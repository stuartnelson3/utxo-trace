import React from 'react';
import { DONATION_BTC_ADDRESS } from '../config';

// Extracted as its own component (mirrors Legend) so it can be rendered and
// asserted on in isolation: the address must appear in the live app footer,
// and must NOT appear in the printed report (BasisReport is a separate
// component tree — a donation address on an audit document would undercut
// the register).
const TipFooter: React.FC<{ copied: boolean; onCopy: () => void }> = ({ copied, onCopy }) => (
  <div style={{ marginTop: 4, fontSize: 10 }}>
    tips:{' '}
    <button
      onClick={onCopy}
      title="copy address"
      style={{
        font: 'inherit',
        color: 'inherit',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      {DONATION_BTC_ADDRESS}
    </button>
    {copied && <span style={{ marginLeft: 6, color: 'var(--exempt)' }}>copied</span>}
  </div>
);

export default TipFooter;
