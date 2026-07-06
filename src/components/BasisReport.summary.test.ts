import { describe, it, expect } from 'vitest';
import { buildSummarySentence } from './BasisReport';
import { formatCurrency } from '../config';

// Regression coverage for the two failure modes already caught once each in
// review: asserting a tax conclusion the app can't know (jurisdiction/
// residency-dependent), and asserting a completed sale when no disposal
// date is set (the number is a mark-to-market hypothetical, not a sale).
describe('buildSummarySentence', () => {
  const base = { btcAmount: '1.00000000', proceeds: 100, totalBasis: 60, gainLoss: 40 };

  it('does not assert a completed sale when no disposal date is set, in either currency', () => {
    for (const displayCurrency of ['EUR', 'USD'] as const) {
      const s = buildSummarySentence({ ...base, disposalDate: null, displayCurrency });
      expect(s).not.toMatch(/was sold/);
      expect(s).toContain('would be worth');
      expect(s).toContain('no disposal date recorded yet');
    }
  });

  it('asserts a completed sale only once a disposal date is actually set', () => {
    const s = buildSummarySentence({
      ...base,
      disposalDate: '2024-06-01',
      displayCurrency: 'EUR',
    });
    expect(s).toMatch(/was sold on/);
    expect(s).not.toContain('would be worth');
  });

  it('never states a tax conclusion (exempt/taxable), regardless of currency or disposal state', () => {
    for (const displayCurrency of ['EUR', 'USD'] as const) {
      for (const disposalDate of [null, '2024-06-01']) {
        const s = buildSummarySentence({ ...base, disposalDate, displayCurrency });
        expect(s).not.toContain('tax-exempt');
        expect(s).not.toMatch(/\btaxable\b/);
      }
    }
  });

  it('formats amounts per the given currency', () => {
    const eur = buildSummarySentence({ ...base, disposalDate: null, displayCurrency: 'EUR' });
    const usd = buildSummarySentence({ ...base, disposalDate: null, displayCurrency: 'USD' });
    expect(eur).toContain(formatCurrency(100, 'EUR'));
    expect(usd).toContain(formatCurrency(100, 'USD'));
  });
});
