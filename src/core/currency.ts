// Display rounding policy: round-half-to-even ("banker's rounding") at 2
// decimal places. Basis sums are computed in full precision throughout the
// app; this is applied once, at the display boundary, so the rounding mode
// is deterministic regardless of Intl.NumberFormat's engine-specific
// internal rounding. (Belongs conceptually in the METHODOLOGY constants
// task 4 introduces; documented here until that file exists.)
export function roundCurrency(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);

  // Normalize through a high-precision decimal string first to strip binary
  // float noise (e.g. 1.005 * 100 === 100.49999999999999) before checking
  // for an exact tie at the rounding boundary.
  const scaled = Number((abs * 100).toFixed(8));
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPSILON = 1e-9;

  let rounded: number;
  if (Math.abs(diff - 0.5) < EPSILON) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return (sign * rounded) / 100;
}
