import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyProvenance, ProvenanceTier } from './lots';

const TIERS: ProvenanceTier[] = ['trades-csv', 'mempool', 'mixed', 'override'];

// Independent restatement of the rule (not a call into the production
// code) so the exhaustive test is a real cross-check, not a tautology.
function expectedTier(tiers: ProvenanceTier[]): ProvenanceTier {
  if (tiers.includes('override')) return 'override';
  if (tiers.every((t) => t === 'trades-csv')) return 'trades-csv';
  if (tiers.every((t) => t === 'mempool')) return 'mempool';
  return 'mixed';
}

function* combinations(n: number): Generator<ProvenanceTier[]> {
  if (n === 0) {
    yield [];
    return;
  }
  for (const rest of combinations(n - 1)) {
    for (const t of TIERS) yield [t, ...rest];
  }
}

describe('classifyProvenance', () => {
  it('matches the stated rule exhaustively for all 4^n combinations, n <= 3', () => {
    for (let n = 1; n <= 3; n++) {
      for (const combo of combinations(n)) {
        expect(classifyProvenance(combo)).toBe(expectedTier(combo));
      }
    }
  });

  it('property: adding an "override" tier to any non-empty set yields "override"', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...TIERS), { minLength: 1, maxLength: 10 }), (tiers) => {
        expect(classifyProvenance([...tiers, 'override'])).toBe('override');
      })
    );
  });

  it('single-tier combinations are stable (a lone tier is its own aggregate, except mixed)', () => {
    expect(classifyProvenance(['trades-csv'])).toBe('trades-csv');
    expect(classifyProvenance(['mempool'])).toBe('mempool');
    expect(classifyProvenance(['override'])).toBe('override');
    expect(classifyProvenance(['mixed'])).toBe('mixed');
  });
});
