---
name: verify-app
description: Run the Playwright smoke test for the btc basis trace app. Use this after any substantial change, or when explicitly asked to verify, test, or check the app works. Starts a dev server on port 5179, drives a real browser through a full trace flow, and reports results.
---

`playwright` is a dev dependency — no install needed.

```bash
# 1. Start the dev server (skip if already running on 5179)
npm run dev -- --port 5179 &
sleep 3

# 2. Run the verification script
node -e "
const { chromium } = require('playwright');
(async () => {
  const br = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await br.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:5179');
  await page.waitForSelector('h1');

  // Block 800000 tx — July 2023, has real EUR price data
  const txid = 'd41f5de48325e79070ccd3a23005f7a3b405f3ce1faa4df09f6d71770497e9d5';
  await page.fill('input[type=text]', txid);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=select output for audit', { timeout: 10000 });
  await page.locator('button:has-text(\"OUTPUT #0\")').click();
  await page.waitForSelector('text=basis:', { timeout: 20000 });
  await page.waitForTimeout(5000); // wait for price fetch

  // 1. Basis loaded and non-zero
  const summaryBasis = await page.locator('text=basis:').first().evaluate(el => el.parentElement.textContent);
  console.log('Summary basis:', summaryBasis);

  // 2. Disposal date/price row rendered
  const disposedLabel = await page.locator('text=disposed:').count();
  console.log('Disposal row present (expect 1):', disposedLabel);

  // 3. CSV button present (unified load button)
  const csvBtn = await page.locator('button:has-text(\"[load exchange csv]\")').count();
  console.log('CSV button present (expect 1):', csvBtn);

  // 4. Holding-period badge visible on root node (July 2023 tx is >1yr old)
  const badge = await page.locator('text=[§23 ✓]').count();
  console.log('§23 badge present (expect 1):', badge);

  // 5. Vout index shown on root node card
  const vout = await page.locator('span:has-text(\"#0\")').count();
  console.log('Vout #0 shown (expect >=1):', vout);

  // 6. Node count before expand
  const nodesBefore = await page.locator('button:has-text(\"[override price]\")').count();
  console.log('Nodes before expand (expect 1):', nodesBefore);

  // 7. Expand and verify children loaded
  await page.locator('button:has-text(\"[expand]\")').first().click();
  await page.waitForTimeout(8000);
  const nodesAfter = await page.locator('button:has-text(\"[override price]\")').count();
  console.log('Nodes after expand (expect >1):', nodesAfter);

  // 8. Collapse and verify tree collapses
  await page.locator('button:has-text(\"[collapse]\")').first().click();
  await page.waitForTimeout(300);
  const nodesCollapsed = await page.locator('button:has-text(\"[override price]\")').count();
  console.log('Nodes after collapse (expect 1):', nodesCollapsed);

  console.log('Console errors:', JSON.stringify(errors));

  const failures = [];
  if (disposedLabel !== 1) failures.push('disposal row missing');
  if (csvBtn !== 1) failures.push('csv button missing');
  if (badge < 1) failures.push('§23 badge missing');
  if (vout < 1) failures.push('vout #0 missing');
  if (nodesBefore !== 1) failures.push('expected 1 node before expand');
  if (nodesAfter <= 1) failures.push('expected >1 nodes after expand');
  if (nodesCollapsed !== 1) failures.push('expected 1 node after collapse');
  if (errors.length) failures.push('console errors: ' + JSON.stringify(errors));

  if (failures.length) {
    console.error('FAILURES:', failures.join(', '));
    process.exit(1);
  }
  console.log('All checks passed.');
  await br.close();
})().catch(e => { console.error(e.message); process.exit(1); });
"

# 3. Stop the dev server when done
pkill -f 'vite --port 5179'
```

**Pass criteria:**
- Basis is a non-zero EUR figure
- `disposed:` row present (disposal date/price UI)
- `[load exchange csv]` button present
- `[§23 ✓]` holding-period badge visible on root node (July 2023 tx is >1yr old)
- `#0` vout shown on root node card
- Node count: 1 → >1 on expand → 1 on collapse
- No console errors
