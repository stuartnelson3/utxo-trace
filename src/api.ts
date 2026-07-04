import { UTXONode } from './core/types';
import { prevDailySnapshot, toDayKey } from './core/price';
import { FetchQueue, RetryableError } from './providers/queue';

// mempool.space USD prices are reliable. EUR data has gaps, so we always fetch
// USD and store the ECB rate separately. The display layer converts at render
// time so the user can toggle currencies without re-fetching. See pricing-api.md.

const eurRateCache = new Map<string, number>();
const txCache = new Map<string, unknown>();

// Shared across all fetches: bounds concurrency, dedupes in-flight requests
// for the same key, and retries 429/5xx with backoff. Expanding a tree that
// references the same parent txid twice fetches it once.
export const queue = new FetchQueue();

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

async function fetchJson(url: string, notFoundMessage: string): Promise<any> {
  const res = await fetch(url);
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableError(`${url} -> ${res.status}`, res.status, retryAfterMs(res));
  }
  if (!res.ok) throw new Error(notFoundMessage);
  return res.json();
}

async function fetchTx(txid: string): Promise<any> {
  const cached = txCache.get(txid);
  if (cached) return cached;
  const txData = await queue.run(`tx:${txid}`, () =>
    fetchJson(`https://mempool.space/api/tx/${txid}`, 'TX not found')
  );
  txCache.set(txid, txData);
  return txData;
}

async function fetchBtcUsd(ts: number): Promise<number> {
  const data = await queue.run(`price:${ts}`, () =>
    fetchJson(
      `https://mempool.space/api/v1/historical-price?currency=USD&timestamp=${ts}`,
      'price not found'
    )
  );
  return data.prices?.[0]?.USD ?? -1;
}

export async function fetchRawBtcUsd(ts: number): Promise<number> {
  let usd = await fetchBtcUsd(ts);
  if (usd < 0) usd = await fetchBtcUsd(prevDailySnapshot(ts));
  return usd > 0 ? usd : 0;
}

export async function fetchUsdToEurRate(ts: number): Promise<number> {
  const date = toDayKey(ts);
  if (eurRateCache.has(date)) return eurRateCache.get(date)!;
  const data = await queue.run(`fx:${date}`, () =>
    fetchJson(`https://api.frankfurter.dev/v1/${date}?from=USD&to=EUR`, 'FX rate not found')
  );
  const rate = data.rates?.EUR;
  if (rate == null) throw new Error('EUR rate missing from response');
  eurRateCache.set(date, rate);
  return rate;
}

export async function fetchNodeData(txid: string, vout: number): Promise<UTXONode> {
  const txData = await fetchTx(txid);
  const selectedOutput = txData.vout[vout];
  const timestamp = txData.status.block_time;

  const [priceBtcUsd, usdToEur] = await Promise.all([
    fetchRawBtcUsd(timestamp).catch(() => 0),
    fetchUsdToEurRate(timestamp).catch(() => 0),
  ]);

  return {
    id: `${txid}:${vout}`,
    txid,
    vout,
    amountSats: selectedOutput.value,
    timestamp,
    priceBtcUsd,
    usdToEur,
    isOverride: false,
    children: [],
  };
}

export async function fetchChildNodes(parentTxid: string): Promise<UTXONode[]> {
  const txData = await fetchTx(parentTxid);
  const inputs = txData.vin.filter((inp: any) => inp.txid);
  return Promise.all(inputs.map((inp: any) => fetchNodeData(inp.txid, inp.vout)));
}
