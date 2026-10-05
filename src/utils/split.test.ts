import { describe, expect, it } from 'vitest';
import {
  chromeMajor,
  splitAvailabilityText,
  expandSelectionWithPartners, nextSplitFix, pairsIn, partnerOf, splitSupported,
  type SplitTab,
} from './split';

function t(id: number, index: number, over: Partial<SplitTab> = {}): SplitTab & { id: number } {
  return { id, index, windowId: 1, groupId: -1, pinned: false, splitViewId: -1, ...over };
}

describe('pair helpers', () => {
  const tabs = [t(1, 0), t(2, 1, { splitViewId: 7 }), t(3, 2, { splitViewId: 7 }), t(4, 3)];

  it('finds the partner', () => {
    expect(partnerOf(tabs[1], tabs)?.id).toBe(3);
    expect(partnerOf(tabs[2], tabs)?.id).toBe(2);
    expect(partnerOf(tabs[0], tabs)).toBeUndefined();
  });
  it('expands selections with partners, no duplicates, partner right after', () => {
    expect(expandSelectionWithPartners([2], tabs)).toEqual([2, 3]);
    expect(expandSelectionWithPartners([4, 3, 2], tabs)).toEqual([4, 3, 2]);
    expect(expandSelectionWithPartners([1, 3], tabs)).toEqual([1, 3, 2]);
  });
  it('lists pairs left to right', () => {
    const more = [...tabs, t(5, 0, { windowId: 2, splitViewId: 9 }), t(6, 1, { windowId: 2, splitViewId: 9 })];
    expect(pairsIn(more).map((p) => p.map((x) => x.id))).toEqual([[2, 3], [5, 6]]);
  });
  it('ignores a half whose partner is missing', () => {
    expect(pairsIn([t(2, 1, { splitViewId: 7 })])).toEqual([]);
  });
  it('is unsupported without the API', () => {
    expect(splitSupported()).toBe(false);
  });
});

describe('nextSplitFix', () => {
  it('is ready when adjacent with matching state', () => {
    expect(nextSplitFix(t(1, 3), t(2, 4))).toEqual({ kind: 'ready', ids: [1, 2] });
    expect(nextSplitFix(t(1, 3), t(2, 2))).toEqual({ kind: 'ready', ids: [2, 1] });
  });
  it('reports already paired', () => {
    expect(nextSplitFix(t(1, 3, { splitViewId: 5 }), t(2, 4, { splitViewId: 5 }))).toEqual({ kind: 'already' });
  });
  it('unsplits either tab first', () => {
    expect(nextSplitFix(t(1, 3, { splitViewId: 5 }), t(2, 9))).toEqual({ kind: 'unsplit', splitViewId: 5 });
    expect(nextSplitFix(t(1, 3), t(2, 4, { splitViewId: 6 }))).toEqual({ kind: 'unsplit', splitViewId: 6 });
  });
  it('matches pinned state before moving', () => {
    expect(nextSplitFix(t(1, 0, { pinned: true }), t(2, 5))).toEqual({ kind: 'pin', tabId: 2, pinned: true });
    expect(nextSplitFix(t(1, 5), t(2, 0, { pinned: true }))).toEqual({ kind: 'pin', tabId: 2, pinned: false });
  });
  it('moves the other tab next to the anchor (post-removal index)', () => {
    expect(nextSplitFix(t(1, 5), t(2, 1))).toEqual({ kind: 'move', tabId: 2, windowId: 1, index: 5 });
    expect(nextSplitFix(t(1, 2), t(2, 8))).toEqual({ kind: 'move', tabId: 2, windowId: 1, index: 3 });
  });
  it('moves across windows', () => {
    expect(nextSplitFix(t(1, 2), t(2, 0, { windowId: 4 }))).toEqual({ kind: 'move', tabId: 2, windowId: 1, index: 3 });
  });
  it('matches the group once adjacent', () => {
    expect(nextSplitFix(t(1, 2, { groupId: 8 }), t(2, 3))).toEqual({ kind: 'group', tabId: 2, groupId: 8 });
    expect(nextSplitFix(t(1, 2), t(2, 3, { groupId: 8 }))).toEqual({ kind: 'group', tabId: 2, groupId: -1 });
  });
});

describe('chromeMajor / splitAvailabilityText', () => {
  it('reads the Chrome major version', () => {
    expect(chromeMajor('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/154.0.8037.58 Safari/537.36')).toBe(154);
    expect(chromeMajor('Mozilla/5.0 Firefox/140.0')).toBeNull();
  });
  it('explains why side by side is missing', () => {
    expect(splitAvailabilityText(true, 155)).toBe('Available');
    expect(splitAvailabilityText(false, 154)).toBe('Needs Chrome 155 (you have 154)');
    expect(splitAvailabilityText(false, 156)).toBe('Not available in this browser');
    expect(splitAvailabilityText(false, null)).toBe('Not available in this browser');
  });
});
