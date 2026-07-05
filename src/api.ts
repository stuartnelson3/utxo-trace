import { UTXONode } from './core/types';
import { EsploraTx, TxSource } from './core/providers';
import { prevDailySnapshot, toDayKey } from './core/price';
import { relativeDivergence, isDivergent } from './core/divergence';
import { FetchQueue, RetryableError } from './providers/queue';
import { MempoolSpaceTxSource, MempoolSpacePriceSource } from './providers/mempoolSpace';
import { CustomEsploraTxSource } from './providers/customEsplora';
import { KrakenOhlcPriceSource } from './providers/krakenOhlc';

// mempool.space USD prices are reliable. EUR data has gaps, so we always fetch
// USD and store the ECB rate separately. The display layer converts at render
// time so the user can toggle currencies without re-fetching. See pricing-api.md.

// Shared across all fetches: bounds concurrency, dedupes in-flight requests
// for the same key, and retries 429/5xx with backoff. Expanding a tree that
// references the same parent txid twice fetches it once.
export const queue = new FetchQueue();

const mempoolTxSource = new MempoolSpaceTxSource(queue);
const mempoolPriceSource = new MempoolSpacePriceSource(queue);
const krakenPriceSource = new KrakenOhlcPriceSource(queue);

let activeTxSource: TxSource = mempoolTxSource;
let crossCheckEnabled = false;

// Keyed by (sourceLabel, ...) so switching sources can never serve stale
// cross-source data. Exported readonly-ish for task 7's session bundle to
// serialize; App.tsx doesn't mutate these directly.
export const txCache = new Map<string, EsploraTx>(); // `${sourceLabel}:${txid}`
export const priceCache = new Map<string, number>(); // `${sourceLabel}:${day}`
export const fxCache = new Map<string, number>(); // day (single source: ECB)

export interface PriceDivergence {
  day: string;
  primaryUsd: number;
  crossCheckUsd: number;
  divergence: number; // fraction, e.g. 0.025 for 2.5%
}
export const priceDivergences: PriceDivergence[] = [];
let crossCheckStats = { total: 0, verified: 0 };

export function getCrossCheckStats() {
  return { ...crossCheckStats };
}

// A new trace starts a new report; stats/divergences are per-report.
export function resetCrossCheckStats() {
  priceDivergences.length = 0;
  crossCheckStats = { total: 0, verified: 0 };
}

export function setCustomEsploraSource(baseUrl: string | null): void {
  activeTxSource = baseUrl ? new CustomEsploraTxSource(baseUrl, queue) : mempoolTxSource;
}

export function getActiveTxSourceLabel(): string {
  return activeTxSource.label;
}

export function setPriceCrossCheck(enabled: boolean): void {
  crossCheckEnabled = enabled;
}

export async function fetchTx(txid: string): Promise<EsploraTx> {
  const key = `${activeTxSource.label}:${txid}`;
  const cached = txCache.get(key);
  if (cached) return cached;
  const tx = await activeTxSource.getTx(txid);
  txCache.set(key, tx);
  return tx;
}

async function crossCheckAgainstKraken(
  day: string,
  snappedTs: number,
  primaryUsd: number
): Promise<void> {
  const krakenKey = `${krakenPriceSource.label}:${day}`;
  let krakenUsd = priceCache.get(krakenKey);
  if (krakenUsd === undefined) {
    try {
      krakenUsd = await krakenPriceSource.getDailyUsd(snappedTs);
    } catch {
      // Best-effort: a failed cross-check never affects the primary price.
      // In practice this fires often for older transactions — Kraken's
      // public OHLC endpoint only retains a limited historical window
      // (verified live: ~720 daily candles back from now), so tracing a
      // multi-year-old UTXO will usually find no covering Kraken candle
      // at all, not a divergence.
      return;
    }
    priceCache.set(krakenKey, krakenUsd);
  }
  crossCheckStats.total++;
  const divergence = relativeDivergence(primaryUsd, krakenUsd);
  if (isDivergent(primaryUsd, krakenUsd)) {
    priceDivergences.push({ day, primaryUsd, crossCheckUsd: krakenUsd, divergence });
  } else {
    crossCheckStats.verified++;
  }
}

export async function fetchRawBtcUsd(ts: number): Promise<number> {
  const day = toDayKey(prevDailySnapshot(ts));
  const key = `${mempoolPriceSource.label}:${day}`;
  let usd = priceCache.get(key);
  if (usd === undefined) {
    usd = await mempoolPriceSource.getDailyUsd(ts);
    priceCache.set(key, usd);
  }

  if (crossCheckEnabled && usd > 0) {
    await crossCheckAgainstKraken(day, prevDailySnapshot(ts), usd);
  }

  return usd;
}

export async function fetchUsdToEurRate(ts: number): Promise<number> {
  const day = toDayKey(ts);
  const cached = fxCache.get(day);
  if (cached !== undefined) return cached;

  async function fetchJson(url: string, notFoundMessage: string): Promise<any> {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) {
      const header = res.headers.get('Retry-After');
      const seconds = header ? Number(header) : NaN;
      throw new RetryableError(
        `${url} -> ${res.status}`,
        res.status,
        Number.isFinite(seconds) ? seconds * 1000 : undefined
      );
    }
    if (!res.ok) throw new Error(notFoundMessage);
    return res.json();
  }

  const data = await queue.run(`ecb:fx:${day}`, () =>
    fetchJson(`https://api.frankfurter.dev/v1/${day}?from=USD&to=EUR`, 'FX rate not found')
  );
  const rate = data.rates?.EUR;
  if (rate == null) throw new Error('EUR rate missing from response');
  fxCache.set(day, rate);
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
  const inputs = txData.vin.filter((inp): inp is { txid: string; vout: number } => !!inp.txid);
  return Promise.all(inputs.map((inp) => fetchNodeData(inp.txid, inp.vout!)));
}
