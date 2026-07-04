import { roundCurrency } from './core/currency';

export type DisplayCurrency = 'USD' | 'EUR';

export const APP_CONFIG = {
  CURRENCY: 'EUR' as DisplayCurrency,
  DATE_LOCALE: 'de-DE',
};

const formatters: Record<DisplayCurrency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
};

// Rounded once, explicitly, before formatting — see core/currency.ts for why.
export const formatCurrency = (value: number, currency: DisplayCurrency = APP_CONFIG.CURRENCY) =>
  formatters[currency].format(roundCurrency(value));

export const dateFormatter = new Intl.DateTimeFormat(APP_CONFIG.DATE_LOCALE, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const formatDate = (date: Date | string | number) => {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dateFormatter.format(d);
};
