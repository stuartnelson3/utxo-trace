import { describe, it, expect } from 'vitest';

const modules = import.meta.glob('./*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

describe('src/core purity', () => {
  it('imports nothing from react or the DOM, and never calls fetch or Date.now', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(modules)) {
      if (file.endsWith('.test.ts')) continue;
      if (/from ['"]react/.test(text)) offenders.push(`${file}: imports react`);
      if (/\bfetch\(/.test(text)) offenders.push(`${file}: calls fetch()`);
      if (/\bDate\.now\(\)/.test(text)) offenders.push(`${file}: calls Date.now()`);
    }
    expect(offenders).toEqual([]);
  });
});
