import React, { useState } from 'react';
import { LotRow } from '../kraken';
import { formatCurrency, formatDate, DisplayCurrency } from '../config';

interface Props {
  label: string; // e.g. "kraken / fifo" or "swan / fifo"
  rows: LotRow[];
  totalDisplay: number;
  currency: DisplayCurrency;
  forceExpand?: boolean;
}

const COLLAPSE_AT = 5;

const LotTable: React.FC<Props> = ({ label, rows, totalDisplay, currency, forceExpand }) => {
  const [showAll, setShowAll] = useState(false);

  const expanded = forceExpand || showAll;
  const visible = rows.length > COLLAPSE_AT && !expanded ? rows.slice(0, COLLAPSE_AT) : rows;
  const hiddenCount = rows.length - COLLAPSE_AT;

  const allFromCsv = rows.every((r) => r.fromCsv);
  const noneFromCsv = rows.every((r) => !r.fromCsv);
  const sourceLabel = allFromCsv ? '[csv ✓]' : noneFromCsv ? '[mempool ~]' : '[mixed ~]';
  const sourceColor = allFromCsv ? 'var(--exempt)' : 'var(--taxable)';

  const th: React.CSSProperties = {
    textAlign: 'left',
    fontWeight: 'normal',
    color: 'var(--muted)',
    paddingBottom: 2,
    paddingRight: 12,
  };
  const tdR: React.CSSProperties = { textAlign: 'right', paddingRight: 12 };

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          {label}
          {'  '}
          <span style={{ color: sourceColor }}>{sourceLabel}</span>
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>acquired</th>
            <th style={{ ...th, textAlign: 'right' }}>btc</th>
            <th style={{ ...th, textAlign: 'right' }}>{currency === 'EUR' ? '€' : '$'}/btc</th>
            <th style={{ ...th, textAlign: 'right' }}>basis</th>
            <th style={{ ...th, textAlign: 'right', paddingRight: 0 }}>src</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr key={i}>
              <td style={{ paddingRight: 12 }}>{formatDate(row.date)}</td>
              <td style={tdR}>{(row.btcSats / 1e8).toFixed(8)}</td>
              <td style={{ ...tdR, color: 'var(--muted)' }}>
                {formatCurrency(row.priceDisplay, currency)}
              </td>
              <td style={tdR}>{formatCurrency(row.basisDisplay, currency)}</td>
              <td
                style={{
                  textAlign: 'right',
                  color: row.fromCsv ? 'var(--exempt)' : 'var(--taxable)',
                }}
              >
                {row.fromCsv ? '✓' : '~'}
              </td>
            </tr>
          ))}

          {rows.length > COLLAPSE_AT && !expanded && (
            <tr>
              <td colSpan={5} style={{ paddingTop: 2 }}>
                <button
                  onClick={() => setShowAll(true)}
                  style={{
                    font: '12px/1.5 monospace',
                    border: 'none',
                    background: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ··· {hiddenCount} more
                </button>
              </td>
            </tr>
          )}

          {rows.length > COLLAPSE_AT && expanded && !forceExpand && (
            <tr>
              <td colSpan={5} style={{ paddingTop: 2 }}>
                <button
                  onClick={() => setShowAll(false)}
                  style={{
                    font: '12px/1.5 monospace',
                    border: 'none',
                    background: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  [show less]
                </button>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={3}
              style={{ borderTop: '1px solid var(--border)', paddingTop: 4, color: 'var(--muted)' }}
            >
              {label} basis
            </td>
            <td
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 4,
                textAlign: 'right',
                paddingRight: 12,
              }}
            >
              <strong>{formatCurrency(totalDisplay, currency)}</strong>
            </td>
            <td style={{ borderTop: '1px solid var(--border)' }} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default LotTable;
