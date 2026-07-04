// Aggregate provenance classification for a set of attributed lots: the
// aggregate is "trades-csv" only if every lot is verified against exchange
// records, "mempool" only if none are, and "mixed" otherwise. Generic over
// any lot carrying a two-tier priceSource so exchanges can share it.
export function classifyPriceSource<S extends string>(
  sources: S[],
  verified: S,
  fallback: S
): S | 'mixed' {
  if (sources.every((s) => s === verified)) return verified;
  if (sources.every((s) => s === fallback)) return fallback;
  return 'mixed';
}

// The full per-leaf provenance lattice, spanning both exchange-attribution
// quality and manual assertion. "override" dominates the aggregate even if
// only one contributing source rests on user assertion — a total resting
// even partly on assertion must say so, not average it away.
export type ProvenanceTier = 'trades-csv' | 'mempool' | 'mixed' | 'override';

export function classifyProvenance(tiers: ProvenanceTier[]): ProvenanceTier {
  if (tiers.some((t) => t === 'override')) return 'override';
  if (tiers.every((t) => t === 'trades-csv')) return 'trades-csv';
  if (tiers.every((t) => t === 'mempool')) return 'mempool';
  return 'mixed';
}
