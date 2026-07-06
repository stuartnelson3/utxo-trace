import React from 'react';

// Extracted (mirrors TipFooter) so the replace-vs-append hint is testable
// as an actual rendered attribute, not just "the string exists somewhere
// in App.tsx's source" — a review caught that the grep-based test that
// preceded this component would still pass even if the hint drifted off
// the button entirely.
const REPLACE_HINT =
  'uploading again replaces previously loaded kraken/swan files — select all files together to combine accounts';

const CsvUploadButton: React.FC<{
  loading: boolean;
  hasAnyAttribution: boolean;
  onClick: () => void;
}> = ({ loading, hasAnyAttribution, onClick }) => (
  <button
    onClick={onClick}
    disabled={loading}
    title={REPLACE_HINT}
    style={{
      font: '14px/1.7 monospace',
      border: '1px solid var(--border)',
      padding: '0 8px',
      cursor: 'pointer',
      background: hasAnyAttribution ? 'var(--fg)' : 'var(--bg)',
      color: hasAnyAttribution ? 'var(--bg)' : 'var(--fg)',
    }}
  >
    {loading ? 'loading...' : hasAnyAttribution ? '[csv ✓]' : '[load exchange csv]'}
  </button>
);

export default CsvUploadButton;
