import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { roundCurrency } from './currency';

describe('roundCurrency', () => {
  it.each([
    [1.005, 1.0],
    [1.015, 1.02],
    [2.005, 2.0],
    [2.025, 2.02],
    [1.0, 1.0],
    [-1.005, -1.0],
  ])('rounds %s -> %s (half-even)', (input, expected) => {
    expect(roundCurrency(input)).toBeCloseTo(expected, 10);
  });

  it('never moves a value by more than half a cent', () => {
    fc.assert(
      fc.property(fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }), (value) => {
        expect(Math.abs(roundCurrency(value) - value)).toBeLessThanOrEqual(0.005 + 1e-9);
      })
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }), (value) => {
        const once = roundCurrency(value);
        expect(roundCurrency(once)).toBeCloseTo(once, 10);
      })
    );
  });
});
