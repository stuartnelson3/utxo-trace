// §23 EStG: private disposal gains are tax-free when held for MORE than one year.
// Uses calendar-accurate comparison so leap years are handled correctly.
// "mehr als ein Jahr" means disposalDate must be strictly after the one-year anniversary.
export function isPara23Exempt(acquisitionTs: number, disposalTs: number): boolean {
  if (!disposalTs || !acquisitionTs) return false;
  const oneYearAfterAcq = new Date(acquisitionTs * 1000);
  oneYearAfterAcq.setFullYear(oneYearAfterAcq.getFullYear() + 1);
  return new Date(disposalTs * 1000) > oneYearAfterAcq;
}
