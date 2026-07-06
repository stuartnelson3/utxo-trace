import { readFileSync } from 'node:fs';

// Guards against two independent failure modes: a broken Vite %VITE_*%
// substitution leaving the literal placeholder token in the shipped HTML
// (or, if a future edit ever composed the string with a template literal
// instead, the substitution silently becoming the string "undefined"), and
// an accidental edit to index.html dropping a CSP origin the app actually
// needs at runtime.
const distIndexPath = new URL('../dist/index.html', import.meta.url);
const html = readFileSync(distIndexPath, 'utf8');

const cspMatch = html.match(/Content-Security-Policy"\s+content="([^"]+)"/);
if (!cspMatch) {
  console.error('FAIL: no Content-Security-Policy meta tag found in dist/index.html');
  process.exit(1);
}
const csp = cspMatch[1];

const failures = [];

if (csp.includes('%VITE_EXTRA_CONNECT_SRC%')) {
  failures.push('literal %VITE_EXTRA_CONNECT_SRC% token survived Vite env substitution');
}
if (/\bundefined\b/.test(csp)) {
  failures.push('CSP contains the literal string "undefined"');
}

const REQUIRED_ORIGINS = ['https://mempool.space', 'https://api.frankfurter.dev', 'https://api.kraken.com'];
for (const origin of REQUIRED_ORIGINS) {
  if (!csp.includes(origin)) {
    failures.push(`missing required CSP origin: ${origin}`);
  }
}

if (failures.length) {
  console.error('FAIL: dist/index.html CSP check failed:');
  for (const f of failures) console.error(' -', f);
  console.error('CSP was:', csp);
  process.exit(1);
}

console.log('OK: dist/index.html CSP check passed.');
console.log('CSP:', csp);
