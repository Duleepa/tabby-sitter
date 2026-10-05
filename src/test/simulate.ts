import type { DropTab, TabMove } from '../sidepanel/drop';

/** chrome.tabs.move single-tab semantics: remove the tab, insert at its final index (clamped). */
export function simulateMoves(allTabs: DropTab[], moves: TabMove[]): Record<number, number[]> {
  const wins: Record<number, number[]> = {};
  for (const t of [...allTabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)) {
    (wins[t.windowId] ??= []).push(t.id);
  }
  for (const m of moves) {
    for (const list of Object.values(wins)) {
      const at = list.indexOf(m.tabId);
      if (at !== -1) list.splice(at, 1);
    }
    const dest = (wins[m.windowId] ??= []);
    dest.splice(Math.min(m.index, dest.length), 0, m.tabId);
  }
  return wins;
}
