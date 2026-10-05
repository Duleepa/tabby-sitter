import { describe, expect, it } from 'vitest';
import { simulateMoves } from '../test/simulate';
import { computeDrop, computeGroupMove, planMoves, type DropTab, type DropTarget } from './drop';

// Window 1: [A0 B1 C2 | G10: D3 E4 | F5 G6]
function tabs(over: Record<number, Partial<DropTab>> = {}): DropTab[] {
  const base: DropTab[] = [
    { id: 1, index: 0, windowId: 1, groupId: -1, pinned: false },
    { id: 2, index: 1, windowId: 1, groupId: -1, pinned: false },
    { id: 3, index: 2, windowId: 1, groupId: -1, pinned: false },
    { id: 4, index: 3, windowId: 1, groupId: 10, pinned: false },
    { id: 5, index: 4, windowId: 1, groupId: 10, pinned: false },
    { id: 6, index: 5, windowId: 1, groupId: -1, pinned: false },
    { id: 7, index: 6, windowId: 1, groupId: -1, pinned: false },
  ];
  return base.map((t) => ({ ...t, ...over[t.id] }));
}

describe('computeDrop on a tab row', () => {
  it('moving forward accounts for the removed tab (after target)', () => {
    // Move tab 1 after tab 3: remaining [2,3,4,5,6,7] -> slot after 3 = 2
    const p = computeDrop(tabs(), [1], { kind: 'tab', tabId: 3, position: 'after' });
    expect(p).toMatchObject({ index: 2, groupId: null, tabIds: [1] });
  });

  it('moving forward before target', () => {
    const p = computeDrop(tabs(), [1], { kind: 'tab', tabId: 3, position: 'before' });
    expect(p?.index).toBe(1);
  });

  it('moving backward does not shift', () => {
    const p = computeDrop(tabs(), [7], { kind: 'tab', tabId: 2, position: 'before' });
    expect(p?.index).toBe(1);
  });

  it('dropping inside a group joins it', () => {
    const p = computeDrop(tabs(), [1], { kind: 'tab', tabId: 5, position: 'before' });
    // remaining [2,3,4,5,6,7]; before 5 -> 3
    expect(p).toMatchObject({ index: 3, groupId: 10 });
  });

  it('dropping next to an ungrouped tab leaves tabs ungrouped', () => {
    const p = computeDrop(tabs(), [4], { kind: 'tab', tabId: 6, position: 'after' });
    // remaining [1,2,3,5,6,7]; after 6 -> 5
    expect(p).toMatchObject({ index: 5, groupId: null });
  });

  it('multi-tab drag: several dragged tabs before the target shift it by their count', () => {
    const p = computeDrop(tabs(), [1, 2], { kind: 'tab', tabId: 6, position: 'before' });
    // remaining [3,4,5,6,7]; before 6 -> 3
    expect(p).toMatchObject({ index: 3, tabIds: [1, 2] });
  });

  it('multi-tab drag keeps visual order regardless of input order', () => {
    const p = computeDrop(tabs(), [7, 2], { kind: 'tab', tabId: 4, position: 'before' });
    expect(p?.tabIds).toEqual([2, 7]);
    // remaining [1,3,4,5,6]; before 4 -> 2
    expect(p?.index).toBe(2);
  });

  it('is a no-op when the target is inside the dragged selection', () => {
    expect(computeDrop(tabs(), [1, 2, 3], { kind: 'tab', tabId: 2, position: 'after' })).toBeNull();
  });

  it('returns null for unknown dragged ids', () => {
    expect(computeDrop(tabs(), [99], { kind: 'tab', tabId: 2, position: 'after' })).toBeNull();
  });
});

describe('computeDrop on a group header', () => {
  it('into appends after the last member and joins the group', () => {
    const p = computeDrop(tabs(), [1], { kind: 'group', groupId: 10, position: 'into' });
    // remaining [2,3,4,5,6,7]; members at 2,3 -> slot 4
    expect(p).toMatchObject({ index: 4, groupId: 10 });
  });

  it('into with a member dragged out of the same group', () => {
    const p = computeDrop(tabs(), [4], { kind: 'group', groupId: 10, position: 'into' });
    // remaining [1,2,3,5,6,7]; member 5 at 3 -> slot 4
    expect(p).toMatchObject({ index: 4, groupId: 10 });
  });

  it('before places ungrouped at the group start', () => {
    const p = computeDrop(tabs(), [7], { kind: 'group', groupId: 10, position: 'before' });
    expect(p).toMatchObject({ index: 3, groupId: null });
  });

  it('is a no-op if every member is dragged', () => {
    expect(computeDrop(tabs(), [4, 5], { kind: 'group', groupId: 10, position: 'into' })).toBeNull();
  });
});

describe('computeDrop into the ungrouped end zone', () => {
  it('moves to the end and ungroups', () => {
    const p = computeDrop(tabs(), [4, 5], { kind: 'end', windowId: 1 });
    expect(p).toMatchObject({ index: 5, groupId: null, tabIds: [4, 5] });
  });
});

describe('computeDrop with pinned tabs', () => {
  const pinned = tabs({
    1: { pinned: true },
    2: { pinned: true },
  });

  it('unpins pinned tabs dropped into a group', () => {
    const p = computeDrop(pinned, [1], { kind: 'tab', tabId: 5, position: 'before' });
    expect(p?.unpin).toEqual([1]);
    expect(p?.groupId).toBe(10);
  });

  it('reordering within the pinned zone keeps them pinned', () => {
    const p = computeDrop(pinned, [1], { kind: 'tab', tabId: 2, position: 'after' });
    expect(p).toMatchObject({ index: 1, groupId: null, unpin: [] });
  });

  it('never places unpinned tabs inside the pinned zone', () => {
    const p = computeDrop(pinned, [7], { kind: 'tab', tabId: 1, position: 'before' });
    expect(p?.index).toBe(2);
    expect(p?.unpin).toEqual([]);
  });

  it('after unpinning, the recomputed plan lands at the right slot', () => {
    // Tab 1 unpinned in place: still index 0 but no longer pinned.
    const after = tabs({ 2: { pinned: true } });
    const p = computeDrop(after, [1], { kind: 'tab', tabId: 6, position: 'before' });
    // remaining [2(p),3,4,5,6,7]; before 6 -> 4
    expect(p?.index).toBe(4);
  });
});

describe('computeDrop across windows', () => {
  const multi: DropTab[] = [
    ...tabs(),
    { id: 20, index: 0, windowId: 2, groupId: -1, pinned: false },
    { id: 21, index: 1, windowId: 2, groupId: -1, pinned: false },
  ];

  it('targets the window of the drop target without removal shift', () => {
    const p = computeDrop(multi, [1], { kind: 'tab', tabId: 21, position: 'before' });
    expect(p).toMatchObject({ windowId: 2, index: 1 });
  });

  it('end zone of another window', () => {
    const p = computeDrop(multi, [1, 2], { kind: 'end', windowId: 2 });
    expect(p).toMatchObject({ windowId: 2, index: 2, tabIds: [1, 2] });
  });
});

describe('computeGroupMove', () => {
  it('moving a group forward accounts for its removed tabs', () => {
    // remaining [1,2,3,6,7]; after tab 6 -> 4
    const p = computeGroupMove(tabs(), 10, { kind: 'tab', tabId: 6, position: 'after' });
    expect(p).toEqual({ groupId: 10, windowId: 1, index: 4 });
  });

  it('moving a group backward', () => {
    const p = computeGroupMove(tabs(), 10, { kind: 'tab', tabId: 1, position: 'before' });
    expect(p?.index).toBe(0);
  });

  it('target inside the group is a no-op', () => {
    expect(computeGroupMove(tabs(), 10, { kind: 'tab', tabId: 4, position: 'after' })).toBeNull();
  });

  it('snaps to the edge of another group when dropped on one of its tabs', () => {
    const t = tabs({ 1: { groupId: 11 }, 2: { groupId: 11 } });
    const p = computeGroupMove(t, 10, { kind: 'tab', tabId: 1, position: 'after' });
    // remaining [1,2,3,6,7]; group 11 members at 0,1 -> after = 2
    expect(p?.index).toBe(2);
  });

  it('end zone', () => {
    expect(computeGroupMove(tabs(), 10, { kind: 'end', windowId: 1 })?.index).toBe(5);
  });
});

function finalOrder(all: DropTab[], dragged: number[], target: DropTarget): Record<number, number[]> {
  const plan = computeDrop(all, dragged, target);
  if (!plan) throw new Error('no plan');
  return simulateMoves(all, planMoves(all, plan));
}

function strip(ids: string): DropTab[] {
  // e.g. "d1 x d2 y z" -> ids 1..5; names map to ids by position
  return ids.split(' ').map((_, i) => ({ id: i + 1, index: i, windowId: 1, groupId: -1, pinned: false }));
}

describe('planMoves', () => {
  it('forward drag within one window', () => {
    // [1 2 3 4 5], drag 1,2 after 4 -> [3 4 1 2 5]
    const all = strip('a b c d e');
    expect(finalOrder(all, [1, 2], { kind: 'tab', tabId: 4, position: 'after' })[1]).toEqual([3, 4, 1, 2, 5]);
  });

  it('backward drag', () => {
    const all = strip('a b c d e');
    expect(finalOrder(all, [4, 5], { kind: 'tab', tabId: 2, position: 'before' })[1]).toEqual([1, 4, 5, 2, 3]);
  });

  it('interleaved drag with dragged tabs on both sides of the target', () => {
    // [d1 x d2 y z] -> drag d1,d2 after y -> [x y d1 d2 z]
    const all = strip('d1 x d2 y z');
    expect(finalOrder(all, [1, 3], { kind: 'tab', tabId: 4, position: 'after' })[1]).toEqual([2, 4, 1, 3, 5]);
  });

  it('interleaved drag before the target', () => {
    const all = strip('d1 x d2 y z');
    expect(finalOrder(all, [1, 3], { kind: 'tab', tabId: 4, position: 'before' })[1]).toEqual([2, 1, 3, 4, 5]);
  });

  it('three dragged tabs scattered around the target', () => {
    // [a d1 b d2 c d3 e], drag d1,d2,d3 before c(5)... ids: a1 d1=2 b3 d2=4 c5 d3=6 e7
    const all = strip('a d1 b d2 c d3 e');
    expect(finalOrder(all, [2, 4, 6], { kind: 'tab', tabId: 5, position: 'before' })[1]).toEqual([1, 3, 2, 4, 6, 5, 7]);
    expect(finalOrder(all, [2, 4, 6], { kind: 'tab', tabId: 1, position: 'before' })[1]).toEqual([2, 4, 6, 1, 3, 5, 7]);
  });

  it('cross-window drag', () => {
    const all: DropTab[] = [
      ...strip('a b c'),
      { id: 20, index: 0, windowId: 2, groupId: -1, pinned: false },
      { id: 21, index: 1, windowId: 2, groupId: -1, pinned: false },
      { id: 22, index: 2, windowId: 2, groupId: -1, pinned: false },
    ];
    const r = finalOrder(all, [1, 3], { kind: 'tab', tabId: 21, position: 'after' });
    expect(r[1]).toEqual([2]);
    expect(r[2]).toEqual([20, 21, 1, 3, 22]);
  });

  it('drop into a group lands among its members', () => {
    // Window: [1 2 | g10: 3 4 | 5 6]; drag 1,6 before tab 4
    const all = tabs();
    const r = finalOrder(all, [1, 7], { kind: 'tab', tabId: 5, position: 'before' });
    expect(r[1]).toEqual([2, 3, 4, 1, 7, 5, 6]);
  });

  it('group header "into" appends after the last member', () => {
    const r = finalOrder(tabs(), [1, 7], { kind: 'group', groupId: 10, position: 'into' });
    expect(r[1]).toEqual([2, 3, 4, 5, 1, 7, 6]);
  });

  it('end zone', () => {
    const r = finalOrder(tabs(), [2, 4], { kind: 'end', windowId: 1 });
    expect(r[1]).toEqual([1, 3, 5, 6, 7, 2, 4]);
  });

  it('end zone of another window', () => {
    const all: DropTab[] = [...strip('a b c'), { id: 20, index: 0, windowId: 2, groupId: -1, pinned: false }];
    const r = finalOrder(all, [1, 3], { kind: 'end', windowId: 2 });
    expect(r[2]).toEqual([20, 1, 3]);
    expect(r[1]).toEqual([2]);
  });

  it('single tab drag matches the plan index', () => {
    const all = strip('a b c d e');
    const plan = computeDrop(all, [1], { kind: 'tab', tabId: 4, position: 'after' });
    expect(planMoves(all, plan!)).toEqual([{ tabId: 1, windowId: 1, index: 3 }]);
  });
});

describe('side-by-side pairs', () => {
  // tabs 2 and 3 are a pair
  const paired = () => tabs({ 2: { splitViewId: 5 }, 3: { splitViewId: 5 } });

  it('dragging one half moves the partner too', () => {
    const p = computeDrop(paired(), [3], { kind: 'tab', tabId: 7, position: 'after' });
    expect(p?.tabIds).toEqual([2, 3]);
    const order = simulateMoves(paired(), planMoves(paired(), p as NonNullable<typeof p>))[1];
    expect(order).toEqual([1, 4, 5, 6, 7, 2, 3]);
  });

  it('a drop between the halves snaps to after the pair', () => {
    const left = computeDrop(paired(), [1], { kind: 'tab', tabId: 2, position: 'after' });
    const right = computeDrop(paired(), [1], { kind: 'tab', tabId: 3, position: 'before' });
    const after = computeDrop(paired(), [1], { kind: 'tab', tabId: 3, position: 'after' });
    expect(left?.index).toBe(after?.index);
    expect(right?.index).toBe(after?.index);
  });

  it('dropping before the pair or after it is unaffected', () => {
    expect(computeDrop(paired(), [1], { kind: 'tab', tabId: 2, position: 'before' })?.index).toBe(0);
  });

  it('dropping on the partner of a dragged tab is a no-op', () => {
    expect(computeDrop(paired(), [2], { kind: 'tab', tabId: 3, position: 'after' })).toBeNull();
  });

  it('moving a pair into a group moves both', () => {
    const p = computeDrop(paired(), [2], { kind: 'group', groupId: 10, position: 'into' });
    expect(p).toMatchObject({ tabIds: [2, 3], groupId: 10 });
    const order = simulateMoves(paired(), planMoves(paired(), p as NonNullable<typeof p>))[1];
    expect(order.slice(0, 1)).toEqual([1]);
    expect(Math.abs(order.indexOf(2) - order.indexOf(3))).toBe(1);
  });
});
