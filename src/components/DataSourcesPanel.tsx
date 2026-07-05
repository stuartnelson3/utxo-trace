import React, { useState } from 'react';

export interface DataSourcesPanelProps {
  txSourceMode: 'mempool' | 'custom';
  customEsploraUrl: string;
  priceCrossCheck: boolean;
  onSelectMempool: () => void;
  onProbeAndSelectCustom: (baseUrl: string) => Promise<boolean>;
  onTogglePriceCrossCheck: (enabled: boolean) => void;
}

const DataSourcesPanel: React.FC<DataSourcesPanelProps> = ({
  txSourceMode,
  customEsploraUrl,
  priceCrossCheck,
  onSelectMempool,
  onProbeAndSelectCustom,
  onTogglePriceCrossCheck,
}) => {
  const [urlDraft, setUrlDraft] = useState(customEsploraUrl);
  const [probeStatus, setProbeStatus] = useState<'idle' | 'probing' | 'ok' | 'fail'>('idle');

  return (
    <div
      style={{
        marginTop: 8,
        borderTop: '1px solid var(--border)',
        paddingTop: 8,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ color: 'var(--muted)' }}>tx source:</div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={txSourceMode === 'mempool'} onChange={onSelectMempool} />
        mempool.space
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="radio" checked={txSourceMode === 'custom'} readOnly />
        custom Esplora base URL
        <input
          type="text"
          placeholder="http://localhost:3000/api"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          style={{
            font: '12px/1.5 monospace',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--fg)',
            padding: '2px 6px',
            width: 220,
          }}
        />
        <button
          disabled={!urlDraft.trim() || probeStatus === 'probing'}
          onClick={async () => {
            setProbeStatus('probing');
            const ok = await onProbeAndSelectCustom(urlDraft.trim());
            setProbeStatus(ok ? 'ok' : 'fail');
          }}
          style={{
            font: '12px/1.5 monospace',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--fg)',
            cursor: 'pointer',
          }}
        >
          [test & use]
        </button>
        {probeStatus === 'probing' && <span style={{ color: 'var(--muted)' }}>probing...</span>}
        {probeStatus === 'ok' && <span style={{ color: 'var(--exempt)' }}>ok ✓</span>}
        {probeStatus === 'fail' && (
          <span style={{ color: 'var(--taxable)' }}>failed — check the URL and try again</span>
        )}
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={priceCrossCheck}
          onChange={(e) => onTogglePriceCrossCheck(e.target.checked)}
        />
        verify prices against Kraken OHLC
      </label>
    </div>
  );
};

export default DataSourcesPanel;
