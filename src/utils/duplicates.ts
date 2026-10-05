import { isRealPageUrl, normalizeUrlForDuplicate } from './url';

export interface DuplicateCandidate {
  id?: number;
  windowId: number;
  index: number;
  url?: string;
  pendingUrl?: string;
  active?: boolean;
  pinned?: boolean;
  lastAccessed?: number;
  /** Split View id; paired tabs are never closed automatically. */
  splitViewId?: number;
}

const isPaired = (t: DuplicateCandidate): boolean => (t.splitViewId ?? -1) !== -1;

export interface DuplicateCluster<T extends DuplicateCandidate> {
  key: string;
  tabs: T[];
}

/**
 * Group tabs by normalised URL. Only real-page URLs, only clusters of two or
 * more, ordered by first appearance (window, index). Tabs mid-navigation
 * (pendingUrl) are ignored.
 */
export function findDuplicateClusters<T extends DuplicateCandidate>(
  tabs: T[],
  extraIgnoredParams: string[] = []
): DuplicateCluster<T>[] {
  const sorted = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  const byKey = new Map<string, T[]>();
  for (const tab of sorted) {
    if (tab.pendingUrl || !isRealPageUrl(tab.url)) continue;
    const key = normalizeUrlForDuplicate(tab.url, extraIgnoredParams);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(tab);
    byKey.set(key, list);
  }
  return [...byKey]
    .filter(([, list]) => list.length >= 2)
    .map(([key, list]) => ({ key, tabs: list }));
}

/**
 * The tab to keep: the active tab in the focused window, else any active tab,
 * else the most recently accessed, else the lowest (windowId, index).
 */
export function pickKeeper<T extends DuplicateCandidate>(
  cluster: DuplicateCluster<T>,
  focusedWindowId?: number
): T {
  const tabs = cluster.tabs;
  const active = tabs.filter((t) => t.active);
  const inFocused = active.find((t) => t.windowId === focusedWindowId);
  if (inFocused) return inFocused;
  if (active.length > 0) return active[0];
  const accessed = tabs.filter((t) => t.lastAccessed !== undefined);
  if (accessed.length > 0) return accessed.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
  return [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)[0];
}

/** Tabs to close for a cluster: everything except the keeper; pinned and side-by-side tabs are never closed. */
export function tabsToClose<T extends DuplicateCandidate>(
  cluster: DuplicateCluster<T>,
  focusedWindowId?: number
): T[] {
  const keeper = pickKeeper(cluster, focusedWindowId);
  return cluster.tabs.filter((t) => t !== keeper && !t.pinned && !isPaired(t));
}

/** Σ (size − 1) over clusters. */
export function duplicateCount<T extends DuplicateCandidate>(clusters: DuplicateCluster<T>[]): number {
  return clusters.reduce((n, c) => n + c.tabs.length - 1, 0);
}

/** Existing tab to point a duplicate at: prefer the same window, then most recently accessed. */
export function pickExistingTab<T extends DuplicateCandidate>(candidates: T[], windowId: number): T | undefined {
  return [...candidates].sort((a, b) => {
    const sameA = a.windowId === windowId ? 1 : 0;
    const sameB = b.windowId === windowId ? 1 : 0;
    return sameB - sameA || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
  })[0];
}

/** Tabs to close to keep only `keep` from its cluster; pinned tabs are never closed. */
export function otherCopiesToClose<T extends DuplicateCandidate>(cluster: DuplicateCluster<T>, keep: T): T[] {
  return cluster.tabs.filter((t) => t !== keep && !t.pinned && !isPaired(t));
}
