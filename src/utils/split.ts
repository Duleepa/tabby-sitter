// Chrome Split View (side-by-side tabs), Chrome 155+. Not in @types/chrome, so this is a typed shim
// plus pure helpers. No permission is needed. When the API is missing, every split UI element is absent.

/** The tab fields the split helpers read. `splitViewId` is -1 (or absent) when the tab is not split. */
export interface SplitTab {
  id?: number;
  index: number;
  windowId: number;
  groupId: number;
  pinned: boolean;
  splitViewId?: number;
}

interface SplitApi {
  createSplit(tabIds: [number, number]): Promise<unknown>;
  unsplit(splitViewId: number): Promise<void>;
}

// Fields Chrome 155+ adds (absent from @types/chrome 0.0.326).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- merging into @types/chrome's namespace
  namespace chrome.tabs {
    interface Tab {
      splitViewId?: number;
    }
    interface CreateProperties {
      splitWithTabId?: number;
    }
  }
}

const api = (): Partial<SplitApi> => ((typeof chrome !== 'undefined' && chrome.tabs) || {}) as Partial<SplitApi>;

/** First Chrome version with the Split View API for extensions. */
export const SPLIT_MIN_CHROME = 155;

/** Pure: Chrome's major version from a user-agent string, or null if it isn't Chrome-based. */
export function chromeMajor(userAgent: string): number | null {
  const m = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent);
  return m ? Number(m[1]) : null;
}

/** Pure: the one-line Settings summary for side by side. */
export function splitAvailabilityText(supported: boolean, major: number | null): string {
  if (supported) return 'Available';
  return major !== null && major < SPLIT_MIN_CHROME
    ? `Needs Chrome ${SPLIT_MIN_CHROME} (you have ${major})`
    : 'Not available in this browser';
}

export function splitSupported(): boolean {
  return typeof chrome !== 'undefined' && typeof api().createSplit === 'function' && typeof api().unsplit === 'function';
}

export function splitIdOf(tab: { splitViewId?: number }): number {
  return tab.splitViewId ?? -1;
}

export function isSplit(tab: { splitViewId?: number }): boolean {
  return splitIdOf(tab) !== -1;
}

export async function createSplit(tabIds: [number, number]): Promise<void> {
  const fn = api().createSplit;
  if (!fn) throw new Error('Side-by-side tabs are not supported in this version of Chrome');
  await fn.call(chrome.tabs, tabIds);
}

export async function unsplit(splitViewId: number): Promise<void> {
  const fn = api().unsplit;
  if (!fn) throw new Error('Side-by-side tabs are not supported in this version of Chrome');
  await fn.call(chrome.tabs, splitViewId);
}

/** Open a new tab beside `tabId` (right by default, left when `side` is 'left'), already split with it. */
export async function createSplitWithNewTab(tab: SplitTab & { id: number }, side: 'left' | 'right' = 'right'): Promise<void> {
  const props: chrome.tabs.CreateProperties = { splitWithTabId: tab.id, windowId: tab.windowId };
  if (side === 'left') props.index = tab.index;
  await chrome.tabs.create(props);
}

/** The other half of this tab's pair, if both are present in `tabs`. */
export function partnerOf<T extends SplitTab>(tab: T, tabs: T[]): T | undefined {
  const sid = splitIdOf(tab);
  if (sid === -1) return undefined;
  return tabs.find((t) => t.id !== tab.id && splitIdOf(t) === sid);
}

/** `ids` plus the partner of each paired tab, partner placed right after its tab, no duplicates. */
export function expandSelectionWithPartners<T extends SplitTab>(ids: number[], tabs: T[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of ids) {
    push(id);
    const tab = tabs.find((t) => t.id === id);
    const partner = tab ? partnerOf(tab, tabs) : undefined;
    if (partner?.id !== undefined) push(partner.id);
  }
  return out;
}

/** Every pair as [left, right] (by window, then index). */
export function pairsIn<T extends SplitTab>(tabs: T[]): [T, T][] {
  const bySplit = new Map<number, T[]>();
  for (const t of tabs) {
    const sid = splitIdOf(t);
    if (sid === -1) continue;
    const list = bySplit.get(sid) ?? [];
    list.push(t);
    bySplit.set(sid, list);
  }
  const pairs: [T, T][] = [];
  for (const list of bySplit.values()) {
    if (list.length !== 2) continue;
    const [a, b] = list.sort((x, y) => x.windowId - y.windowId || x.index - y.index);
    pairs.push([a, b]);
  }
  return pairs.sort((p, q) => p[0].windowId - q[0].windowId || p[0].index - q[0].index);
}

export type SplitFix =
  | { kind: 'already' }
  | { kind: 'unsplit'; splitViewId: number }
  | { kind: 'pin'; tabId: number; pinned: boolean }
  | { kind: 'move'; tabId: number; windowId: number; index: number }
  | { kind: 'group'; tabId: number; groupId: number }
  | { kind: 'ready'; ids: [number, number] };

/**
 * The next thing to fix before `createSplit([anchor, other])` can work, judged against a fresh snapshot of
 * both tabs. Apply the fix, re-query, ask again, until 'ready' (or 'already' when they are a pair).
 * Order: unsplit -> pinned state -> window + adjacency -> group. The anchor never moves; `other` does.
 */
export function nextSplitFix(anchor: SplitTab & { id: number }, other: SplitTab & { id: number }): SplitFix {
  if (anchor.id === other.id) return { kind: 'already' };
  if (isSplit(anchor) && splitIdOf(anchor) === splitIdOf(other)) return { kind: 'already' };
  if (isSplit(anchor)) return { kind: 'unsplit', splitViewId: splitIdOf(anchor) };
  if (isSplit(other)) return { kind: 'unsplit', splitViewId: splitIdOf(other) };
  if (other.pinned !== anchor.pinned) return { kind: 'pin', tabId: other.id, pinned: anchor.pinned };
  const sameWindow = other.windowId === anchor.windowId;
  const adjacent = sameWindow && Math.abs(other.index - anchor.index) === 1;
  if (!adjacent) {
    // chrome.tabs.move indices are post-removal: a tab coming from the left lands at anchor.index.
    const index = sameWindow && other.index < anchor.index ? anchor.index : anchor.index + 1;
    return { kind: 'move', tabId: other.id, windowId: anchor.windowId, index };
  }
  if (other.groupId !== anchor.groupId) return { kind: 'group', tabId: other.id, groupId: anchor.groupId };
  const [left, right] = anchor.index < other.index ? [anchor.id, other.id] : [other.id, anchor.id];
  return { kind: 'ready', ids: [left, right] };
}
