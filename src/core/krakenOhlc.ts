// Pure parsing of Kraken's OHLC response shape — kept separate from the
// fetch wrapper (src/providers/krakenOhlc.ts) so it's testable with a
// recorded fixture, no network involved.
//
// Response shape: { error: [], result: { <pairKey>: [[time, open, high,
// low, close, vwap, volume, count], ...], last: <ts> } }. The pair key
// itself varies (Kraken renames crypto/fiat pairs with X/Z prefixes, e.g.
// "XXBTZUSD"), so it's found by elimination rather than assumed.
type KrakenCandle = [number, string, string, string, string, string, string, number];

export interface KrakenOhlcResponse {
  error: string[];
  result: Record<string, KrakenCandle[] | number>;
}

export function parseKrakenOhlcClose(response: KrakenOhlcResponse, snappedTs: number): number {
  const pairKey = Object.keys(response.result).find((k) => k !== 'last');
  if (!pairKey) throw new Error('no OHLC pair data in Kraken response');
  const candles = response.result[pairKey] as KrakenCandle[];

  // Each candle covers [time, time+86400). Pick the one containing
  // snappedTs, falling back to the latest candle at or before it.
  let best: KrakenCandle | null = null;
  for (const candle of candles) {
    const time = candle[0];
    if (time <= snappedTs && (!best || time > best[0])) best = candle;
  }
  if (!best) throw new Error(`no OHLC candle covers timestamp ${snappedTs}`);
  return parseFloat(best[4]);
}
