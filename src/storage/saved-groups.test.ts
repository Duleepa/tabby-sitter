import { describe, expect, it } from 'vitest';
import { isSavableUrl, snapshotFromTabs } from './saved-groups';

describe('isSavableUrl', () => {
  it('accepts http, https, file and chrome pages', () => {
    expect(isSavableUrl('https://a.com')).toBe(true);
    expect(isSavableUrl('http://a.com')).toBe(true);
    expect(isSavableUrl('file:///tmp/a.html')).toBe(true);
    expect(isSavableUrl('chrome://settings')).toBe(true);
  });
  it('rejects the new tab page, about:, extension pages and empties', () => {
    expect(isSavableUrl('chrome://newtab/')).toBe(false);
    expect(isSavableUrl('chrome://new-tab-page/')).toBe(false);
    expect(isSavableUrl('about:blank')).toBe(false);
    expect(isSavableUrl('chrome-extension://abc/page.html')).toBe(false);
    expect(isSavableUrl('devtools://devtools/x')).toBe(false);
    expect(isSavableUrl('')).toBe(false);
    expect(isSavableUrl(undefined)).toBe(false);
  });
});

describe('snapshotFromTabs', () => {
  it('keeps order, filters unrestorable tabs and falls back to the URL for titles', () => {
    const g = snapshotFromTabs(
      'Dev',
      'blue',
      [
        { url: 'https://a.com/1', title: 'One' },
        { url: 'chrome://newtab/' },
        { url: 'about:blank' },
        { url: '', pendingUrl: 'https://b.com/2' },
        { url: 'https://c.com/3', title: '' },
      ],
      123,
      'id1'
    );
    expect(g).toEqual({
      id: 'id1',
      title: 'Dev',
      color: 'blue',
      createdAt: 123,
      updatedAt: 123,
      tabs: [
        { url: 'https://a.com/1', title: 'One' },
        { url: 'https://b.com/2', title: 'https://b.com/2' },
        { url: 'https://c.com/3', title: 'https://c.com/3' },
      ],
    });
  });
  it('can yield an empty snapshot', () => {
    expect(snapshotFromTabs('X', 'red', [{ url: 'about:blank' }], 1, 'i').tabs).toEqual([]);
  });
});
