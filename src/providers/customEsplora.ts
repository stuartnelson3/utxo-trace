import { TxSource, EsploraTx } from '../core/providers';
import { parseEsploraTx } from '../core/esplora';
import { FetchQueue, RetryableError } from './queue';

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

// mempool.space, Blockstream Esplora, and a self-hosted esplora/electrs all
// serve GET {base}/tx/:txid identically, so one implementation covers all
// three — only the base URL and label differ.
export class CustomEsploraTxSource implements TxSource {
  readonly label: string;

  constructor(
    private readonly baseUrl: string,
    private readonly queue: FetchQueue
  ) {
    this.label = `custom:${baseUrl}`;
  }

  async getTx(txid: string): Promise<EsploraTx> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/tx/${txid}`;
    const data = await this.queue.run(`${this.label}:tx:${txid}`, async () => {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableError(`${url} -> ${res.status}`, res.status, retryAfterMs(res));
      }
      if (!res.ok) throw new Error('TX not found');
      return res.json();
    });
    return parseEsploraTx(data);
  }
}

// Block 170's coinbase-to-Hal-Finney transaction (the first bitcoin-to-bitcoin
// transfer) — NOT the genesis coinbase, which consensus rules exclude from
// the UTXO set and which most Esplora-compatible backends refuse to serve.
// Present on every real backend, so it's a reliable connectivity + shape
// probe before accepting a custom endpoint in the settings UI.
export const GENESIS_TXID = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';

export async function probeEsploraEndpoint(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/tx/${GENESIS_TXID}`);
    if (!res.ok) return false;
    parseEsploraTx(await res.json());
    return true;
  } catch {
    return false;
  }
}
