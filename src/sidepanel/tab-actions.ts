import { retryTabMutation } from '../utils/tabs';
import { computeDrop, computeGroupMove, planMoves, type DropTab, type DropTarget } from './drop';
import { nextUnusedColor } from './tab-tree';

type Ids = [number, ...number[]];

function nonEmpty(ids: number[]): Ids | null {
  return ids.length > 0 ? (ids as Ids) : null;
}

export function toDropTabs(tabs: chrome.tabs.Tab[]): DropTab[] {
  const out: DropTab[] = [];
  for (const t of tabs) {
    if (t.id === undefined) continue;
    out.push({ id: t.id, index: t.index, windowId: t.windowId, groupId: t.groupId, pinned: t.pinned });
  }
  return out;
}

export async function activateTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function closeTabs(ids: number[]): Promise<void> {
  const list = nonEmpty(ids);
  if (!list) return;
  await retryTabMutation(() => chrome.tabs.remove(list));
}

export async function moveToGroup(ids: number[], groupId: number): Promise<void> {
  const list = nonEmpty(ids);
  if (!list) return;
  await unpinTabs(await pinnedAmong(list));
  await retryTabMutation(() => chrome.tabs.group({ tabIds: list, groupId }));
}

export async function moveToNewGroup(
  ids: number[],
  windowId: number,
  name: string,
  usedColors: string[]
): Promise<void> {
  const list = nonEmpty(ids);
  if (!list) return;
  await unpinTabs(await pinnedAmong(list));
  const groupId = await retryTabMutation(() =>
    chrome.tabs.group({ tabIds: list, createProperties: { windowId } })
  );
  await chrome.tabGroups.update(groupId, { title: name, color: nextUnusedColor(usedColors) });
}

export async function removeFromGroup(ids: number[]): Promise<void> {
  const list = nonEmpty(ids);
  if (!list) return;
  await retryTabMutation(() => chrome.tabs.ungroup(list));
}

export async function setPinned(ids: number[], pinned: boolean): Promise<void> {
  for (const id of ids) {
    await retryTabMutation(() => chrome.tabs.update(id, { pinned }));
  }
}

export async function discardTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
  for (const t of tabs) {
    if (t.id === undefined || t.active || t.discarded) continue;
    try {
      await chrome.tabs.discard(t.id);
    } catch (err) {
      console.warn('[Sidepanel] discard failed', err);
    }
  }
}

export async function ungroupGroup(groupId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  await removeFromGroup(tabs.flatMap((t) => (t.id === undefined ? [] : [t.id])));
}

export async function closeGroup(groupId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ groupId });
  await closeTabs(tabs.flatMap((t) => (t.id === undefined ? [] : [t.id])));
}

export async function updateGroup(
  groupId: number,
  props: { title?: string; color?: chrome.tabGroups.UpdateProperties['color']; collapsed?: boolean }
): Promise<void> {
  await chrome.tabGroups.update(groupId, props);
}

async function pinnedAmong(ids: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const id of ids) {
    try {
      if ((await chrome.tabs.get(id)).pinned) out.push(id);
    } catch {
      /* closed */
    }
  }
  return out;
}

async function unpinTabs(ids: number[]): Promise<void> {
  await setPinned(ids, false);
}

/**
 * Move dragged tabs to the drop target, then explicitly group or ungroup them
 * (never relying on Chrome's implicit join behaviour).
 */
export async function applyDrop(draggedIds: number[], target: DropTarget): Promise<void> {
  let all = toDropTabs(await chrome.tabs.query({}));
  let plan = computeDrop(all, draggedIds, target);
  if (!plan) return;

  if (plan.unpin.length > 0) {
    await unpinTabs(plan.unpin);
    // Unpinning shifts indices; recompute against the fresh state.
    all = toDropTabs(await chrome.tabs.query({}));
    plan = computeDrop(all, draggedIds, target);
    if (!plan) return;
  }

  // chrome.tabs.move with several ids is not atomic, so move one tab at a time.
  for (const m of planMoves(all, plan)) {
    await retryTabMutation(() => chrome.tabs.move(m.tabId, { windowId: m.windowId, index: m.index }));
  }

  const { tabIds, windowId, groupId } = plan;
  const ids = tabIds as Ids;
  if (groupId !== null) {
    await retryTabMutation(() => chrome.tabs.group({ tabIds: ids, groupId }));
  } else {
    const current = await chrome.tabs.query({ windowId });
    const grouped = current.filter((t) => t.id !== undefined && tabIds.includes(t.id) && t.groupId !== -1);
    const ungroupIds = nonEmpty(grouped.map((t) => t.id as number));
    if (ungroupIds) await retryTabMutation(() => chrome.tabs.ungroup(ungroupIds));
  }
}

export async function applyGroupMove(groupId: number, target: DropTarget): Promise<void> {
  const plan = computeGroupMove(toDropTabs(await chrome.tabs.query({})), groupId, target);
  if (!plan) return;
  await retryTabMutation(() =>
    chrome.tabGroups.move(plan.groupId, { windowId: plan.windowId, index: plan.index })
  );
}
