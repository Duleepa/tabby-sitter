/**
 * Typed message contracts passed over chrome.runtime between the
 * background service worker, popup, and content scripts.
 */

export interface DuplicateConfirmData {
  newTabId: number;
  existingTabId: number;
  url: string;
}

export type RuntimeMessage =
  | { action: 'organizeAllTabs' }
  | { action: 'switchToExisting'; existingTabId: number; newTabId: number }
  | { action: 'showDuplicateConfirm'; data: DuplicateConfirmData };

export interface OrganizeResponse {
  success: boolean;
  error?: string;
}
