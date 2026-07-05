import { PriceSource } from '../core/providers';
import { parseKrakenOhlcClose, KrakenOhlcResponse } from '../core/krakenOhlc';
import { FetchQueue, RetryableError } from './queue';

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

// Public, keyless, CORS-enabled — used only as an optional cross-check
// against the primary mempool.space price, never as a silent substitute.
export class KrakenOhlcPriceSource implements PriceSource {
  readonly label = 'kraken-ohlc';
  constructor(private readonly queue: FetchQueue) {}

  async getDailyUsd(snappedTs: number): Promise<number> {
    const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=${snappedTs}`;
    const data = await this.queue.run(`${this.label}:price:${snappedTs}`, async () => {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableError(`${url} -> ${res.status}`, res.status, retryAfterMs(res));
      }
      if (!res.ok) throw new Error('Kraken OHLC not found');
      return (await res.json()) as KrakenOhlcResponse;
    });
    return parseKrakenOhlcClose(data, snappedTs);
  }
}
