import { LedgerEntry } from './kraken';
import { METHODOLOGY } from './methodology';

export type AmountBasis = 'net' | 'net-minus-fee' | 'net-plus-fee';

export interface MatchCandidate {
  refid: string; // ledger row identity — matches are stored by refid, not amount
  ledgerTxid: string;
  withdrawalSats: number; // |amount| from ledger, in sats
  feeSats: number;
  time: Date; // ledger timestamp (UTC)
  amountBasis: AmountBasis; // which fee interpretation produced the hit
  amountDeltaSats: number; // |expected - nodeSats| for that basis
  timeDeltaMs: number; // |ledgerTime - nodeBlockTime|; Infinity if unverified
  timeVerified: boolean; // false when nodeBlockTime is unknown (R2 skipped)
}

// A user-confirmed match, persisted by refid. amountBasis travels with it so
// the report can disclose when the match wasn't an exact net-amount hit.
export interface KrakenMatch {
  refid: string;
  amountBasis: AmountBasis;
}

export interface TimeWindow {
  beforeMs: number; // how far before nodeBlockTime a ledger entry may be
  afterMs: number; // how far after nodeBlockTime a ledger entry may be
}

export interface FindMatchCandidatesInput {
  nodeSats: number;
  nodeBlockTime: Date | null;
  ledger: LedgerEntry[];
  alreadyMatchedRefids: Set<string>;
  opts?: { amountToleranceSats?: number; timeWindow?: TimeWindow };
}

// Sourced from METHODOLOGY so the report's documented tolerance/window and
// this code cannot drift apart.
export const DEFAULT_AMOUNT_TOLERANCE_SATS = METHODOLOGY.matching.amountToleranceSats;
// A withdrawal is initiated before it confirms on-chain, so the ledger entry
// should precede the block; 72h covers slow confirmations, 1h covers minor
// clock skew on the "shouldn't postdate" side.
export const DEFAULT_TIME_WINDOW: TimeWindow = {
  beforeMs: METHODOLOGY.matching.timeWindowBeforeMs,
  afterMs: METHODOLOGY.matching.timeWindowAfterMs,
};

function amountHit(
  withdrawalSats: number,
  feeSats: number,
  nodeSats: number,
  toleranceSats: number
): { basis: AmountBasis; delta: number } | null {
  const bases: Array<{ basis: AmountBasis; expected: number }> = [
    { basis: 'net', expected: withdrawalSats },
    { basis: 'net-minus-fee', expected: withdrawalSats - feeSats },
    { basis: 'net-plus-fee', expected: withdrawalSats + feeSats },
  ];
  let best: { basis: AmountBasis; delta: number } | null = null;
  for (const { basis, expected } of bases) {
    const delta = Math.abs(expected - nodeSats);
    if (delta <= toleranceSats && (!best || delta < best.delta)) {
      best = { basis, delta };
    }
  }
  return best;
}

// Deterministic, fee-aware, time-windowed candidate finder. Never picks a
// winner among ambiguous candidates itself — that's a UI decision, recorded
// explicitly by the user and persisted by refid (see MatchCandidate.refid).
export function findMatchCandidates(input: FindMatchCandidatesInput): MatchCandidate[] {
  const { nodeSats, nodeBlockTime, ledger, alreadyMatchedRefids } = input;
  const toleranceSats = input.opts?.amountToleranceSats ?? DEFAULT_AMOUNT_TOLERANCE_SATS;
  const timeWindow = input.opts?.timeWindow ?? DEFAULT_TIME_WINDOW;

  const candidates: MatchCandidate[] = [];

  for (const entry of ledger) {
    if (entry.type !== 'withdrawal' || entry.amountSats >= 0) continue;
    if (alreadyMatchedRefids.has(entry.refid)) continue;

    const withdrawalSats = Math.abs(entry.amountSats);
    const hit = amountHit(withdrawalSats, entry.feeSats, nodeSats, toleranceSats);
    if (!hit) continue;

    let timeVerified = false;
    let timeDeltaMs = Infinity;
    if (nodeBlockTime) {
      const lower = nodeBlockTime.getTime() - timeWindow.beforeMs;
      const upper = nodeBlockTime.getTime() + timeWindow.afterMs;
      const t = entry.time.getTime();
      if (t < lower || t > upper) continue;
      timeVerified = true;
      timeDeltaMs = Math.abs(t - nodeBlockTime.getTime());
    }

    candidates.push({
      refid: entry.refid,
      ledgerTxid: entry.txid,
      withdrawalSats,
      feeSats: entry.feeSats,
      time: entry.time,
      amountBasis: hit.basis,
      amountDeltaSats: hit.delta,
      timeDeltaMs,
      timeVerified,
    });
  }

  const basisRank: Record<AmountBasis, number> = { net: 0, 'net-minus-fee': 1, 'net-plus-fee': 1 };
  return candidates.sort((a, b) => {
    if (a.amountDeltaSats !== b.amountDeltaSats) return a.amountDeltaSats - b.amountDeltaSats;
    const rank = basisRank[a.amountBasis] - basisRank[b.amountBasis];
    if (rank !== 0) return rank;
    return a.timeDeltaMs - b.timeDeltaMs;
  });
}

// Matches are keyed by refid precisely because refid is stable ledger
// identity — re-uploading a fresh export of the same account (e.g. three
// new months appended) must not destroy prior confirmations. Reconciles
// against the newly parsed ledger: a match survives only if its refid still
// appears as a withdrawal row (a refid that now shows up as a different row
// type doesn't count as present — the identity has to mean the same thing).
export function reconcileMatches(
  existing: Map<string, KrakenMatch>,
  newLedger: LedgerEntry[]
): { kept: Map<string, KrakenMatch>; droppedRefids: string[] } {
  const withdrawalRefids = new Set(
    newLedger.filter((e) => e.type === 'withdrawal').map((e) => e.refid)
  );
  const kept = new Map<string, KrakenMatch>();
  const droppedRefids: string[] = [];
  for (const [nodeId, match] of existing) {
    if (withdrawalRefids.has(match.refid)) {
      kept.set(nodeId, match);
    } else {
      droppedRefids.push(match.refid);
    }
  }
  return { kept, droppedRefids };
}

// For the zero-candidates UI hint: the closest unmatched withdrawal by
// amount, ignoring tolerance and the time window entirely, so the user can
// diagnose a fee-basis or CSV mismatch instead of just seeing "no match".
export function findNearestMiss(
  nodeSats: number,
  ledger: LedgerEntry[],
  alreadyMatchedRefids: Set<string>
): { refid: string; amountDeltaSats: number } | null {
  let best: { refid: string; amountDeltaSats: number } | null = null;
  for (const entry of ledger) {
    if (entry.type !== 'withdrawal' || entry.amountSats >= 0) continue;
    if (alreadyMatchedRefids.has(entry.refid)) continue;
    const withdrawalSats = Math.abs(entry.amountSats);
    const deltas = [
      withdrawalSats,
      withdrawalSats - entry.feeSats,
      withdrawalSats + entry.feeSats,
    ].map((expected) => Math.abs(expected - nodeSats));
    const delta = Math.min(...deltas);
    if (!best || delta < best.amountDeltaSats)
      best = { refid: entry.refid, amountDeltaSats: delta };
  }
  return best;
}
