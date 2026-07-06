import React, { useState, useMemo, useEffect } from 'react';
import { UTXONode as UTXONodeType } from '../core/types';
import { formatCurrency, formatDate, DisplayCurrency } from '../config';
import { nodePrice } from '../core/tree';
import { isHeldOverOneYear } from '../core/holding';
import { useTraceContext } from '../TraceContext';
import { krakenToLotRows } from '../core/kraken';
import { swanToLotRows } from '../core/swan';
import { MatchCandidate } from '../core/match';
import { METHODOLOGY } from '../core/methodology';
import LotTable from './LotTable';

interface FindCandidatesResult {
  candidates: MatchCandidate[];
  nearestMiss: { refid: string; amountDeltaSats: number } | null;
}

interface Props {
  node: UTXONodeType;
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onPruneBranch: (id: string, reason: string) => void;
  onRestoreBranch: (id: string) => void;
  onSaveOverride: (id: string, priceUsd: number, memo: string) => void;
  onClearOverride: (id: string) => void;
  onFindKrakenCandidates?: (
    nodeId: string,
    amountSats: number,
    blockTimeSec: number
  ) => FindCandidatesResult;
  onConfirmKrakenMatch?: (nodeId: string, candidate: MatchCandidate) => void;
  onRemoveKraken?: (nodeId: string) => void;
  isLastSibling?: boolean;
}

function describeCandidate(c: MatchCandidate, currency: DisplayCurrency): string {
  const date = formatDate(c.time, currency);
  const btc = (c.withdrawalSats / 1e8).toFixed(8);
  const basisNote = c.amountBasis === 'net' ? '' : ` (${c.amountBasis.replace('-', ' ')})`;
  return `${date} ${btc} BTC refid ${c.refid}${basisNote}`;
}

const PRUNE_REASON_PLACEHOLDER =
  "e.g. 'change output returned to sender', 'not my funds — counterparty input', 'below dust, immaterial'";

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children,
  style,
  disabled,
  ...props
}) => (
  <button
    {...props}
    disabled={disabled}
    style={{
      font: '14px/1.7 monospace',
      border: 'none',
      background: 'none',
      padding: 0,
      cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--muted)' : 'var(--link)',
      opacity: disabled ? 0.6 : 1,
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
  onPruneBranch,
  onRestoreBranch,
  onSaveOverride,
  onClearOverride,
  onFindKrakenCandidates,
  onConfirmKrakenMatch,
  onRemoveKraken,
  isLastSibling,
}) => {
  const {
    displayCurrency,
    disposalTimestamp,
    krakenAttributions,
    krakenMatches,
    krakenRefidIndex,
    swanAttributions,
    pruneRecords,
  } = useTraceContext();

  const pruneRecord = pruneRecords.get(node.id);

  // Look up this node's confirmed Kraken match from the shared context map.
  const matchedKraken = krakenMatches.get(node.id);
  const matchedLedgerTxid = matchedKraken ? krakenRefidIndex.get(matchedKraken.refid) : undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');
  const [memoDraft, setMemoDraft] = useState('');
  const [pruneReasonDraft, setPruneReasonDraft] = useState<string | null>(null);
  // Candidates found by the last [match kraken] click; null = not searched
  // yet, [] = searched and found nothing.
  const [pendingCandidates, setPendingCandidates] = useState<MatchCandidate[] | null>(null);
  const [nearestMiss, setNearestMiss] = useState<{ refid: string; amountDeltaSats: number } | null>(
    null
  );

  const isExpanded = expandedIds.has(node.id);
  const price = nodePrice(node, displayCurrency);
  const nodeBasis = ((node.amountSats || 0) / 1e8) * price;
  const heldOverOneYear = isHeldOverOneYear(node.timestamp, disposalTimestamp);

  const displayedOverride =
    node.isOverride && node.manualPriceUsd !== undefined
      ? displayCurrency === 'EUR'
        ? (node.manualPriceUsd * node.usdToEur).toFixed(2)
        : node.manualPriceUsd.toFixed(2)
      : '';

  // Opening the form always starts from the node's current committed state.
  useEffect(() => {
    if (isEditing) {
      setPriceDraft(displayedOverride);
      setMemoDraft(node.memo ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Swan: exact txid match (always automatic — txid is unambiguous).
  const swanAttr = swanAttributions.get(node.txid) ?? null;

  // Kraken: explicit user match, confirmed from a candidate list (never
  // auto-selected — see core/match.ts).
  const krakenAttr = useMemo(
    () => (matchedLedgerTxid ? (krakenAttributions.get(matchedLedgerTxid) ?? null) : null),
    [matchedLedgerTxid, krakenAttributions]
  );

  // Show [match kraken] button when Kraken CSV is loaded, this node has no match yet,
  // and the node is not expanded (expanded nodes are intermediate, not leaves).
  const showMatchBtn =
    krakenAttributions.size > 0 &&
    !krakenAttr &&
    !swanAttr &&
    !isExpanded &&
    !!onFindKrakenCandidates;

  const lotRows = useMemo(() => {
    if (krakenAttr) return krakenToLotRows(krakenAttr, displayCurrency, node.usdToEur);
    if (swanAttr) return swanToLotRows(swanAttr, displayCurrency, node.usdToEur);
    return null;
  }, [krakenAttr, swanAttr, displayCurrency, node.usdToEur]);

  const lotTotal = useMemo(() => {
    if (!lotRows) return 0;
    return lotRows.reduce((s, r) => s + r.basisDisplay, 0);
  }, [lotRows]);

  const hasConnector = isLastSibling !== undefined;

  // Pruned: render a single collapsed, struck-through row. Data (children,
  // memo, etc.) is retained untouched underneath — [restore] just deletes
  // the prune record, nothing is recomputed from scratch.
  if (pruneRecord) {
    return (
      <div style={{ marginTop: hasConnector ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {hasConnector && (
            <div style={{ width: '2ch', flexShrink: 0, borderBottom: '1px solid var(--border)' }} />
          )}
          <div
            style={{
              flex: 1,
              border: '1px dashed var(--border)',
              padding: '8px 12px',
              display: 'flex',
              gap: 12,
              alignItems: 'baseline',
              flexWrap: 'wrap',
              opacity: 0.6,
            }}
          >
            <span style={{ textDecoration: 'line-through' }}>
              <code style={{ fontSize: 12 }}>{node.txid.substring(0, 20)}…</code>{' '}
              {(node.amountSats / 1e8).toFixed(8)} BTC
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              ⊘ excluded: {pruneRecord.reason}
            </span>
            <Btn onClick={() => onRestoreBranch(node.id)}>[restore]</Btn>
          </div>
        </div>
      </div>
    );
  }

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
              {formatDate(new Date(node.timestamp * 1000), displayCurrency)}
            </span>
            {disposalTimestamp > 0 && (
              <span
                style={{
                  color: heldOverOneYear ? 'var(--exempt)' : 'var(--taxable)',
                  fontSize: 12,
                }}
              >
                {heldOverOneYear
                  ? METHODOLOGY.holdingPeriodBadge.over
                  : METHODOLOGY.holdingPeriodBadge.under}
              </span>
            )}
            {node.isOverride && (
              <span style={{ color: 'var(--taxable)', fontSize: 12 }}>[! asserted]</span>
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
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                (overridden by kraken
                {matchedKraken && matchedKraken.amountBasis !== 'net'
                  ? `, ${matchedKraken.amountBasis.replace('-', ' ')}`
                  : ''}
                )
              </span>
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
            {isExpanded && !(swanAttr || krakenAttr) && pruneReasonDraft === null && (
              <Btn style={{ color: 'var(--taxable)' }} onClick={() => setPruneReasonDraft('')}>
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
                  const result = onFindKrakenCandidates!(node.id, node.amountSats, node.timestamp);
                  setPendingCandidates(result.candidates);
                  setNearestMiss(result.nearestMiss);
                }}
              >
                [match kraken]
              </Btn>
            )}
            {pendingCandidates && pendingCandidates.length === 0 && !krakenAttr && !swanAttr && (
              <span style={{ color: 'var(--taxable)', fontSize: 12 }}>
                no match for {(node.amountSats / 1e8).toFixed(8)} BTC
                {nearestMiss &&
                  ` — nearest: refid ${nearestMiss.refid} (Δ${nearestMiss.amountDeltaSats} sats)`}
              </span>
            )}
            {krakenAttr && onRemoveKraken && (
              <Btn style={{ color: 'var(--taxable)' }} onClick={() => onRemoveKraken(node.id)}>
                [remove]
              </Btn>
            )}
            {node.memo && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{node.memo}</span>}
          </div>

          {/* prune reason form — required, non-empty (Part B) */}
          {pruneReasonDraft !== null && (
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <label
                style={{ display: 'block', color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}
              >
                reason for excluding this branch:
              </label>
              <input
                type="text"
                placeholder={PRUNE_REASON_PLACEHOLDER}
                value={pruneReasonDraft}
                onChange={(e) => setPruneReasonDraft(e.target.value)}
                style={{
                  font: '14px/1.7 monospace',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--fg)',
                  padding: '2px 6px',
                  width: '100%',
                  marginBottom: 6,
                }}
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <Btn
                  disabled={pruneReasonDraft.trim().length === 0}
                  onClick={() => {
                    onPruneBranch(node.id, pruneReasonDraft);
                    setPruneReasonDraft(null);
                  }}
                >
                  [confirm exclude]
                </Btn>
                <Btn onClick={() => setPruneReasonDraft(null)}>[cancel]</Btn>
              </div>
            </div>
          )}

          {/* Kraken match candidates — one requires a single [confirm] click,
              several require an explicit pick; never pre-selected. */}
          {pendingCandidates && pendingCandidates.length > 0 && (
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              {pendingCandidates.length > 1 && (
                <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>
                  {pendingCandidates.length} withdrawals match — choose one:
                </div>
              )}
              {pendingCandidates.map((c) => (
                <div
                  key={c.refid}
                  style={{
                    fontSize: 12,
                    marginBottom: 4,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                >
                  <span>
                    {pendingCandidates!.length === 1 ? 'match: ' : ''}
                    {describeCandidate(c, displayCurrency)}
                    {!c.timeVerified && (
                      <span style={{ color: 'var(--muted)' }}> (time unverified)</span>
                    )}
                  </span>
                  <Btn
                    onClick={() => {
                      onConfirmKrakenMatch!(node.id, c);
                      setPendingCandidates(null);
                      setNearestMiss(null);
                    }}
                  >
                    {pendingCandidates!.length === 1 ? '[confirm]' : '[choose]'}
                  </Btn>
                </div>
              ))}
            </div>
          )}

          {/* lot table — shown when attribution is set (Swan automatic, Kraken explicit) */}
          {lotRows && (
            <LotTable
              label={krakenAttr ? 'kraken / fifo' : 'swan / fifo'}
              rows={lotRows}
              totalDisplay={lotTotal}
              currency={displayCurrency}
            />
          )}

          {/* override form — a non-empty memo (the rationale) is required to save */}
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
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
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
                memo (required — state the source of this price, e.g. 'P2P purchase, invoice #…'):
              </label>
              <input
                type="text"
                placeholder="state the source of this price — e.g. 'P2P purchase, invoice #…'"
                value={memoDraft}
                onChange={(e) => setMemoDraft(e.target.value)}
                style={{
                  font: '14px/1.7 monospace',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--fg)',
                  padding: '2px 6px',
                  width: '100%',
                  marginBottom: 6,
                }}
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <Btn
                  disabled={priceDraft.trim().length === 0 || memoDraft.trim().length === 0}
                  onClick={() => {
                    const entered = parseFloat(priceDraft);
                    const usdValue =
                      displayCurrency === 'EUR' && node.usdToEur > 0
                        ? entered / node.usdToEur
                        : entered;
                    onSaveOverride(node.id, usdValue, memoDraft);
                    setIsEditing(false);
                  }}
                >
                  [save]
                </Btn>
                {node.isOverride && (
                  <Btn
                    style={{ color: 'var(--taxable)' }}
                    onClick={() => {
                      onClearOverride(node.id);
                      setIsEditing(false);
                    }}
                  >
                    [clear override]
                  </Btn>
                )}
                <Btn onClick={() => setIsEditing(false)}>[cancel]</Btn>
              </div>
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
              onPruneBranch={onPruneBranch}
              onRestoreBranch={onRestoreBranch}
              onSaveOverride={onSaveOverride}
              onClearOverride={onClearOverride}
              onFindKrakenCandidates={onFindKrakenCandidates}
              onConfirmKrakenMatch={onConfirmKrakenMatch}
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
