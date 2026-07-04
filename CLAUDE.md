# UTXO Basis Tracer

Personal tool for tracing Bitcoin UTXO lineage and computing proportional cost basis for tax records. Runs entirely client-side — no backend, no stored data.

## Stack

- React 19 + TypeScript, Vite, Tailwind CSS
- `react-to-print` for PDF export
- All blockchain data and historical prices: `mempool.space` public API (no key required)

## Commands

```
npm run dev      # dev server on http://localhost:5173
npm run build    # type-check + production build
```

## How it works

1. Paste a TXID → app fetches all outputs from mempool.space
2. Select the output to trace (the specific UTXO you received)
3. Each node shows BTC amount + EUR price at block time
4. Expand a node to trace its inputs recursively
5. "Export Audit PDF" triggers browser print with the `BasisReport` layout

## Config

Currency and locale are in `src/config.ts`. Change `CURRENCY` and `LOCALE` there to switch between EUR/USD/etc.

## Verifying the app

Run `/verify-app` after any substantial change, or when explicitly asked. Not required for every small edit.

The skill is at `.claude/skills/verify-app/SKILL.md` — it drives a full Playwright smoke test against a real transaction and checks basis loading, expand/collapse, and console errors.

## Planning convention

Before writing non-trivial code, plan using the **simple-made-easy** skill at `~/notes/skills/simple-made-easy`. Name the concerns in play, find the braids, and prefer simple (unentangled) over easy (familiar) before committing to an approach.
