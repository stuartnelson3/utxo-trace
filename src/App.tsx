import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import UTXONode from './components/UTXONode';
import BasisReport from './components/BasisReport';
import Legend from './components/Legend';
import DataSourcesPanel from './components/DataSourcesPanel';
import { UTXONode as UTXONodeType } from './core/types';
import {
  fetchTx,
  fetchNodeData,
  fetchChildNodes,
  fetchRawBtcUsd,
  fetchUsdToEurRate,
  queue,
  setCustomEsploraSource,
  setPriceCrossCheck,
  resetCrossCheckStats,
  getCrossCheckStats,
  priceDivergences,
  exportCaches,
  importCaches,
} from './api';
import { probeEsploraEndpoint } from './providers/customEsplora';
import { EvidenceBundle, hashBundle, migrate } from './core/bundle';
import {
  collectLeaves,
  collectExcluded,
  sumBasis,
  updateNode,
  findNode,
  nodePrice,
  OverrideRecord,
  PruneRecord,
} from './core/tree';
import { formatCurrency, APP_CONFIG, DisplayCurrency } from './config';
import { TraceContext } from './TraceContext';
import { findMatchCandidates, findNearestMiss, MatchCandidate, KrakenMatch } from './core/match';
import {
  detectCsvType,
  parseKrakenLedger,
  parseKrakenTrades,
  buildAttributions,
  fillMissingPrices,
  KrakenWithdrawalAttribution,
  LedgerEntry,
  TradeEntry,
} from './core/kraken';
import {
  detectSwanCsvType,
  parseSwanTrades,
  parseSwanTransfers,
  parseSwanWithdrawals,
  buildSwanAttributions,
  SwanWithdrawalAttribution,
  SwanLot,
  SwanWithdrawal,
} from './core/swan';

const App: React.FC = () => {
  const [rootNode, setRootNode] = useState<UTXONodeType | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get('expanded');
    return e ? new Set(e.split(',').filter(Boolean)) : new Set();
  });
  const [searchTxid, setSearchTxid] = useState('');
  const [selectedVout, setSelectedVout] = useState<number | null>(null);
  const [pendingOutputs, setPendingOutputs] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueStats, setQueueStats] = useState({ active: 0, pending: 0 });
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(APP_CONFIG.CURRENCY);

  // Data source settings — component state only, no hidden persistence.
  const [showDataSources, setShowDataSources] = useState(false);
  const [txSourceMode, setTxSourceMode] = useState<'mempool' | 'custom'>('mempool');
  const [customEsploraUrl, setCustomEsploraUrl] = useState('');
  const [priceCrossCheckEnabled, setPriceCrossCheckEnabled] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const pendingAutoExpand = useRef<string[]>([]);
  // True while replaying expandedIds from a URL/bundle restore — expands
  // during replay shouldn't clear the "offline replay" banner, only
  // genuinely new user-initiated expansion should.
  const isAutoExpandingRef = useRef(false);
  const csvFileRef = useRef<HTMLInputElement>(null);
  const sessionFileRef = useRef<HTMLInputElement>(null);
  const disposalPriceRef = useRef<HTMLInputElement>(null);

  // Evidence bundle (task 7)
  const [bundleHash, setBundleHash] = useState<string | null>(null);
  // Set on import, cleared as soon as the user expands beyond cached data
  // (which triggers live fetches and changes the hash on next export).
  const [offlineReplayHash, setOfflineReplayHash] = useState<string | null>(null);

  // Kraken state — explicit user matching (candidates can be ambiguous, so
  // the user always confirms; matches are persisted by refid, not amount).
  const [krakenLedger, setKrakenLedger] = useState<LedgerEntry[]>([]);
  // Kept for the evidence bundle (task 7) — previously discarded after
  // buildAttributions, but re-deriving attributions on import needs it.
  const [krakenTrades, setKrakenTrades] = useState<Map<string, TradeEntry>>(new Map());
  const [krakenAttributions, setKrakenAttributions] = useState<Map<
    string,
    KrakenWithdrawalAttribution
  > | null>(null);
  // Map: nodeId → confirmed match. Keyed by refid (the ledger row identity);
  // amountBasis travels with it so the report can disclose a non-exact match.
  const [krakenMatches, setKrakenMatches] = useState<Map<string, KrakenMatch>>(new Map());

  // refid -> ledgerTxid, so a refid-keyed match can look up its
  // krakenAttributions entry (which stays keyed by ledgerTxid — buildAttributions
  // and its existing tests are unaffected by the refid-based matcher).
  const krakenRefidIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const entry of krakenLedger) {
      if (entry.type === 'withdrawal') index.set(entry.refid, entry.txid);
    }
    return index;
  }, [krakenLedger]);

  // Manual interventions — first-class, disclosed, mandatory rationale.
  const [overrideRecords, setOverrideRecords] = useState<Map<string, OverrideRecord>>(new Map());
  const [pruneRecords, setPruneRecords] = useState<Map<string, PruneRecord>>(new Map());
  const prunedIds = useMemo(() => new Set(pruneRecords.keys()), [pruneRecords]);

  // Swan state — automatic matching via Bitcoin txid (exact, no ambiguity)
  const [swanAttributions, setSwanAttributions] = useState<Map<
    string,
    SwanWithdrawalAttribution
  > | null>(null);
  const [swanWarnings, setSwanWarnings] = useState<string[]>([]);
  // Kept for the evidence bundle — same reasoning as krakenTrades above.
  const [swanLotsState, setSwanLotsState] = useState<SwanLot[]>([]);
  const [swanWithdrawalsState, setSwanWithdrawalsState] = useState<SwanWithdrawal[]>([]);

  const [csvLoading, setCsvLoading] = useState(false);
  // What was detected per exchange — shown as compact type summaries, not filenames.
  const [krakenSummary, setKrakenSummary] = useState<string | null>(null);
  const [swanSummary, setSwanSummary] = useState<string | null>(null);

  // Actual disposal date + price (user-entered). When set, drives real gain/loss instead of hypothetical.
  const [disposalDate, setDisposalDate] = useState('');
  const [disposalPriceStr, setDisposalPriceStr] = useState('');

  const handlePrint = useReactToPrint({
    contentRef: reportRef,
    documentTitle: `BTC-Audit-${searchTxid.substring(0, 8)}`,
  });

  // Progress UX for deep expansions: subscribe to the shared fetch queue.
  useEffect(() => queue.onChange(setQueueStats), []);

  const handleSelectMempool = () => {
    setTxSourceMode('mempool');
    setCustomEsploraSource(null);
  };

  // Probes with a known-good genesis-era txid before accepting the custom
  // endpoint, per the settings UI spec — never switch on an unreachable URL.
  const handleProbeAndSelectCustom = async (baseUrl: string): Promise<boolean> => {
    const ok = await probeEsploraEndpoint(baseUrl);
    if (ok) {
      setTxSourceMode('custom');
      setCustomEsploraUrl(baseUrl);
      setCustomEsploraSource(baseUrl);
    }
    return ok;
  };

  const handleTogglePriceCrossCheck = (enabled: boolean) => {
    setPriceCrossCheckEnabled(enabled);
    setPriceCrossCheck(enabled);
  };

  const handleInitialFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTxid) return;
    setRootNode(null);
    setExpandedIds(new Set());
    setSelectedVout(null);
    try {
      const txData = await fetchTx(searchTxid);
      setPendingOutputs(txData.vout);
    } catch {
      alert('Transaction not found. Check the TXID and try again.');
    }
  };

  const startTrace = async (voutIndex: number) => {
    setSelectedVout(voutIndex);
    setRootNode(null);
    setExpandedIds(new Set());
    setPendingOutputs(null);
    setDisposalDate('');
    setDisposalPriceStr('');
    setLoading(true);
    resetCrossCheckStats(); // divergences/stats are per-report
    try {
      const data = await fetchNodeData(searchTxid, voutIndex);
      setRootNode(data);
    } catch (err) {
      console.error('Trace failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = async (nodeId: string) => {
    if (!rootNode) return;
    const node = findNode(rootNode, nodeId);
    if (!node) return;
    if (node.children.length > 0) {
      setExpandedIds((prev) => new Set([...prev, nodeId]));
      return;
    }
    setLoading(true);
    // Expanding beyond what the imported bundle already covers may trigger
    // live fetches, which would change the hash on next export — the
    // "offline replay" banner no longer accurately describes the session.
    // Auto-expand replaying the bundle's own expandedIds doesn't count.
    if (!isAutoExpandingRef.current) setOfflineReplayHash(null);
    try {
      const children = await fetchChildNodes(node.txid);
      setRootNode((prev) => (prev ? updateNode(prev, nodeId, (n) => ({ ...n, children })) : null));
      setExpandedIds((prev) => new Set([...prev, nodeId]));
    } catch (err) {
      console.error('Expand failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCollapse = (nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  };

  // Soft prune: the subtree is excluded from the computation (collectLeaves
  // skips it, collectExcluded accounts for it) but never deleted from state,
  // so it can always be restored.
  const handlePruneBranch = (nodeId: string, reason: string) => {
    const node = rootNode ? findNode(rootNode, nodeId) : null;
    if (!node) return;
    setPruneRecords((prev) => {
      const next = new Map(prev);
      next.set(nodeId, {
        nodeId,
        txid: node.txid,
        vout: node.vout,
        amountSats: node.amountSats,
        reason,
        prunedAt: Date.now(),
      });
      return next;
    });
  };

  const handleRestoreBranch = (nodeId: string) => {
    setPruneRecords((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  };

  const handleNodeUpdate = (nodeId: string, patch: Partial<UTXONodeType>) => {
    setRootNode((prev) => (prev ? updateNode(prev, nodeId, (n) => ({ ...n, ...patch })) : null));
  };

  // Overrides require a non-empty memo to save (the memo IS the rationale —
  // see the UI hint) and are recorded with what they replaced, so the report
  // can disclose the assertion rather than silently blending it into "mempool".
  const handleSaveOverride = (nodeId: string, priceUsd: number, memo: string) => {
    const node = rootNode ? findNode(rootNode, nodeId) : null;
    if (!node || !memo.trim()) return;
    const previousPriceUsd = node.isOverride ? (node.manualPriceUsd ?? null) : node.priceBtcUsd;
    const previousSource = node.isOverride ? 'override' : 'mempool';
    setOverrideRecords((prev) => {
      const next = new Map(prev);
      next.set(nodeId, {
        nodeId,
        txid: node.txid,
        vout: node.vout,
        priceUsd,
        previousPriceUsd,
        previousSource,
        memo,
        assertedAt: Date.now(),
      });
      return next;
    });
    handleNodeUpdate(nodeId, { isOverride: true, manualPriceUsd: priceUsd, memo });
  };

  const handleClearOverride = (nodeId: string) => {
    setOverrideRecords((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    handleNodeUpdate(nodeId, { isOverride: false, manualPriceUsd: undefined });
  };

  // Fee-aware, time-windowed candidate search (never auto-selects among
  // ambiguous candidates — that's a UI decision, made explicit below).
  const handleFindKrakenCandidates = (
    nodeId: string,
    amountSats: number,
    blockTimeSec: number
  ): {
    candidates: MatchCandidate[];
    nearestMiss: { refid: string; amountDeltaSats: number } | null;
  } => {
    const alreadyMatchedRefids = new Set(
      [...krakenMatches.entries()].filter(([id]) => id !== nodeId).map(([, m]) => m.refid)
    );
    const candidates = findMatchCandidates({
      nodeSats: amountSats,
      nodeBlockTime: blockTimeSec ? new Date(blockTimeSec * 1000) : null,
      ledger: krakenLedger,
      alreadyMatchedRefids,
    });
    const nearestMiss =
      candidates.length === 0
        ? findNearestMiss(amountSats, krakenLedger, alreadyMatchedRefids)
        : null;
    return { candidates, nearestMiss };
  };

  const handleConfirmKrakenMatch = (nodeId: string, candidate: MatchCandidate) => {
    const match: KrakenMatch = { refid: candidate.refid, amountBasis: candidate.amountBasis };
    setKrakenMatches((prev) => new Map([...prev, [nodeId, match]]));
  };

  const handleRemoveKraken = (nodeId: string) => {
    setKrakenMatches((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  };

  // Unified CSV loader — auto-detects Kraken ledger/trades and Swan trades/transfers/withdrawals.
  // All exchange files can be loaded in one shot.
  const handleCsvFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setCsvLoading(true);

    let krakenLedgerText = '';
    let krakenTradesText = '';
    let swanTradesText = '';
    let swanTransfersText = '';
    let swanWithdrawalsText = '';
    const names: string[] = [];

    for (const file of Array.from(files)) {
      const text = await file.text();
      const krakenType = detectCsvType(text);
      const swanType = detectSwanCsvType(text);
      if (krakenType === 'ledger') {
        krakenLedgerText = text;
        names.push(file.name);
      } else if (krakenType === 'trades') {
        krakenTradesText = text;
        names.push(file.name);
      } else if (swanType === 'swan-trades') {
        swanTradesText = text;
        names.push(file.name);
      } else if (swanType === 'swan-transfers') {
        swanTransfersText = text;
        names.push(file.name);
      } else if (swanType === 'swan-withdrawals') {
        swanWithdrawalsText = text;
        names.push(file.name);
      }
    }

    const warnings: string[] = [];

    // --- Kraken ---
    if (krakenLedgerText) {
      try {
        const ledger = parseKrakenLedger(krakenLedgerText);
        const trades = krakenTradesText ? parseKrakenTrades(krakenTradesText) : new Map();
        const raw = buildAttributions(ledger, trades);
        const filled = await fillMissingPrices(raw, fetchRawBtcUsd, fetchUsdToEurRate);
        setKrakenLedger(ledger);
        setKrakenTrades(trades);
        setKrakenAttributions(filled);
        setKrakenMatches(new Map()); // clear stale matches when CSV reloaded
        setKrakenSummary(krakenTradesText ? 'ledger + trades' : 'ledger');
      } catch (err) {
        console.error('Kraken CSV error:', err);
        warnings.push('failed to parse Kraken CSV — check file format');
      }
    }

    // --- Swan ---
    let swanLots: SwanLot[] = [];
    let swanLotSource = '';
    if (swanTransfersText && swanTradesText) {
      warnings.push('both trades and transfers detected (redundant): using transfers');
    }
    try {
      if (swanTransfersText) {
        swanLots = parseSwanTransfers(swanTransfersText);
        swanLotSource = 'transfers';
      } else if (swanTradesText) {
        swanLots = parseSwanTrades(swanTradesText);
        swanLotSource = 'trades';
      }
    } catch (err) {
      console.error('Swan CSV error:', err);
      warnings.push('failed to parse Swan CSV — check file format');
    }
    const hasSwanLots = swanLots.length > 0;
    const hasSwanWithdrawals = !!swanWithdrawalsText;

    if (hasSwanLots && !hasSwanWithdrawals) {
      warnings.push(`swan ${swanLotSource} detected — withdrawals CSV also required`);
    }
    if (!hasSwanLots && hasSwanWithdrawals) {
      warnings.push('swan withdrawals detected — trades or transfers CSV also required');
    }
    if (hasSwanLots && hasSwanWithdrawals) {
      try {
        const withdrawals = parseSwanWithdrawals(swanWithdrawalsText);
        setSwanLotsState(swanLots);
        setSwanWithdrawalsState(withdrawals);
        setSwanAttributions(buildSwanAttributions(swanLots, withdrawals));
        setSwanSummary(`${swanLotSource} + withdrawals`);
      } catch (err) {
        console.error('Swan CSV error:', err);
        warnings.push('failed to parse Swan CSV — check file format');
      }
    }

    setSwanWarnings(warnings);
    setCsvLoading(false);
  };

  // Restore state from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const urlTxid = p.get('txid');
    const urlVout = p.get('vout');
    const urlExpanded = p.get('expanded');
    if (!urlTxid || urlVout === null) return;
    const vout = parseInt(urlVout, 10);
    if (isNaN(vout)) return;
    setSearchTxid(urlTxid);
    setSelectedVout(vout);
    setLoading(true);
    fetchNodeData(urlTxid, vout)
      .then((data) => {
        setRootNode(data);
        if (urlExpanded) pendingAutoExpand.current = urlExpanded.split(',').filter(Boolean);
      })
      .catch((err) => console.error('URL restore failed:', err))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL whenever trace state changes
  useEffect(() => {
    if (!rootNode || selectedVout === null) return;
    const parts = [`txid=${searchTxid}`, `vout=${selectedVout}`];
    if (expandedIds.size > 0) parts.push(`expanded=${[...expandedIds].join(',')}`);
    history.replaceState(null, '', `?${parts.join('&')}`);
  }, [rootNode, searchTxid, selectedVout, expandedIds]);

  // Auto-expand nodes restored from URL or an imported bundle, one at a
  // time top-down. isAutoExpandingRef distinguishes this replay from
  // genuinely new user-initiated expansion (see handleExpand).
  useEffect(() => {
    if (!rootNode || pendingAutoExpand.current.length === 0) {
      isAutoExpandingRef.current = false;
      return;
    }
    isAutoExpandingRef.current = true;
    pendingAutoExpand.current = pendingAutoExpand.current.filter((id) => {
      const n = findNode(rootNode, id);
      return n === null || n.children.length === 0;
    });
    const nextId = pendingAutoExpand.current.find((id) => findNode(rootNode, id) !== null);
    if (!nextId) {
      isAutoExpandingRef.current = false;
      return;
    }
    pendingAutoExpand.current = pendingAutoExpand.current.filter((id) => id !== nextId);
    handleExpand(nextId);
  }, [rootNode]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaves = useMemo(
    () => (rootNode ? collectLeaves(rootNode, expandedIds, prunedIds) : []),
    [rootNode, expandedIds, prunedIds]
  );

  const excludedLeaves = useMemo(
    () => (rootNode ? collectExcluded(rootNode, expandedIds, prunedIds) : []),
    [rootNode, expandedIds, prunedIds]
  );
  const totalExcludedSats = useMemo(
    () => excludedLeaves.reduce((s, l) => s + l.scaledSats, 0),
    [excludedLeaves]
  );

  // Attach basisOverride to leaves.
  // Swan: automatic (txid exact match, unambiguous).
  // Kraken: only for nodes explicitly matched by the user (amount-based, could be ambiguous).
  const leavesWithAttribution = useMemo(() => {
    if (!krakenAttributions && !swanAttributions) return leaves;
    return leaves.map((leaf) => {
      if (swanAttributions) {
        const attr = swanAttributions.get(leaf.node.txid);
        if (attr) return { ...leaf, basisOverride: { usd: attr.totalBasisUsd } };
      }
      if (krakenAttributions && krakenMatches.size > 0) {
        const match = krakenMatches.get(leaf.node.id);
        const ledgerTxid = match ? krakenRefidIndex.get(match.refid) : undefined;
        if (ledgerTxid) {
          const attr = krakenAttributions.get(ledgerTxid);
          if (attr) {
            const basisEur = attr.lots.reduce((s, l) => s + (l.basisEur ?? 0), 0);
            return {
              ...leaf,
              basisOverride: { usd: basisEur / (leaf.node.usdToEur || 1), eur: basisEur },
            };
          }
        }
      }
      return leaf;
    });
  }, [leaves, krakenAttributions, krakenMatches, krakenRefidIndex, swanAttributions]);

  const totalBasis = useMemo(
    () => sumBasis(leavesWithAttribution, displayCurrency),
    [leavesWithAttribution, displayCurrency]
  );

  const disposalTimestamp = disposalDate
    ? Math.floor(new Date(disposalDate).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const disposalPriceNum = disposalPriceStr ? parseFloat(disposalPriceStr) : null;

  const rootPrice = rootNode ? nodePrice(rootNode, displayCurrency) : 0;
  const proceeds = rootNode ? (rootNode.amountSats / 1e8) * (disposalPriceNum ?? rootPrice) : 0;
  const gainLoss = proceeds - totalBasis;

  const hasAnyAttribution = krakenAttributions !== null || swanAttributions !== null;

  const traceContext = useMemo(
    () => ({
      displayCurrency,
      disposalTimestamp,
      disposalDate: disposalDate || null,
      disposalPriceDisplay: disposalPriceNum,
      krakenAttributions: krakenAttributions ?? new Map(),
      krakenMatches,
      krakenRefidIndex,
      swanAttributions: swanAttributions ?? new Map(),
      overrideRecords,
      pruneRecords,
      excludedSats: totalExcludedSats,
    }),
    [
      displayCurrency,
      disposalTimestamp,
      disposalDate,
      disposalPriceNum,
      krakenAttributions,
      krakenMatches,
      krakenRefidIndex,
      swanAttributions,
      overrideRecords,
      pruneRecords,
      totalExcludedSats,
    ]
  );

  // --- Evidence bundle: export/import (task 7) ---

  const buildBundle = (): EvidenceBundle | null => {
    if (!rootNode || selectedVout === null) return null;
    const caches = exportCaches();
    return {
      schemaVersion: 1,
      app: { version: __APP_VERSION__, commit: __COMMIT__ },
      createdAt: new Date().toISOString(),
      inputs: {
        rootTxid: searchTxid,
        selectedVout,
        disposal: disposalDate
          ? {
              timestamp: disposalTimestamp,
              priceDisplay: disposalPriceNum,
              currency: displayCurrency,
            }
          : null,
      },
      krakenLedger: krakenLedger.map((e) => ({ ...e, time: e.time.toISOString() })),
      krakenTrades: [...krakenTrades.values()],
      swanLots: swanLotsState.map((l) => ({ ...l, date: l.date.toISOString() })),
      swanWithdrawals: swanWithdrawalsState.map((w) => ({ ...w, date: w.date.toISOString() })),
      txCache: caches.txCache,
      priceCache: caches.priceCache,
      fxCache: caches.fxCache,
      tree: { expandedIds: [...expandedIds] },
      matches: [...krakenMatches.entries()].map(([nodeId, m]) => ({
        nodeId,
        refid: m.refid,
        amountBasis: m.amountBasis,
      })),
      overrides: [...overrideRecords.values()],
      prunedBranches: [...pruneRecords.values()],
      settings: {
        txSourceMode,
        customEsploraUrl,
        priceCrossCheck: priceCrossCheckEnabled,
      },
    };
  };

  // Recompute the footer hash whenever the report's inputs change (the hash
  // itself excludes createdAt, so this doesn't churn on re-render alone).
  useEffect(() => {
    const bundle = buildBundle();
    if (!bundle) {
      setBundleHash(null);
      return;
    }
    let cancelled = false;
    hashBundle(bundle).then((h) => {
      if (!cancelled) setBundleHash(h);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rootNode,
    selectedVout,
    disposalDate,
    disposalPriceNum,
    krakenLedger,
    krakenTrades,
    swanLotsState,
    swanWithdrawalsState,
    expandedIds,
    krakenMatches,
    overrideRecords,
    pruneRecords,
  ]);

  const handleExportSession = async () => {
    const bundle = buildBundle();
    if (!bundle) return;
    const hash = await hashBundle(bundle);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `utxo-trace-session-${hash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSession = async (file: File) => {
    const text = await file.text();
    let bundle: EvidenceBundle;
    try {
      bundle = migrate(JSON.parse(text));
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'issues' in err
          ? (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')
          : (err as Error).message;
      alert(`Failed to import session — invalid bundle:\n${message}`);
      return;
    }

    // Restore settings first so the active tx source matches whatever the
    // cache was built against.
    if (bundle.settings) {
      setTxSourceMode(bundle.settings.txSourceMode);
      setCustomEsploraUrl(bundle.settings.customEsploraUrl);
      setPriceCrossCheckEnabled(bundle.settings.priceCrossCheck);
      setPriceCrossCheck(bundle.settings.priceCrossCheck);
      setCustomEsploraSource(
        bundle.settings.txSourceMode === 'custom' ? bundle.settings.customEsploraUrl : null
      );
    } else {
      setCustomEsploraSource(null);
    }

    importCaches({
      txCache: bundle.txCache,
      priceCache: bundle.priceCache,
      fxCache: bundle.fxCache,
    });

    setKrakenLedger(bundle.krakenLedger.map((e) => ({ ...e, time: new Date(e.time) })));
    setKrakenTrades(new Map(bundle.krakenTrades.map((t) => [t.txid, t])));
    setSwanLotsState(bundle.swanLots.map((l) => ({ ...l, date: new Date(l.date) })));
    setSwanWithdrawalsState(bundle.swanWithdrawals.map((w) => ({ ...w, date: new Date(w.date) })));

    if (bundle.krakenLedger.length > 0) {
      const ledger = bundle.krakenLedger.map((e) => ({ ...e, time: new Date(e.time) }));
      const trades = new Map(bundle.krakenTrades.map((t) => [t.txid, t]));
      const raw = buildAttributions(ledger, trades);
      // Prices are already resolved in the ledger/trades data (or served
      // from the imported price/fx caches below) — no network needed.
      const filled = await fillMissingPrices(raw, fetchRawBtcUsd, fetchUsdToEurRate);
      setKrakenAttributions(filled);
      setKrakenSummary(bundle.krakenTrades.length > 0 ? 'ledger + trades' : 'ledger');
    }
    if (bundle.swanLots.length > 0 && bundle.swanWithdrawals.length > 0) {
      const lots = bundle.swanLots.map((l) => ({ ...l, date: new Date(l.date) }));
      const withdrawals = bundle.swanWithdrawals.map((w) => ({ ...w, date: new Date(w.date) }));
      setSwanAttributions(buildSwanAttributions(lots, withdrawals));
      setSwanSummary('imported');
    }

    setKrakenMatches(
      new Map(bundle.matches.map((m) => [m.nodeId, { refid: m.refid, amountBasis: m.amountBasis }]))
    );
    setOverrideRecords(new Map(bundle.overrides.map((o) => [o.nodeId, o])));
    setPruneRecords(new Map(bundle.prunedBranches.map((p) => [p.nodeId, p])));

    setSearchTxid(bundle.inputs.rootTxid);
    setSelectedVout(bundle.inputs.selectedVout);
    if (bundle.inputs.disposal) {
      setDisposalDate(new Date(bundle.inputs.disposal.timestamp * 1000).toISOString().slice(0, 10));
      setDisposalPriceStr(bundle.inputs.disposal.priceDisplay?.toString() ?? '');
    } else {
      setDisposalDate('');
      setDisposalPriceStr('');
    }
    setDisplayCurrency(bundle.inputs.disposal?.currency ?? APP_CONFIG.CURRENCY);
    setExpandedIds(new Set());
    pendingAutoExpand.current = bundle.tree.expandedIds;

    const hash = await hashBundle(bundle);
    setOfflineReplayHash(hash);
    setLoading(true);
    try {
      const data = await fetchNodeData(bundle.inputs.rootTxid, bundle.inputs.selectedVout);
      setRootNode(data);
    } catch (err) {
      console.error('Session import: root node fetch failed:', err);
      alert('Import failed: could not reconstruct the trace root from the bundle.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', padding: '0 20px' }}>
      {/* Header */}
      <header style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 'bold', letterSpacing: 0 }}>
            utxo trace
          </h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {/* Unified CSV upload */}
            <input
              ref={csvFileRef}
              type="file"
              accept=".csv"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleCsvFiles(e.target.files)}
            />
            <button
              onClick={() => csvFileRef.current?.click()}
              disabled={csvLoading}
              style={{
                font: '14px/1.7 monospace',
                border: '1px solid var(--border)',
                padding: '0 8px',
                cursor: 'pointer',
                background: hasAnyAttribution ? 'var(--fg)' : 'var(--bg)',
                color: hasAnyAttribution ? 'var(--bg)' : 'var(--fg)',
              }}
            >
              {csvLoading ? 'loading...' : hasAnyAttribution ? '[csv ✓]' : '[load exchange csv]'}
            </button>
            {(krakenSummary || swanSummary) && !csvLoading && (
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                {[
                  krakenSummary && `kraken: ${krakenSummary}`,
                  swanSummary && `swan: ${swanSummary}`,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </span>
            )}

            {/* Currency toggle */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['USD', 'EUR'] as DisplayCurrency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setDisplayCurrency(c)}
                  style={{
                    font: '14px/1.7 monospace',
                    border: '1px solid var(--border)',
                    padding: '0 8px',
                    cursor: 'pointer',
                    background: displayCurrency === c ? 'var(--fg)' : 'var(--bg)',
                    color: displayCurrency === c ? 'var(--bg)' : 'var(--fg)',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowDataSources(!showDataSources)}
              style={{
                font: '14px/1.7 monospace',
                border: '1px solid var(--border)',
                padding: '0 8px',
                cursor: 'pointer',
                background: 'var(--bg)',
                color: 'var(--fg)',
              }}
            >
              [data sources]
            </button>

            {rootNode && (
              <button
                onClick={handleExportSession}
                title="the exported file contains your transaction graph and parsed exchange history — treat it like a bank statement"
                style={{
                  font: '14px/1.7 monospace',
                  border: '1px solid var(--border)',
                  padding: '0 8px',
                  cursor: 'pointer',
                  background: 'var(--bg)',
                  color: 'var(--fg)',
                }}
              >
                [export session]
              </button>
            )}
            <input
              ref={sessionFileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportSession(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => sessionFileRef.current?.click()}
              style={{
                font: '14px/1.7 monospace',
                border: '1px solid var(--border)',
                padding: '0 8px',
                cursor: 'pointer',
                background: 'var(--bg)',
                color: 'var(--fg)',
              }}
            >
              [import session]
            </button>
          </div>
        </div>
        {offlineReplayHash && (
          <div
            style={{
              marginTop: 8,
              padding: '4px 8px',
              border: '1px solid var(--exempt)',
              color: 'var(--exempt)',
              fontSize: 12,
            }}
          >
            offline replay — data from bundle {offlineReplayHash.slice(0, 8)}
          </div>
        )}
        {showDataSources && (
          <DataSourcesPanel
            txSourceMode={txSourceMode}
            customEsploraUrl={customEsploraUrl}
            priceCrossCheck={priceCrossCheckEnabled}
            onSelectMempool={handleSelectMempool}
            onProbeAndSelectCustom={handleProbeAndSelectCustom}
            onTogglePriceCrossCheck={handleTogglePriceCrossCheck}
          />
        )}
        <hr
          style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0 12px' }}
        />
        <form onSubmit={handleInitialFetch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="paste transaction id..."
            value={searchTxid}
            onChange={(e) => setSearchTxid(e.target.value)}
            style={{
              flex: 1,
              font: '14px/1.7 monospace',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--fg)',
              padding: '2px 8px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              font: '14px/1.7 monospace',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--fg)',
              padding: '2px 12px',
              cursor: 'pointer',
            }}
          >
            {loading ? 'loading...' : '[trace]'}
          </button>
          {(queueStats.active > 0 || queueStats.pending > 0) && (
            <span style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>
              fetching {queueStats.active} of {queueStats.active + queueStats.pending}
            </span>
          )}
        </form>

        {/* Warnings */}
        {swanWarnings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {swanWarnings.map((w, i) => (
              <div key={i} style={{ color: 'var(--taxable)', fontSize: 12 }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </header>

      {/* Output selector */}
      {pendingOutputs && (
        <div style={{ marginBottom: 32 }}>
          <p
            style={{
              margin: '0 0 8px',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: 1,
              fontSize: 11,
            }}
          >
            select output for audit
          </p>
          {pendingOutputs.map((output, index) => (
            <div key={index} style={{ marginBottom: 4 }}>
              <button
                onClick={() => startTrace(index)}
                style={{
                  font: '14px/1.7 monospace',
                  border: 'none',
                  background: 'none',
                  color: 'var(--link)',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                OUTPUT #{index}
              </button>
              <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                {(output.value / 1e8).toFixed(8)} BTC
              </span>
              {output.scriptpubkey_address && (
                <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                  → {output.scriptpubkey_address}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main trace view */}
      {rootNode && (
        <TraceContext.Provider value={traceContext}>
          <>
            {/* Summary bar */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 32,
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  marginBottom: 8,
                }}
              >
                <div>
                  <span style={{ color: 'var(--muted)' }}>basis: </span>
                  <strong>{formatCurrency(totalBasis, displayCurrency)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>
                    {gainLoss >= 0 ? 'gain: ' : 'loss: '}
                  </span>
                  <strong>
                    {gainLoss >= 0 ? '▲' : '▼'}{' '}
                    {formatCurrency(Math.abs(gainLoss), displayCurrency)}
                  </strong>
                  {!disposalPriceNum && (
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                      (est)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handlePrint()}
                  style={{
                    font: '14px/1.7 monospace',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--fg)',
                    padding: '0 10px',
                    cursor: 'pointer',
                  }}
                >
                  [export pdf]
                </button>
              </div>

              {/* Disposal date + price — converts gain from hypothetical to actual */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>disposed:</span>
                <input
                  type="date"
                  value={disposalDate}
                  onChange={(e) => setDisposalDate(e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value) disposalPriceRef.current?.focus();
                  }}
                  style={{
                    font: '13px/1.5 monospace',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: disposalDate ? 'var(--fg)' : 'var(--muted)',
                    padding: '1px 4px',
                  }}
                />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>@</span>
                <input
                  ref={disposalPriceRef}
                  type="number"
                  value={disposalPriceStr}
                  onChange={(e) => setDisposalPriceStr(e.target.value)}
                  placeholder={`${displayCurrency}/BTC`}
                  style={{
                    font: '13px/1.5 monospace',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--fg)',
                    padding: '1px 4px',
                    width: 140,
                  }}
                />
                {(disposalDate || disposalPriceStr) && (
                  <button
                    onClick={() => {
                      setDisposalDate('');
                      setDisposalPriceStr('');
                    }}
                    style={{
                      font: '13px/1.5 monospace',
                      border: 'none',
                      background: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    [×]
                  </button>
                )}
              </div>
            </div>

            <UTXONode
              node={rootNode}
              expandedIds={expandedIds}
              onExpand={handleExpand}
              onCollapse={handleCollapse}
              onPruneBranch={handlePruneBranch}
              onRestoreBranch={handleRestoreBranch}
              onSaveOverride={handleSaveOverride}
              onClearOverride={handleClearOverride}
              onFindKrakenCandidates={handleFindKrakenCandidates}
              onConfirmKrakenMatch={handleConfirmKrakenMatch}
              onRemoveKraken={handleRemoveKraken}
            />
          </>
        </TraceContext.Provider>
      )}

      {/* Footer disclaimer */}
      <footer
        style={{
          marginTop: 48,
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
          color: 'var(--muted)',
          fontSize: 12,
        }}
      >
        {rootNode && (
          <div style={{ marginBottom: 12 }}>
            <Legend />
          </div>
        )}
        not financial or tax advice. blockchain prices from{' '}
        <a href="https://mempool.space" target="_blank">
          mempool.space
        </a>{' '}
        and the ecb via{' '}
        <a href="https://frankfurter.dev" target="_blank">
          frankfurter.dev
        </a>
        . exchange cost basis from kraken (ledger + trades csvs) or swan bitcoin (transfers or
        trades + withdrawals csvs; transfers preferred when both are loaded). verify with a tax
        professional before filing.
        <div style={{ marginTop: 8, fontSize: 10 }}>
          app v{__APP_VERSION__} · commit {__COMMIT__}
          {bundleHash && ` · evidence bundle ${bundleHash.slice(0, 8)}`}
        </div>
      </footer>

      {/* Hidden print target */}
      <div style={{ display: 'none' }}>
        {rootNode && (
          <TraceContext.Provider value={traceContext}>
            <BasisReport
              ref={reportRef}
              rootNode={rootNode}
              totalBasis={totalBasis}
              leaves={leavesWithAttribution}
              excludedLeaves={excludedLeaves}
              expandedIds={expandedIds}
              priceDivergences={priceDivergences}
              crossCheckStats={getCrossCheckStats()}
              bundleHash={bundleHash}
            />
          </TraceContext.Provider>
        )}
      </div>
    </div>
  );
};

export default App;
