import { roundCurrency } from './core/currency';

export type DisplayCurrency = 'USD' | 'EUR';

export const APP_CONFIG = {
  CURRENCY: 'EUR' as DisplayCurrency,
};

// Locale travels with currency, never set independently — a USD report
// with German-formatted dates (or vice versa) would be a real inconsistency,
// not a style choice.
const LOCALE_BY_CURRENCY: Record<DisplayCurrency, string> = {
  USD: 'en-US',
  EUR: 'de-DE',
};

const formatters: Record<DisplayCurrency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat(LOCALE_BY_CURRENCY.USD, { style: 'currency', currency: 'USD' }),
  EUR: new Intl.NumberFormat(LOCALE_BY_CURRENCY.EUR, { style: 'currency', currency: 'EUR' }),
};

// Rounded once, explicitly, before formatting — see core/currency.ts for why.
export const formatCurrency = (value: number, currency: DisplayCurrency = APP_CONFIG.CURRENCY) =>
  formatters[currency].format(roundCurrency(value));

const dateFormatters: Record<DisplayCurrency, Intl.DateTimeFormat> = {
  USD: new Intl.DateTimeFormat(LOCALE_BY_CURRENCY.USD, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }),
  EUR: new Intl.DateTimeFormat(LOCALE_BY_CURRENCY.EUR, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }),
};

export const formatDate = (
  date: Date | string | number,
  currency: DisplayCurrency = APP_CONFIG.CURRENCY
) => {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dateFormatters[currency].format(d);
};
