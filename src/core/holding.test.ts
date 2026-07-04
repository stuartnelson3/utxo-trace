import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isPara23Exempt } from './holding';

const oneYearMs = (acquisitionTs: number) => {
  const d = new Date(acquisitionTs * 1000);
  d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
};

describe('isPara23Exempt', () => {
  it('is false with no disposal or acquisition timestamp', () => {
    expect(isPara23Exempt(0, 1_700_000_000)).toBe(false);
    expect(isPara23Exempt(1_700_000_000, 0)).toBe(false);
  });

  it('boundary: disposal exactly one year after acquisition is NOT exempt', () => {
    const acq = Date.UTC(2023, 4, 10) / 1000; // 2023-05-10
    const disposalExactlyOneYear = Date.UTC(2024, 4, 10) / 1000; // 2024-05-10
    expect(isPara23Exempt(acq, disposalExactlyOneYear)).toBe(false);
  });

  it('boundary: one year and one day after acquisition IS exempt', () => {
    const acq = Date.UTC(2023, 4, 10) / 1000;
    const disposalOneYearOneDay = Date.UTC(2024, 4, 11) / 1000;
    expect(isPara23Exempt(acq, disposalOneYearOneDay)).toBe(true);
  });

  it('handles a Feb 29 acquisition (leap year) correctly', () => {
    const acq = Date.UTC(2020, 1, 29) / 1000; // 2020-02-29
    // setFullYear(2021) on Feb 29 rolls forward to Mar 1, 2021
    const justBefore = Date.UTC(2021, 2, 1) / 1000 - 1;
    const justAfter = Date.UTC(2021, 2, 1) / 1000 + 1;
    expect(isPara23Exempt(acq, justBefore)).toBe(false);
    expect(isPara23Exempt(acq, justAfter)).toBe(true);
  });

  it('property: exempt for any timestamp strictly after the anniversary, not exempt at or before', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800 }),
        fc.integer({ min: -5000, max: 5000 }),
        (acquisitionTs, offsetSeconds) => {
          const anniversaryMs = oneYearMs(acquisitionTs);
          const disposalTs = Math.floor(anniversaryMs / 1000) + offsetSeconds;
          const expected = disposalTs * 1000 > anniversaryMs;
          expect(isPara23Exempt(acquisitionTs, disposalTs)).toBe(expected);
        }
      )
    );
  });
});
