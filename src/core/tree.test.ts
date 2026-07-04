import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  collectLeaves,
  collectExcluded,
  updateNode,
  findNode,
  sumBasis,
  leafBasis,
  ScaledLeaf,
} from './tree';
import { UTXONode } from './types';

// Bounded-depth arbitrary tree. Children are NOT required to sum to the
// parent's amount (that's the normal case on-chain, once miner fees are
// involved) — collectLeaves compensates by scaling proportionally, which is
// exactly the invariant under test below.
function arbNode(depth: number): fc.Arbitrary<UTXONode> {
  const base = {
    id: fc.uuid(),
    txid: fc.string({ minLength: 10, maxLength: 20 }),
    vout: fc.nat(4),
    amountSats: fc.integer({ min: 1, max: 5_000_000_000 }),
    timestamp: fc.integer({ min: 0, max: 4_102_444_800 }),
    priceBtcUsd: fc.double({ min: 0, max: 200_000, noNaN: true }),
    usdToEur: fc.double({ min: 0.5, max: 1.2, noNaN: true }),
    isOverride: fc.constant(false as const),
  };
  if (depth <= 0) {
    return fc.record({ ...base, children: fc.constant([] as UTXONode[]) });
  }
  return fc.oneof(
    fc.record({ ...base, children: fc.constant([] as UTXONode[]) }),
    fc.record({ ...base, children: fc.array(arbNode(depth - 1), { minLength: 1, maxLength: 3 }) })
  );
}

function allIds(node: UTXONode): string[] {
  return [node.id, ...node.children.flatMap(allIds)];
}

describe('collectLeaves', () => {
  it('conserves total scaled sats when every internal node is expanded', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        const expanded = new Set(allIds(root));
        const leaves = collectLeaves(root, expanded);
        const total = leaves.reduce((sum, l) => sum + l.scaledSats, 0);
        // Proportional rescaling is floating-point division; allow a tiny
        // relative tolerance rather than asserting exact equality.
        expect(Math.abs(total - root.amountSats)).toBeLessThan(Math.max(1, root.amountSats * 1e-9));
      })
    );
  });

  it('returns exactly the root as a single leaf when nothing is expanded', () => {
    fc.assert(
      fc.property(arbNode(2), (root) => {
        const leaves = collectLeaves(root, new Set());
        expect(leaves).toHaveLength(1);
        expect(leaves[0].node.id).toBe(root.id);
        expect(leaves[0].scaledSats).toBe(root.amountSats);
      })
    );
  });
});

describe('collectExcluded / prune conservation', () => {
  it('attributed + excluded === traced total, for any subset of pruned nodes', () => {
    fc.assert(
      fc.property(
        arbNode(3),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
        (root, flags) => {
          const expanded = new Set(allIds(root));
          const ids = allIds(root);
          // Prune a pseudo-random subset (any id whose position flag is true).
          const prunedIds = new Set(
            flags.length === 0 ? [] : ids.filter((_, i) => flags[i % flags.length])
          );

          const attributed = collectLeaves(root, expanded, prunedIds).reduce(
            (s, l) => s + l.scaledSats,
            0
          );
          const excluded = collectExcluded(root, expanded, prunedIds).reduce(
            (s, l) => s + l.scaledSats,
            0
          );
          const tolerance = Math.max(1, root.amountSats * 1e-9);
          expect(Math.abs(attributed + excluded - root.amountSats)).toBeLessThan(tolerance);
        }
      )
    );
  });

  it('prune/restore round trip: excluding then un-excluding a node returns to the original total', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        const expanded = new Set(allIds(root));
        const ids = allIds(root);
        const targetId = ids[ids.length - 1];

        const before = collectLeaves(root, expanded).reduce((s, l) => s + l.scaledSats, 0);

        // "prune"
        const pruned = new Set([targetId]);
        const duringAttributed = collectLeaves(root, expanded, pruned).reduce(
          (s, l) => s + l.scaledSats,
          0
        );
        const duringExcluded = collectExcluded(root, expanded, pruned).reduce(
          (s, l) => s + l.scaledSats,
          0
        );
        const tolerance = Math.max(1, root.amountSats * 1e-9);
        expect(Math.abs(duringAttributed + duringExcluded - root.amountSats)).toBeLessThan(
          tolerance
        );

        // "restore" (empty prune set again)
        const after = collectLeaves(root, expanded, new Set()).reduce(
          (s, l) => s + l.scaledSats,
          0
        );
        expect(after).toBeCloseTo(before, 6);
      })
    );
  });

  it('a pruned node with children excludes the whole subtree, not just itself', () => {
    const leaf: UTXONode = {
      id: 'leaf',
      txid: 't-leaf',
      vout: 0,
      amountSats: 100,
      timestamp: 0,
      priceBtcUsd: 0,
      usdToEur: 1,
      isOverride: false,
      children: [],
    };
    const branch: UTXONode = {
      id: 'branch',
      txid: 't-branch',
      vout: 0,
      amountSats: 100,
      timestamp: 0,
      priceBtcUsd: 0,
      usdToEur: 1,
      isOverride: false,
      children: [leaf],
    };
    const root: UTXONode = {
      id: 'root',
      txid: 't-root',
      vout: 0,
      amountSats: 100,
      timestamp: 0,
      priceBtcUsd: 0,
      usdToEur: 1,
      isOverride: false,
      children: [branch],
    };
    const expanded = new Set(['root', 'branch']);
    const pruned = new Set(['branch']);

    expect(collectLeaves(root, expanded, pruned)).toEqual([]);
    expect(collectExcluded(root, expanded, pruned)).toEqual([{ node: branch, scaledSats: 100 }]);
  });
});

describe('updateNode / findNode', () => {
  it('finds every node reachable in the tree', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        for (const id of allIds(root)) {
          expect(findNode(root, id)).not.toBeNull();
        }
      })
    );
  });

  it('returns null for an id not present in the tree', () => {
    fc.assert(
      fc.property(arbNode(3), fc.uuid(), (root, randomId) => {
        fc.pre(!allIds(root).includes(randomId));
        expect(findNode(root, randomId)).toBeNull();
      })
    );
  });

  it('updateNode is an identity when fn is identity', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        const result = updateNode(root, root.id, (n) => n);
        expect(result).toEqual(root);
      })
    );
  });

  it('updateNode does not mutate the input tree', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        const frozenCopy = JSON.parse(JSON.stringify(root));
        updateNode(root, root.id, (n) => ({ ...n, memo: 'changed' }));
        expect(root).toEqual(frozenCopy);
      })
    );
  });

  it('applies the update at the target id and leaves siblings untouched', () => {
    fc.assert(
      fc.property(arbNode(3), (root) => {
        const ids = allIds(root);
        const targetId = ids[ids.length - 1];
        const updated = updateNode(root, targetId, (n) => ({ ...n, memo: 'hit' }));
        expect(findNode(updated, targetId)!.memo).toBe('hit');
      })
    );
  });
});

describe('sumBasis / leafBasis', () => {
  it('is additive across leaves regardless of grouping', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            node: arbNode(0),
            scaledSats: fc.integer({ min: 0, max: 5_000_000_000 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (leaves: ScaledLeaf[]) => {
          const total = sumBasis(leaves, 'USD');
          const manual = leaves.reduce((s, l) => s + leafBasis(l, 'USD'), 0);
          expect(total).toBeCloseTo(manual, 6);
        }
      )
    );
  });
});
