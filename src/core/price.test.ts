import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { prevDailySnapshot, toDayKey, applyRate, SNAP_ANCHOR_UTC_HOUR } from './price';

const arbTimestamp = fc.integer({ min: 0, max: 4_102_444_800 }); // 1970..2100

describe('prevDailySnapshot', () => {
  it('always lands exactly on the anchor UTC hour', () => {
    fc.assert(
      fc.property(arbTimestamp, (ts) => {
        const snapped = prevDailySnapshot(ts);
        expect(new Date(snapped * 1000).getUTCHours()).toBe(SNAP_ANCHOR_UTC_HOUR);
        expect(new Date(snapped * 1000).getUTCMinutes()).toBe(0);
        expect(new Date(snapped * 1000).getUTCSeconds()).toBe(0);
      })
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(arbTimestamp, (ts) => {
        const once = prevDailySnapshot(ts);
        expect(prevDailySnapshot(once)).toBe(once);
      })
    );
  });

  // The snap floors to the PRIOR anchor, so t is always within a day of it —
  // but never before it (t - snap(t) is never negative).
  it('t - snap(t) is in [0, 86400)', () => {
    fc.assert(
      fc.property(arbTimestamp, (ts) => {
        const delta = ts - prevDailySnapshot(ts);
        expect(delta).toBeGreaterThanOrEqual(0);
        expect(delta).toBeLessThan(86400);
      })
    );
  });
});

describe('toDayKey', () => {
  it('maps same-day timestamps to the same key', () => {
    const morning = Date.UTC(2023, 4, 10, 1, 0, 0) / 1000;
    const evening = Date.UTC(2023, 4, 10, 23, 59, 0) / 1000;
    expect(toDayKey(morning)).toBe(toDayKey(evening));
    expect(toDayKey(morning)).toBe('2023-05-10');
  });

  it('maps different days to different keys', () => {
    const day1 = Date.UTC(2023, 4, 10, 12, 0, 0) / 1000;
    const day2 = Date.UTC(2023, 4, 11, 12, 0, 0) / 1000;
    expect(toDayKey(day1)).not.toBe(toDayKey(day2));
  });
});

describe('applyRate', () => {
  it('passes USD through unchanged', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true }), (usd) => {
        expect(applyRate(usd, 'USD', 0.92)).toBe(usd);
      })
    );
  });

  it('multiplies by the rate for EUR', () => {
    expect(applyRate(100, 'EUR', 0.9)).toBeCloseTo(90);
  });
});
