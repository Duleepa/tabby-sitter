/// <reference types="vite/client" />
import rawCss from './styles.css?raw';
import themeCss from './theme.css?raw';
import { describe, expect, it } from 'vitest';

const NAMED = [
  'white', 'black', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'cyan', 'magenta',
  'gray', 'grey', 'silver', 'maroon', 'olive', 'lime', 'aqua', 'teal', 'navy', 'fuchsia', 'brown',
  'gold', 'indigo', 'violet', 'crimson', 'coral', 'salmon', 'tomato', 'khaki', 'ivory', 'beige',
  'lavender', 'turquoise', 'tan', 'orchid', 'plum', 'azure', 'snow',
];

const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('styles.css uses tokens only', () => {
  it('has no hex colours', () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
  it('has no rgb/hsl/hwb/lab/lch/oklab/oklch/color() literals', () => {
    expect(css.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g) ?? []).toEqual([]);
  });
  it('has no named colours', () => {
    const re = new RegExp(`(?<![\\w-])(?:${NAMED.join('|')})(?![\\w-])`, 'gi');
    // Look only at declaration values, not selectors.
    const values = [...css.matchAll(/:\s*([^;{}]+)[;}]/g)].map((m) => m[1]);
    const hits = values.flatMap((v) => v.match(re) ?? []);
    expect(hits).toEqual([]);
  });
  it('detects literals (self-check)', () => {
    expect('a{color:#fff}'.match(/#[0-9a-fA-F]{3,8}\b/g)).toHaveLength(1);
  });
});

describe('token references', () => {
  // Set from TS per element (group colour, swatch colour).
  const RUNTIME = new Set(['--gc', '--swatch']);
  it('every var(--x) used in styles.css is defined in theme.css or styles.css', () => {
    const defined = new Set([...(themeCss + css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v) && !RUNTIME.has(v))).toEqual([]);
  });
});
