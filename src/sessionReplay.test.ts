import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import replayBundleRaw from './core/__fixtures__/replay-bundle.json';
import { migrate, hashBundle } from './core/bundle';
import { collectLeaves, collectExcluded, sumBasis } from './core/tree';
import { loadSession, buildFullyExpandedTree } from './sessionReplay';
import { TraceContext } from './TraceContext';
import BasisReport from './components/BasisReport';

// Freezes canonical serialization: if this ever fails, either the fixture
// changed (expected — regenerate and update the pin) or canonicalization
// itself changed (not expected — investigate before touching the pin).
const PINNED_HASH = '1b44c3453ce2ecc0ec6156445d1162743d01e338ca754e583daa4ea94052abd3';

describe('offline replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('hashBundle(fixture) is pinned', async () => {
    const bundle = migrate(replayBundleRaw);
    expect(await hashBundle(bundle)).toBe(PINNED_HASH);
  });

  it('renders the full report from the bundle alone, with zero network access', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access during offline replay');
    });
    vi.stubGlobal('fetch', fetchSpy);
    // BasisReport stamps "generated <now>" directly from the wall clock —
    // freeze it so the snapshot below is deterministic across runs/days.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T00:00:00.000Z'));

    const bundle = migrate(replayBundleRaw);
    const session = await loadSession(bundle);
    const expandedIds = new Set(session.expandedIds);
    const prunedIds = new Set(session.pruneRecords.keys());
    const rootNode = await buildFullyExpandedTree(session.rootNode, expandedIds);

    const leaves = collectLeaves(rootNode, expandedIds, prunedIds);
    const excludedLeaves = collectExcluded(rootNode, expandedIds, prunedIds);
    const totalBasis = sumBasis(leaves, session.displayCurrency);
    const excludedSats = excludedLeaves.reduce((s, l) => s + l.scaledSats, 0);
    const bundleHash = await hashBundle(bundle);

    const krakenRefidIndex = new Map<string, string>();
    for (const entry of session.krakenLedger) {
      if (entry.type === 'withdrawal') krakenRefidIndex.set(entry.refid, entry.txid);
    }

    const html = renderToStaticMarkup(
      React.createElement(
        TraceContext.Provider,
        {
          value: {
            displayCurrency: session.displayCurrency,
            disposalTimestamp: session.disposalTimestamp,
            disposalDate: session.disposalDate,
            disposalPriceDisplay: session.disposalPriceDisplay,
            krakenAttributions: session.krakenAttributions ?? new Map(),
            krakenMatches: session.krakenMatches,
            krakenRefidIndex,
            swanAttributions: session.swanAttributions ?? new Map(),
            overrideRecords: session.overrideRecords,
            pruneRecords: session.pruneRecords,
            excludedSats,
          },
        },
        React.createElement(BasisReport, {
          rootNode,
          totalBasis,
          leaves,
          excludedLeaves,
          expandedIds,
          priceDivergences: [],
          crossCheckStats: { total: 0, verified: 0 },
          bundleHash,
        })
      )
    );

    // Bundle hash cited in the report footer.
    expect(html).toContain(bundleHash.slice(0, 8));
    // Confirmed Kraken match's lot table.
    expect(html).toContain('kraken / fifo');
    // Automatic Swan match's lot table.
    expect(html).toContain('swan / fifo');
    // Manual price override, disclosed with its memo.
    expect(html).toContain('manual verification via block explorer');
    // Excluded (pruned) branch, disclosed with its reason.
    expect(html).toContain('change output returned to sender');
    // Mass-balance reconciliation line.
    expect(html).toContain('traced inputs');

    expect(fetchSpy).not.toHaveBeenCalled();

    expect(html).toMatchSnapshot();
  });
});
