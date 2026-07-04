import { chromium } from 'playwright';

const baseUrl = process.env.SMOKE_TEST_URL ?? 'http://localhost:5179';
// Block 800000 tx — July 2023, has real EUR price data
const txid = 'd41f5de48325e79070ccd3a23005f7a3b405f3ce1faa4df09f6d71770497e9d5';

// stuartnelson.xyz is fronted by Cloudflare, which auto-injects a Web
// Analytics beacon into every page it serves regardless of app code; our CSP
// (script-src 'self') correctly blocks it, but the resulting console error
// is expected noise on the deployed domain, not a real app regression.
const KNOWN_NOISE = [/static\.cloudflareinsights\.com\/beacon/];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !KNOWN_NOISE.some((re) => re.test(m.text()))) {
    errors.push(m.text());
  }
});

try {
  await page.goto(baseUrl);
  await page.waitForSelector('h1');

  await page.fill('input[type=text]', txid);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=select output for audit', { timeout: 10000 });
  await page.locator('button:has-text("OUTPUT #0")').click();
  await page.waitForSelector('text=basis:', { timeout: 20000 });
  await page.waitForTimeout(5000); // wait for price fetch

  const summaryBasis = await page
    .locator('text=basis:')
    .first()
    .evaluate((el) => el.parentElement.textContent);
  console.log('Summary basis:', summaryBasis);

  const disposedLabel = await page.locator('text=disposed:').count();
  console.log('Disposal row present (expect 1):', disposedLabel);

  const csvBtn = await page.locator('button:has-text("[load exchange csv]")').count();
  console.log('CSV button present (expect 1):', csvBtn);

  const badge = await page.locator('text=[§23 ✓]').count();
  console.log('§23 badge present (expect 1):', badge);

  const vout = await page.locator('span:has-text("#0")').count();
  console.log('Vout #0 shown (expect >=1):', vout);

  const nodesBefore = await page.locator('button:has-text("[override price]")').count();
  console.log('Nodes before expand (expect 1):', nodesBefore);

  await page.locator('button:has-text("[expand]")').first().click();
  await page.waitForTimeout(8000);
  const nodesAfter = await page.locator('button:has-text("[override price]")').count();
  console.log('Nodes after expand (expect >1):', nodesAfter);

  await page.locator('button:has-text("[collapse]")').first().click();
  await page.waitForTimeout(300);
  const nodesCollapsed = await page.locator('button:has-text("[override price]")').count();
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
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
} finally {
  await browser.close();
}
