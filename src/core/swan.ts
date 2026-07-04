import { parseCSV } from './csvUtils';
import { DisplayCurrency } from '../config';
import { LotRow } from './kraken';
import { parseBtcToSats } from './sats';

export type SwanCsvType = 'swan-trades' | 'swan-transfers' | 'swan-withdrawals';

export interface SwanLot {
  date: Date;
  btcSats: number;
  priceUsd: number;
  source: 'trades' | 'transfers';
}

export interface SwanWithdrawal {
  txid: string;   // Bitcoin txid — matches UTXONode.txid directly
  btcSats: number;
  date: Date;     // Executed At (on-chain settlement time)
}

export interface SwanAttributedLot {
  date: Date;
  attributedSats: number;
  priceUsd: number;
  basisUsd: number;
}

export interface SwanWithdrawalAttribution {
  txid: string;
  withdrawalSats: number;
  lots: SwanAttributedLot[];
  totalBasisUsd: number;
}

// Swan files share a 2-line company preamble before the CSV header.
const SWAN_SKIP = 2;

export function detectSwanCsvType(text: string): SwanCsvType | null {
  // Trades (CoinTracker format) — no preamble, header on line 1
  if (text.trimStart().startsWith('Date,Received Quantity,Received Currency')) {
    return 'swan-trades';
  }
  // Transfers and withdrawals share the 2-line preamble
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines.length < 3) return null;
  const header = lines[2].trim();
  if (header.startsWith('Event,Date,Timezone,Status')) return 'swan-transfers';
  if (header.startsWith('Created At,Timezone,Transaction ID')) return 'swan-withdrawals';
  return null;
}

// Trades date: "MM/DD/YYYY HH:MM:SS" (no timezone — treat as UTC)
function parseTradeDate(s: string): Date {
  const [datePart, timePart] = s.trim().split(' ');
  const [m, d, y] = datePart.split('/');
  return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart}Z`);
}

// Transfers/withdrawals date: "2022-01-16 10:23:00+00"
function parseSwanDate(s: string): Date {
  return new Date(s.trim().replace(' ', 'T').replace('+00', 'Z'));
}

// Trades CSV: infer price from Sent / Received quantities.
export function parseSwanTrades(text: string): SwanLot[] {
  return parseCSV(text)
    .filter(r => r['Received Currency'] === 'BTC' && r['Sent Currency'] === 'USD')
    .map(r => {
      const btc = parseFloat(r['Received Quantity']) || 0;
      const usd = parseFloat(r['Sent Quantity']) || 0;
      return {
        date: parseTradeDate(r['Date']),
        btcSats: parseBtcToSats(r['Received Quantity']),
        priceUsd: btc > 0 ? usd / btc : 0,
        source: 'trades' as const,
      };
    })
    .filter(l => l.btcSats > 0);
}

// Transfers CSV: use explicit BTC Price field; only settled purchase rows.
export function parseSwanTransfers(text: string): SwanLot[] {
  return parseCSV(text, SWAN_SKIP)
    .filter(r => r['Event'] === 'purchase' && r['Status'] === 'settled')
    .map(r => {
      const price = parseFloat(r['BTC Price']) || 0;
      return {
        date: parseSwanDate(r['Date']),
        btcSats: parseBtcToSats(r['Unit Count']),
        priceUsd: price,
        source: 'transfers' as const,
      };
    })
    .filter(l => l.btcSats > 0 && l.priceUsd > 0);
}

// Withdrawals CSV: settled rows with a non-empty Bitcoin txid.
export function parseSwanWithdrawals(text: string): SwanWithdrawal[] {
  return parseCSV(text, SWAN_SKIP)
    .filter(r => r['Status'] === 'settled' && r['Transaction ID'].trim().length > 0)
    .map(r => ({
      txid: r['Transaction ID'].trim(),
      btcSats: parseBtcToSats(r['Bitcoin Amount']),
      date: parseSwanDate(r['Executed At']),
    }))
    .filter(w => w.btcSats > 0);
}

// FIFO attribution: assign purchase lots chronologically to each withdrawal.
// Swan withdrawals are matched by Bitcoin txid (exact), so the map key IS
// the txid that appears in UTXONode.txid.
export function buildSwanAttributions(
  lots: SwanLot[],
  withdrawals: SwanWithdrawal[]
): Map<string, SwanWithdrawalAttribution> {
  const sortedLots = [...lots].sort((a, b) => a.date.getTime() - b.date.getTime());
  const sortedWithdrawals = [...withdrawals].sort((a, b) => a.date.getTime() - b.date.getTime());

  const queue = sortedLots.map(lot => ({ lot, residualSats: lot.btcSats }));
  const result = new Map<string, SwanWithdrawalAttribution>();

  for (const w of sortedWithdrawals) {
    let remaining = w.btcSats;
    const attributedLots: SwanAttributedLot[] = [];

    for (const item of queue) {
      if (remaining <= 0) break;
      if (item.residualSats === 0) continue;

      const take = Math.min(item.residualSats, remaining);
      attributedLots.push({
        date: item.lot.date,
        attributedSats: take,
        priceUsd: item.lot.priceUsd,
        basisUsd: (take / 1e8) * item.lot.priceUsd,
      });
      item.residualSats -= take;
      remaining -= take;
    }

    result.set(w.txid, {
      txid: w.txid,
      withdrawalSats: w.btcSats,
      lots: attributedLots,
      totalBasisUsd: attributedLots.reduce((s, l) => s + l.basisUsd, 0),
    });
  }

  return result;
}

// Convert a Swan attribution to generic LotRow[] for rendering in LotTable.
// Swan prices are natively in USD; EUR is approximated via the node's
// usdToEur rate at blockchain transaction time.
export function swanToLotRows(
  attr: SwanWithdrawalAttribution,
  currency: DisplayCurrency,
  usdToEur: number
): LotRow[] {
  return attr.lots.map(al => ({
    date: al.date,
    btcSats: al.attributedSats,
    priceDisplay: currency === 'EUR' ? al.priceUsd * usdToEur : al.priceUsd,
    basisDisplay: currency === 'EUR' ? al.basisUsd * usdToEur : al.basisUsd,
    fromCsv: true,
  }));
}
