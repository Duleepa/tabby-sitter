import { describe, expect, it } from 'vitest';
import {
  duplicateCount,
  findDuplicateClusters,
  otherCopiesToClose,
  pickExistingTab,
  pickKeeper,
  tabsToClose,
  type DuplicateCandidate,
} from './duplicates';

let nextId = 1;
function t(over: Partial<DuplicateCandidate> & { id?: number } = {}): DuplicateCandidate & { id: number } {
  return { id: nextId++, windowId: 1, index: 0, url: 'https://a.com/x', ...over };
}

describe('findDuplicateClusters', () => {
  it('clusters by normalised URL, size >= 2, ordered by first appearance', () => {
    const tabs = [
      t({ index: 0, url: 'https://b.com/' }),
      t({ index: 1, url: 'https://a.com/x#frag' }),
      t({ index: 2, url: 'https://b.com' }),
      t({ index: 3, url: 'https://a.com/x?utm_source=q' }),
      t({ index: 4, url: 'https://c.com/' }),
    ];
    const clusters = findDuplicateClusters(tabs);
    expect(clusters.map((c) => c.tabs.length)).toEqual([2, 2]);
    expect(clusters[0].key).toBe('https://b.com/');
    expect(clusters[1].key).toBe('https://a.com/x');
  });

  it('spans windows and orders by window then index', () => {
    const tabs = [t({ windowId: 2, index: 0 }), t({ windowId: 1, index: 5 })];
    const [c] = findDuplicateClusters(tabs);
    expect(c.tabs.map((x) => x.windowId)).toEqual([1, 2]);
  });

  it('ignores non-page URLs and tabs with a pending navigation', () => {
    const tabs = [
      t({ url: 'chrome://settings' }),
      t({ url: 'chrome://settings' }),
      t({ pendingUrl: 'https://z.com' }),
      t({}),
    ];
    expect(findDuplicateClusters(tabs)).toHaveLength(0);
  });

  it('uses the extra ignored params', () => {
    const tabs = [t({ url: 'https://a.com/p?foo=1' }), t({ url: 'https://a.com/p?foo=2' })];
    expect(findDuplicateClusters(tabs)).toHaveLength(0);
    expect(findDuplicateClusters(tabs, ['foo'])).toHaveLength(1);
  });
});

describe('duplicateCount', () => {
  it('sums size - 1', () => {
    const tabs = [t(), t(), t(), t({ url: 'https://b.com' }), t({ url: 'https://b.com' })];
    expect(duplicateCount(findDuplicateClusters(tabs))).toBe(3);
    expect(duplicateCount([])).toBe(0);
  });
});

describe('pickKeeper', () => {
  const cluster = (tabs: ReturnType<typeof t>[]) => ({ key: 'k', tabs });

  it('prefers the active tab in the focused window', () => {
    const a = t({ windowId: 1, active: true });
    const b = t({ windowId: 2, active: true });
    expect(pickKeeper(cluster([a, b]), 2)).toBe(b);
  });
  it('falls back to any active tab', () => {
    const a = t({ windowId: 1 });
    const b = t({ windowId: 2, active: true });
    expect(pickKeeper(cluster([a, b]), 1)).toBe(b);
  });
  it('then the most recently accessed', () => {
    const a = t({ lastAccessed: 5 });
    const b = t({ lastAccessed: 9 });
    expect(pickKeeper(cluster([a, b]))).toBe(b);
  });
  it('then the lowest window/index', () => {
    const a = t({ windowId: 2, index: 0 });
    const b = t({ windowId: 1, index: 3 });
    const c = t({ windowId: 1, index: 1 });
    expect(pickKeeper(cluster([a, b, c]))).toBe(c);
  });
});

describe('tabsToClose', () => {
  it('closes everything but the keeper and never pinned tabs', () => {
    const a = t({ active: true, windowId: 1 });
    const b = t({ pinned: true });
    const c = t({});
    expect(tabsToClose({ key: 'k', tabs: [a, b, c] }, 1)).toEqual([c]);
  });
});

describe('pickExistingTab', () => {
  it('prefers the same window, then the most recently accessed', () => {
    const a = t({ windowId: 2, lastAccessed: 100 });
    const b = t({ windowId: 1, lastAccessed: 1 });
    const c = t({ windowId: 1, lastAccessed: 7 });
    expect(pickExistingTab([a, b, c], 1)).toBe(c);
    expect(pickExistingTab([a], 1)).toBe(a);
    expect(pickExistingTab([], 1)).toBeUndefined();
  });
});

describe('otherCopiesToClose', () => {
  it('keeps the given tab and never closes pinned copies', () => {
    const a = t({});
    const b = t({});
    const c = t({ pinned: true });
    const d = t({});
    expect(otherCopiesToClose({ key: 'k', tabs: [a, b, c, d] }, b)).toEqual([a, d]);
  });
  it('returns nothing for a cluster of only the kept tab and pinned tabs', () => {
    const a = t({});
    const b = t({ pinned: true });
    expect(otherCopiesToClose({ key: 'k', tabs: [a, b] }, a)).toEqual([]);
  });
});
