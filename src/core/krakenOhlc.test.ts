import { describe, it, expect } from 'vitest';
import { parseKrakenOhlcClose, KrakenOhlcResponse } from './krakenOhlc';
import fixtureJson from './__fixtures__/kraken-ohlc.json';

const fixture = fixtureJson as unknown as KrakenOhlcResponse;

describe('parseKrakenOhlcClose', () => {
  it('picks the covering candle for a mid-day timestamp', () => {
    const midDay = 1690156800 + 16 * 3600; // 16:00 UTC on the first candle's day
    expect(parseKrakenOhlcClose(fixture, midDay)).toBe(29380.5);
  });

  it('picks the candle exactly at a snap/candle boundary', () => {
    expect(parseKrakenOhlcClose(fixture, 1690243200)).toBe(29510.0);
  });

  it('picks the latest candle at or before an arbitrary timestamp', () => {
    const lateInThirdDay = 1690329600 + 3600;
    expect(parseKrakenOhlcClose(fixture, lateInThirdDay)).toBe(29650.2);
  });

  it('throws if no candle covers the requested timestamp', () => {
    expect(() => parseKrakenOhlcClose(fixture, 1690156800 - 1)).toThrow();
  });
});
