import { UTXONode } from './types';
import { DisplayCurrency } from '../config';
import { applyRate } from './price';

// basisOverride stores the full (unscaled) basis for this node as computed
// from exchange CSV data. usd is always present; eur is set when the exchange
// provides EUR prices directly (Kraken trades CSV) to avoid a USD→EUR
// conversion approximation. leafBasis applies the scaledSats ratio on top.
export interface BasisOverride {
  usd: number; // full node basis in USD
  eur?: number; // full node basis in EUR, if known exactly
}

export interface ScaledLeaf {
  node: UTXONode;
  scaledSats: number;
  basisOverride?: BasisOverride;
}

// A manually-asserted price, recorded with mandatory rationale so the
// report can disclose it rather than silently blending it into "mempool".
export interface OverrideRecord {
  nodeId: string;
  txid: string;
  vout: number;
  priceUsd: number;
  previousPriceUsd: number | null;
  previousSource: string;
  memo: string;
  assertedAt: number;
}

// Price of one BTC at this node in the requested currency.
export function nodePrice(node: UTXONode, currency: DisplayCurrency): number {
  const usd = node.isOverride ? (node.manualPriceUsd ?? 0) : node.priceBtcUsd;
  return applyRate(usd, currency, node.usdToEur);
}

// Basis for a single scaled leaf.
// If basisOverride is set (from exchange CSV), use it with proportional scaling.
// Otherwise fall back to the node's mempool price.
export function leafBasis(leaf: ScaledLeaf, currency: DisplayCurrency): number {
  const { node, scaledSats, basisOverride } = leaf;
  if (basisOverride) {
    const ratio = node.amountSats > 0 ? scaledSats / node.amountSats : 1;
    if (currency === 'EUR') {
      const eur = basisOverride.eur ?? basisOverride.usd * (node.usdToEur || 1);
      return eur * ratio;
    }
    return basisOverride.usd * ratio;
  }
  const basis = (scaledSats / 1e8) * nodePrice(node, currency);
  return isNaN(basis) ? 0 : basis;
}

export function sumBasis(leaves: ScaledLeaf[], currency: DisplayCurrency): number {
  return leaves.reduce((sum, leaf) => sum + leafBasis(leaf, currency), 0);
}

// A pruned branch is excluded from the computation but its data is kept —
// see collectExcluded, which walks the identical ratio math to account for
// exactly what was left out (attributed + excluded === traced, always).
export interface PruneRecord {
  nodeId: string;
  txid: string;
  vout: number;
  amountSats: number;
  reason: string;
  prunedAt: number;
}

// Traversal: walk the expanded tree and collect leaf nodes with their
// proportionally scaled satoshi amounts. Pruned nodes (and their subtrees)
// contribute nothing here — see collectExcluded for their share.
export function collectLeaves(
  node: UTXONode,
  expandedIds: Set<string>,
  prunedIds: Set<string> = new Set(),
  scale = 1
): ScaledLeaf[] {
  if (prunedIds.has(node.id)) return [];
  if (expandedIds.has(node.id) && node.children.length > 0) {
    const childrenSats = node.children.reduce((sum, c) => sum + c.amountSats, 0);
    const ratio = node.amountSats / childrenSats;
    return node.children.flatMap((c) => collectLeaves(c, expandedIds, prunedIds, scale * ratio));
  }
  return [{ node, scaledSats: node.amountSats * scale }];
}

// The mirror image of collectLeaves: the scaled sats of every pruned
// subtree, using the identical proportional-scaling math, so that
// sum(collectLeaves) + sum(collectExcluded) === root.amountSats always.
export function collectExcluded(
  node: UTXONode,
  expandedIds: Set<string>,
  prunedIds: Set<string>,
  scale = 1
): ScaledLeaf[] {
  if (prunedIds.has(node.id)) return [{ node, scaledSats: node.amountSats * scale }];
  if (expandedIds.has(node.id) && node.children.length > 0) {
    const childrenSats = node.children.reduce((sum, c) => sum + c.amountSats, 0);
    const ratio = node.amountSats / childrenSats;
    return node.children.flatMap((c) => collectExcluded(c, expandedIds, prunedIds, scale * ratio));
  }
  return [];
}

// Immutable tree update: apply fn to the node with the given id, return new root.
export function updateNode(root: UTXONode, id: string, fn: (node: UTXONode) => UTXONode): UTXONode {
  if (root.id === id) return fn(root);
  if (root.children.length === 0) return root;
  return { ...root, children: root.children.map((c) => updateNode(c, id, fn)) };
}

// Find a node by id anywhere in the tree.
export function findNode(root: UTXONode, id: string): UTXONode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
