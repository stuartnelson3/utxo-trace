import type { DisplayCurrency } from '../config';
import { METHODOLOGY } from './methodology';

// mempool.space snapshots are ~daily at 16:00 UTC; timestamps outside that
// window return -1 from the API. Falling back to the prior snapshot means
// re-querying at this floored timestamp. Sourced from METHODOLOGY so the
// report's documented snap rule and this code cannot drift apart.
export const SNAP_ANCHOR_UTC_HOUR = METHODOLOGY.priceOracle.snapAnchorUtcHour;

export function prevDailySnapshot(ts: number): number {
  return (
    Math.floor((ts - SNAP_ANCHOR_UTC_HOUR * 3600) / 86400) * 86400 + SNAP_ANCHOR_UTC_HOUR * 3600
  );
}

// Cache key for a timestamp's calendar day (UTC), used to key the daily
// USD->EUR rate cache so same-day timestamps share one lookup.
export function toDayKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// Apply a USD->EUR rate to a USD price for display in the requested currency.
export function applyRate(usd: number, currency: DisplayCurrency, usdToEur: number): number {
  return currency === 'EUR' ? usd * usdToEur : usd;
}
