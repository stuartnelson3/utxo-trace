import { roundCurrency } from './core/currency';

export type DisplayCurrency = 'USD' | 'EUR';

export const APP_CONFIG = {
  CURRENCY: 'EUR' as DisplayCurrency,
};

// Single source of truth for the tip address — every surface (README, app
// footer) renders from this constant so a typo can only ever happen once,
// and it's drift-guarded by config.test.ts against the README copy.
export const DONATION_BTC_ADDRESS = 'bc1quuszc94zvdlu628ev3hemymtk2nkwkv0xq6vuc';

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

const dateTimeFormatters: Record<DisplayCurrency, Intl.DateTimeFormat> = {
  USD: new Intl.DateTimeFormat(LOCALE_BY_CURRENCY.USD, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
  EUR: new Intl.DateTimeFormat(LOCALE_BY_CURRENCY.EUR, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
};

// Explicit-locale date+time formatting — like formatDate, but with a time
// component, for timestamps (override/prune assertions, report generation
// stamp) that need more than a bare day. Never falls back to the system's
// default locale (a bare toLocaleString()/toLocaleDateString() call): a
// report shown in EUR mode must render de-DE-formatted timestamps
// regardless of what locale the browser or CI runner happens to have.
export const formatDateTime = (
  date: Date | string | number,
  currency: DisplayCurrency = APP_CONFIG.CURRENCY
) => {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dateTimeFormatters[currency].format(d);
};
