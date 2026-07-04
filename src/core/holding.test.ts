import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isPara23Exempt } from './holding';

// isPara23Exempt operates on local-time Date methods throughout (matching
// the app's own history), so the reference boundary here must too — mixing
// Date.UTC with local getFullYear/setDate would misalign whenever the
// runtime's timezone isn't UTC.
function localSeconds(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, m, d, h, mi, s).getTime() / 1000;
}

// The exempt boundary: the first moment of the day AFTER the acquisition's
// one-year anniversary (§187/§188 BGB analog — period begins the day after
// acquisition, expires at the end of the corresponding day one year later).
function firstExemptDayMs(acquisitionTs: number): number {
  const d = new Date(acquisitionTs * 1000);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

describe('isPara23Exempt', () => {
  it('is false when disposalTs is the "not set yet" sentinel (0)', () => {
    expect(isPara23Exempt(1_700_000_000, 0)).toBe(false);
  });

  it('treats acquisitionTs=0 as a real timestamp (epoch), not a sentinel', () => {
    // Acquired at epoch (1970), disposed decades later — well past a year.
    expect(isPara23Exempt(0, 1_700_000_000)).toBe(true);
  });

  it('boundary: any moment on the exact anniversary calendar day is NOT exempt', () => {
    const acq = localSeconds(2023, 4, 10, 0, 0, 0); // 2023-05-10
    expect(isPara23Exempt(acq, localSeconds(2024, 4, 10, 0, 0, 0))).toBe(false);
    expect(isPara23Exempt(acq, localSeconds(2024, 4, 10, 12, 0, 0))).toBe(false);
    expect(isPara23Exempt(acq, localSeconds(2024, 4, 10, 23, 59, 59))).toBe(false);
  });

  it('boundary: the day after the anniversary IS exempt, from its first moment', () => {
    const acq = localSeconds(2023, 4, 10, 0, 0, 0);
    expect(isPara23Exempt(acq, localSeconds(2024, 4, 11, 0, 0, 0))).toBe(true);
  });

  it('handles a Feb 29 acquisition (leap year) correctly', () => {
    const acq = localSeconds(2020, 1, 29, 0, 0, 0); // 2020-02-29
    // setFullYear(2021) on Feb 29 rolls forward to Mar 1, 2021; the exempt
    // boundary is the day after that.
    const justBefore = firstExemptDayMs(acq) / 1000 - 1;
    const justAfter = firstExemptDayMs(acq) / 1000;
    expect(isPara23Exempt(acq, justBefore)).toBe(false);
    expect(isPara23Exempt(acq, justAfter)).toBe(true);
  });

  it('property: exempt on/after the first-exempt-day boundary, not exempt before it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800 }),
        fc.integer({ min: -5000, max: 5000 }),
        (acquisitionTs, offsetSeconds) => {
          const boundaryMs = firstExemptDayMs(acquisitionTs);
          const disposalTs = Math.floor(boundaryMs / 1000) + offsetSeconds;
          const expected = disposalTs * 1000 >= boundaryMs;
          expect(isPara23Exempt(acquisitionTs, disposalTs)).toBe(expected);
        }
      )
    );
  });
});
