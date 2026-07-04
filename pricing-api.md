# Pricing API Decision

This doc tracks the historical price API situation. It's been a headache and will likely need revisiting.

## What we need

For each UTXO node, the app fetches the BTC/EUR closing price at the block's timestamp. Requirements:

- Historical daily prices in EUR going back to at least 2013
- No CORS block (requests come from the browser directly)
- No or minimal rate limiting for traces that expand several levels deep
- No API key required (or key can live in source for a personal tool)

---

## Options

### 1. mempool.space (USD) + frankfurter.dev (EUR conversion) — current

**How it works:** Fetch BTC/USD from mempool.space (reliable, consistent). Convert to EUR using the ECB daily rate from `api.frankfurter.dev/v1/{date}?from=USD&to=EUR`. EUR rates are cached by date in a module-level Map, so nodes that share a date only hit frankfurter.dev once.

**Pros:**
- No API key for either service
- Both are CORS-friendly (`frankfurter.dev` has `Access-Control-Allow-Origin: *`)
- USD prices on mempool.space are consistently available; EUR-specific gaps are avoided
- ECB rates are authoritative for EUR and cover back to 1999
- Cache reduces frankfurter.dev requests significantly on deep traces

**Cons:**
- mempool.space USD still has the ~8h snapshot gap issue (mitigated by retrying at the prior 16:00 UTC daily snapshot)
- Two API hosts instead of one
- Rate limiting on mempool.space is still a risk on very deep traces — this was the original reason for getting the CryptoCompare key

---

### 2. CryptoCompare `histoday`

**How it works:** `GET https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=EUR&limit=1&toTs=TIMESTAMP` with an API key in the `Authorization` header.

**Pros:**
- Daily candles in EUR, no gaps, reliable back to 2013
- Free tier is generous (~100k calls/month) — more than enough for personal use
- API key already exists in the repo history (free account, low risk)

**Cons:**
- **Blocks CORS from browser origins** — confirmed both in Playwright headless and real Chrome. The `Authorization` header triggers a preflight, and the server doesn't return `Access-Control-Allow-Origin`.
- Can't be used client-side without a proxy

---

### 3. CoinGecko `/coins/bitcoin/history`

**How it works:** `GET https://api.coingecko.com/api/v3/coins/bitcoin/history?date=DD-MM-YYYY`

**Pros:**
- Daily EUR prices, well-known API

**Cons:**
- Free public endpoint now returns 401 — requires a paid or demo API key
- Demo key is free to register but adds friction

---

### 4. Local Node.js proxy (recommended next step)

**How it works:** A small Express/Fastify server running on localhost that forwards requests to CryptoCompare, adding the API key server-side. The browser hits `localhost:3001/price?ts=...` instead of CryptoCompare directly.

**Pros:**
- Unlocks CryptoCompare (option 2) — the best data source
- No CORS problem: same-origin or trivially configured
- Runs on the same laptop, no external infrastructure
- Rate limiting is a non-issue at personal-use scale
- A single `~30-line` file

**Cons:**
- Two processes to start instead of one (`npm run dev` + `node proxy.js`)
- Could be wrapped into a single `npm run dev` with `concurrently` to hide the friction

---

### 5. Cloudflare Worker / Vercel edge function

Same idea as option 4 but hosted rather than local. Solves CORS, unlocks CryptoCompare.

**Pros:** Always-on, no local process

**Cons:** Adds external infrastructure for what's a personal laptop tool. Overkill.

---

## Rate limiting history

The original switch from mempool.space to CryptoCompare was motivated by rate limiting on mempool.space during deep recursive traces (many nodes expanding in parallel). CryptoCompare's free tier has been reliable for this use case. The `250ms` delay between `fetchNodeData` calls in `api.ts` was added as a mitigation.

If mempool.space rate limiting becomes a problem again, the local proxy (option 4) is the right move — it gets us back to CryptoCompare without the CORS issue.
