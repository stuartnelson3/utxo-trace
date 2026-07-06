// Holding-duration predicate shared by both jurisdictions' holding-period
// rules: §23 Abs. 1 Nr. 2 EStG (Germany, disposal after >1yr is not taxable)
// and §1222/§1223 IRC (US, long-term vs. short-term rate) both hinge on the
// identical day-count — the period begins the day AFTER acquisition (§187
// Abs. 1 BGB analog) and runs for one year, expiring at the end of the
// calendar day one year later that corresponds to the acquisition day (§188
// Abs. 2 BGB). "More than one year" therefore requires the disposal to fall
// on or after the day AFTER that anniversary date — acquisition 2023-05-10
// exempts only from 2024-05-11 onward; any moment on 2024-05-10 itself is
// still within the one-year period, not yet exempt.
//
// This function only proves a *duration* — not a tax conclusion. Whether
// ">1 year" means "exempt" (Germany) or "long-term rate" (US) is jurisdiction
// interpretation, stated with citations in METHODOLOGY.holdingPeriod, not
// asserted per-row in the UI (see METHODOLOGY.holdingPeriodLabels and the
// components that render it).
export function isHeldOverOneYear(acquisitionTs: number, disposalTs: number): boolean {
  // disposalTs === 0 is the "no disposal date set yet" sentinel (see
  // TraceContext's default). acquisitionTs is always a real block time in
  // practice, so it is NOT given the same falsy-zero treatment — epoch 0
  // (1970-01-01T00:00:00Z) is a valid timestamp, not a sentinel, and
  // treating it as "unset" was a real bug (caught by the property test
  // below at acquisitionTs=0).
  if (!disposalTs) return false;
  const firstExemptDay = new Date(acquisitionTs * 1000);
  firstExemptDay.setFullYear(firstExemptDay.getFullYear() + 1);
  firstExemptDay.setDate(firstExemptDay.getDate() + 1);
  firstExemptDay.setHours(0, 0, 0, 0);
  return new Date(disposalTs * 1000) >= firstExemptDay;
}
