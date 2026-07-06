import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DONATION_BTC_ADDRESS } from '../config';
import TipFooter from './TipFooter';

describe('TipFooter', () => {
  it('renders the full donation address', () => {
    const html = renderToStaticMarkup(
      React.createElement(TipFooter, { copied: false, onCopy: () => {} })
    );
    expect(html).toContain(DONATION_BTC_ADDRESS);
  });

  it('shows "copied" feedback only when copied is true', () => {
    const notCopied = renderToStaticMarkup(
      React.createElement(TipFooter, { copied: false, onCopy: () => {} })
    );
    const copied = renderToStaticMarkup(
      React.createElement(TipFooter, { copied: true, onCopy: () => {} })
    );
    expect(notCopied).not.toContain('copied<');
    expect(copied).toContain('copied<');
  });
});
