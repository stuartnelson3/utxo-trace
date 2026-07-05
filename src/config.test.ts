import { describe, it, expect } from 'vitest';
import { APP_CONFIG, formatCurrency, formatDate } from './config';
import { METHODOLOGY } from './core/methodology';

// Pin the default explicitly, so any future change to it is a reviewed diff
// rather than a silent config edit — the app owner's standing decision.
describe('APP_CONFIG default', () => {
  it('CURRENCY defaults to EUR', () => {
    expect(APP_CONFIG.CURRENCY).toBe('EUR');
  });
});

describe('formatDate follows the currency argument, not a fixed locale', () => {
  const d = new Date('2024-03-05T00:00:00Z');

  it('formats EUR as de-DE (DD.MM.YYYY)', () => {
    expect(formatDate(d, 'EUR')).toBe('05.03.2024');
  });

  it('formats USD as en-US (MM/DD/YYYY)', () => {
    expect(formatDate(d, 'USD')).toBe('03/05/2024');
  });

  it('defaults to APP_CONFIG.CURRENCY when no currency is passed', () => {
    expect(formatDate(d)).toBe(formatDate(d, APP_CONFIG.CURRENCY));
  });
});

describe('formatCurrency defaults to APP_CONFIG.CURRENCY when no currency is passed', () => {
  it('matches the explicit-currency call for the default currency', () => {
    expect(formatCurrency(1234.5)).toBe(formatCurrency(1234.5, APP_CONFIG.CURRENCY));
  });
});

// With no user interaction (no currency toggle click), the report must show
// the label/vocabulary set matching APP_CONFIG.CURRENCY, not a stale literal.
describe('default report vocabulary resolves from APP_CONFIG.CURRENCY', () => {
  it('subtitle label resolves to METHODOLOGY.labels.en_eur by default', () => {
    const subtitle =
      APP_CONFIG.CURRENCY === 'EUR' ? METHODOLOGY.labels.en_eur : METHODOLOGY.labels.en_usd;
    expect(subtitle).toBe(METHODOLOGY.labels.en_eur);
  });

  it('holding-period vocabulary resolves to the §23 set by default', () => {
    const labels = METHODOLOGY.holdingPeriodLabels[APP_CONFIG.CURRENCY];
    expect(labels).toBe(METHODOLOGY.holdingPeriodLabels.EUR);
    expect(labels.badgeExempt).toBe('[§23 ✓]');
  });
});
