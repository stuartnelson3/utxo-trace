import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  findMatchCandidates,
  findNearestMiss,
  reconcileMatches,
  DEFAULT_TIME_WINDOW,
  AmountBasis,
  KrakenMatch,
} from './match';
import { LedgerEntry } from './kraken';

function withdrawal(
  refid: string,
  time: Date,
  withdrawalSats: number,
  feeSats: number
): LedgerEntry {
  return {
    txid: `TX-${refid}`,
    refid,
    time,
    type: 'withdrawal',
    amountSats: -withdrawalSats,
    feeSats,
  };
}

const BLOCK_TIME = new Date('2023-06-15T12:00:00Z');

describe('findMatchCandidates', () => {
  it('T1 property: recovers the originating withdrawal with the correct amount basis', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1000, max: 5_000_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom<AmountBasis>('net', 'net-minus-fee', 'net-plus-fee'),
        fc.integer({ min: -DEFAULT_TIME_WINDOW.beforeMs, max: DEFAULT_TIME_WINDOW.afterMs }),
        (withdrawalSats, feeSats, basis, offsetMs) => {
          const ledgerTime = new Date(BLOCK_TIME.getTime() + offsetMs);
          const entry = withdrawal('R1', ledgerTime, withdrawalSats, feeSats);
          const nodeSats =
            basis === 'net'
              ? withdrawalSats
              : basis === 'net-minus-fee'
                ? withdrawalSats - feeSats
                : withdrawalSats + feeSats;

          const candidates = findMatchCandidates({
            nodeSats,
            nodeBlockTime: BLOCK_TIME,
            ledger: [entry],
            alreadyMatchedRefids: new Set(),
          });

          expect(candidates.some((c) => c.refid === 'R1')).toBe(true);
          const match = candidates.find((c) => c.refid === 'R1')!;
          expect(match.amountDeltaSats).toBe(0);
        }
      )
    );
  });

  it('T2 collision: two withdrawals with identical sats both returned, neither pre-selected', () => {
    const ledger = [
      withdrawal('R1', BLOCK_TIME, 50_000_000, 0),
      withdrawal('R2', BLOCK_TIME, 50_000_000, 0),
    ];
    const candidates = findMatchCandidates({
      nodeSats: 50_000_000,
      nodeBlockTime: BLOCK_TIME,
      ledger,
      alreadyMatchedRefids: new Set(),
    });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((c) => c.refid))).toEqual(new Set(['R1', 'R2']));
  });

  it('T3 one-to-one: once refid A is matched, only B is returned for an identical node', () => {
    const ledger = [
      withdrawal('R1', BLOCK_TIME, 50_000_000, 0),
      withdrawal('R2', BLOCK_TIME, 50_000_000, 0),
    ];
    const candidates = findMatchCandidates({
      nodeSats: 50_000_000,
      nodeBlockTime: BLOCK_TIME,
      ledger,
      alreadyMatchedRefids: new Set(['R1']),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].refid).toBe('R2');
  });

  it('T4 time window: excluded just past the "precede" boundary, included just inside it', () => {
    // Ledger entry is fixed at BLOCK_TIME; we vary nodeBlockTime instead so
    // "how far before the block the entry is" moves across the boundary.
    const ledger = [withdrawal('R1', BLOCK_TIME, 50_000_000, 0)];
    const base = { nodeSats: 50_000_000, ledger, alreadyMatchedRefids: new Set<string>() };

    const justOutside = new Date(BLOCK_TIME.getTime() + DEFAULT_TIME_WINDOW.beforeMs + 1000);
    expect(findMatchCandidates({ ...base, nodeBlockTime: justOutside })).toHaveLength(0);

    const justInside = new Date(BLOCK_TIME.getTime() + DEFAULT_TIME_WINDOW.beforeMs - 1000);
    expect(findMatchCandidates({ ...base, nodeBlockTime: justInside })).toHaveLength(1);
  });

  it('T4b: ledger entry more than afterMs after the block time is excluded, less is included', () => {
    const withdrawalTime = new Date(BLOCK_TIME.getTime() + DEFAULT_TIME_WINDOW.afterMs + 1000);
    const ledger = [withdrawal('R1', withdrawalTime, 50_000_000, 0)];
    expect(
      findMatchCandidates({
        nodeSats: 50_000_000,
        nodeBlockTime: BLOCK_TIME,
        ledger,
        alreadyMatchedRefids: new Set(),
      })
    ).toHaveLength(0);

    const withdrawalTimeInside = new Date(
      BLOCK_TIME.getTime() + DEFAULT_TIME_WINDOW.afterMs - 1000
    );
    const ledgerInside = [withdrawal('R1', withdrawalTimeInside, 50_000_000, 0)];
    expect(
      findMatchCandidates({
        nodeSats: 50_000_000,
        nodeBlockTime: BLOCK_TIME,
        ledger: ledgerInside,
        alreadyMatchedRefids: new Set(),
      })
    ).toHaveLength(1);
  });

  it('T5 null block time: all candidates unverified, time window not applied', () => {
    const farOutsideWindow = new Date(BLOCK_TIME.getTime() - DEFAULT_TIME_WINDOW.beforeMs * 10);
    const ledger = [withdrawal('R1', farOutsideWindow, 50_000_000, 0)];
    const candidates = findMatchCandidates({
      nodeSats: 50_000_000,
      nodeBlockTime: null,
      ledger,
      alreadyMatchedRefids: new Set(),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].timeVerified).toBe(false);
  });

  it('T6 fee variants: node = |amount| - fee exact -> single candidate, net-minus-fee, delta 0', () => {
    const ledger = [withdrawal('R1', BLOCK_TIME, 100_000_000, 5000)];
    const candidates = findMatchCandidates({
      nodeSats: 99_995_000, // withdrawalSats - feeSats
      nodeBlockTime: BLOCK_TIME,
      ledger,
      alreadyMatchedRefids: new Set(),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].amountBasis).toBe('net-minus-fee');
    expect(candidates[0].amountDeltaSats).toBe(0);
  });

  it('is pure: does not mutate the ledger input', () => {
    const ledger = [withdrawal('R1', BLOCK_TIME, 50_000_000, 0)];
    const copy = ledger.map((e) => ({ ...e }));
    findMatchCandidates({
      nodeSats: 50_000_000,
      nodeBlockTime: BLOCK_TIME,
      ledger,
      alreadyMatchedRefids: new Set(),
    });
    expect(ledger).toEqual(copy);
  });
});

describe('findNearestMiss', () => {
  it('returns the closest unmatched withdrawal by amount, ignoring tolerance and time', () => {
    const ledger = [
      withdrawal('R1', BLOCK_TIME, 50_000_010, 0),
      withdrawal('R2', BLOCK_TIME, 60_000_000, 0),
    ];
    const miss = findNearestMiss(50_000_000, ledger, new Set());
    expect(miss).not.toBeNull();
    expect(miss!.refid).toBe('R1');
    expect(miss!.amountDeltaSats).toBe(10);
  });

  it('returns null when there are no unmatched withdrawals', () => {
    expect(findNearestMiss(50_000_000, [], new Set())).toBeNull();
  });
});

function trade(refid: string): LedgerEntry {
  return { txid: `TX-${refid}`, refid, time: BLOCK_TIME, type: 'trade', amountSats: 0, feeSats: 0 };
}

describe('reconcileMatches', () => {
  it('keeps all when every matched refid is still a withdrawal in the new ledger', () => {
    const existing = new Map<string, KrakenMatch>([
      ['n1', { refid: 'R1', amountBasis: 'net' }],
      ['n2', { refid: 'R2', amountBasis: 'net-minus-fee' }],
    ]);
    const ledger = [withdrawal('R1', BLOCK_TIME, 1, 0), withdrawal('R2', BLOCK_TIME, 2, 0)];
    const { kept, droppedRefids } = reconcileMatches(existing, ledger);
    expect(kept).toEqual(existing);
    expect(droppedRefids).toEqual([]);
  });

  it('drops all when no matched refid appears in the new ledger', () => {
    const existing = new Map<string, KrakenMatch>([['n1', { refid: 'R1', amountBasis: 'net' }]]);
    const ledger = [withdrawal('R9', BLOCK_TIME, 1, 0)];
    const { kept, droppedRefids } = reconcileMatches(existing, ledger);
    expect(kept.size).toBe(0);
    expect(droppedRefids).toEqual(['R1']);
  });

  it('partitions a mixed set correctly', () => {
    const existing = new Map<string, KrakenMatch>([
      ['n1', { refid: 'R1', amountBasis: 'net' }],
      ['n2', { refid: 'R2', amountBasis: 'net' }],
      ['n3', { refid: 'R3', amountBasis: 'net' }],
    ]);
    const ledger = [withdrawal('R1', BLOCK_TIME, 1, 0), withdrawal('R3', BLOCK_TIME, 3, 0)];
    const { kept, droppedRefids } = reconcileMatches(existing, ledger);
    expect([...kept.keys()].sort()).toEqual(['n1', 'n3']);
    expect(droppedRefids).toEqual(['R2']);
  });

  it('drops a refid that now appears only as a non-withdrawal row', () => {
    const existing = new Map<string, KrakenMatch>([['n1', { refid: 'R1', amountBasis: 'net' }]]);
    const ledger = [trade('R1')]; // same refid, but re-typed as a trade, not a withdrawal
    const { kept, droppedRefids } = reconcileMatches(existing, ledger);
    expect(kept.size).toBe(0);
    expect(droppedRefids).toEqual(['R1']);
  });

  it('re-uploading an identical ledger keeps everything and drops nothing', () => {
    const existing = new Map<string, KrakenMatch>([
      ['n1', { refid: 'R1', amountBasis: 'net' }],
      ['n2', { refid: 'R2', amountBasis: 'net-plus-fee' }],
    ]);
    const ledger = [withdrawal('R1', BLOCK_TIME, 1, 0), withdrawal('R2', BLOCK_TIME, 2, 0)];
    const { kept, droppedRefids } = reconcileMatches(existing, ledger);
    expect(kept).toEqual(existing);
    expect(droppedRefids).toEqual([]);
  });

  it('property: kept is a subset of existing, every kept refid is a withdrawal refid of the ledger, and kept ∪ dropped covers existing exactly', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 0, maxLength: 8 }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 0, maxLength: 8 }),
        (existingRefids, ledgerWithdrawalRefids) => {
          const existing = new Map<string, KrakenMatch>(
            existingRefids.map((refid, i) => [`n${i}`, { refid, amountBasis: 'net' as const }])
          );
          const ledger = ledgerWithdrawalRefids.map((refid) => withdrawal(refid, BLOCK_TIME, 1, 0));
          const { kept, droppedRefids } = reconcileMatches(existing, ledger);

          const withdrawalRefidSet = new Set(ledgerWithdrawalRefids);
          for (const match of kept.values()) {
            expect(withdrawalRefidSet.has(match.refid)).toBe(true);
          }
          for (const [nodeId, match] of kept) {
            expect(existing.get(nodeId)).toEqual(match);
          }
          const coveredRefids = new Set([
            ...[...kept.values()].map((m) => m.refid),
            ...droppedRefids,
          ]);
          expect(coveredRefids).toEqual(new Set(existingRefids));
          expect(kept.size + droppedRefids.length).toBe(existing.size);
        }
      )
    );
  });
});
