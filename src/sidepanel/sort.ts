import type { TabMove } from './drop';
import { splitIdOf } from '../utils/split';

export interface SortableTab {
  id: number;
  index: number;
  windowId: number;
  url?: string;
  title?: string;
  /** Split View id; -1 or absent when not paired. */
  splitViewId?: number;
}

function siteOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Hostname (without www.), then title. */
export function compareBySite(a: SortableTab, b: SortableTab): number {
  return siteOf(a.url).localeCompare(siteOf(b.url)) || (a.title ?? '').localeCompare(b.title ?? '');
}

/**
 * Selection-insertion sort planner for the tabs of one group (given in strip
 * order, contiguous). For each position i in sorted order, move the tab that
 * belongs there to groupStart + i unless it is already there. Already-placed
 * tabs are never disturbed and every move stays inside the group's range.
 */
export function planSortMoves(
  groupTabsInOrder: SortableTab[],
  compare: (a: SortableTab, b: SortableTab) => number = compareBySite
): TabMove[] {
  if (groupTabsInOrder.length < 2) return [];
  const start = Math.min(...groupTabsInOrder.map((t) => t.index));
  const windowId = groupTabsInOrder[0].windowId;
  const current = groupTabsInOrder.map((t) => t.id);
  // A pair is one unit keyed by its left tab, so the halves stay adjacent.
  const units: SortableTab[][] = [];
  for (const tab of groupTabsInOrder) {
    const prev = units[units.length - 1];
    const sid = splitIdOf(tab);
    if (sid !== -1 && prev?.length === 1 && splitIdOf(prev[0]) === sid) prev.push(tab);
    else units.push([tab]);
  }
  const sorted = units.sort((a, b) => compare(a[0], b[0])).flat(); // stable

  const moves: TabMove[] = [];
  sorted.forEach((tab, i) => {
    if (current[i] === tab.id) return;
    current.splice(current.indexOf(tab.id), 1);
    current.splice(i, 0, tab.id);
    moves.push({ tabId: tab.id, windowId, index: start + i });
  });
  return moves;
}
