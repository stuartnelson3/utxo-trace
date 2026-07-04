import { describe, it, expect } from 'vitest';
import {
  detectSwanCsvType,
  parseSwanTrades,
  parseSwanTransfers,
  parseSwanWithdrawals,
  buildSwanAttributions,
  SwanLot,
  SwanWithdrawal,
} from './swan';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const COMPANY_LINE = '"Electric Solidus LLC (DBA Swan Bitcoin)"';
const PHONE_LINE = 'Phone: 12183797926';

const TRANSFERS_HEADER = 'Event,Date,Timezone,Status,Transaction ID,Total USD,Transaction USD,Fee USD,Unit Count,Asset Type,BTC Price,Address Label,USD Cost Basis,Acquisition Date';
const WITHDRAWALS_HEADER = 'Created At,Timezone,Transaction ID,Executed At,Canceled At,Status,Bitcoin Amount,Automatic,IP Address';
const TRADES_HEADER = 'Date,Received Quantity,Received Currency,Sent Quantity,Sent Currency,Fee Amount,Fee Currency,Tag';

function transfersFile(rows: string[]): string {
  return [COMPANY_LINE, PHONE_LINE, TRANSFERS_HEADER, ...rows].join('\n');
}

function withdrawalsFile(rows: string[]): string {
  return [COMPANY_LINE, PHONE_LINE, WITHDRAWALS_HEADER, ...rows].join('\n');
}

function tradesFile(rows: string[]): string {
  return [TRADES_HEADER, ...rows].join('\n');
}

function transferRow(date: string, btc: number, price: number): string {
  return `purchase,${date},UTC,settled,uuid-1,,,,${btc},BTC,${price},,,`;
}

function withdrawalRow(txid: string, executedAt: string, btc: number): string {
  return `${executedAt},UTC,${txid},${executedAt},,settled,${btc},f,1.2.3.4`;
}

function tradeRow(date: string, btc: number, usd: number): string {
  return `${date},${btc},BTC,${usd},USD,0.00,USD,""`;
}

// ---------------------------------------------------------------------------
// 1. detectSwanCsvType
// ---------------------------------------------------------------------------

describe('detectSwanCsvType', () => {
  it('identifies swan trades CSV', () => {
    const csv = tradesFile([tradeRow('08/24/2023 17:15:57', 0.003826, 100)]);
    expect(detectSwanCsvType(csv)).toBe('swan-trades');
  });

  it('identifies swan transfers CSV', () => {
    const csv = transfersFile([transferRow('2023-08-24 17:16:03+00', 0.003826, 26136)]);
    expect(detectSwanCsvType(csv)).toBe('swan-transfers');
  });

  it('identifies swan withdrawals CSV', () => {
    const csv = withdrawalsFile([withdrawalRow('abc123', '2023-08-24 18:01:52+00', 0.003826)]);
    expect(detectSwanCsvType(csv)).toBe('swan-withdrawals');
  });

  it('returns null for unrecognized format', () => {
    expect(detectSwanCsvType('"txid","refid","time","type"\nL1,R1,2023-01-01,trade')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. parseSwanTrades
// ---------------------------------------------------------------------------

describe('parseSwanTrades', () => {
  it('parses rows and infers price', () => {
    const csv = tradesFile([tradeRow('08/24/2023 17:15:57', 0.003826, 100)]);
    const lots = parseSwanTrades(csv);
    expect(lots).toHaveLength(1);
    expect(lots[0].btcSats).toBe(382600);
    expect(lots[0].priceUsd).toBeCloseTo(100 / 0.003826, 0);
    expect(lots[0].source).toBe('trades');
  });

  it('parses date correctly as UTC', () => {
    const csv = tradesFile([tradeRow('01/15/2024 08:43:00', 0.00233707, 100)]);
    const lots = parseSwanTrades(csv);
    expect(lots[0].date.toISOString()).toBe('2024-01-15T08:43:00.000Z');
  });

  it('skips rows with zero BTC', () => {
    const csv = tradesFile([tradeRow('08/24/2023 17:15:57', 0, 0)]);
    expect(parseSwanTrades(csv)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. parseSwanTransfers
// ---------------------------------------------------------------------------

describe('parseSwanTransfers', () => {
  it('parses settled purchase rows', () => {
    const csv = transfersFile([transferRow('2023-08-24 17:16:03+00', 0.003826, 26136.96)]);
    const lots = parseSwanTransfers(csv);
    expect(lots).toHaveLength(1);
    expect(lots[0].btcSats).toBe(382600);
    expect(lots[0].priceUsd).toBeCloseTo(26136.96);
    expect(lots[0].source).toBe('transfers');
  });

  it('skips non-purchase events (deposit, prepaid_fee)', () => {
    const csv = [
      COMPANY_LINE, PHONE_LINE, TRANSFERS_HEADER,
      `deposit,2023-08-24 17:15:39+00,UTC,settled,,100.00,,,,USD,,,,`,
      transferRow('2023-08-24 17:16:03+00', 0.003826, 26136.96),
      `prepaid_fee,2023-08-24 17:00:00+00,UTC,settled,,,,1.00,,,,,,`,
    ].join('\n');
    const lots = parseSwanTransfers(csv);
    expect(lots).toHaveLength(1);
  });

  it('skips reversed rows', () => {
    const csv = [
      COMPANY_LINE, PHONE_LINE, TRANSFERS_HEADER,
      `deposit,2022-11-12 15:49:23+00,UTC,reversed,,504.95,,4.95,,USD,,,,`,
      transferRow('2023-08-24 17:16:03+00', 0.003826, 26136.96),
    ].join('\n');
    const lots = parseSwanTransfers(csv);
    expect(lots).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. parseSwanWithdrawals
// ---------------------------------------------------------------------------

describe('parseSwanWithdrawals', () => {
  it('parses settled rows with txid', () => {
    const csv = withdrawalsFile([withdrawalRow('abc123def', '2023-08-24 18:01:52+00', 0.011473)]);
    const ws = parseSwanWithdrawals(csv);
    expect(ws).toHaveLength(1);
    expect(ws[0].txid).toBe('abc123def');
    expect(ws[0].btcSats).toBe(1147300);
  });

  it('skips rows with empty txid', () => {
    const csv = withdrawalsFile([
      `2022-11-18 22:05:03+00,UTC,,2022-11-18 22:05:04+00,,settled,0.00010000,f,1.2.3.4`,
    ]);
    expect(parseSwanWithdrawals(csv)).toHaveLength(0);
  });

  it('skips user-canceled rows', () => {
    const csv = withdrawalsFile([
      `2024-01-20 15:39:30+00,UTC,abc,2024-01-20 16:00:00+00,2024-02-19 15:39:30+00,user-canceled,0.00233707,f,1.2.3.4`,
    ]);
    expect(parseSwanWithdrawals(csv)).toHaveLength(0);
  });

  it('uses Executed At as the date', () => {
    const csv = withdrawalsFile([
      `2022-01-16 10:23:00+00,UTC,abc,2022-01-17 20:23:46+00,,settled,0.05510246,t,1.2.3.4`,
    ]);
    const ws = parseSwanWithdrawals(csv);
    expect(ws[0].date.toISOString()).toBe('2022-01-17T20:23:46.000Z');
  });
});

// ---------------------------------------------------------------------------
// 5. buildSwanAttributions — FIFO scenarios
// ---------------------------------------------------------------------------

function makeLots(entries: [string, number, number][]): SwanLot[] {
  return entries.map(([date, sats, price]) => ({
    date: new Date(date),
    btcSats: sats,
    priceUsd: price,
    source: 'transfers' as const,
  }));
}

function makeWithdrawals(entries: [string, string, number][]): SwanWithdrawal[] {
  return entries.map(([txid, date, sats]) => ({
    txid,
    btcSats: sats,
    date: new Date(date),
  }));
}

describe('buildSwanAttributions', () => {
  // Scenario A: single lot → single withdrawal, exact match
  it('attributes a single lot to a matching withdrawal', () => {
    const lots = makeLots([['2023-01-01', 100_000_000, 30000]]);
    const ws = makeWithdrawals([['txABC', '2023-02-01', 100_000_000]]);
    const attrs = buildSwanAttributions(lots, ws);

    expect(attrs.size).toBe(1);
    const attr = attrs.get('txABC')!;
    expect(attr.withdrawalSats).toBe(100_000_000);
    expect(attr.lots).toHaveLength(1);
    expect(attr.lots[0].attributedSats).toBe(100_000_000);
    expect(attr.lots[0].basisUsd).toBeCloseTo(30000);
    expect(attr.totalBasisUsd).toBeCloseTo(30000);
  });

  // Scenario B: multi-lot FIFO
  // Lot A: 0.5 BTC @ $20 000 → $10 000
  // Lot B: 0.5 BTC @ $25 000 → $12 500
  // Withdrawal: 0.7 BTC → take all of A (0.5) + 0.2 from B
  // Basis: $10 000 + 0.2 × $25 000 = $15 000
  it('applies FIFO ordering across multiple lots', () => {
    const lots = makeLots([
      ['2023-01-01', 50_000_000, 20000],
      ['2023-01-15', 50_000_000, 25000],
    ]);
    const ws = makeWithdrawals([['txABC', '2023-02-01', 70_000_000]]);
    const attrs = buildSwanAttributions(lots, ws);

    const attr = attrs.get('txABC')!;
    expect(attr.lots).toHaveLength(2);
    expect(attr.lots[0].attributedSats).toBe(50_000_000);
    expect(attr.lots[1].attributedSats).toBe(20_000_000);
    expect(attr.totalBasisUsd).toBeCloseTo(15000);
  });

  // Scenario C: FIFO state carries across two withdrawals
  // (Lot B has 0.3 BTC residual after first withdrawal)
  // Lot C: 0.2 BTC @ $28 000
  // Withdrawal 2: 0.4 BTC → 0.3 from B residual + 0.1 from C
  // Basis: 0.3 × $25 000 + 0.1 × $28 000 = $7 500 + $2 800 = $10 300
  it('carries FIFO residuals across sequential withdrawals', () => {
    const lots = makeLots([
      ['2023-01-01', 50_000_000, 20000],
      ['2023-01-15', 50_000_000, 25000],
      ['2023-02-10', 20_000_000, 28000],
    ]);
    const ws = makeWithdrawals([
      ['txW1', '2023-02-01', 70_000_000],
      ['txW2', '2023-03-01', 40_000_000],
    ]);
    const attrs = buildSwanAttributions(lots, ws);

    const w1 = attrs.get('txW1')!;
    expect(w1.lots[0].attributedSats).toBe(50_000_000);
    expect(w1.lots[1].attributedSats).toBe(20_000_000);

    const w2 = attrs.get('txW2')!;
    expect(w2.lots).toHaveLength(2);
    expect(w2.lots[0].attributedSats).toBe(30_000_000); // B residual
    expect(w2.lots[0].priceUsd).toBe(25000);
    expect(w2.lots[1].attributedSats).toBe(10_000_000); // from C
    expect(w2.lots[1].priceUsd).toBe(28000);
    expect(w2.totalBasisUsd).toBeCloseTo(10300);
  });

  // Scenario D: keyed by Bitcoin txid for exact lookup
  it('keys the result map by Bitcoin txid', () => {
    const lots = makeLots([['2023-01-01', 50_000_000, 20000]]);
    const ws = makeWithdrawals([['5747d01131ce09ce46307110bdd0fe2be1eefbbd', '2023-02-01', 50_000_000]]);
    const attrs = buildSwanAttributions(lots, ws);
    expect(attrs.has('5747d01131ce09ce46307110bdd0fe2be1eefbbd')).toBe(true);
  });

  // Scenario E: lots sort correctly regardless of input order
  it('sorts lots and withdrawals by date before FIFO', () => {
    const lots = makeLots([
      ['2023-01-15', 50_000_000, 25000], // out of order
      ['2023-01-01', 50_000_000, 20000],
    ]);
    const ws = makeWithdrawals([['txABC', '2023-02-01', 50_000_000]]);
    const attrs = buildSwanAttributions(lots, ws);
    // FIFO should consume the Jan 1 lot first ($20 000), not Jan 15 ($25 000)
    expect(attrs.get('txABC')!.lots[0].priceUsd).toBe(20000);
  });

  // Scenario F: empty lots → empty attributions (no crash)
  it('handles empty inputs gracefully', () => {
    expect(buildSwanAttributions([], [])).toEqual(new Map());
    const lots = makeLots([['2023-01-01', 50_000_000, 20000]]);
    expect(buildSwanAttributions(lots, [])).toEqual(new Map());
  });
});
