import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseBtcToSats, formatSats, assertSats, ParseError } from './sats';

describe('parseBtcToSats', () => {
  it.each([
    ['0.00000001', 1],
    ['21000000', 2_100_000_000_000_000],
    ['0.1', 10_000_000],
    ['0.30000000', 30_000_000],
    ['20999999.99999999', 2_099_999_999_999_999],
    ['-0.5', -50_000_000],
  ])('parses %s -> %i sats', (input, expected) => {
    expect(parseBtcToSats(input)).toBe(expected);
  });

  it.each([['1e-8'], ['1,5'], [''], ['0.123456789'], ['abc'], ['0.-5'], ['1.2.3']])(
    'rejects %s',
    (input) => {
      expect(() => parseBtcToSats(input)).toThrow(ParseError);
    }
  );

  it('round-trips arbitrary integer sats through toFixed(8) formatting', () => {
    fc.assert(
      fc.property(fc.integer({ min: -21_000_000 * 1e8, max: 21_000_000 * 1e8 }), (sats) => {
        const btcString = (sats / 1e8).toFixed(8);
        expect(parseBtcToSats(btcString)).toBe(sats);
      })
    );
  });
});

describe('formatSats', () => {
  it('formats sats to an 8-decimal BTC string', () => {
    expect(formatSats(1)).toBe('0.00000001');
    expect(formatSats(100_000_000)).toBe('1.00000000');
    expect(formatSats(-50_000_000)).toBe('-0.50000000');
    expect(formatSats(0)).toBe('0.00000000');
  });

  it('rejects non-safe-integer input', () => {
    expect(() => formatSats(1.5)).toThrow();
    expect(() => formatSats(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('parseBtcToSats <-> formatSats round trip', () => {
  it('formatSats(parseBtcToSats(s)) round-trips modulo trailing zeros', () => {
    fc.assert(
      fc.property(fc.integer({ min: -21_000_000 * 1e8, max: 21_000_000 * 1e8 }), (sats) => {
        const s = formatSats(sats);
        expect(parseBtcToSats(s)).toBe(sats);
      })
    );
  });

  it('parseBtcToSats(formatSats(n)) === n for arbitrary safe integer sats', () => {
    fc.assert(
      fc.property(fc.integer({ min: -21_000_000 * 1e8, max: 21_000_000 * 1e8 }), (n) => {
        expect(parseBtcToSats(formatSats(n))).toBe(n);
      })
    );
  });
});

describe('assertSats', () => {
  it('passes for safe integers, throws otherwise', () => {
    expect(() => assertSats(0)).not.toThrow();
    expect(() => assertSats(-100)).not.toThrow();
    expect(() => assertSats(1.5)).toThrow();
    expect(() => assertSats(Number.NaN)).toThrow();
  });
});
