import { describe, expect, it } from 'vitest';
import { simulateMoves } from '../test/simulate';
import { compareBySite, planSortMoves, type SortableTab } from './sort';

function tabs(specs: [string, string][], start = 0): SortableTab[] {
  return specs.map(([url, title], i) => ({ id: i + 1, index: start + i, windowId: 1, url, title }));
}

function sortedOrder(group: SortableTab[], outside: SortableTab[] = []): number[] {
  const all = [...outside, ...group].map((t) => ({ id: t.id, index: t.index, windowId: t.windowId, groupId: -1, pinned: false }));
  return simulateMoves(all, planSortMoves(group))[1];
}

describe('planSortMoves', () => {
  it('sorts by hostname then title', () => {
    const g = tabs([
      ['https://b.com/', 'Z'],
      ['https://www.a.com/', 'B'],
      ['https://a.com/x', 'A'],
      ['https://c.com/', 'M'],
    ]);
    expect(sortedOrder(g)).toEqual([3, 2, 1, 4]);
  });

  it('is a no-op for sorted or tiny groups', () => {
    expect(planSortMoves(tabs([['https://a.com/', 'a'], ['https://b.com/', 'b']]))).toEqual([]);
    expect(planSortMoves(tabs([['https://a.com/', 'a']]))).toEqual([]);
  });

  it('stays inside the group range when the group is not at the strip start', () => {
    const outside = [
      { id: 100, index: 0, windowId: 1, url: 'https://z.com', title: '' },
      { id: 101, index: 4, windowId: 1, url: 'https://0.com', title: '' },
    ];
    const g = tabs([['https://c.com/', ''], ['https://b.com/', ''], ['https://a.com/', '']], 1);
    const moves = planSortMoves(g);
    expect(moves.every((m) => m.index >= 1 && m.index <= 3)).toBe(true);
    expect(sortedOrder(g, outside)).toEqual([100, 3, 2, 1, 101]);
  });

  it('handles reversed and shuffled input', () => {
    const g = tabs([
      ['https://e.com', ''], ['https://d.com', ''], ['https://c.com', ''], ['https://b.com', ''], ['https://a.com', ''],
    ]);
    expect(sortedOrder(g)).toEqual([5, 4, 3, 2, 1]);
    const h = tabs([['https://c.com', ''], ['https://a.com', ''], ['https://e.com', ''], ['https://b.com', ''], ['https://d.com', '']]);
    expect(sortedOrder(h)).toEqual([2, 4, 1, 5, 3]);
  });

  it('is stable for equal keys', () => {
    const g = tabs([['https://a.com', 'x'], ['https://a.com', 'x'], ['https://a.com', 'x']]);
    expect(planSortMoves(g)).toEqual([]);
  });
});

describe('planSortMoves with pairs', () => {
  it('keeps a pair adjacent, sorted by its left tab', () => {
    const g = tabs([
      ['https://c.com/', ''],
      ['https://b.com/', ''],
      ['https://a.com/', ''],
      ['https://d.com/', ''],
    ]).map((x) => (x.id === 2 || x.id === 3 ? { ...x, splitViewId: 9 } : x));
    // pair (2,3) is keyed by tab 2 (b.com): order c, [b, a], d -> [b, a], c, d
    expect(sortedOrder(g)).toEqual([2, 3, 1, 4]);
  });

  it('never splits a pair when other tabs sort between its halves', () => {
    const g = tabs([
      ['https://z.com/', ''],
      ['https://a.com/', ''],
      ['https://m.com/', ''],
      ['https://c.com/', ''],
    ]).map((x) => (x.id === 1 || x.id === 2 ? { ...x, splitViewId: 4 } : x));
    // keyed by the left tab (z.com): c, m, then the pair
    expect(sortedOrder(g)).toEqual([4, 3, 1, 2]);
  });
});

describe('compareBySite', () => {
  it('ignores www. and falls back to title', () => {
    const a = { id: 1, index: 0, windowId: 1, url: 'https://www.a.com', title: 'b' };
    const b = { id: 2, index: 1, windowId: 1, url: 'https://a.com', title: 'a' };
    expect(compareBySite(a, b)).toBeGreaterThan(0);
  });
});
