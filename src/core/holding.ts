// §23 EStG: private disposal gains are tax-free when held for MORE than one year.
// Uses calendar-accurate comparison so leap years are handled correctly.
// "mehr als ein Jahr" means disposalDate must be strictly after the one-year anniversary.
export function isPara23Exempt(acquisitionTs: number, disposalTs: number): boolean {
  // disposalTs === 0 is the "no disposal date set yet" sentinel (see
  // TraceContext's default). acquisitionTs is always a real block time in
  // practice, so it is NOT given the same falsy-zero treatment — epoch 0
  // (1970-01-01T00:00:00Z) is a valid timestamp, not a sentinel, and
  // treating it as "unset" was a real bug (caught by the property test
  // below at acquisitionTs=0).
  if (!disposalTs) return false;
  const oneYearAfterAcq = new Date(acquisitionTs * 1000);
  oneYearAfterAcq.setFullYear(oneYearAfterAcq.getFullYear() + 1);
  return new Date(disposalTs * 1000) > oneYearAfterAcq;
}
