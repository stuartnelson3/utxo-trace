import { KrakenWithdrawalAttribution } from './kraken';

// Find a withdrawal matching a UTXO leaf amount (within 2 sats tolerance).
// Amount-only, first-match: collides on equal amounts and can't tell a
// network/exchange fee apart from a mismatch. Task 3 replaces this with a
// fee-aware, time-windowed candidate finder that never auto-selects among
// ambiguous candidates.
export function findMatchingWithdrawal(
  attributions: Map<string, KrakenWithdrawalAttribution>,
  leafAmountSats: number
): KrakenWithdrawalAttribution | null {
  for (const attr of attributions.values()) {
    if (Math.abs(attr.withdrawalAmountSats - leafAmountSats) <= 2) return attr;
  }
  return null;
}
