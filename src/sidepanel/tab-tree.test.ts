import { describe, expect, it } from 'vitest';
import { buildWindowTree, filterTree, nextUnusedColor } from './tab-tree';

function tab(id: number, index: number, over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id,
    index,
    windowId: 1,
    groupId: -1,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://site${id}.com/`,
    ...over,
  } as chrome.tabs.Tab;
}

function group(id: number, title = `G${id}`): chrome.tabGroups.TabGroup {
  return { id, title, color: 'blue', collapsed: false, windowId: 1 };
}

describe('buildWindowTree', () => {
  it('folds contiguous same-group tabs into group nodes', () => {
    const tabs = [tab(1, 0), tab(2, 1, { groupId: 10 }), tab(3, 2, { groupId: 10 }), tab(4, 3), tab(5, 4, { groupId: 11 })];
    const tree = buildWindowTree(tabs, [group(10), group(11)], 1);
    expect(tree.nodes.map((n) => n.kind)).toEqual(['tab', 'group', 'tab', 'group']);
    const g = tree.nodes[1];
    expect(g.kind === 'group' && g.tabs.map((t) => t.id)).toEqual([2, 3]);
  });

  it('splits pinned tabs out', () => {
    const tabs = [tab(1, 0, { pinned: true }), tab(2, 1, { pinned: true }), tab(3, 2)];
    const tree = buildWindowTree(tabs, [], 1);
    expect(tree.pinned.map((t) => t.id)).toEqual([1, 2]);
    expect(tree.nodes).toHaveLength(1);
  });

  it('sorts by index and ignores other windows', () => {
    const tabs = [tab(2, 1), tab(1, 0), tab(9, 0, { windowId: 2 })];
    const tree = buildWindowTree(tabs, [], 1);
    expect(tree.nodes.map((n) => n.kind === 'tab' && n.tab.id)).toEqual([1, 2]);
  });

  it('treats tabs of an unknown group as ungrouped', () => {
    const tree = buildWindowTree([tab(1, 0, { groupId: 99 })], [], 1);
    expect(tree.nodes[0].kind).toBe('tab');
  });

  it('keeps two adjacent different groups separate', () => {
    const tabs = [tab(1, 0, { groupId: 10 }), tab(2, 1, { groupId: 11 })];
    const tree = buildWindowTree(tabs, [group(10), group(11)], 1);
    expect(tree.nodes).toHaveLength(2);
  });
});

describe('filterTree', () => {
  const tabs = [
    tab(1, 0, { title: 'GitHub PR', url: 'https://github.com/a/b' }),
    tab(2, 1, { title: 'Docs', url: 'https://example.com/pr', groupId: 10 }),
    tab(3, 2, { title: 'Other', url: 'https://x.com', groupId: 10 }),
    tab(4, 3, { title: 'Pinned PR', url: 'https://p.com', pinned: true }),
  ];
  const tree = buildWindowTree(tabs, [group(10)], 1);

  it('returns the tree for an empty query', () => {
    expect(filterTree(tree, '   ')).toBe(tree);
  });

  it('ANDs terms over title and url, case-insensitively', () => {
    const r = filterTree(tree, 'PR github');
    expect(r.nodes).toHaveLength(1);
    expect(r.pinned).toHaveLength(0);
  });

  it('keeps only matching tabs inside groups and drops empty groups', () => {
    const r = filterTree(tree, 'pr');
    expect(r.nodes.map((n) => n.kind)).toEqual(['tab', 'group']);
    const g = r.nodes[1];
    expect(g.kind === 'group' && g.tabs.map((t) => t.id)).toEqual([2]);
    expect(r.pinned.map((t) => t.id)).toEqual([4]);
    expect(filterTree(tree, 'zzz').nodes).toHaveLength(0);
  });
});

describe('nextUnusedColor', () => {
  it('picks the first unused color and wraps when all are used', () => {
    expect(nextUnusedColor(['grey', 'blue'])).toBe('red');
    expect(nextUnusedColor(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])).toBe('grey');
  });
});
