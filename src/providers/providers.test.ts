import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchQueue } from './queue';
import { MempoolSpaceTxSource } from './mempoolSpace';
import { CustomEsploraTxSource } from './customEsplora';
import mempoolSpaceFixture from '../core/__fixtures__/mempool-space-tx.json';

describe('provider swap: mempool.space vs. a custom Esplora endpoint', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('produce identical core computation results for the same underlying tx data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mempoolSpaceFixture,
      }))
    );

    const mempoolTx = await new MempoolSpaceTxSource(new FetchQueue()).getTx(
      mempoolSpaceFixture.txid
    );
    const customTx = await new CustomEsploraTxSource(
      'http://127.0.0.1:3000/api',
      new FetchQueue()
    ).getTx(mempoolSpaceFixture.txid);

    // Only the source label may differ; the parsed shape must be identical.
    expect(mempoolTx.txid).toBe(customTx.txid);
    expect(mempoolTx.status).toEqual(customTx.status);
    expect(mempoolTx.vin).toEqual(customTx.vin);
    expect(mempoolTx.vout).toEqual(customTx.vout);
  });
});
