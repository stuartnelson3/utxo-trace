import { describe, it, expect } from 'vitest';
import {
  detectCsvType,
  parseKrakenLedger,
  parseKrakenTrades,
  buildAttributions,
  findMatchingWithdrawal,
} from './kraken';
import { sumBasis, leafBasis, ScaledLeaf } from './utils';
import { UTXONode } from './types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const LEDGER_HEADER =
  '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"';

const TRADES_HEADER =
  '"txid","ordertxid","pair","aclass","subclass","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers","posttxid","posstatuscode","cprice","ccost","cfee","cvol","cmargin","net","trades"';

function ledgerRow(
  txid: string,
  refid: string,
  time: string,
  type: string,
  amount: number,
  fee: number,
  balance: number
): string {
  return `"${txid}","${refid}","${time}","${type}","","currency","BTC","spot / main",${amount},${fee},${balance}`;
}

function tradeRow(txid: string, pair: string, price: number, vol: number, ledgerTxid: string): string {
  const cost = price * vol;
  return `"${txid}","ORD-${txid}","${pair}","forex","crypto","2023-01-01 00:00:00.0000","buy","limit",${price},${cost},0,${vol},0,"","${ledgerTxid}","","","","","","","","",""`;
}

// ---------------------------------------------------------------------------
// 1. detectCsvType
// ---------------------------------------------------------------------------

describe('detectCsvType', () => {
  it('identifies ledger CSV', () => {
    const csv = `${LEDGER_HEADER}\n${ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade', 0.5, 0, 0.5)}`;
    expect(detectCsvType(csv)).toBe('ledger');
  });

  it('identifies trades CSV', () => {
    const csv = `${TRADES_HEADER}\n${tradeRow('T1', 'BTC/EUR', 20000, 0.5, 'L1')}`;
    expect(detectCsvType(csv)).toBe('trades');
  });

  it('returns null for unknown format', () => {
    expect(detectCsvType('col1,col2,col3\n1,2,3')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. parseKrakenLedger
// ---------------------------------------------------------------------------

describe('parseKrakenLedger', () => {
  it('filters out non-BTC rows', () => {
    const csv = [
      LEDGER_HEADER,
      '"L1","T1","2023-01-01 00:00:00","trade","","currency","BTC","spot / main",0.5,0,0.5',
      '"L2","T2","2023-01-02 00:00:00","trade","","currency","ETH","spot / main",1.0,0,1.0',
    ].join('\n');
    const rows = parseKrakenLedger(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].txid).toBe('L1');
  });

  it('computes net amount as amount − fee', () => {
    // Post-2022 style: fee charged in BTC
    const csv = [
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade', 1.001, 0.001, 1.0),
    ].join('\n');
    const rows = parseKrakenLedger(csv);
    expect(rows[0].amount).toBeCloseTo(1.001);
    expect(rows[0].fee).toBeCloseTo(0.001);
  });

  it('sorts rows by time ascending', () => {
    const csv = [
      LEDGER_HEADER,
      ledgerRow('L2', 'T2', '2023-02-01 00:00:00', 'trade', 0.5, 0, 1.0),
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade', 0.5, 0, 0.5),
    ].join('\n');
    const rows = parseKrakenLedger(csv);
    expect(rows[0].txid).toBe('L1');
    expect(rows[1].txid).toBe('L2');
  });
});

// ---------------------------------------------------------------------------
// 3. parseKrakenTrades
// ---------------------------------------------------------------------------

describe('parseKrakenTrades', () => {
  it('indexes BTC/EUR trades by txid', () => {
    const csv = [
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 30000, 0.5, 'L1'),
    ].join('\n');
    const map = parseKrakenTrades(csv);
    expect(map.has('T1')).toBe(true);
    expect(map.get('T1')!.price).toBe(30000);
    expect(map.get('T1')!.pair).toBe('BTC/EUR');
  });

  it('includes non-EUR BTC pairs (price will be ignored by FIFO)', () => {
    const csv = [
      TRADES_HEADER,
      tradeRow('T1', 'TRX/BTC', 0.0000019, 2880, 'L1'),
    ].join('\n');
    const map = parseKrakenTrades(csv);
    expect(map.has('T1')).toBe(true);
  });

  it('excludes non-BTC pairs', () => {
    const csv = [
      TRADES_HEADER,
      tradeRow('T1', 'ETH/EUR', 2000, 1.0, 'L1'),
    ].join('\n');
    const map = parseKrakenTrades(csv);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. buildAttributions — FIFO scenarios
// ---------------------------------------------------------------------------

describe('buildAttributions', () => {

  // Scenario A: single BTC/EUR trade → single withdrawal, exact match
  // Lot: 1.0 BTC @ 30 000 EUR
  // Withdrawal: 1.0 BTC, fee 0
  // Expected basis: 1.0 × 30 000 = 30 000 EUR
  it('attributes a single lot to a matching withdrawal', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      1.0, 0, 1.0),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -1.0, 0, 0),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 30000, 1.0, 'L1'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    expect(attrs.size).toBe(1);
    const attr = attrs.get('LW')!;
    expect(attr.withdrawalAmountSats).toBe(100_000_000);
    expect(attr.lots).toHaveLength(1);
    expect(attr.lots[0].attributedSats).toBe(100_000_000);
    expect(attr.lots[0].lot.pricePer).toBe(30000);
    expect(attr.lots[0].basisEur).toBeCloseTo(30000);
    expect(attr.priceSource).toBe('trades-csv');
  });

  // Scenario B: trade with BTC fee — net lot = amount − fee
  // Gross: 1.001 BTC, fee: 0.001 BTC → net: 1.000 BTC in queue
  // Withdrawal: 1.0 BTC, fee 0
  it('uses net lot size (amount − fee) for BTC-fee trades', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      1.001, 0.001, 1.0),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -1.0,  0,     0),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 30000, 1.0, 'L1'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    const attr = attrs.get('LW')!;
    expect(attr.withdrawalAmountSats).toBe(100_000_000);
    expect(attr.lots[0].attributedSats).toBe(100_000_000);
    expect(attr.lots[0].basisEur).toBeCloseTo(30000);
  });

  // Scenario C: receive entry (no matching trade) → pricePer is null
  // Receive: 0.25 BTC, fee 0.00025 → net 0.24975 BTC
  // Withdrawal: 0.24975 BTC
  it('marks receive-entry lots with null price (mempool source)', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'TR1', '2023-01-01 00:00:00', 'receive',    0.25,     0.00025, 0.24975),
      ledgerRow('LW', 'AW',  '2023-02-01 00:00:00', 'withdrawal', -0.24975, 0,       0),
    ].join('\n'));
    const trades = parseKrakenTrades(`${TRADES_HEADER}\n`); // empty

    const attrs = buildAttributions(ledger, trades);
    const attr = attrs.get('LW')!;
    expect(attr.lots[0].lot.pricePer).toBeNull();
    expect(attr.lots[0].lot.priceSource).toBe('mempool');
    expect(attr.lots[0].basisEur).toBeNull();
    expect(attr.priceSource).toBe('mempool');
  });

  // Scenario D: multi-lot FIFO
  // Lot A: 0.5 BTC @ 20 000 EUR
  // Lot B: 0.5 BTC @ 25 000 EUR
  // Withdrawal: 0.7 BTC, fee 0
  // Expected: consume all of A (0.5) + 0.2 from B
  // Basis: 0.5×20 000 + 0.2×25 000 = 10 000 + 5 000 = 15 000 EUR
  it('applies FIFO ordering across multiple lots', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      0.5, 0, 0.5),
      ledgerRow('L2', 'T2', '2023-01-15 00:00:00', 'trade',      0.5, 0, 1.0),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -0.7, 0, 0.3),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 20000, 0.5, 'L1'),
      tradeRow('T2', 'BTC/EUR', 25000, 0.5, 'L2'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    const attr = attrs.get('LW')!;
    expect(attr.withdrawalAmountSats).toBe(70_000_000);
    expect(attr.lots).toHaveLength(2);
    expect(attr.lots[0].attributedSats).toBe(50_000_000); // all of Lot A
    expect(attr.lots[1].attributedSats).toBe(20_000_000); // 0.2 from Lot B
    const totalBasis = attr.lots.reduce((s, l) => s + (l.basisEur ?? 0), 0);
    expect(totalBasis).toBeCloseTo(15000);
  });

  // Scenario E: FIFO state carries across two withdrawals
  // (continues from Scenario D — Lot B has 0.3 BTC residual)
  // Lot C: 0.2 BTC @ 28 000 EUR
  // Withdrawal 2: 0.4 BTC, fee 0
  // Expected: 0.3 from B residual + 0.1 from C
  // Basis: 0.3×25 000 + 0.1×28 000 = 7 500 + 2 800 = 10 300 EUR
  it('carries FIFO residuals across sequential withdrawals', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      0.5, 0, 0.5),
      ledgerRow('L2', 'T2', '2023-01-15 00:00:00', 'trade',      0.5, 0, 1.0),
      ledgerRow('LW1', 'AW1', '2023-02-01 00:00:00', 'withdrawal', -0.7, 0, 0.3),
      ledgerRow('L3', 'T3', '2023-02-10 00:00:00', 'trade',      0.2, 0, 0.5),
      ledgerRow('LW2', 'AW2', '2023-03-01 00:00:00', 'withdrawal', -0.4, 0, 0.1),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 20000, 0.5, 'L1'),
      tradeRow('T2', 'BTC/EUR', 25000, 0.5, 'L2'),
      tradeRow('T3', 'BTC/EUR', 28000, 0.2, 'L3'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);

    // First withdrawal: Lot A fully, 0.2 from Lot B
    const w1 = attrs.get('LW1')!;
    expect(w1.lots[0].attributedSats).toBe(50_000_000);
    expect(w1.lots[1].attributedSats).toBe(20_000_000);

    // Second withdrawal: 0.3 Lot B residual + 0.1 from Lot C
    const w2 = attrs.get('LW2')!;
    expect(w2.lots).toHaveLength(2);
    expect(w2.lots[0].attributedSats).toBe(30_000_000); // B residual
    expect(w2.lots[0].lot.pricePer).toBe(25000);
    expect(w2.lots[1].attributedSats).toBe(10_000_000); // 0.1 from C
    expect(w2.lots[1].lot.pricePer).toBe(28000);
    const basis2 = w2.lots.reduce((s, l) => s + (l.basisEur ?? 0), 0);
    expect(basis2).toBeCloseTo(10300);
  });

  // Scenario F: withdrawal fee is consumed from the FIFO queue
  // Lot A: 0.2 BTC → 20 000 000 sats
  // Withdrawal: amount=-0.19 BTC, fee=0.01 BTC → total consume = 0.20 BTC
  // After withdrawal: queue empty, UTXO receives 0.19 BTC
  it('withdraws both amount and fee from the queue', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      0.2,   0,    0.2),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -0.19, 0.01, 0),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'BTC/EUR', 20000, 0.2, 'L1'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    const attr = attrs.get('LW')!;
    // UTXO gets only |amount| = 0.19 BTC
    expect(attr.withdrawalAmountSats).toBe(19_000_000);
    expect(attr.lots[0].attributedSats).toBe(19_000_000);
    expect(attr.lots[0].basisEur).toBeCloseTo(3800); // 0.19 × 20 000
  });

  // Scenario G: non-EUR-pair trade → null price (price column is not EUR/BTC)
  // e.g. TRX/BTC swap — price is BTC-per-TRX, not EUR-per-BTC
  it('sets null price for non-BTC/EUR trades', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',      0.005, 0, 0.005),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -0.005, 0, 0),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T1', 'TRX/BTC', 0.0000019, 2631, 'L1'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    const attr = attrs.get('LW')!;
    expect(attr.lots[0].lot.pricePer).toBeNull();
    expect(attr.lots[0].lot.priceSource).toBe('mempool');
    expect(attr.priceSource).toBe('mempool');
  });

  // Scenario H: mixed priceSource classification
  it('classifies priceSource as "mixed" when lots span both sources', () => {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1',  '2023-01-01 00:00:00', 'receive',    0.1, 0, 0.1), // no trades entry
      ledgerRow('L2', 'T2',  '2023-01-15 00:00:00', 'trade',      0.1, 0, 0.2),
      ledgerRow('LW', 'AW',  '2023-02-01 00:00:00', 'withdrawal', -0.2, 0, 0),
    ].join('\n'));
    const trades = parseKrakenTrades([
      TRADES_HEADER,
      tradeRow('T2', 'BTC/EUR', 25000, 0.1, 'L2'),
    ].join('\n'));

    const attrs = buildAttributions(ledger, trades);
    expect(attrs.get('LW')!.priceSource).toBe('mixed');
  });
});

// ---------------------------------------------------------------------------
// 5. findMatchingWithdrawal
// ---------------------------------------------------------------------------

describe('findMatchingWithdrawal', () => {
  // Build a minimal set of attributions for matching tests
  function makeAttrs(withdrawalBtc: number) {
    const ledger = parseKrakenLedger([
      LEDGER_HEADER,
      ledgerRow('L1', 'T1', '2023-01-01 00:00:00', 'trade',       withdrawalBtc, 0, withdrawalBtc),
      ledgerRow('LW', 'AW', '2023-02-01 00:00:00', 'withdrawal', -withdrawalBtc, 0, 0),
    ].join('\n'));
    return buildAttributions(ledger, new Map());
  }

  it('returns the attribution for an exact sats match', () => {
    const attrs = makeAttrs(0.5);
    const result = findMatchingWithdrawal(attrs, 50_000_000);
    expect(result).not.toBeNull();
    expect(result!.withdrawalAmountSats).toBe(50_000_000);
  });

  it('matches within 2-sat tolerance', () => {
    const attrs = makeAttrs(0.5); // 50_000_000 sats
    expect(findMatchingWithdrawal(attrs, 50_000_001)).not.toBeNull();
    expect(findMatchingWithdrawal(attrs, 49_999_999)).not.toBeNull();
    expect(findMatchingWithdrawal(attrs, 50_000_002)).not.toBeNull();
  });

  it('returns null when more than 2 sats off', () => {
    const attrs = makeAttrs(0.5);
    expect(findMatchingWithdrawal(attrs, 50_000_003)).toBeNull();
    expect(findMatchingWithdrawal(attrs, 49_999_997)).toBeNull();
  });

  it('returns null when no withdrawals loaded', () => {
    expect(findMatchingWithdrawal(new Map(), 50_000_000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. sumBasis with krakenAttribution
// ---------------------------------------------------------------------------

// Minimal UTXONode stub
function makeNode(amountSats: number): UTXONode {
  return {
    id: 'test:0',
    txid: 'test',
    vout: 0,
    amountSats,
    timestamp: 1700000000,
    priceBtcUsd: 40000,
    usdToEur: 0.92,
    isOverride: false,
    children: [],
  };
}

describe('sumBasis with basisOverride', () => {
  it('uses basisOverride EUR basis instead of node price', () => {
    const amountSats = 100_000_000; // 1 BTC
    const node = makeNode(amountSats);

    // Without override: basis = 1 BTC × 40 000 USD × 0.92 = 36 800 EUR
    const leavesPlain: ScaledLeaf[] = [{ node, scaledSats: amountSats }];
    expect(sumBasis(leavesPlain, 'EUR')).toBeCloseTo(36800);

    // With override: basis = 30 000 EUR (from exchange CSV)
    const leavesOverride: ScaledLeaf[] = [
      { node, scaledSats: amountSats, basisOverride: { usd: 30000 / 0.92, eur: 30000 } },
    ];
    expect(sumBasis(leavesOverride, 'EUR')).toBeCloseTo(30000);
  });

  it('applies proportional scale to basisOverride', () => {
    const amountSats = 100_000_000;
    const node = makeNode(amountSats);

    // Node is 1 BTC but scaled to 0.6 (60% of parent UTXO)
    const leavesScaled: ScaledLeaf[] = [
      { node, scaledSats: 60_000_000, basisOverride: { usd: 30000 / 0.92, eur: 30000 } },
    ];
    // Expected: 30 000 × (60_000_000 / 100_000_000) = 18 000 EUR
    expect(sumBasis(leavesScaled, 'EUR')).toBeCloseTo(18000);
  });

  it('sums multiple leaves where only some have basisOverride', () => {
    const amountSats = 100_000_000; // 1 BTC
    const node1 = makeNode(amountSats);
    const node2 = makeNode(amountSats);

    const leaves: ScaledLeaf[] = [
      { node: node1, scaledSats: amountSats, basisOverride: { usd: 30000 / 0.92, eur: 30000 } }, // 30 000 EUR
      { node: node2, scaledSats: amountSats },  // 40 000 × 0.92 = 36 800 EUR
    ];
    expect(sumBasis(leaves, 'EUR')).toBeCloseTo(66800);
  });

  it('uses usd field when eur is absent (Swan-style)', () => {
    const amountSats = 100_000_000;
    const node = makeNode(amountSats); // usdToEur = 0.92
    const leaves: ScaledLeaf[] = [
      { node, scaledSats: amountSats, basisOverride: { usd: 40000 } }, // no eur field
    ];
    // EUR = usd * usdToEur = 40 000 * 0.92 = 36 800
    expect(sumBasis(leaves, 'EUR')).toBeCloseTo(36800);
    expect(sumBasis(leaves, 'USD')).toBeCloseTo(40000);
  });
});
