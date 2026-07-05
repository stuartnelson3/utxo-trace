import React, { forwardRef } from 'react';
import { UTXONode } from '../core/types';
import { ScaledLeaf, nodePrice, leafBasis, findNode } from '../core/tree';
import { isPara23Exempt } from '../core/holding';
import { formatDate, formatCurrency } from '../config';
import { useTraceContext } from '../TraceContext';
import { krakenToLotRows } from '../core/kraken';
import { swanToLotRows } from '../core/swan';
import LotTable from './LotTable';
import Legend from './Legend';
import { METHODOLOGY } from '../core/methodology';
import type { PriceDivergence } from '../api';

interface Props {
  rootNode: UTXONode;
  totalBasis: number;
  leaves: ScaledLeaf[];
  excludedLeaves: ScaledLeaf[];
  expandedIds: Set<string>;
  priceDivergences: PriceDivergence[];
  crossCheckStats: { total: number; verified: number };
  bundleHash: string | null;
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
  (
    {
      rootNode,
      totalBasis,
      leaves,
      excludedLeaves,
      expandedIds,
      priceDivergences,
      crossCheckStats,
      bundleHash,
    },
    ref
  ) => {
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
      overrideRecords,
      pruneRecords,
    } = useTraceContext();
    const fmt = (val: number) => formatCurrency(val, displayCurrency);
    const fmtBoth = (usd: number, eur: number) =>
      `${formatCurrency(usd, 'USD')} / ${formatCurrency(eur, 'EUR')}`;

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

    // Mass-balance reconciliation: attributed + excluded === traced.
    const attributedSats = leaves.reduce((s, l) => s + l.scaledSats, 0);
    const excludedSats = excludedLeaves.reduce((s, l) => s + l.scaledSats, 0);
    const tracedSats = attributedSats + excludedSats;

    const overrides = [...overrideRecords.values()].sort((a, b) => a.assertedAt - b.assertedAt);

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
          <div style={{ color: '#555', fontSize: 11 }}>
            {displayCurrency === 'EUR' ? METHODOLOGY.labels.en_eur : METHODOLOGY.labels.en_usd}
          </div>
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
          <Row
            label="acquisition basis"
            value={
              <>
                <strong>{fmt(totalBasis)}</strong>
                {overrides.length > 0 && (
                  <span style={{ color: '#b60', fontSize: 10, marginLeft: 6 }}>
                    (includes {overrides.length} manually asserted price
                    {overrides.length === 1 ? '' : 's'})
                  </span>
                )}
              </>
            }
          />
          {excludedSats > 0 && (
            <Row
              label="reconciliation"
              value={
                <span style={{ fontSize: 10, color: '#555' }}>
                  traced inputs {(tracedSats / 1e8).toFixed(8)} BTC = attributed{' '}
                  {(attributedSats / 1e8).toFixed(8)} BTC + excluded{' '}
                  {(excludedSats / 1e8).toFixed(8)} BTC
                </span>
              }
            />
          )}
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

        {/* Manual price assertions */}
        {overrides.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontWeight: 'bold',
                borderBottom: '1px solid #000',
                marginBottom: 8,
                paddingBottom: 4,
              }}
            >
              manual price assertions
            </div>
            {overrides.map((o, i) => {
              const node = findNode(rootNode, o.nodeId);
              const usdToEur = node?.usdToEur ?? 1;
              return (
                <div
                  key={i}
                  style={{ borderBottom: '1px solid #ddd', padding: '6px 0', fontSize: 11 }}
                >
                  <div
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <span style={{ color: '#b60' }}>!</span>
                    <code style={{ color: '#555', wordBreak: 'break-all' }}>
                      {o.txid}:{o.vout}
                    </code>
                    <span style={{ color: '#999' }}>{new Date(o.assertedAt).toLocaleString()}</span>
                  </div>
                  <div>
                    asserted: <strong>{fmtBoth(o.priceUsd, o.priceUsd * usdToEur)}</strong>/BTC —
                    replaced{' '}
                    {o.previousPriceUsd != null
                      ? `${fmtBoth(o.previousPriceUsd, o.previousPriceUsd * usdToEur)}/BTC (${o.previousSource})`
                      : `unknown price (${o.previousSource})`}
                  </div>
                  <div style={{ color: '#555' }}>{o.memo}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Excluded branches */}
        {[...pruneRecords.values()].length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontWeight: 'bold',
                borderBottom: '1px solid #000',
                marginBottom: 8,
                paddingBottom: 4,
              }}
            >
              excluded branches
            </div>
            {[...pruneRecords.values()]
              .sort((a, b) => a.prunedAt - b.prunedAt)
              .map((p, i) => (
                <div
                  key={i}
                  style={{ borderBottom: '1px solid #ddd', padding: '6px 0', fontSize: 11 }}
                >
                  <div
                    style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <span>⊘</span>
                    <code style={{ color: '#555', wordBreak: 'break-all' }}>
                      {p.txid}:{p.vout}
                    </code>
                    <span>{(p.amountSats / 1e8).toFixed(8)} BTC</span>
                    <span style={{ color: '#999' }}>{new Date(p.prunedAt).toLocaleString()}</span>
                  </div>
                  <div style={{ color: '#555' }}>{p.reason}</div>
                </div>
              ))}
          </div>
        )}

        {/* Price source divergences */}
        {priceDivergences.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontWeight: 'bold',
                borderBottom: '1px solid #000',
                marginBottom: 8,
                paddingBottom: 4,
              }}
            >
              price source divergences
            </div>
            {priceDivergences.map((d, i) => (
              <div
                key={i}
                style={{ borderBottom: '1px solid #ddd', padding: '6px 0', fontSize: 11 }}
              >
                {d.day}: mempool.space ${d.primaryUsd.toFixed(2)} vs. kraken $
                {d.crossCheckUsd.toFixed(2)} — {(d.divergence * 100).toFixed(2)}% divergence
                (mempool.space value used)
              </div>
            ))}
          </div>
        )}

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

        {/* Methodology appendix */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontWeight: 'bold',
              borderBottom: '1px solid #000',
              marginBottom: 8,
              paddingBottom: 4,
            }}
          >
            methodology
          </div>
          <div style={{ fontSize: 10, color: '#333', lineHeight: 1.6 }}>
            <div>
              <strong>price source:</strong> {METHODOLOGY.priceOracle.source};{' '}
              {METHODOLOGY.priceOracle.snapRule}.
            </div>
            <div>
              <strong>fx:</strong> {METHODOLOGY.fx.source}; {METHODOLOGY.fx.rule}.
            </div>
            {crossCheckStats.total > 0 && (
              <div>
                <strong>cross-check:</strong> {crossCheckStats.verified} of {crossCheckStats.total}{' '}
                estimated prices cross-verified against Kraken OHLC within 2%.
              </div>
            )}
            <div>
              <strong>attribution:</strong> {METHODOLOGY.attribution.rule},{' '}
              {METHODOLOGY.attribution.scope}.
            </div>
            <div>
              <strong>matching:</strong> {METHODOLOGY.matching.rule}.
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>holding period (DE):</strong> {METHODOLOGY.holdingPeriod.rule_de}
            </div>
            <div>
              <strong>holding period (US):</strong> {METHODOLOGY.holdingPeriod.rule_us}
            </div>
            <table style={{ marginTop: 8, borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: 8, color: '#060' }}>✓</td>
                  <td style={{ paddingRight: 16 }}>{METHODOLOGY.provenanceTiers['trades-csv']}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 8, color: '#b60' }}>~</td>
                  <td style={{ paddingRight: 16 }}>{METHODOLOGY.provenanceTiers.mempool}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 8 }}>mixed</td>
                  <td style={{ paddingRight: 16 }}>{METHODOLOGY.provenanceTiers.mixed}</td>
                </tr>
                <tr>
                  <td style={{ paddingRight: 8, color: '#b60' }}>!</td>
                  <td style={{ paddingRight: 16 }}>{METHODOLOGY.provenanceTiers.override}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 8, color: '#999' }}>
              methodology v{METHODOLOGY.version} · app v{__APP_VERSION__} · commit {__COMMIT__} ·
              generated {new Date().toISOString()}
              {disposalDate && (
                <>
                  {' '}
                  · disposal {formatDate(new Date(disposalDate))}
                  {disposalPriceDisplay != null && ` @ ${fmt(disposalPriceDisplay)}/BTC`}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginBottom: 12 }}>
          <Legend dark={false} />
        </div>

        {/* Evidence bundle */}
        {bundleHash && (
          <div style={{ fontSize: 10, color: '#999', marginBottom: 12 }}>
            evidence bundle sha256 {bundleHash} · app {__APP_VERSION__} · commit {__COMMIT__} ·
            methodology v{METHODOLOGY.version}
          </div>
        )}

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
