import { describe, it, expect } from 'vitest';
import { METHODOLOGY } from './methodology';
import { SNAP_ANCHOR_UTC_HOUR } from './price';
import { DEFAULT_AMOUNT_TOLERANCE_SATS, DEFAULT_TIME_WINDOW } from './match';

// "No drift" test: if a future change hardcodes a new literal instead of
// importing from METHODOLOGY, this fails — the whole point of the task.
describe('METHODOLOGY drift', () => {
  it('price.ts snap anchor is reference-equal to METHODOLOGY', () => {
    expect(SNAP_ANCHOR_UTC_HOUR).toBe(METHODOLOGY.priceOracle.snapAnchorUtcHour);
  });

  it('match.ts tolerance and time window are reference-equal to METHODOLOGY', () => {
    expect(DEFAULT_AMOUNT_TOLERANCE_SATS).toBe(METHODOLOGY.matching.amountToleranceSats);
    expect(DEFAULT_TIME_WINDOW.beforeMs).toBe(METHODOLOGY.matching.timeWindowBeforeMs);
    expect(DEFAULT_TIME_WINDOW.afterMs).toBe(METHODOLOGY.matching.timeWindowAfterMs);
  });
});

// Grep-based enforcement, mirroring the task's acceptance criterion: zero
// magic numbers for snap hour, tolerance, and time window outside this file.
describe('no magic numbers outside methodology.ts', () => {
  const modules = import.meta.glob('./*.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  it('no other core module hardcodes the snap hour, tolerance, or time window literals', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(modules)) {
      if (file.endsWith('.test.ts') || file.includes('methodology.ts')) continue;
      if (/16\s*\*\s*3600/.test(text)) offenders.push(`${file}: hardcoded 16*3600 (snap anchor)`);
      if (/72\s*\*\s*3600\s*\*\s*1000/.test(text)) {
        offenders.push(`${file}: hardcoded 72*3600*1000 (time window)`);
      }
      if (/<=\s*2\b/.test(text) && /amountDeltaSats|toleranceSats/.test(text)) {
        offenders.push(`${file}: hardcoded amount tolerance literal`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// Task 8: the report/footer used to call the output a "specific
// identification ledger" while the exchange-side attribution is FIFO.
describe('honest labeling', () => {
  const allSrc = import.meta.glob('../**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  it('"specific identification ledger" appears nowhere in src/', () => {
    const offenders = Object.entries(allSrc)
      .filter(([file]) => !file.includes('methodology.ts'))
      .filter(([, text]) => /specific identification ledger/i.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('labels encode the FIFO/specific-evidence split honestly, per jurisdiction', () => {
    // Exchange side is FIFO in both jurisdictions...
    expect(METHODOLOGY.labels.en_usd).toMatch(/FIFO/);
    expect(METHODOLOGY.labels.en_eur).toMatch(/FIFO/);
    expect(METHODOLOGY.labels.de).toMatch(/FIFO/);
    // ...on-chain side is specific-evidence attribution in both...
    expect(METHODOLOGY.labels.en_usd).toMatch(/specific evidence/);
    expect(METHODOLOGY.labels.en_eur).toMatch(/specific evidence/);
    // ...and the US label explicitly disclaims being a spec-ID election.
    expect(METHODOLOGY.labels.en_usd).toMatch(/not itself a specific-ID election/);
  });
});
