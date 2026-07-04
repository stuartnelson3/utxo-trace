import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildAttributions, LedgerEntry, TradeEntry } from './kraken';

// Generates a time-ordered ledger of BTC/EUR trade buys followed by
// withdrawals bounded by the running balance, so every withdrawal fully
// clears. Over-withdrawal / dust edge cases are covered by the scenario
// tests in kraken.test.ts; this generator is for the FIFO invariants.
const arbLedgerAndTrades = fc
  .array(
    fc.record({
      isWithdrawal: fc.boolean(),
      sats: fc.integer({ min: 1000, max: 500_000_000 }),
      price: fc.integer({ min: 100, max: 100_000 }),
    }),
    { minLength: 1, maxLength: 12 }
  )
  .map((ops) => {
    let balance = 0;
    let t = Date.UTC(2023, 0, 1);
    const ledger: LedgerEntry[] = [];
    const trades = new Map<string, TradeEntry>();
    let n = 0;
    for (const op of ops) {
      n += 1;
      t += 86_400_000; // strictly increasing, one day apart
      const id = `E${n}`;
      if (op.isWithdrawal && balance > 0) {
        const withdrawSats = Math.min(op.sats, balance);
        balance -= withdrawSats;
        ledger.push({
          txid: id,
          refid: id,
          time: new Date(t),
          type: 'withdrawal',
          amountSats: -withdrawSats,
          feeSats: 0,
        });
      } else {
        balance += op.sats;
        ledger.push({
          txid: id,
          refid: id,
          time: new Date(t),
          type: 'trade',
          amountSats: op.sats,
          feeSats: 0,
        });
        trades.set(id, { txid: id, pair: 'BTC/EUR', price: op.price });
      }
    }
    return { ledger, trades };
  });

describe('buildAttributions properties', () => {
  it('attributes exactly the withdrawal amount when balance suffices, never more', () => {
    fc.assert(
      fc.property(arbLedgerAndTrades, ({ ledger, trades }) => {
        const attrs = buildAttributions(ledger, trades);
        for (const attr of attrs.values()) {
          const attributed = attr.lots.reduce((s, l) => s + l.attributedSats, 0);
          expect(attributed).toBeLessThanOrEqual(attr.withdrawalAmountSats);
          expect(attributed).toBe(attr.withdrawalAmountSats);
        }
      })
    );
  });

  it('consumes lots in non-decreasing time order within a withdrawal (FIFO)', () => {
    fc.assert(
      fc.property(arbLedgerAndTrades, ({ ledger, trades }) => {
        const attrs = buildAttributions(ledger, trades);
        for (const attr of attrs.values()) {
          const times = attr.lots.map((l) => l.lot.time.getTime());
          expect(times).toEqual([...times].sort((a, b) => a - b));
        }
      })
    );
  });

  it('basis equals attributed BTC times the lot price', () => {
    fc.assert(
      fc.property(arbLedgerAndTrades, ({ ledger, trades }) => {
        const attrs = buildAttributions(ledger, trades);
        for (const attr of attrs.values()) {
          for (const l of attr.lots) {
            expect(l.basisEur).toBeCloseTo((l.attributedSats / 1e8) * l.lot.pricePer!, 6);
          }
        }
      })
    );
  });

  it('is deterministic and does not mutate its inputs', () => {
    fc.assert(
      fc.property(arbLedgerAndTrades, ({ ledger, trades }) => {
        const ledgerCopy = ledger.map((e) => ({ ...e }));
        const first = buildAttributions(ledger, trades);
        const second = buildAttributions(ledger, trades);
        expect(ledger).toEqual(ledgerCopy);
        expect([...first.entries()]).toEqual([...second.entries()]);
      })
    );
  });
});
