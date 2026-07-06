import { describe, it, expect } from 'vitest';
import { APP_CONFIG, formatCurrency, formatDate, DONATION_BTC_ADDRESS } from './config';
import { METHODOLOGY } from './core/methodology';

const readmeModules = import.meta.glob('../README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const readmeText = Object.values(readmeModules)[0];

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

  it('holding-period summary-row vocabulary resolves to the EUR set by default', () => {
    const labels = METHODOLOGY.holdingPeriodLabels[APP_CONFIG.CURRENCY];
    expect(labels).toBe(METHODOLOGY.holdingPeriodLabels.EUR);
    expect(labels.rowExempt).toBe('exempt basis (>1yr, see appendix)');
  });

  it('holding-period badge is a single pair, independent of display currency', () => {
    expect(METHODOLOGY.holdingPeriodBadge.over).toBe('[>1y ✓]');
    expect(METHODOLOGY.holdingPeriodBadge.under).toBe('[<1y]');
  });
});

// --- BIP-173 bech32 checksum (implemented here, not in shipped code — this
// is a one-time verification of a hardcoded constant, not a runtime need) ---
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function bech32VerifyChecksum(hrp: string, data: number[]): boolean {
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === 1;
}

function decodeBech32(address: string): { hrp: string; data: number[] } {
  const pos = address.lastIndexOf('1');
  if (pos < 1 || pos + 7 > address.length) throw new Error('malformed bech32 string');
  const hrp = address.slice(0, pos);
  const dataPart = address.slice(pos + 1);
  const data = [...dataPart].map((c) => {
    const v = CHARSET.indexOf(c);
    if (v === -1) throw new Error(`invalid bech32 character: ${c}`);
    return v;
  });
  return { hrp, data };
}

describe('DONATION_BTC_ADDRESS', () => {
  it('matches the address published in the README (drift guard)', () => {
    const match = readmeText.match(/\bbc1[a-z0-9]{20,}\b/);
    expect(match).not.toBeNull();
    expect(match![0]).toBe(DONATION_BTC_ADDRESS);
  });

  it('has a valid BIP-173 bech32 checksum', () => {
    const lower = DONATION_BTC_ADDRESS.toLowerCase();
    expect(lower).toBe(DONATION_BTC_ADDRESS); // must already be all-lowercase
    const { hrp, data } = decodeBech32(lower);
    expect(hrp).toBe('bc');
    expect(bech32VerifyChecksum(hrp, data)).toBe(true);
  });

  it('a single corrupted character breaks the checksum', () => {
    const lower = DONATION_BTC_ADDRESS.toLowerCase();
    const corrupted = lower.slice(0, -1) + (lower.at(-1) === CHARSET[0] ? CHARSET[1] : CHARSET[0]);
    const { hrp, data } = decodeBech32(corrupted);
    expect(bech32VerifyChecksum(hrp, data)).toBe(false);
  });
});
