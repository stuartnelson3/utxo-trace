import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EvidenceBundleSchema, EvidenceBundle, hashBundle, canonicalJson, migrate } from './bundle';

function minimalBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const base: EvidenceBundle = {
    schemaVersion: 1,
    app: { version: '1.0.0', commit: 'dev' },
    createdAt: '2024-01-01T00:00:00.000Z',
    inputs: {
      rootTxid: 'a'.repeat(64),
      selectedVout: 0,
      disposal: null,
    },
    krakenLedger: [
      {
        txid: 'L1',
        refid: 'R1',
        time: '2023-01-01T00:00:00.000Z',
        type: 'trade',
        amountSats: 100_000_000,
        feeSats: 0,
      },
    ],
    krakenTrades: [],
    swanLots: [],
    swanWithdrawals: [],
    txCache: {
      'mempool.space:abc': {
        txid: 'abc',
        status: { block_time: 1_700_000_000 },
        vin: [],
        vout: [{ value: 100_000_000, scriptpubkey_address: 'bc1q...' }],
      },
    },
    priceCache: [{ source: 'mempool.space', day: '2023-01-01', usd: 30000 }],
    fxCache: [{ day: '2023-01-01', usdToEur: 0.92 }],
    tree: { expandedIds: ['root'] },
    matches: [{ nodeId: 'n1', refid: 'R1', amountBasis: 'net' }],
    overrides: [],
    prunedBranches: [],
  };
  return { ...base, ...overrides };
}

describe('EvidenceBundleSchema', () => {
  it('accepts a well-formed bundle', () => {
    expect(() => EvidenceBundleSchema.parse(minimalBundle())).not.toThrow();
  });

  it('rejects non-finite prices', () => {
    const bad = minimalBundle({
      priceCache: [{ source: 'x', day: '2023-01-01', usd: Infinity }],
    });
    expect(() => EvidenceBundleSchema.parse(bad)).toThrow();
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively, regardless of insertion order', () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order (order is meaningful, e.g. ledger rows)', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });
});

describe('hashBundle', () => {
  it('is stable regardless of key insertion order in the source object', async () => {
    const bundle = minimalBundle();
    const reordered = JSON.parse(JSON.stringify(bundle)); // same data, same JS key order here
    // Build a genuinely different-order object by round-tripping through a
    // Map and rebuilding keys in reverse.
    const reorderedKeys = Object.fromEntries(Object.entries(bundle).reverse()) as EvidenceBundle;
    expect(await hashBundle(bundle)).toBe(await hashBundle(reorderedKeys));
    expect(await hashBundle(bundle)).toBe(await hashBundle(reordered));
  });

  it('excludes createdAt: changing it alone does not change the hash', async () => {
    const a = minimalBundle({ createdAt: '2024-01-01T00:00:00.000Z' });
    const b = minimalBundle({ createdAt: '2025-06-15T12:34:56.000Z' });
    expect(await hashBundle(a)).toBe(await hashBundle(b));
  });

  it('changes when a single sat value is mutated', async () => {
    const a = minimalBundle();
    const b = minimalBundle({
      krakenLedger: [{ ...a.krakenLedger[0], amountSats: a.krakenLedger[0].amountSats + 1 }],
    });
    expect(await hashBundle(a)).not.toBe(await hashBundle(b));
  });

  it('changes when a single memo character is mutated', async () => {
    const withOverride = (memo: string): EvidenceBundle =>
      minimalBundle({
        overrides: [
          {
            nodeId: 'n1',
            txid: 'abc',
            vout: 0,
            priceUsd: 100,
            previousPriceUsd: 90,
            previousSource: 'mempool',
            memo,
            assertedAt: 1_700_000_000,
          },
        ],
      });
    expect(await hashBundle(withOverride('P2P purchase'))).not.toBe(
      await hashBundle(withOverride('P2P purchasee'))
    );
  });

  it('round-trip property: export -> import -> export yields identical hash and canonical bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1000, max: 5_000_000_000 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (amountSats, memo) => {
          const original = minimalBundle({
            krakenLedger: [
              {
                txid: 'L1',
                refid: 'R1',
                time: '2023-01-01T00:00:00.000Z',
                type: 'trade',
                amountSats,
                feeSats: 0,
              },
            ],
            overrides: memo.trim()
              ? [
                  {
                    nodeId: 'n1',
                    txid: 'abc',
                    vout: 0,
                    priceUsd: 100,
                    previousPriceUsd: null,
                    previousSource: 'mempool',
                    memo,
                    assertedAt: 1_700_000_000,
                  },
                ]
              : [],
          });

          const exported = JSON.stringify(original);
          const imported = migrate(JSON.parse(exported));
          const reExported = JSON.stringify(imported);

          expect(canonicalJson(JSON.parse(reExported))).toBe(canonicalJson(original));
          expect(await hashBundle(imported)).toBe(await hashBundle(original));
        }
      )
    );
  });
});

describe('migrate', () => {
  it('a v1 bundle passes through unchanged', () => {
    const bundle = minimalBundle();
    expect(migrate(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it('throws on validation failure with the zod error path list surfaced', () => {
    const broken = { ...minimalBundle(), inputs: { rootTxid: 'not-hex', selectedVout: -1 } };
    expect(() => migrate(broken)).toThrow();
  });

  it('throws (rather than silently accepting) an unsupported schemaVersion', () => {
    expect(() => migrate({ ...minimalBundle(), schemaVersion: 99 })).toThrow(
      /unsupported evidence bundle schemaVersion/
    );
  });
});
