# UTXO Basis Tracer

A client-side tool for tracing the on-chain lineage of a Bitcoin UTXO and
attributing tax cost basis to it from exchange records, for producing a
defensible provenance document when self-custody transactions are reported
with a zero or missing basis.

**This is an evidence assembler, not a tax calculator.** It does not file
anything, does not compute your tax liability, and its output is not a
substitute for advice from a qualified professional. See
[DISCLAIMER.md](DISCLAIMER.md).

## Who it's for

Two jurisdictions, both first-class, toggled from the header:

- **US taxpayers:** USD display, long-term/short-term capital gains at the
  one-year mark, FIFO lot attribution — the IRS default basis method under
  Treas. Reg. §1.1012-1 absent a contemporaneous specific-ID election,
  tracked wallet-by-wallet consistent with Rev. Proc. 2024-28.
- **German taxpayers:** EUR display, the §23 EStG one-year exemption, FIFO
  per BMF-Schreiben v. 10.05.2022.

The currency toggle switches the holding-period rule set and its labels
together — the report never mixes USD prices with §23 language or vice
versa. (Current default on load is EUR / de-DE; see [Config](#config) to
change it.)

Both acquired BTC on an exchange (Kraken and Swan Bitcoin are supported
today), withdrew to self-custody, and need to show acquisition dates, cost
basis, and holding period per sub-lot for a UTXO whose on-chain history
doesn't carry that information on its own.

## How it works

1. Paste a transaction ID and press `[trace]`
2. Select the output (the specific UTXO you received)
3. Each node shows the BTC amount and the historical price at block time
4. Expand a node to trace its inputs recursively — the proportional basis
   and gain/loss summary update as you drill down
5. Toggle USD / EUR in the header; §23 EStG exemption badges appear in EUR
   mode when a disposal date is configured
6. Override a node's price manually if you have a better source (e.g. a
   P2P purchase receipt); add a memo for audit context
7. `[export pdf]` triggers a browser print dialog with a formatted ledger
   covering the full lineage, proportional basis, and gains/loss summary

### Exchange shadow lots

When a UTXO leaf traces back to an exchange withdrawal, the withdrawal is
itself funded by one or more purchases made inside the exchange account. The
shadow lot feature attributes those purchases to the leaf via FIFO so the
basis reflects actual acquisition prices rather than the on-chain block
price.

**Kraken:** export *Funding → Export → Ledger (BTC only)*, and optionally
*History → Export → Trades* for exact EUR trade prices. Click
`[load kraken]` and upload one or both — the ledger CSV is required, the
trades CSV is optional but gives exact prices instead of a mempool.space
fallback.

**Swan Bitcoin:** export a transfers CSV, or trades + withdrawals CSVs.

Click `[match kraken]` (or the Swan equivalent) on a leaf node to find a
withdrawal whose amount matches within tolerance and run FIFO backward
through the purchase history. Matched lots appear in a table inside the
node card, with a source-quality badge:

- `[trades ✓]` — all lot prices came from the trades CSV (exact)
- `[mempool ~]` — all lot prices are mempool.space estimates
- `[mixed ~]` — some lots exact, others fell back

## Threat / trust model

Nothing leaves the browser except read-only API calls to:

- `mempool.space` — transaction data and historical BTC/USD daily prices
  (or a self-hosted Esplora/electrs-compatible endpoint you configure
  instead, via the app's "data sources" panel)
- `api.frankfurter.dev` — ECB daily USD→EUR reference rate
- `api.kraken.com` — optional, only if you enable price cross-checking

There is no backend, no accounts, and no stored data (no localStorage,
indexedDB, or sessionStorage). Exchange CSVs are parsed entirely in-browser
and never transmitted anywhere.

This is enforced by a strict CSP, not just by convention:

```
default-src 'self'; script-src 'self';
connect-src https://mempool.space https://api.frankfurter.dev
  https://api.kraken.com http://localhost:* http://127.0.0.1:*
  ws://localhost:* ws://127.0.0.1:*;
style-src 'self' 'unsafe-inline'; img-src 'self' data:
```

(`localhost`/`127.0.0.1` are always allowed for a self-hosted Esplora node;
self-hosters extending this further set `VITE_EXTRA_CONNECT_SRC` at build
time — see [Config](#config).)

What's trusted: mempool.space (or your configured custom source) for tx
data and price history, and the ECB (via frankfurter.dev) for the daily FX
fixing. Neither is authenticated by default — enabling the optional Kraken
OHLC cross-check surfaces divergences between the two price sources in the
report rather than silently trusting either one.

### Verifying a deployed build matches this source

Every deploy (CI: `.github/workflows/deploy.yml`) builds with
`VITE_COMMIT_SHA` set to the triggering commit, which the app renders in
its footer and in every printed report ("app v... · commit ..."). The
build's own CSP is checked at build time (`scripts/check-dist-csp.mjs`) so
a broken `%VITE_EXTRA_CONNECT_SRC%` substitution or an accidentally
narrowed CSP fails CI rather than shipping quietly.

To confirm the JS actually served at a given moment matches building this
repo yourself at the commit shown in the footer (the asset filename is
content-hashed by Vite, so this derives it rather than assuming one):

```bash
# 1. Find the deployed script's actual (content-hashed) path and hash it.
DEPLOYED_JS=$(curl -s https://stuartnelson.xyz/utxo-trace/ | grep -oE 'assets/index-[^"]+\.js')
curl -s "https://stuartnelson.xyz/utxo-trace/$DEPLOYED_JS" | sha256sum

# 2. Build the exact same commit locally (read the sha from the site's
#    own footer first) and compare.
git checkout <commit-sha-from-the-footer>
npm ci
VITE_COMMIT_SHA=<commit-sha-from-the-footer> npm run build
sha256sum "dist/$DEPLOYED_JS"
# the two sha256sum outputs should be identical
```

Local-only variant (confirm your own build output against the checksum
manifest CI produced for that commit's run, downloaded from the Actions
run's artifacts as `dist-checksums.txt`):

```bash
npm run build
(cd dist && find . -type f -exec sha256sum {} \; | sort -k2) > /tmp/local-checksums.txt
diff /tmp/local-checksums.txt dist-checksums.txt
```

Releases are cut manually (not on every commit — see `CLAUDE.md`'s
"Releasing" section for the exact recipe); tags and release notes at
[github.com/stuartnelson3/utxo-trace/releases](https://github.com/stuartnelson3/utxo-trace/releases)
are the changelog of record — there is no separate CHANGELOG.md.

## Methodology

Every rule that affects a number in the report — the price snap time, the
matching tolerance, the FIFO ordering, the holding-period boundary — is
meant to live in one canonical, versioned constants file so the README, the
printed report, and the code can't drift from each other. That
consolidation (`src/core/methodology.ts`) is in progress; until it lands,
the authoritative description of current behavior is this README plus the
in-app disclaimer, and `pricing-api.md` documents the price-source decision
history.

## URL state

The active trace and expanded tree are encoded in the URL automatically.
Reloading or sharing the URL restores the full session — the app re-fetches
the root node and re-expands all branches in order.

URL format: `?txid=<txid>&vout=<n>&expanded=<id1>,<id2>,...`

## Running locally

```bash
npm ci
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build    # type-check + production build
```

Node version is pinned in `.nvmrc`; the package manager is pinned via the
`packageManager` field in `package.json`.

## Stack

- React 19 + TypeScript, Vite
- Blockchain data and historical USD prices: [mempool.space](https://mempool.space) public API
- EUR/USD exchange rates: [frankfurter.dev](https://frankfurter.dev) (ECB rates)
- PDF export: `react-to-print` (browser print dialog)

## Config

The default display currency is set by `APP_CONFIG.CURRENCY` in
`src/config.ts` (currently `'EUR'`). Date locale is never set separately —
it always follows the active currency (EUR → de-DE, USD → en-US), on load
and when toggled in the header, so a report can't show mismatched
currency/date formatting. Change `CURRENCY` to `'USD'` to default to USD
mode instead.

## Disclaimer

Not financial, tax, or legal advice. See [DISCLAIMER.md](DISCLAIMER.md) for
the full statement, and [LICENSE](LICENSE) for terms (MIT).

## Support

If this tool saved you an afternoon with your tax advisor, tips are
welcome — BTC only:

```
bc1quuszc94zvdlu628ev3hemymtk2nkwkv0xq6vuc
```
