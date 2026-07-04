import { UTXONode } from './types';
import { DisplayCurrency } from './config';

// basisOverride stores the full (unscaled) basis for this node as computed
// from exchange CSV data. usd is always present; eur is set when the exchange
// provides EUR prices directly (Kraken trades CSV) to avoid a USD→EUR
// conversion approximation. leafBasis applies the scaledSats ratio on top.
export interface BasisOverride {
  usd: number;   // full node basis in USD
  eur?: number;  // full node basis in EUR, if known exactly
}

export interface ScaledLeaf {
  node: UTXONode;
  scaledSats: number;
  basisOverride?: BasisOverride;
}

// Price of one BTC at this node in the requested currency.
export function nodePrice(node: UTXONode, currency: DisplayCurrency): number {
  const usd = node.isOverride ? (node.manualPriceUsd ?? 0) : node.priceBtcUsd;
  return currency === 'EUR' ? usd * node.usdToEur : usd;
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

// Traversal: walk the expanded tree and collect leaf nodes with their
// proportionally scaled satoshi amounts.
export function collectLeaves(
  node: UTXONode,
  expandedIds: Set<string>,
  scale = 1
): ScaledLeaf[] {
  if (expandedIds.has(node.id) && node.children.length > 0) {
    const childrenSats = node.children.reduce((sum, c) => sum + c.amountSats, 0);
    const ratio = node.amountSats / childrenSats;
    return node.children.flatMap((c) => collectLeaves(c, expandedIds, scale * ratio));
  }
  return [{ node, scaledSats: node.amountSats * scale }];
}

// Immutable tree update: apply fn to the node with the given id, return new root.
export function updateNode(
  root: UTXONode,
  id: string,
  fn: (node: UTXONode) => UTXONode
): UTXONode {
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

// §23 EStG: private disposal gains are tax-free when held for MORE than one year.
// Uses calendar-accurate comparison so leap years are handled correctly.
// "mehr als ein Jahr" means disposalDate must be strictly after the one-year anniversary.
export function isPara23Exempt(acquisitionTs: number, disposalTs: number): boolean {
  if (!disposalTs || !acquisitionTs) return false;
  const oneYearAfterAcq = new Date(acquisitionTs * 1000);
  oneYearAfterAcq.setFullYear(oneYearAfterAcq.getFullYear() + 1);
  return new Date(disposalTs * 1000) > oneYearAfterAcq;
}
