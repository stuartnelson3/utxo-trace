---
name: verify-app
description: Run the Playwright smoke test for the btc basis trace app. Use this after any substantial change, or when explicitly asked to verify, test, or check the app works. Starts a dev server on port 5179, drives a real browser through a full trace flow, and reports results.
---

`playwright` is a dev dependency — no install needed locally. The check itself
lives in `scripts/smoke-test.mjs` (also used by CI's post-deploy smoke test
against the live site — see `.github/workflows/deploy.yml`).

```bash
# 1. Start the dev server (skip if already running on 5179)
npm run dev -- --port 5179 &
sleep 3

# 2. Run the verification script against it
node scripts/smoke-test.mjs

# 3. Stop the dev server when done
pkill -f 'vite --port 5179'
```

To check a deployed URL instead of a local dev server:

```bash
SMOKE_TEST_URL=https://stuartnelson.xyz/utxo-trace/ node scripts/smoke-test.mjs
```

**Pass criteria:**
- Basis is a non-zero EUR figure
- `disposed:` row present (disposal date/price UI)
- `[load exchange csv]` button present
- `[>1y ✓]` holding-period badge visible on root node (July 2023 tx is >1yr old)
- `#0` vout shown on root node card
- Node count: 1 → >1 on expand → 1 on collapse
- No console errors
