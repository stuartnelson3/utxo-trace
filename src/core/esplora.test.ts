import { describe, it, expect } from 'vitest';
import { parseEsploraTx } from './esplora';
import mempoolSpaceFixture from './__fixtures__/mempool-space-tx.json';
import electrsFixture from './__fixtures__/electrs-tx.json';

describe('parseEsploraTx', () => {
  it('accepts a recorded mempool.space response, ignoring extra fields', () => {
    const tx = parseEsploraTx(mempoolSpaceFixture);
    expect(tx.txid).toBe(mempoolSpaceFixture.txid);
    expect(tx.status.block_time).toBe(1690168629);
    expect(tx.vout[0].value).toBe(143332);
  });

  it('accepts a recorded electrs response with a leaner shape', () => {
    const tx = parseEsploraTx(electrsFixture);
    expect(tx.txid).toBe(electrsFixture.txid);
    expect(tx.vout[0].value).toBe(143332);
    expect(tx.vin[0].txid).toBe(electrsFixture.vin[0].txid);
  });

  it('rejects a response missing vout values', () => {
    const broken = {
      ...mempoolSpaceFixture,
      vout: [{ scriptpubkey_address: 'bc1q...' }], // no `value`
    };
    expect(() => parseEsploraTx(broken)).toThrow();
  });

  it('rejects a response missing status.block_time', () => {
    const broken = { ...mempoolSpaceFixture, status: { confirmed: true } };
    expect(() => parseEsploraTx(broken)).toThrow();
  });
});
