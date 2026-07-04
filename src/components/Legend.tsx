import React from 'react';

// Shared between the live tree view and the printed report, so the same
// symbols mean the same thing on both surfaces. `dark` selects the CSS
// custom properties used by the app UI; the report renders on a plain
// white background and passes dark={false} to use fixed hex colors.
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
    </div>
  );
};

export default Legend;
