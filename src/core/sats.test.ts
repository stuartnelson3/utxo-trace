import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseBtcToSats } from './sats';

describe('parseBtcToSats', () => {
  it.each([
    ['0.00000001', 1],
    ['21000000', 2_100_000_000_000_000],
    ['0.1', 10_000_000],
    ['0.30000000', 30_000_000],
    ['20999999.99999999', 2_099_999_999_999_999],
    ['-0.5', -50_000_000],
    ['', 0],
  ])('parses %s -> %i sats', (input, expected) => {
    expect(parseBtcToSats(input)).toBe(expected);
  });

  // Task 9 replaces the float-based parser with an exact BigInt one that
  // validates input instead of silently coercing it. These document the
  // current, known-loose behavior so the gap doesn't get lost.
  it.fails('rejects scientific notation (task 9)', () => {
    expect(() => parseBtcToSats('1e-8')).toThrow();
  });

  it.fails('rejects malformed input instead of truncating (task 9)', () => {
    expect(() => parseBtcToSats('1,5')).toThrow();
  });

  it.fails('rejects more than 8 decimal places instead of rounding (task 9)', () => {
    expect(() => parseBtcToSats('0.123456789')).toThrow();
  });

  it('round-trips arbitrary integer sats through toFixed(8) formatting', () => {
    fc.assert(
      fc.property(fc.integer({ min: -21_000_000 * 1e8, max: 21_000_000 * 1e8 }), (sats) => {
        const btcString = (sats / 1e8).toFixed(8);
        expect(parseBtcToSats(btcString)).toBe(sats);
      })
    );
  });
});
