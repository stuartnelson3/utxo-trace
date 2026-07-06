import React from 'react';
import { METHODOLOGY } from '../core/methodology';

// Shared between the live tree view and the printed report, so the same
// symbols mean the same thing on both surfaces. `dark` selects the CSS
// custom properties used by the app UI; the report renders on a plain
// white background and passes dark={false} to use fixed hex colors.
//
// Includes the holding-period badges (sourced from METHODOLOGY, not
// hardcoded, so they can't drift from what UTXONode/BasisReport actually
// render) alongside the provenance symbols — both appear on every node
// card, and a reader shouldn't have to reach the appendix to decode either
// one. Note the badges are multi-character strings ("[>1y ✓]"/"[<1y]"),
// not a bare reuse of the ✓ symbol above, even though >1y's badge also
// contains a ✓ — the bracket form is what to look for on the card.
const Legend: React.FC<{ dark?: boolean }> = ({ dark = true }) => {
  const exempt = dark ? 'var(--exempt)' : '#060';
  const taxable = dark ? 'var(--taxable)' : '#b60';
  const muted = dark ? 'var(--muted)' : '#888';

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: muted }}>
      <span>
        <span style={{ color: exempt }}>✓</span> csv-verified
      </span>
      <span>
        <span style={{ color: taxable }}>~</span> price-history estimate
      </span>
      <span>mixed</span>
      <span>
        <span style={{ color: taxable }}>!</span> asserted
      </span>
      <span>⊘ excluded branch</span>
      <span>
        <span style={{ color: exempt }}>{METHODOLOGY.holdingPeriodBadge.over}</span> held over one
        year (see appendix)
      </span>
      <span>
        <span style={{ color: taxable }}>{METHODOLOGY.holdingPeriodBadge.under}</span> held one year
        or less (see appendix)
      </span>
    </div>
  );
};

export default Legend;
