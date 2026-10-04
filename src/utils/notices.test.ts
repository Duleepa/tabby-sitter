import { describe, expect, it } from 'vitest';
import { addNoticeTo, pruneNotices, removeFlaggedForTab, type DuplicateNotice } from './notices';

function n(id: string, at: number, over: Partial<DuplicateNotice> = {}): DuplicateNotice {
  return { id, kind: 'closed', existingTabId: 1, url: 'https://a.com', windowId: 1, at, ...over };
}

describe('pruneNotices', () => {
  it('drops notices older than 60 s', () => {
    const out = pruneNotices([n('a', 0), n('b', 50000)], 61000);
    expect(out.map((x) => x.id)).toEqual(['b']);
  });
  it('keeps the newest five', () => {
    const list = ['1', '2', '3', '4', '5', '6', '7'].map((id, i) => n(id, 1000 + i));
    expect(pruneNotices(list, 2000).map((x) => x.id)).toEqual(['3', '4', '5', '6', '7']);
  });
});

describe('addNoticeTo', () => {
  it('replaces an older flagged notice for the same tab', () => {
    const first = n('a', 1000, { kind: 'flagged', tabId: 9 });
    const out = addNoticeTo([first], n('b', 2000, { kind: 'flagged', tabId: 9 }), 2000);
    expect(out.map((x) => x.id)).toEqual(['b']);
  });
  it('prunes on write', () => {
    const out = addNoticeTo([n('old', 0)], n('new', 100000), 100000);
    expect(out.map((x) => x.id)).toEqual(['new']);
  });
});

describe('removeFlaggedForTab', () => {
  it('removes only flagged notices of that tab', () => {
    const list = [n('a', 1, { kind: 'flagged', tabId: 3 }), n('b', 1, { kind: 'flagged', tabId: 4 }), n('c', 1, { tabId: 3 })];
    expect(removeFlaggedForTab(list, 3).map((x) => x.id)).toEqual(['b', 'c']);
  });
});
