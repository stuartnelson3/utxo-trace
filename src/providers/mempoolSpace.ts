import { TxSource, PriceSource, EsploraTx } from '../core/providers';
import { parseEsploraTx } from '../core/esplora';
import { prevDailySnapshot } from '../core/price';
import { FetchQueue, RetryableError } from './queue';

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

async function fetchJson(url: string, notFoundMessage: string): Promise<unknown> {
  const res = await fetch(url);
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableError(`${url} -> ${res.status}`, res.status, retryAfterMs(res));
  }
  if (!res.ok) throw new Error(notFoundMessage);
  return res.json();
}

export class MempoolSpaceTxSource implements TxSource {
  readonly label = 'mempool.space';
  constructor(private readonly queue: FetchQueue) {}

  async getTx(txid: string): Promise<EsploraTx> {
    const data = await this.queue.run(`${this.label}:tx:${txid}`, () =>
      fetchJson(`https://mempool.space/api/tx/${txid}`, 'TX not found')
    );
    return parseEsploraTx(data);
  }
}

export class MempoolSpacePriceSource implements PriceSource {
  readonly label = 'mempool.space';
  constructor(private readonly queue: FetchQueue) {}

  private async fetchAt(ts: number): Promise<number> {
    const data = (await this.queue.run(`${this.label}:price:${ts}`, () =>
      fetchJson(
        `https://mempool.space/api/v1/historical-price?currency=USD&timestamp=${ts}`,
        'price not found'
      )
    )) as { prices?: Array<{ USD?: number }> };
    return data.prices?.[0]?.USD ?? -1;
  }

  async getDailyUsd(snappedTs: number): Promise<number> {
    let usd = await this.fetchAt(snappedTs);
    if (usd < 0) usd = await this.fetchAt(prevDailySnapshot(snappedTs));
    return usd > 0 ? usd : 0;
  }
}
