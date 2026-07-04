import React, { forwardRef } from 'react';
import { UTXONode } from '../core/types';
import { ScaledLeaf, nodePrice, leafBasis } from '../core/tree';
import { isPara23Exempt } from '../core/holding';
import { formatDate, formatCurrency } from '../config';
import { useTraceContext } from '../TraceContext';
import { krakenToLotRows } from '../core/kraken';
import { swanToLotRows } from '../core/swan';
import LotTable from './LotTable';

interface Props {
  rootNode: UTXONode;
  totalBasis: number;
  leaves: ScaledLeaf[];
  expandedIds: Set<string>;
}

const Row: React.FC<{ label: string; value: React.ReactNode; muted?: boolean }> = ({
  label,
  value,
  muted,
}) => (
  <div
    style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--border)', padding: '4px 0' }}
  >
    <span style={{ color: 'var(--muted)', minWidth: 180, flexShrink: 0 }}>{label}</span>
    <span style={{ color: muted ? 'var(--muted)' : 'inherit' }}>{value}</span>
  </div>
);

const BasisReport = forwardRef<HTMLDivElement, Props>(
  ({ rootNode, totalBasis, leaves, expandedIds }, ref) => {
    if (!rootNode) return null;

    const {
      displayCurrency,
      disposalTimestamp,
      disposalDate,
      disposalPriceDisplay,
      krakenAttributions,
      krakenMatches,
      krakenRefidIndex,
      swanAttributions,
    } = useTraceContext();
    const fmt = (val: number) => formatCurrency(val, displayCurrency);

    const getLineagePath = (node: UTXONode, path: any[] = []) => {
      path.push({
        txid: node.txid,
        amount: node.amountSats / 1e8,
        date: formatDate(new Date(node.timestamp * 1000)),
        price: nodePrice(node, displayCurrency),
      });
      if (expandedIds.has(node.id) && node.children.length > 0) {
        node.children.forEach((child) => getLineagePath(child, path));
      }
      return path;
    };

    const lineagePath = getLineagePath(rootNode);
    const rootUnitPrice = disposalPriceDisplay ?? nodePrice(rootNode, displayCurrency);
    const proceeds = (rootNode.amountSats / 1e8) * rootUnitPrice;
    const gainLoss = proceeds - totalBasis;

    const exemptBasis = leaves.reduce((sum, leaf) => {
      if (!isPara23Exempt(leaf.node.timestamp, disposalTimestamp)) return sum;
      return sum + leafBasis(leaf, displayCurrency);
    }, 0);
    const taxableBasis = totalBasis - exemptBasis;

    return (
      <div
        ref={ref}
        style={{
          font: '12px/1.6 monospace',
          background: 'white',
          color: '#000',
          padding: 40,
          maxWidth: 800,
        }}
      >
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
            proportional basis audit
          </div>
          <div style={{ color: '#555', fontSize: 11 }}>specific identification ledger</div>
          <code style={{ fontSize: 11, color: '#555', wordBreak: 'break-all' }}>
            {rootNode.txid}
          </code>
        </div>

        {/* Summary table */}
        <div style={{ marginBottom: 20 }}>
          {disposalDate && (
            <Row label="date of disposal" value={formatDate(new Date(disposalDate))} />
          )}
          <Row
            label="disposal proceeds"
            value={
              <>
                <strong>{fmt(proceeds)}</strong>
                {!disposalPriceDisplay && (
                  <span style={{ color: '#999', fontSize: 10, marginLeft: 6 }}>(estimated)</span>
                )}
              </>
            }
          />
          <Row label="@ unit price" value={`${fmt(rootUnitPrice)}/BTC`} muted />
          <Row label="acquisition basis" value={<strong>{fmt(totalBasis)}</strong>} />
          <Row
            label={gainLoss >= 0 ? 'realized gain' : 'realized loss'}
            value={
              <strong style={{ color: gainLoss >= 0 ? '#060' : '#c00' }}>
                {gainLoss >= 0 ? '▲ ' : '▼ '}
                {fmt(Math.abs(gainLoss))}
              </strong>
            }
          />
          {exemptBasis > 0 && (
            <>
              <Row
                label={
                  displayCurrency === 'EUR'
                    ? '§23 EStG exempt basis (>1yr)'
                    : 'long-term basis (>1yr)'
                }
                value={<span style={{ color: '#060' }}>{fmt(exemptBasis)}</span>}
              />
              <Row
                label={
                  displayCurrency === 'EUR' ? 'taxable basis (≤1yr)' : 'short-term basis (≤1yr)'
                }
                value={<span style={{ color: '#b60' }}>{fmt(taxableBasis)}</span>}
              />
            </>
          )}
        </div>

        {/* Acquisition sources */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontWeight: 'bold',
              borderBottom: '1px solid #000',
              marginBottom: 8,
              paddingBottom: 4,
            }}
          >
            acquisition sources (inputs)
          </div>
          {leaves.map((leaf, i) => {
            const { node, scaledSats, basisOverride } = leaf;
            const scaledBTC = scaledSats / 1e8;
            const basis = leafBasis(leaf, displayCurrency);
            const exempt = isPara23Exempt(node.timestamp, disposalTimestamp);

            // Look up attribution for lot table rendering (mirrors UTXONode logic).
            // Swan: automatic by txid. Kraken: explicit by user-confirmed match.
            const swanAttr = swanAttributions.get(node.txid) ?? null;
            const krakenMatch = !swanAttr ? krakenMatches.get(node.id) : undefined;
            const krakenLedgerTxid = krakenMatch
              ? krakenRefidIndex.get(krakenMatch.refid)
              : undefined;
            const krakenAttr = krakenLedgerTxid
              ? (krakenAttributions.get(krakenLedgerTxid) ?? null)
              : null;
            const lotRows = krakenAttr
              ? krakenToLotRows(krakenAttr, displayCurrency, node.usdToEur)
              : swanAttr
                ? swanToLotRows(swanAttr, displayCurrency, node.usdToEur)
                : null;
            const lotLabel = krakenAttr ? 'kraken / fifo' : 'swan / fifo';
            const lotTotal = lotRows ? lotRows.reduce((s, r) => s + r.basisDisplay, 0) : 0;
            // Disclose the match basis whenever it wasn't an exact net-amount hit.
            const matchDisclosure =
              krakenAttr && krakenMatch && krakenMatch.amountBasis !== 'net'
                ? `matched to ledger refid ${krakenMatch.refid} (amount ${krakenMatch.amountBasis === 'net-minus-fee' ? 'net of' : 'gross of'} withdrawal fee)`
                : null;
            // Ratio of this UTXO's proportional share vs the full node.
            const ratio = node.amountSats > 0 ? scaledSats / node.amountSats : 1;
            const isPartial = lotRows !== null && Math.abs(ratio - 1) > 0.0001;

            return (
              <div key={i} style={{ borderBottom: '1px solid #ddd', padding: '6px 0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
                  <div>
                    <div
                      style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}
                    >
                      <span>acquired: {formatDate(new Date(node.timestamp * 1000))}</span>
                      {disposalTimestamp > 0 && (
                        <span style={{ color: exempt ? '#060' : '#b60', fontSize: 11 }}>
                          {displayCurrency === 'EUR'
                            ? exempt
                              ? '[§23 ✓]'
                              : '[<1yr]'
                            : exempt
                              ? '[long-term]'
                              : '[short-term]'}
                        </span>
                      )}
                      {node.memo && (
                        <span style={{ color: '#555', fontSize: 11 }}>{node.memo}</span>
                      )}
                    </div>
                    <code style={{ fontSize: 10, color: '#555', wordBreak: 'break-all' }}>
                      {node.txid}
                      <span style={{ color: '#999' }}>:{node.vout}</span>
                    </code>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {basisOverride ? (
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {scaledBTC.toFixed(8)} BTC ({krakenAttr ? 'kraken' : 'swan'} fifo)
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: '#555' }}>
                        {scaledBTC.toFixed(8)} BTC @ {fmt(nodePrice(node, displayCurrency))}
                      </div>
                    )}
                    <div style={{ fontWeight: 'bold' }}>{fmt(basis)}</div>
                  </div>
                </div>
                {lotRows && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid #ddd' }}>
                    {matchDisclosure && (
                      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
                        {matchDisclosure}
                      </div>
                    )}
                    <LotTable
                      label={lotLabel}
                      rows={lotRows}
                      totalDisplay={lotTotal}
                      currency={displayCurrency}
                      forceExpand
                    />
                    {isPartial && (
                      <div
                        style={{
                          fontSize: 10,
                          color: '#888',
                          marginTop: 4,
                          fontFamily: 'monospace',
                        }}
                      >
                        proportional share: {scaledBTC.toFixed(8)} /{' '}
                        {(node.amountSats / 1e8).toFixed(8)} BTC = {(ratio * 100).toFixed(2)}% →
                        basis {fmt(basis)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Lineage path */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontWeight: 'bold',
              borderBottom: '1px solid #000',
              marginBottom: 8,
              paddingBottom: 4,
            }}
          >
            blockchain lineage (full path)
          </div>
          {lineagePath.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                fontSize: 11,
                padding: '3px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span style={{ color: '#555', flexShrink: 0 }}>{i + 1}.</span>
              <div style={{ flex: 1 }}>
                <code style={{ wordBreak: 'break-all', color: '#555', fontSize: 10 }}>
                  {item.txid}
                </code>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span>{item.date}</span>
                  <span>{item.amount.toFixed(8)} BTC</span>
                  <span style={{ color: '#555' }}>{fmt(item.amount * (item.price || 0))}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid #ccc',
            paddingTop: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 20,
          }}
        >
          <div style={{ fontSize: 10, color: '#555', flex: 1 }}>
            lineage verified. attribution sum [{(rootNode.amountSats / 1e8).toFixed(8)} BTC] matches
            disposal amount.
          </div>
          <div style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>
            {new Date().toLocaleDateString()}
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 9, color: '#999', lineHeight: 1.5 }}>
          not financial or tax advice. this document is for informational purposes only and does not
          constitute financial, tax, legal, or accounting advice. price data from mempool.space and
          the ecb (frankfurter.dev); exchange cost basis from kraken (ledger + trades) or swan
          bitcoin (transfers or trades + withdrawals). accuracy not guaranteed. verify with a
          qualified tax professional before filing. no liability is accepted for errors, omissions,
          or tax outcomes arising from use of this tool.
        </div>
      </div>
    );
  }
);

export default BasisReport;
