// Decimal BTC string -> integer sats. Task 9 replaces the internals with
// exact BigInt-based parsing; this wrapper exists now so call sites don't
// need to change again when that lands.
export function parseBtcToSats(s: string): number {
  return Math.round((parseFloat(s) || 0) * 1e8);
}
