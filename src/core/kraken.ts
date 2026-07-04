import { parseCSV } from './csvUtils';
import { DisplayCurrency } from '../config';
import { classifyPriceSource } from './lots';
import { parseBtcToSats } from './sats';

export type PriceSource = 'trades-csv' | 'mempool';
export type AttributionPriceSource = 'trades-csv' | 'mixed' | 'mempool';

export interface KrakenLot {
  ledgerTxid: string;
  refid: string;
  time: Date;
  type: 'trade' | 'receive';
  pricePer: number | null; // EUR per BTC; null until mempool fetch
  priceSource: PriceSource;
  btcSats: number; // net sats credited (amount - fee)
}

export interface KrakenAttributedLot {
  lot: KrakenLot;
  attributedSats: number; // sats from this lot funding the withdrawal
  basisEur: number | null; // null if price not yet fetched
}

export interface KrakenWithdrawalAttribution {
  ledgerTxid: string;
  withdrawalAmountSats: number; // |amount| in sats — match against UTXO leaf
  withdrawalTime: Date;
  lots: KrakenAttributedLot[];
  priceSource: AttributionPriceSource;
}

// Normalized row for the generic LotTable component.
export interface LotRow {
  date: Date;
  btcSats: number;
  priceDisplay: number;
  basisDisplay: number;
  fromCsv: boolean;
}

export function detectCsvType(text: string): 'ledger' | 'trades' | null {
  const first = text.trimStart().slice(0, 120);
  if (first.includes('"txid","refid","time","type"')) return 'ledger';
  if (first.includes('"txid","ordertxid","pair"')) return 'trades';
  return null;
}

// Exported so App.tsx can store and merge entries across multiple files.
// amountSats is signed (negative for withdrawals); feeSats is always >= 0.
export interface LedgerEntry {
  txid: string;
  refid: string;
  time: Date;
  type: string;
  amountSats: number;
  feeSats: number;
}

export interface TradeEntry {
  txid: string;
  pair: string;
  price: number;
}

export function parseKrakenLedger(text: string): LedgerEntry[] {
  return parseCSV(text)
    .filter((r) => r.asset === 'BTC')
    .map((r) => ({
      txid: r.txid,
      refid: r.refid,
      time: new Date(r.time.replace(' ', 'T') + 'Z'),
      type: r.type,
      amountSats: parseBtcToSats(r.amount),
      feeSats: parseBtcToSats(r.fee),
    }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

export function parseKrakenTrades(text: string): Map<string, TradeEntry> {
  const map = new Map<string, TradeEntry>();
  for (const r of parseCSV(text)) {
    if (!r.pair.includes('BTC')) continue;
    map.set(r.txid, { txid: r.txid, pair: r.pair, price: parseFloat(r.price) || 0 });
  }
  return map;
}

function classifySource(lots: KrakenAttributedLot[]): AttributionPriceSource {
  return classifyPriceSource(
    lots.map((l) => l.lot.priceSource),
    'trades-csv',
    'mempool'
  );
}

// FIFO attribution: processes all BTC ledger entries in order, consumes
// lots from a queue for each withdrawal. Post-2022 Kraken trades charge
// fees in BTC, so net lot size = amount - fee for all acquisition types.
export function buildAttributions(
  ledger: LedgerEntry[],
  trades: Map<string, TradeEntry>
): Map<string, KrakenWithdrawalAttribution> {
  const queue: { lot: KrakenLot; residualSats: number }[] = [];
  const result = new Map<string, KrakenWithdrawalAttribution>();

  for (const entry of ledger) {
    const absSats = Math.abs(entry.amountSats);
    const feeSats = entry.feeSats;

    if ((entry.type === 'trade' || entry.type === 'receive') && entry.amountSats > 0) {
      const netSats = Math.max(0, absSats - feeSats);
      const trade = trades.get(entry.refid);
      const isEurPair = trade?.pair === 'BTC/EUR';
      const pricePer = isEurPair ? trade!.price : null;
      const priceSource: PriceSource = isEurPair ? 'trades-csv' : 'mempool';

      queue.push({
        lot: {
          ledgerTxid: entry.txid,
          refid: entry.refid,
          time: entry.time,
          type: entry.type as 'trade' | 'receive',
          pricePer,
          priceSource,
          btcSats: netSats,
        },
        residualSats: netSats,
      });
    } else if (entry.type === 'withdrawal' && entry.amountSats < 0) {
      const withdrawalSats = absSats;
      const totalConsume = absSats + feeSats;

      let remaining = totalConsume;
      let withdrawalRemaining = withdrawalSats;
      const attributedLots: KrakenAttributedLot[] = [];

      for (const item of queue) {
        if (remaining <= 0) break;
        if (item.residualSats === 0) continue;

        const take = Math.min(item.residualSats, remaining);
        const forWithdrawal = Math.min(take, withdrawalRemaining);

        if (forWithdrawal > 0) {
          attributedLots.push({
            lot: item.lot,
            attributedSats: forWithdrawal,
            basisEur: item.lot.pricePer !== null ? (forWithdrawal / 1e8) * item.lot.pricePer : null,
          });
          withdrawalRemaining -= forWithdrawal;
        }

        item.residualSats -= take;
        remaining -= take;
      }

      result.set(entry.txid, {
        ledgerTxid: entry.txid,
        withdrawalAmountSats: withdrawalSats,
        withdrawalTime: entry.time,
        lots: attributedLots,
        priceSource: classifySource(attributedLots),
      });
    }
  }

  return result;
}

export async function fillMissingPrices(
  attributions: Map<string, KrakenWithdrawalAttribution>,
  fetchUsdAtTs: (ts: number) => Promise<number>,
  fetchUsdToEurAtTs: (ts: number) => Promise<number>
): Promise<Map<string, KrakenWithdrawalAttribution>> {
  const needsPrice = new Map<string, KrakenLot>();
  for (const attr of attributions.values()) {
    for (const { lot } of attr.lots) {
      if (lot.pricePer === null) needsPrice.set(lot.ledgerTxid, lot);
    }
  }

  if (needsPrice.size === 0) return attributions;

  const fetchedPrices = new Map<string, number>();
  await Promise.all(
    Array.from(needsPrice.entries()).map(async ([txid, lot]) => {
      const ts = Math.floor(lot.time.getTime() / 1000);
      const [usd, usdToEur] = await Promise.all([
        fetchUsdAtTs(ts).catch(() => 0),
        fetchUsdToEurAtTs(ts).catch(() => 1),
      ]);
      fetchedPrices.set(txid, usd * usdToEur);
    })
  );

  const result = new Map<string, KrakenWithdrawalAttribution>();
  for (const [key, attr] of attributions) {
    const lots = attr.lots.map((al) => {
      if (al.lot.pricePer !== null) return al;
      const pricePer = fetchedPrices.get(al.lot.ledgerTxid) ?? 0;
      return {
        ...al,
        lot: { ...al.lot, pricePer, priceSource: 'mempool' as PriceSource },
        basisEur: (al.attributedSats / 1e8) * pricePer,
      };
    });
    result.set(key, { ...attr, lots, priceSource: classifySource(lots) });
  }
  return result;
}

// Convert a Kraken attribution to generic LotRow[] for rendering in LotTable.
// Kraken stores prices natively in EUR; USD display is approximated via the
// node's usdToEur rate at blockchain transaction time.
export function krakenToLotRows(
  attr: KrakenWithdrawalAttribution,
  currency: DisplayCurrency,
  usdToEur: number
): LotRow[] {
  return attr.lots.map((al) => {
    const pricePer = al.lot.pricePer ?? 0;
    const basisEur = al.basisEur ?? 0;
    return {
      date: al.lot.time,
      btcSats: al.attributedSats,
      priceDisplay: currency === 'EUR' ? pricePer : pricePer / (usdToEur || 1),
      basisDisplay: currency === 'EUR' ? basisEur : basisEur / (usdToEur || 1),
      fromCsv: al.lot.priceSource !== 'mempool',
    };
  });
}
