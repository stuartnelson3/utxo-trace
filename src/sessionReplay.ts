// Reconstructs the non-tree state from an imported evidence bundle, without
// touching React state directly — App.tsx's [import session] handler calls
// this and applies the result via setState, keeping its own existing
// progressive auto-expand mechanism for the live tree (unchanged UX: nodes
// still populate one at a time with queue-stats feedback, exactly as a
// manual [expand] click would). The offline-replay test calls loadSession
// for the same state, then separately awaits buildFullyExpandedTree (below)
// to get a complete tree in one shot, since a test has no render ticks to
// drive progressive expansion.
//
// Kept out of core/ because it calls into api.ts (fetch-backed, cache-first)
// rather than being framework/effect-free.
import { UTXONode } from './core/types';
import { EvidenceBundle } from './core/bundle';
import {
  buildAttributions,
  fillMissingPrices,
  KrakenWithdrawalAttribution,
  LedgerEntry,
  TradeEntry,
} from './core/kraken';
import {
  buildSwanAttributions,
  SwanLot,
  SwanWithdrawal,
  SwanWithdrawalAttribution,
} from './core/swan';
import { KrakenMatch } from './core/match';
import { OverrideRecord, PruneRecord } from './core/tree';
import { APP_CONFIG, DisplayCurrency } from './config';
import {
  importCaches,
  fetchNodeData,
  fetchChildNodes,
  fetchRawBtcUsd,
  fetchUsdToEurRate,
} from './api';

export interface ReplayedSession {
  rootNode: UTXONode; // root only — mirrors handleImportSession's own fetchNodeData call
  krakenLedger: LedgerEntry[];
  krakenTrades: Map<string, TradeEntry>;
  krakenAttributions: Map<string, KrakenWithdrawalAttribution> | null;
  krakenSummary: string | null;
  swanLots: SwanLot[];
  swanWithdrawals: SwanWithdrawal[];
  swanAttributions: Map<string, SwanWithdrawalAttribution> | null;
  swanSummary: string | null;
  krakenMatches: Map<string, KrakenMatch>;
  overrideRecords: Map<string, OverrideRecord>;
  pruneRecords: Map<string, PruneRecord>;
  expandedIds: string[]; // bundle.tree.expandedIds, verbatim — App.tsx feeds this to its own auto-expand
  disposalDate: string;
  disposalPriceStr: string;
  disposalTimestamp: number;
  disposalPriceDisplay: number | null;
  displayCurrency: DisplayCurrency;
}

export async function loadSession(bundle: EvidenceBundle): Promise<ReplayedSession> {
  importCaches({
    txCache: bundle.txCache,
    priceCache: bundle.priceCache,
    fxCache: bundle.fxCache,
  });

  const krakenLedger = bundle.krakenLedger.map((e) => ({ ...e, time: new Date(e.time) }));
  const krakenTrades = new Map(bundle.krakenTrades.map((t) => [t.txid, t]));
  const swanLots = bundle.swanLots.map((l) => ({ ...l, date: new Date(l.date) }));
  const swanWithdrawals = bundle.swanWithdrawals.map((w) => ({ ...w, date: new Date(w.date) }));

  let krakenAttributions: Map<string, KrakenWithdrawalAttribution> | null = null;
  let krakenSummary: string | null = null;
  if (krakenLedger.length > 0) {
    const raw = buildAttributions(krakenLedger, krakenTrades);
    // Prices are already resolved in the ledger/trades data (or served from
    // the imported price/fx caches above) — no network needed for a bundle
    // that actually covers everything it references.
    krakenAttributions = await fillMissingPrices(raw, fetchRawBtcUsd, fetchUsdToEurRate);
    krakenSummary = bundle.krakenTrades.length > 0 ? 'ledger + trades' : 'ledger';
  }

  let swanAttributions: Map<string, SwanWithdrawalAttribution> | null = null;
  let swanSummary: string | null = null;
  if (swanLots.length > 0 && swanWithdrawals.length > 0) {
    swanAttributions = buildSwanAttributions(swanLots, swanWithdrawals);
    swanSummary = 'imported';
  }

  const krakenMatches = new Map(
    bundle.matches.map((m) => [m.nodeId, { refid: m.refid, amountBasis: m.amountBasis }])
  );
  const overrideRecords = new Map(bundle.overrides.map((o) => [o.nodeId, o]));
  const pruneRecords = new Map(bundle.prunedBranches.map((p) => [p.nodeId, p]));

  const rootNode = await fetchNodeData(bundle.inputs.rootTxid, bundle.inputs.selectedVout);

  const disposalDate = bundle.inputs.disposal
    ? new Date(bundle.inputs.disposal.timestamp * 1000).toISOString().slice(0, 10)
    : '';
  const disposalPriceStr = bundle.inputs.disposal?.priceDisplay?.toString() ?? '';

  return {
    rootNode,
    krakenLedger,
    krakenTrades,
    krakenAttributions,
    krakenSummary,
    swanLots,
    swanWithdrawals,
    swanAttributions,
    swanSummary,
    krakenMatches,
    overrideRecords,
    pruneRecords,
    expandedIds: bundle.tree.expandedIds,
    disposalDate,
    disposalPriceStr,
    disposalTimestamp: bundle.inputs.disposal?.timestamp ?? 0,
    disposalPriceDisplay: bundle.inputs.disposal?.priceDisplay ?? null,
    displayCurrency: bundle.inputs.disposal?.currency ?? APP_CONFIG.CURRENCY,
  };
}

// Recursively expands every node whose id is in expandedIds, using the same
// fetchNodeData/fetchChildNodes a live manual [expand] click uses. Only used
// by the offline-replay test, which has no render ticks to drive App.tsx's
// own progressive one-at-a-time auto-expand — reads exclusively from the
// caches loadSession just populated, so it never touches the network for a
// well-formed bundle.
export async function buildFullyExpandedTree(
  root: UTXONode,
  expandedIds: Set<string>
): Promise<UTXONode> {
  if (!expandedIds.has(root.id)) return root;
  const children = await fetchChildNodes(root.txid);
  const expandedChildren = await Promise.all(
    children.map((c) => buildFullyExpandedTree(c, expandedIds))
  );
  return { ...root, children: expandedChildren };
}
