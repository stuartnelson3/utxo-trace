import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { relativeDivergence, isDivergent, DIVERGENCE_THRESHOLD } from './divergence';

describe('relativeDivergence', () => {
  it('is zero for identical values', () => {
    expect(relativeDivergence(100, 100)).toBe(0);
  });

  it('is symmetric', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        (a, b) => {
          expect(relativeDivergence(a, b)).toBeCloseTo(relativeDivergence(b, a), 10);
        }
      )
    );
  });

  it('computes the documented formula', () => {
    // |30000 - 30600| / ((30000+30600)/2) = 600/30300 ≈ 0.0198
    expect(relativeDivergence(30000, 30600)).toBeCloseTo(600 / 30300, 10);
  });
});

describe('isDivergent', () => {
  it('threshold-exact case: exactly 2.0% is NOT flagged', () => {
    // a=100, b=102.0408... gives exactly 2% relative divergence at mean~101.02
    const a = 100;
    const b = a * (1 + (DIVERGENCE_THRESHOLD * 2) / (2 - DIVERGENCE_THRESHOLD));
    expect(relativeDivergence(a, b)).toBeCloseTo(DIVERGENCE_THRESHOLD, 10);
    expect(isDivergent(a, b)).toBe(false);
  });

  it('strictly greater than 2% IS flagged', () => {
    expect(isDivergent(100, 103)).toBe(true);
  });

  it('well within tolerance is not flagged', () => {
    expect(isDivergent(30000, 30100)).toBe(false);
  });
});
