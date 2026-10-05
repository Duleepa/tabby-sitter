import { describe, expect, it } from 'vitest';
import { hostnameMatchesDomain, parseDomains, isRealPageUrl, isSkippableUrl, normalizeUrlForDuplicate, parseIgnoreParams } from './url';

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
  it('strips a leading www. and lowercases the host', () => {
    expect(normalizeUrlForDuplicate('https://WWW.Example.com/a')).toBe('https://example.com/a');
  });
  it('drops tracking params but keeps meaningful ones', () => {
    expect(normalizeUrlForDuplicate('https://a.com/p?utm_source=x&id=7&fbclid=1&UTM_Medium=y&si=z')).toBe('https://a.com/p?id=7');
    expect(normalizeUrlForDuplicate('https://a.com/p?ref=home')).toBe('https://a.com/p?ref=home');
    expect(normalizeUrlForDuplicate('https://a.com/p?gclid=1&_ga=2')).toBe('https://a.com/p');
  });
  it('sorts remaining params so order does not matter', () => {
    expect(normalizeUrlForDuplicate('https://a.com/p?b=2&a=1')).toBe(normalizeUrlForDuplicate('https://a.com/p?a=1&b=2'));
  });
  it('honours the extra ignore list case-insensitively', () => {
    expect(normalizeUrlForDuplicate('https://a.com/p?Foo=1&k=2', ['foo'])).toBe('https://a.com/p?k=2');
    expect(normalizeUrlForDuplicate('https://a.com/p?foo=1', [])).toBe('https://a.com/p?foo=1');
  });
  it('treats a tracking-only variant as the same page', () => {
    expect(normalizeUrlForDuplicate('https://a.com/p?utm_source=x')).toBe(normalizeUrlForDuplicate('https://a.com/p'));
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

describe('parseIgnoreParams', () => {
  it('splits, trims and lowercases', () => {
    expect(parseIgnoreParams(' Foo, bar ,,BAZ ')).toEqual(['foo', 'bar', 'baz']);
    expect(parseIgnoreParams('')).toEqual([]);
  });
});

describe('domain helpers', () => {
  it('parses domain lists', () => {
    expect(parseDomains(' A.com, ,b.org ')).toEqual(['a.com', 'b.org']);
  });
  it('matches host and subdomains only', () => {
    expect(hostnameMatchesDomain('gist.github.com', 'github.com')).toBe(true);
    expect(hostnameMatchesDomain('github.com', 'github.com')).toBe(true);
    expect(hostnameMatchesDomain('notgithub.com', 'github.com')).toBe(false);
  });
});
