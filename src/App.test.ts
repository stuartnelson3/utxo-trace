import { describe, it, expect } from 'vitest';

// App.tsx's CSV upload button is deeply wired into app-level state
// (csvFileRef, csvLoading, handleCsvFiles, hasAnyAttribution) — not a
// clean extraction candidate the way TipFooter was. Verified structurally
// instead, mirroring methodology.test.ts's "no magic numbers" grep pattern.
const modules = import.meta.glob('./App.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const appSource = Object.values(modules)[0];

describe('CSV upload replace-vs-append hint (task 6)', () => {
  it('the upload control carries a hint that re-uploading replaces, not appends, per exchange', () => {
    expect(appSource).toContain(
      'uploading again replaces previously loaded kraken/swan files — select all files together to combine accounts'
    );
  });
});
