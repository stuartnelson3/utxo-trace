// Aggregate provenance classification for a set of attributed lots: the
// aggregate is "trades-csv" only if every lot is verified against exchange
// records, "mempool" only if none are, and "mixed" otherwise. Generic over
// any lot carrying a two-tier priceSource so exchanges can share it (task 5
// extends this lattice with an "override" tier).
export function classifyPriceSource<S extends string>(
  sources: S[],
  verified: S,
  fallback: S
): S | 'mixed' {
  if (sources.every((s) => s === verified)) return verified;
  if (sources.every((s) => s === fallback)) return fallback;
  return 'mixed';
}
