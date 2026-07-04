import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildSwanAttributions, SwanLot, SwanWithdrawal } from './swan';

// Time-ordered lots followed by withdrawals bounded by running balance.
const arbLotsAndWithdrawals = fc
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
    const lots: SwanLot[] = [];
    const withdrawals: SwanWithdrawal[] = [];
    let n = 0;
    for (const op of ops) {
      n += 1;
      t += 86_400_000;
      if (op.isWithdrawal && balance > 0) {
        const withdrawSats = Math.min(op.sats, balance);
        balance -= withdrawSats;
        withdrawals.push({ txid: `W${n}`, btcSats: withdrawSats, date: new Date(t) });
      } else {
        balance += op.sats;
        lots.push({ date: new Date(t), btcSats: op.sats, priceUsd: op.price, source: 'transfers' });
      }
    }
    return { lots, withdrawals };
  });

describe('buildSwanAttributions properties', () => {
  it('attributes exactly the withdrawal amount when balance suffices, never more', () => {
    fc.assert(
      fc.property(arbLotsAndWithdrawals, ({ lots, withdrawals }) => {
        const attrs = buildSwanAttributions(lots, withdrawals);
        for (const attr of attrs.values()) {
          const attributed = attr.lots.reduce((s, l) => s + l.attributedSats, 0);
          expect(attributed).toBeLessThanOrEqual(attr.withdrawalSats);
          expect(attributed).toBe(attr.withdrawalSats);
        }
      })
    );
  });

  it('consumes lots in non-decreasing time order (FIFO)', () => {
    fc.assert(
      fc.property(arbLotsAndWithdrawals, ({ lots, withdrawals }) => {
        const attrs = buildSwanAttributions(lots, withdrawals);
        for (const attr of attrs.values()) {
          const times = attr.lots.map((l) => l.date.getTime());
          expect(times).toEqual([...times].sort((a, b) => a - b));
        }
      })
    );
  });

  it('totalBasisUsd equals the sum of per-lot basis', () => {
    fc.assert(
      fc.property(arbLotsAndWithdrawals, ({ lots, withdrawals }) => {
        const attrs = buildSwanAttributions(lots, withdrawals);
        for (const attr of attrs.values()) {
          const manual = attr.lots.reduce((s, l) => s + l.basisUsd, 0);
          expect(attr.totalBasisUsd).toBeCloseTo(manual, 6);
        }
      })
    );
  });

  it('is deterministic and does not mutate its inputs', () => {
    fc.assert(
      fc.property(arbLotsAndWithdrawals, ({ lots, withdrawals }) => {
        const lotsCopy = lots.map((l) => ({ ...l }));
        const first = buildSwanAttributions(lots, withdrawals);
        const second = buildSwanAttributions(lots, withdrawals);
        expect(lots).toEqual(lotsCopy);
        expect([...first.entries()]).toEqual([...second.entries()]);
      })
    );
  });
});
