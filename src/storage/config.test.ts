import { describe, expect, it } from 'vitest';
import { normalizeTheme, THEMES } from './config';

describe('normalizeTheme', () => {
  it('accepts the whitelisted themes', () => {
    for (const t of THEMES) expect(normalizeTheme(t)).toBe(t);
  });
  it('falls back to system for anything else', () => {
    for (const v of ['Dark', 'blue', '', ' light', 1, null, undefined, {}, ['dark']]) {
      expect(normalizeTheme(v)).toBe('system');
    }
  });
});
