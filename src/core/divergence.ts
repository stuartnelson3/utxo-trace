// Relative divergence between two price estimates for the same day.
// Symmetric (divergence(a,b) === divergence(b,a)) so it doesn't matter
// which source is "primary" for the magnitude of disagreement.
export function relativeDivergence(a: number, b: number): number {
  const mean = (a + b) / 2;
  if (mean === 0) return a === b ? 0 : Infinity;
  return Math.abs(a - b) / mean;
}

export const DIVERGENCE_THRESHOLD = 0.02; // 2%

// Strictly greater than the threshold flags; exactly at it does not.
export function isDivergent(
  a: number,
  b: number,
  thresholdFraction = DIVERGENCE_THRESHOLD
): boolean {
  return relativeDivergence(a, b) > thresholdFraction;
}
