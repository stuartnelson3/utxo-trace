import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A 30-tx fixture: GENESIS is referenced as a parent by every other node
// (heavy sharing), and NODE_i also chains to NODE_(i-1) so expansion has
// real depth. 30 distinct txids total (GENESIS + NODE_0..NODE_28).
const NODE_COUNT = 30;

function mockTx(txid: string, parentTxids: string[], value = 100_000_000) {
  return {
    txid,
    status: { block_time: 1_700_000_000 },
    vout: [{ value }],
    vin: parentTxids.map((p) => ({ txid: p, vout: 0 })),
  };
}

function buildFixtureGraph(): Map<string, ReturnType<typeof mockTx>> {
  const graph = new Map<string, ReturnType<typeof mockTx>>();
  graph.set('GENESIS', mockTx('GENESIS', []));
  for (let i = 0; i < NODE_COUNT - 1; i++) {
    const txid = `NODE_${i}`;
    const parents = i === 0 ? ['GENESIS'] : ['GENESIS', `NODE_${i - 1}`];
    graph.set(txid, mockTx(txid, parents));
  }
  return graph;
}

describe('api.ts fetch queue: shared-parent dedup regression', () => {
  let txFetchCount: Map<string, number>;
  let graph: Map<string, ReturnType<typeof mockTx>>;
  let fetchNodeData: typeof import('./api').fetchNodeData;
  let fetchChildNodes: typeof import('./api').fetchChildNodes;

  beforeEach(async () => {
    vi.resetModules();
    txFetchCount = new Map();
    graph = buildFixtureGraph();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/tx/')) {
          const txid = url.split('/api/tx/')[1];
          txFetchCount.set(txid, (txFetchCount.get(txid) ?? 0) + 1);
          const node = graph.get(txid);
          if (!node) return { ok: false, status: 404, headers: new Headers() } as any;
          return { ok: true, status: 200, headers: new Headers(), json: async () => node } as any;
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ prices: [{ USD: 30000 }], rates: { EUR: 0.9 } }),
        } as any;
      })
    );

    const api = await import('./api');
    fetchNodeData = api.fetchNodeData;
    fetchChildNodes = api.fetchChildNodes;
  });

  afterEach(() => vi.unstubAllGlobals());

  async function expandAll(txid: string, order: 'forward' | 'reverse'): Promise<void> {
    const children = await fetchChildNodes(txid);
    const ordered = order === 'reverse' ? [...children].reverse() : children;
    await Promise.all(ordered.map((c) => expandAll(c.txid, order)));
  }

  it('fetches each distinct txid exactly once, forward expansion order', async () => {
    const root = await fetchNodeData('NODE_28', 0);
    await expandAll(root.txid, 'forward');

    expect(txFetchCount.size).toBe(NODE_COUNT);
    for (const [, count] of txFetchCount) expect(count).toBe(1);
  });

  it('fetches each distinct txid exactly once, reverse expansion order', async () => {
    const root = await fetchNodeData('NODE_28', 0);
    await expandAll(root.txid, 'reverse');

    expect(txFetchCount.size).toBe(NODE_COUNT);
    for (const [, count] of txFetchCount) expect(count).toBe(1);
  });
});
