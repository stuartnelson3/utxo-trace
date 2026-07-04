import { UTXONode } from './core/types';
import { prevDailySnapshot, toDayKey } from './core/price';

// mempool.space USD prices are reliable. EUR data has gaps, so we always fetch
// USD and store the ECB rate separately. The display layer converts at render
// time so the user can toggle currencies without re-fetching. See pricing-api.md.

const eurRateCache = new Map<string, number>();

async function fetchBtcUsd(ts: number): Promise<number> {
  const res = await fetch(
    `https://mempool.space/api/v1/historical-price?currency=USD&timestamp=${ts}`
  );
  if (!res.ok) throw new Error(`mempool.space error: ${res.statusText}`);
  const data = await res.json();
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
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?from=USD&to=EUR`);
  if (!res.ok) throw new Error(`frankfurter error: ${res.statusText}`);
  const data = await res.json();
  const rate = data.rates?.EUR;
  if (rate == null) throw new Error('EUR rate missing from response');
  eurRateCache.set(date, rate);
  return rate;
}

export async function fetchNodeData(txid: string, vout: number): Promise<UTXONode> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const txRes = await fetch(`https://mempool.space/api/tx/${txid}`);
  if (!txRes.ok) throw new Error('TX not found');
  const txData = await txRes.json();

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
  const res = await fetch(`https://mempool.space/api/tx/${parentTxid}`);
  if (!res.ok) throw new Error('Failed to fetch inputs');
  const txData = await res.json();
  return Promise.all(
    txData.vin.filter((inp: any) => inp.txid).map((inp: any) => fetchNodeData(inp.txid, inp.vout))
  );
}
