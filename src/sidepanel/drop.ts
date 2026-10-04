// Pure drop-position math for drag & drop in the side panel. No DOM or chrome.* calls.

export interface DropTab {
  id: number;
  index: number;
  windowId: number;
  groupId: number;
  pinned: boolean;
}

export type DropTarget =
  | { kind: 'tab'; tabId: number; position: 'before' | 'after' }
  | { kind: 'group'; groupId: number; position: 'before' | 'into' }
  | { kind: 'end'; windowId: number };

export interface DropPlan {
  /** Dragged tabs in visual order. */
  tabIds: number[];
  windowId: number;
  /** Final index of the first moved tab (post-removal coordinates, as chrome.tabs.move expects). */
  index: number;
  /** Destination group, or null to leave the tabs ungrouped. */
  groupId: number | null;
  /** Pinned dragged tabs that must be unpinned (and the plan recomputed) before moving. */
  unpin: number[];
}

export interface GroupMovePlan {
  groupId: number;
  windowId: number;
  index: number;
}

function byPosition(a: DropTab, b: DropTab): number {
  return a.windowId - b.windowId || a.index - b.index;
}

/**
 * Compute where dragged tabs end up.
 *
 * Works on the remaining list: the window's tabs with the dragged ones removed.
 * The insertion slot is found in that list, which already accounts for the
 * index shift caused by removing dragged tabs that sit before the target.
 * Returns null for a no-op (target is part of the dragged selection).
 */
export function computeDrop(
  allTabs: DropTab[],
  draggedIds: number[],
  target: DropTarget
): DropPlan | null {
  const draggedSet = new Set(draggedIds);
  const dragged = allTabs.filter((t) => draggedSet.has(t.id)).sort(byPosition);
  if (dragged.length === 0) return null;

  let windowId: number;
  let groupId: number | null = null;
  let targetPinned = false;
  if (target.kind === 'tab') {
    if (draggedSet.has(target.tabId)) return null;
    const t = allTabs.find((x) => x.id === target.tabId);
    if (!t) return null;
    windowId = t.windowId;
    targetPinned = t.pinned;
    groupId = !t.pinned && t.groupId !== -1 ? t.groupId : null;
  } else if (target.kind === 'group') {
    const members = allTabs.filter((t) => t.groupId === target.groupId);
    if (members.length === 0 || members.every((t) => draggedSet.has(t.id))) return null;
    windowId = members[0].windowId;
    groupId = target.position === 'into' ? target.groupId : null;
  } else {
    windowId = target.windowId;
  }

  const remaining = allTabs.filter((t) => t.windowId === windowId && !draggedSet.has(t.id)).sort(byPosition);
  const pinnedCount = remaining.filter((t) => t.pinned).length;

  let slot: number;
  if (target.kind === 'tab') {
    const at = remaining.findIndex((t) => t.id === target.tabId);
    slot = at + (target.position === 'after' ? 1 : 0);
  } else if (target.kind === 'group') {
    slot = groupSlot(allTabs, remaining, draggedSet, target.groupId, target.position === 'into');
  } else {
    slot = remaining.length;
  }

  // Dropping on a pinned row only keeps the tabs pinned if they are all pinned already.
  const stayPinned = targetPinned && dragged.every((t) => t.pinned);
  const unpin = stayPinned ? [] : dragged.filter((t) => t.pinned).map((t) => t.id);
  if (!stayPinned) slot = Math.max(slot, pinnedCount);

  return { tabIds: dragged.map((t) => t.id), windowId, index: slot, groupId, unpin };
}

/** Slot in `remaining` at the start of a group (atEnd=false) or right after its last remaining member. */
function groupSlot(
  allTabs: DropTab[],
  remaining: DropTab[],
  draggedSet: Set<number>,
  groupId: number,
  atEnd: boolean
): number {
  const remainingMembers = remaining.filter((t) => t.groupId === groupId);
  if (remainingMembers.length > 0) {
    const first = remaining.indexOf(remainingMembers[0]);
    return atEnd ? first + remainingMembers.length : first;
  }
  // Every member is being dragged; use the group's original position.
  const members = allTabs.filter((t) => t.groupId === groupId).sort(byPosition);
  return remaining.filter((t) => t.windowId === members[0].windowId && t.index < members[0].index).length;
}

export interface TabMove {
  tabId: number;
  windowId: number;
  index: number;
}

/**
 * Turn a drop plan into single-tab moves that, applied one at a time with
 * chrome.tabs.move's single-move semantics (remove the tab, insert it at
 * `index` = its final position), yield: the remaining tabs with the dragged
 * block inserted at plan.index. Chrome does not move several ids atomically,
 * so each move's index is derived from the simulated strip at that moment:
 * the first tab goes right after the slot-th remaining tab, every later tab
 * right after the previously placed one.
 */
export function planMoves(allTabs: DropTab[], plan: DropPlan): TabMove[] {
  const windows = new Map<number, number[]>();
  for (const t of [...allTabs].sort(byPosition)) {
    const list = windows.get(t.windowId) ?? [];
    list.push(t.id);
    windows.set(t.windowId, list);
  }
  const dragged = new Set(plan.tabIds);
  const dest = windows.get(plan.windowId) ?? [];
  windows.set(plan.windowId, dest);

  // Array position right after the slot-th remaining (non-dragged) tab; 0 for slot 0.
  const slotAnchor = (): number => {
    if (plan.index <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < dest.length; i++) {
      if (!dragged.has(dest[i]) && ++seen === plan.index) return i + 1;
    }
    return dest.length;
  };

  const moves: TabMove[] = [];
  let prev: number | null = null;
  for (const id of plan.tabIds) {
    let from: number[] | undefined;
    let fromIdx = -1;
    for (const list of windows.values()) {
      fromIdx = list.indexOf(id);
      if (fromIdx !== -1) {
        from = list;
        break;
      }
    }
    if (!from) continue;
    // The anchor is computed before removal and then adjusted for the removal.
    let p = prev === null ? slotAnchor() : dest.indexOf(prev) + 1;
    if (from === dest && fromIdx < p) p -= 1;
    from.splice(fromIdx, 1);
    dest.splice(p, 0, id);
    if (!(from === dest && fromIdx === p)) moves.push({ tabId: id, windowId: plan.windowId, index: p });
    prev = id;
  }
  return moves;
}

/**
 * Compute the tabGroups.move() destination for dragging a whole group.
 * A group can only land on a top-level boundary, never inside another group.
 */
export function computeGroupMove(
  allTabs: DropTab[],
  groupId: number,
  target: DropTarget
): GroupMovePlan | null {
  const members = allTabs.filter((t) => t.groupId === groupId);
  if (members.length === 0) return null;
  const memberIds = new Set(members.map((t) => t.id));

  let windowId: number;
  if (target.kind === 'tab') {
    if (memberIds.has(target.tabId)) return null;
    const t = allTabs.find((x) => x.id === target.tabId);
    if (!t) return null;
    windowId = t.windowId;
  } else if (target.kind === 'group') {
    if (target.groupId === groupId) return null;
    const other = allTabs.find((t) => t.groupId === target.groupId);
    if (!other) return null;
    windowId = other.windowId;
  } else {
    windowId = target.windowId;
  }

  const remaining = allTabs.filter((t) => t.windowId === windowId && !memberIds.has(t.id)).sort(byPosition);
  const pinnedCount = remaining.filter((t) => t.pinned).length;

  let slot: number;
  if (target.kind === 'tab') {
    const t = remaining.find((x) => x.id === target.tabId);
    if (!t) return null;
    if (!t.pinned && t.groupId !== -1) {
      // Snap to the edge of the group that contains the target tab.
      const others = remaining.filter((x) => x.groupId === t.groupId);
      const first = remaining.indexOf(others[0]);
      slot = target.position === 'before' ? first : first + others.length;
    } else {
      slot = remaining.indexOf(t) + (target.position === 'after' ? 1 : 0);
    }
  } else if (target.kind === 'group') {
    const others = remaining.filter((x) => x.groupId === target.groupId);
    const first = remaining.indexOf(others[0]);
    slot = target.position === 'before' ? first : first + others.length;
  } else {
    slot = remaining.length;
  }

  return { groupId, windowId, index: Math.max(slot, pinnedCount) };
}
