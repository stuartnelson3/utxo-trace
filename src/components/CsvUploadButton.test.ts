import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CsvUploadButton from './CsvUploadButton';

describe('CsvUploadButton', () => {
  it('renders the replace-vs-append hint as the button title, regardless of state', () => {
    for (const props of [
      { loading: false, hasAnyAttribution: false, onClick: () => {} },
      { loading: false, hasAnyAttribution: true, onClick: () => {} },
      { loading: true, hasAnyAttribution: false, onClick: () => {} },
    ]) {
      const html = renderToStaticMarkup(React.createElement(CsvUploadButton, props));
      expect(html).toContain(
        'uploading again replaces previously loaded kraken/swan files — select all files together to combine accounts'
      );
    }
  });

  it('shows [load exchange csv] before any attribution, [csv ✓] after, loading... while loading', () => {
    const before = renderToStaticMarkup(
      React.createElement(CsvUploadButton, {
        loading: false,
        hasAnyAttribution: false,
        onClick: () => {},
      })
    );
    const after = renderToStaticMarkup(
      React.createElement(CsvUploadButton, {
        loading: false,
        hasAnyAttribution: true,
        onClick: () => {},
      })
    );
    const loading = renderToStaticMarkup(
      React.createElement(CsvUploadButton, {
        loading: true,
        hasAnyAttribution: false,
        onClick: () => {},
      })
    );
    expect(before).toContain('[load exchange csv]');
    expect(after).toContain('[csv ✓]');
    expect(loading).toContain('loading...');
  });
});
