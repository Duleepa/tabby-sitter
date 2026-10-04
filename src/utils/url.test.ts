import { describe, expect, it } from 'vitest';
import { isRealPageUrl, isSkippableUrl, normalizeUrlForDuplicate } from './url';

describe('normalizeUrlForDuplicate', () => {
  it('strips the fragment', () => {
    expect(normalizeUrlForDuplicate('https://a.com/x#top')).toBe('https://a.com/x');
  });
  it('strips trailing slash on non-root paths', () => {
    expect(normalizeUrlForDuplicate('https://a.com/x/')).toBe('https://a.com/x');
  });
  it('keeps the root slash', () => {
    expect(normalizeUrlForDuplicate('https://a.com')).toBe('https://a.com/');
    expect(normalizeUrlForDuplicate('https://a.com/#x')).toBe('https://a.com/');
  });
  it('keeps the query string', () => {
    expect(normalizeUrlForDuplicate('https://a.com/x/?q=1#h')).toBe('https://a.com/x?q=1');
  });
  it('returns null for unparsable URLs', () => {
    expect(normalizeUrlForDuplicate('not a url')).toBeNull();
    expect(normalizeUrlForDuplicate('')).toBeNull();
  });
});

describe('url helpers', () => {
  it('detects skippable URLs', () => {
    expect(isSkippableUrl('chrome://settings')).toBe(true);
    expect(isSkippableUrl('about:blank')).toBe(true);
    expect(isSkippableUrl('view-source:https://a.com')).toBe(true);
    expect(isSkippableUrl('https://a.com')).toBe(false);
  });
  it('detects real page URLs', () => {
    expect(isRealPageUrl('https://a.com')).toBe(true);
    expect(isRealPageUrl('file:///tmp/a.html')).toBe(true);
    expect(isRealPageUrl('chrome://newtab')).toBe(false);
    expect(isRealPageUrl('')).toBe(false);
    expect(isRealPageUrl(undefined)).toBe(false);
  });
});
