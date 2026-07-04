import React, { useState, useMemo } from 'react';
import { UTXONode as UTXONodeType } from '../core/types';
import { formatCurrency, formatDate } from '../config';
import { nodePrice } from '../core/tree';
import { isPara23Exempt } from '../core/holding';
import { useTraceContext } from '../TraceContext';
import { krakenToLotRows } from '../core/kraken';
import { swanToLotRows } from '../core/swan';
import LotTable from './LotTable';

interface Props {
  node: UTXONodeType;
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onRemoveBranch: (id: string) => void;
  onNodeUpdate: (id: string, patch: Partial<UTXONodeType>) => void;
  onMatchKraken?: (nodeId: string, amountSats: number) => boolean;
  onRemoveKraken?: (nodeId: string) => void;
  isLastSibling?: boolean;
}

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children,
  style,
  ...props
}) => (
  <button
    {...props}
    style={{
      font: '14px/1.7 monospace',
      border: 'none',
      background: 'none',
      padding: 0,
      cursor: 'pointer',
      color: 'var(--link)',
      ...style,
    }}
  >
    {children}
  </button>
);

const UTXONode: React.FC<Props> = ({
  node,
  expandedIds,
  onExpand,
  onCollapse,
  onRemoveBranch,
  onNodeUpdate,
  onMatchKraken,
  onRemoveKraken,
  isLastSibling,
}) => {
  const {
    displayCurrency,
    disposalTimestamp,
    krakenAttributions,
    krakenMatches,
    swanAttributions,
  } = useTraceContext();
  // Look up this node's explicit Kraken match from the shared context map.
  const matchedKrakenTxid = krakenMatches.get(node.id);
  const [isEditing, setIsEditing] = useState(false);
  const [krakenNoMatch, setKrakenNoMatch] = useState(false);

  const isExpanded = expandedIds.has(node.id);
  const price = nodePrice(node, displayCurrency);
  const nodeBasis = ((node.amountSats || 0) / 1e8) * price;
  const exempt = isPara23Exempt(node.timestamp, disposalTimestamp);

  // Swan: exact txid match (always automatic — txid is unambiguous).
  const swanAttr = swanAttributions.get(node.txid) ?? null;

  // Kraken: explicit user match (amount-based matching is ambiguous;
  // user clicks [match kraken] to assign this node to a withdrawal).
  const krakenAttr = useMemo(
    () => (matchedKrakenTxid ? (krakenAttributions.get(matchedKrakenTxid) ?? null) : null),
    [matchedKrakenTxid, krakenAttributions]
  );

  // Show [match kraken] button when Kraken CSV is loaded, this node has no match yet,
  // and the node is not expanded (expanded nodes are intermediate, not leaves).
  const showMatchBtn =
    krakenAttributions.size > 0 && !krakenAttr && !swanAttr && !isExpanded && !!onMatchKraken;

  const lotRows = useMemo(() => {
    if (krakenAttr) return krakenToLotRows(krakenAttr, displayCurrency, node.usdToEur);
    if (swanAttr) return swanToLotRows(swanAttr, displayCurrency, node.usdToEur);
    return null;
  }, [krakenAttr, swanAttr, displayCurrency, node.usdToEur]);

  const lotTotal = useMemo(() => {
    if (!lotRows) return 0;
    return lotRows.reduce((s, r) => s + r.basisDisplay, 0);
  }, [lotRows]);

  const displayedOverride =
    node.isOverride && node.manualPriceUsd !== undefined
      ? displayCurrency === 'EUR'
        ? (node.manualPriceUsd * node.usdToEur).toFixed(2)
        : node.manualPriceUsd.toFixed(2)
      : '';

  const hasConnector = isLastSibling !== undefined;

  return (
    <div style={{ marginTop: hasConnector ? 8 : 0 }}>
      {/* connector: CSS-border horizontal dash, flush against parent's borderLeft */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {hasConnector && (
          <div
            style={{
              width: '2ch',
              flexShrink: 0,
              borderBottom: '1px solid var(--border)',
            }}
          />
        )}

        <div style={{ flex: 1, border: '1px solid var(--border)', padding: '8px 12px' }}>
          {/* row 1: txid + date + badge */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0 16px',
              alignItems: 'baseline',
              marginBottom: 2,
            }}
          >
            <code style={{ fontSize: 12 }}>{node.txid.substring(0, 20)}…</code>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>#{node.vout}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {formatDate(new Date(node.timestamp * 1000))}
            </span>
            {disposalTimestamp > 0 && (
              <span style={{ color: exempt ? 'var(--exempt)' : 'var(--taxable)', fontSize: 12 }}>
                {displayCurrency === 'EUR'
                  ? exempt
                    ? '[§23 ✓]'
                    : '[<1yr]'
                  : exempt
                    ? '[long-term]'
                    : '[short-term]'}
              </span>
            )}
            {node.isOverride && (
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>[override]</span>
            )}
          </div>

          {/* row 2: amount · price · basis */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 16px', alignItems: 'baseline' }}>
            <span>{(node.amountSats / 1e8).toFixed(8)} BTC</span>
            <span style={{ color: 'var(--muted)' }}>
              @ {formatCurrency(price, displayCurrency)}/BTC
            </span>
            <span>
              basis: <strong>{formatCurrency(nodeBasis, displayCurrency)}</strong>
            </span>
            {krakenAttr && (
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>(overridden by kraken)</span>
            )}
          </div>

          {/* row 3: actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {swanAttr || krakenAttr ? (
              isExpanded && <Btn onClick={() => onCollapse(node.id)}>[collapse]</Btn>
            ) : (
              <Btn onClick={() => (isExpanded ? onCollapse(node.id) : onExpand(node.id))}>
                {isExpanded ? '[collapse]' : '[expand]'}
              </Btn>
            )}
            {isExpanded && !(swanAttr || krakenAttr) && (
              <Btn
                style={{ color: 'var(--taxable)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBranch(node.id);
                }}
              >
                [remove branch]
              </Btn>
            )}
            <Btn onClick={() => setIsEditing(!isEditing)}>
              {node.isOverride ? '[edit override]' : '[override price]'}
            </Btn>
            <a
              href={`https://blockstream.info/tx/${node.txid}#vout=${node.vout}`}
              target="_blank"
              style={{ fontSize: 14, fontFamily: 'monospace' }}
            >
              [explorer ↗]
            </a>
            {showMatchBtn && (
              <Btn
                onClick={() => {
                  const found = onMatchKraken!(node.id, node.amountSats);
                  setKrakenNoMatch(!found);
                }}
              >
                [match kraken]
              </Btn>
            )}
            {krakenNoMatch && !krakenAttr && !swanAttr && (
              <span style={{ color: 'var(--taxable)', fontSize: 12 }}>
                no match for {(node.amountSats / 1e8).toFixed(8)} BTC
              </span>
            )}
            {krakenAttr && onRemoveKraken && (
              <Btn style={{ color: 'var(--taxable)' }} onClick={() => onRemoveKraken(node.id)}>
                [remove]
              </Btn>
            )}
            {node.memo && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{node.memo}</span>}
          </div>

          {/* lot table — shown when attribution is set (Swan automatic, Kraken explicit) */}
          {lotRows && (
            <LotTable
              label={krakenAttr ? 'kraken / fifo' : 'swan / fifo'}
              rows={lotRows}
              totalDisplay={lotTotal}
              currency={displayCurrency}
            />
          )}

          {/* override / memo form */}
          {isEditing && (
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <label
                style={{ display: 'block', color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}
              >
                price override ({displayCurrency}):
              </label>
              <input
                type="number"
                placeholder={`price in ${displayCurrency}`}
                defaultValue={displayedOverride}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    onNodeUpdate(node.id, { isOverride: false, manualPriceUsd: undefined });
                  } else {
                    const entered = parseFloat(val);
                    const usdValue =
                      displayCurrency === 'EUR' && node.usdToEur > 0
                        ? entered / node.usdToEur
                        : entered;
                    onNodeUpdate(node.id, { isOverride: true, manualPriceUsd: usdValue });
                  }
                }}
                style={{
                  font: '14px/1.7 monospace',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--fg)',
                  padding: '2px 6px',
                  width: 180,
                }}
              />
              <label
                style={{
                  display: 'block',
                  color: 'var(--muted)',
                  fontSize: 12,
                  marginBottom: 4,
                  marginTop: 8,
                }}
              >
                memo:
              </label>
              <input
                type="text"
                placeholder="e.g. P2P purchase from Kraken"
                defaultValue={node.memo}
                onChange={(e) => onNodeUpdate(node.id, { memo: e.target.value })}
                style={{
                  font: '14px/1.7 monospace',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--fg)',
                  padding: '2px 6px',
                  width: '100%',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* children tree */}
      {isExpanded && node.children.length > 0 && (
        <div
          style={{
            borderLeft: '1px solid var(--border)',
            marginLeft: hasConnector ? '2ch' : 0,
            paddingBottom: 8,
          }}
        >
          {node.children.map((child, idx) => (
            <UTXONode
              key={child.id}
              node={child}
              expandedIds={expandedIds}
              onExpand={onExpand}
              onCollapse={onCollapse}
              onRemoveBranch={onRemoveBranch}
              onNodeUpdate={onNodeUpdate}
              onMatchKraken={onMatchKraken}
              onRemoveKraken={onRemoveKraken}
              isLastSibling={idx === node.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default UTXONode;
