// Pure data model for the side panel tab tree. No DOM or chrome.* calls.

export type TreeNode =
  | { kind: 'tab'; tab: chrome.tabs.Tab }
  | { kind: 'group'; group: chrome.tabGroups.TabGroup; tabs: chrome.tabs.Tab[] };

export interface WindowTree {
  windowId: number;
  pinned: chrome.tabs.Tab[];
  nodes: TreeNode[];
}

export const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;

export function nextUnusedColor(used: string[]): (typeof GROUP_COLORS)[number] {
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
}

/**
 * Chrome keeps group members contiguous, so walk the tabs in index order and
 * fold consecutive tabs with the same groupId into one group node.
 */
export function buildWindowTree(
  tabs: chrome.tabs.Tab[],
  groups: chrome.tabGroups.TabGroup[],
  windowId: number
): WindowTree {
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const sorted = tabs.filter((t) => t.windowId === windowId).sort((a, b) => a.index - b.index);

  const pinned: chrome.tabs.Tab[] = [];
  const nodes: TreeNode[] = [];

  for (const tab of sorted) {
    if (tab.pinned) {
      pinned.push(tab);
      continue;
    }
    const group = tab.groupId !== undefined && tab.groupId !== -1 ? groupsById.get(tab.groupId) : undefined;
    if (!group) {
      nodes.push({ kind: 'tab', tab });
      continue;
    }
    const last = nodes[nodes.length - 1];
    if (last && last.kind === 'group' && last.group.id === group.id) {
      last.tabs.push(tab);
    } else {
      nodes.push({ kind: 'group', group, tabs: [tab] });
    }
  }

  return { windowId, pinned, nodes };
}

function tabMatches(tab: chrome.tabs.Tab, terms: string[]): boolean {
  const haystack = `${tab.title ?? ''} ${tab.url ?? ''}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/** AND of whitespace-separated terms over title + url. Empty query returns the tree as is. */
export function filterTree(tree: WindowTree, query: string): WindowTree {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return tree;

  const nodes: TreeNode[] = [];
  for (const node of tree.nodes) {
    if (node.kind === 'tab') {
      if (tabMatches(node.tab, terms)) nodes.push(node);
    } else {
      const tabs = node.tabs.filter((t) => tabMatches(t, terms));
      if (tabs.length > 0) nodes.push({ kind: 'group', group: node.group, tabs });
    }
  }
  return {
    windowId: tree.windowId,
    pinned: tree.pinned.filter((t) => tabMatches(t, terms)),
    nodes,
  };
}
