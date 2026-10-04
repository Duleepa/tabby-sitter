export interface DuplicateNotice {
  id: string;
  kind: 'closed' | 'flagged';
  /** The flagged tab (flagged notices only). */
  tabId?: number;
  existingTabId: number;
  url: string;
  title?: string;
  windowId: number;
  index?: number;
  at: number;
}

export const NOTICE_MAX = 5;
export const NOTICE_TTL_MS = 60000;

/** Drop notices older than the TTL and keep only the newest NOTICE_MAX. */
export function pruneNotices(notices: DuplicateNotice[], now: number): DuplicateNotice[] {
  return notices.filter((n) => now - n.at <= NOTICE_TTL_MS).slice(-NOTICE_MAX);
}

/** Append a notice; a newer flagged notice for the same tab replaces the older one. */
export function addNoticeTo(notices: DuplicateNotice[], notice: DuplicateNotice, now: number): DuplicateNotice[] {
  const rest =
    notice.kind === 'flagged' && notice.tabId !== undefined
      ? notices.filter((n) => !(n.kind === 'flagged' && n.tabId === notice.tabId))
      : notices;
  return pruneNotices([...rest, notice], now);
}

/** Remove flagged notices for a tab (it closed or navigated away). */
export function removeFlaggedForTab(notices: DuplicateNotice[], tabId: number): DuplicateNotice[] {
  return notices.filter((n) => !(n.kind === 'flagged' && n.tabId === tabId));
}
