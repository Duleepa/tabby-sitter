import { getRules, getActiveRules, type GroupRule } from '../storage/rules';
import { getSettings } from '../storage/config';
import { addOverrides, clearOverrides, getOverrides } from '../storage/overrides';
import { decideTabAction, type TabAction } from './decide';
import { ExpectedGroupChanges } from './expected-changes';
import { retryTabMutation } from '../utils/tabs';
import { isRealPageUrl, isSkippableUrl, normalizeUrlForDuplicate } from '../utils/url';

console.log('[Background] Tabby Sitter started.');

function enableSidePanelOnActionClick(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[Background] setPanelBehavior failed', err));
}

enableSidePanelOnActionClick();
chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain);
}

const FRESH_TAB_TTL_MS = 15000;
const FRESH_TABS_KEY = 'freshTabs';

// tabId -> creation time. In-memory mirror of chrome.storage.session so a
// service worker restart doesn't lose track of fresh tabs.
const freshTabs = new Map<number, number>();
let freshTabsLoaded: Promise<void> | null = null;

function loadFreshTabs(): Promise<void> {
  freshTabsLoaded ??= (async () => {
    try {
      const result = await chrome.storage.session.get<{ freshTabs?: Record<string, number> }>(FRESH_TABS_KEY);
      for (const [id, created] of Object.entries(result.freshTabs ?? {})) {
        if (!freshTabs.has(Number(id))) freshTabs.set(Number(id), created);
      }
    } catch (err) {
      console.warn('[Background] Failed to load fresh tabs', err);
    }
  })();
  return freshTabsLoaded;
}

function persistFreshTabs(): void {
  const now = Date.now();
  for (const [id, created] of freshTabs) {
    if (now - created > FRESH_TAB_TTL_MS) freshTabs.delete(id);
  }
  chrome.storage.session
    .set({ [FRESH_TABS_KEY]: Object.fromEntries(freshTabs) })
    .catch((err) => console.warn('[Background] Failed to persist fresh tabs', err));
}

async function markTabFresh(tabId: number): Promise<void> {
  await loadFreshTabs();
  freshTabs.set(tabId, Date.now());
  persistFreshTabs();
}

async function forgetFreshTab(tabId: number): Promise<void> {
  await loadFreshTabs();
  if (freshTabs.delete(tabId)) persistFreshTabs();
}

/**
 * Returns true exactly once per fresh tab: the first time it is evaluated
 * with a real URL, provided it is within the TTL. The check and delete run
 * synchronously after the load await, so concurrent callers cannot both win.
 */
async function consumeFreshTab(tabId: number): Promise<boolean> {
  await loadFreshTabs();
  const created = freshTabs.get(tabId);
  if (created === undefined) return false;
  freshTabs.delete(tabId);
  persistFreshTabs();
  return Date.now() - created <= FRESH_TAB_TTL_MS;
}

const CREATED_TTL_MS = 5000;
const NEW_TAB_GRACE_MS = 1500;
const CREATED_KEY = 'tabCreated';

// tabId -> creation time (kept after the fresh-tab entry is consumed), mirrored
// to chrome.storage.session. Used to ignore Chrome's native "opened from a
// grouped tab joins that group" change.
const createdAt = new Map<number, number>();
let createdLoaded: Promise<void> | null = null;

function loadCreated(): Promise<void> {
  createdLoaded ??= (async () => {
    try {
      const result = await chrome.storage.session.get<{ tabCreated?: Record<string, number> }>(CREATED_KEY);
      for (const [id, t] of Object.entries(result.tabCreated ?? {})) {
        if (!createdAt.has(Number(id))) createdAt.set(Number(id), t);
      }
    } catch (err) {
      console.warn('[Background] Failed to load creation times', err);
    }
  })();
  return createdLoaded;
}

function persistCreated(): void {
  const now = Date.now();
  for (const [id, t] of createdAt) if (now - t > CREATED_TTL_MS) createdAt.delete(id);
  chrome.storage.session
    .set({ [CREATED_KEY]: Object.fromEntries(createdAt) })
    .catch((err) => console.warn('[Background] Failed to persist creation times', err));
}

async function recordCreated(tabId: number): Promise<void> {
  await loadCreated();
  createdAt.set(tabId, Date.now());
  persistCreated();
}

async function wasJustCreated(tabId: number): Promise<boolean> {
  await loadCreated();
  const t = createdAt.get(tabId);
  return t !== undefined && Date.now() - t < NEW_TAB_GRACE_MS;
}

// Group changes the extension is about to cause (in-memory, ~3 s).
const expectedChanges = new ExpectedGroupChanges();

async function groupTabs(options: { tabIds: number | number[]; groupId?: number }): Promise<number> {
  expectedChanges.expect(options.tabIds);
  const tabIds = options.tabIds as [number, ...number[]];
  return retryTabMutation(() =>
    chrome.tabs.group(options.groupId === undefined ? { tabIds } : { tabIds, groupId: options.groupId })
  );
}

async function ungroupTabs(tabIds: number | number[]): Promise<void> {
  expectedChanges.expect(tabIds);
  await retryTabMutation(() => chrome.tabs.ungroup(tabIds as [number, ...number[]]));
}

async function handleGroupChange(tabId: number, newGroupId: number): Promise<void> {
  if (expectedChanges.consume(tabId)) return;
  if (await wasJustCreated(tabId)) return;
  try {
    await chrome.tabs.get(tabId);
    if (newGroupId !== -1) await chrome.tabGroups.get(newGroupId);
  } catch {
    return; // tab or group is gone
  }
  await addOverrides([tabId]);
  console.log(`[Background] Tab ${tabId} placed manually (group ${newGroupId}); rules will leave it alone`);
}

function waitForTabReady(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 150);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 150);
      }
    }).catch(() => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab not found'));
    });
  });
}

async function switchToExistingAndClose(existingTabId: number, newTabId: number): Promise<void> {
  const existing = await chrome.tabs.get(existingTabId);
  await chrome.tabs.update(existingTabId, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
  await retryTabMutation(async () => {
    await chrome.tabs.remove(newTabId);
  });
}

async function handleDuplicateTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id || !isRealPageUrl(tab.url)) return false;

  // Only fresh tabs may be auto-closed; this also ensures one evaluation per tab.
  if (!(await consumeFreshTab(tab.id))) return false;

  const settings = await getSettings();

  if (settings.duplicateTabMode === 'allow') return false;

  const normalized = normalizeUrlForDuplicate(tab.url);
  if (!normalized) return false;

  const allTabs = await chrome.tabs.query({});
  const existingTab = allTabs.find(
    (t) =>
      t.id !== tab.id &&
      !t.pendingUrl &&
      !!t.url &&
      normalizeUrlForDuplicate(t.url) === normalized
  );
  if (!existingTab || !existingTab.id) return false;

  if (settings.duplicateTabMode === 'prevent-specific') {
    try {
      const hostname = new URL(tab.url).hostname.toLowerCase();
      const domains = parseDomains(settings.duplicateTabDomains);
      if (!domains.some((d) => hostnameMatchesDomain(hostname, d))) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const newTabId = tab.id;
  const existingTabId = existingTab.id;

  if (settings.duplicateTabConfirm) {
    try {
      await waitForTabReady(newTabId);
      await chrome.tabs.sendMessage(newTabId, {
        action: 'showDuplicateConfirm',
        data: { newTabId, existingTabId, url: tab.url },
      });
    } catch (err) {
      console.warn('[Background] Failed to show confirmation bar, auto-closing:', err);
      await switchToExistingAndClose(existingTabId, newTabId);
    }
    return true;
  }

  await switchToExistingAndClose(existingTabId, newTabId);
  console.log(`[Background] Switched to existing tab ${existingTabId}, closed duplicate ${newTabId}`);
  return true;
}


async function findGroupInWindow(
  groupName: string,
  windowId: number
): Promise<number> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => g.title === groupName)?.id ?? -1;
}

async function groupTitleOf(groupId: number): Promise<string | undefined> {
  if (groupId === -1) return undefined;
  try {
    return (await chrome.tabGroups.get(groupId)).title;
  } catch {
    return undefined; // group closed
  }
}

async function processTab(tab: Pick<chrome.tabs.Tab, 'id'>): Promise<void> {
  if (!tab.id) return;

  let freshTab: chrome.tabs.Tab;
  try {
    freshTab = await chrome.tabs.get(tab.id);
  } catch {
    return;
  }
  const tabId = freshTab.id;
  if (tabId === undefined || !freshTab.url) return;

  const [allRules, settings, overrides] = await Promise.all([getRules(), getSettings(), getOverrides()]);
  const currentGroupId = freshTab.groupId ?? -1;

  let keepWithOpener = false;
  if (settings.keepOpenedTabsInGroup && currentGroupId !== -1 && freshTab.openerTabId !== undefined) {
    try {
      keepWithOpener = (await chrome.tabs.get(freshTab.openerTabId)).groupId === currentGroupId;
    } catch {
      /* opener closed */
    }
  }

  const action = decideTabAction({
    url: freshTab.url,
    rules: getActiveRules(allRules),
    currentGroupTitle: await groupTitleOf(currentGroupId),
    manual: overrides.has(tabId),
    keepWithOpener,
  });

  if (action.kind === 'group') {
    const rule = action.rule;
    let groupId = await findGroupInWindow(rule.groupName, freshTab.windowId);
    if (groupId === -1) {
      groupId = await groupTabs({ tabIds: tabId });
      await chrome.tabGroups.update(groupId, { title: rule.groupName, color: rule.color || 'blue' });
    } else {
      // Moving a grouped tab can implicitly change its group; expect that too.
      expectedChanges.expect(tabId);
      await retryTabMutation(() => chrome.tabs.move(tabId, { index: -1 }));
      await groupTabs({ tabIds: tabId, groupId });
    }
    console.log(`[Background] Tab ${tabId} moved to group "${rule.groupName}" in window ${freshTab.windowId}`);
  } else if (action.kind === 'ungroup') {
    await ungroupTabs(tabId);
    console.log(`[Background] Tab ${tabId} ungrouped (no matching rule)`);
  }
}

export interface OrganizeOptions {
  /** Window to organize; defaults to the current (focused) window. */
  windowId?: number;
  /** Organize every normal window. */
  allWindows?: boolean;
}

export async function organizeAllTabs(options: OrganizeOptions = {}): Promise<void> {
  if (options.allWindows) {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const w of windows) {
      if (w.id !== undefined) await organizeWindow(w.id);
    }
    return;
  }
  let windowId = options.windowId;
  if (windowId === undefined) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length === 0) return;
    windowId = tabs[0].windowId;
  }
  await organizeWindow(windowId);
}

async function organizeWindow(windowId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length === 0) return;

  const [allRules, settings, overrides] = await Promise.all([getRules(), getSettings(), getOverrides()]);
  const rules = getActiveRules(allRules);

  const groups = await chrome.tabGroups.query({ windowId });
  const groupNameToId = new Map<string, number>();
  const groupIdToTitle = new Map<number, string>();
  for (const group of groups) {
    if (group.title) {
      groupNameToId.set(group.title, group.id);
      groupIdToTitle.set(group.id, group.title);
    }
  }
  const tabById = new Map(tabs.map((t) => [t.id, t]));

  const tabsToGroup = new Map<string, { rule: GroupRule; ids: number[] }>();
  const tabsToUngroup: number[] = [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url || isSkippableUrl(tab.url)) continue;

    const currentGroupId = tab.groupId ?? -1;
    const opener = tab.openerTabId !== undefined ? tabById.get(tab.openerTabId) : undefined;
    const action: TabAction = decideTabAction({
      url: tab.url,
      rules,
      currentGroupTitle: groupIdToTitle.get(currentGroupId),
      manual: overrides.has(tab.id),
      keepWithOpener: settings.keepOpenedTabsInGroup && currentGroupId !== -1 && opener?.groupId === currentGroupId,
    });

    if (action.kind === 'group') {
      const entry = tabsToGroup.get(action.rule.groupName) ?? { rule: action.rule, ids: [] };
      entry.ids.push(tab.id);
      tabsToGroup.set(action.rule.groupName, entry);
    } else if (action.kind === 'ungroup') {
      tabsToUngroup.push(tab.id);
    }
  }

  for (const [groupName, { rule, ids }] of tabsToGroup) {
    let groupId = groupNameToId.get(groupName) ?? -1;

    if (groupId === -1) {
      groupId = await groupTabs({ tabIds: [ids[0]] });
      await chrome.tabGroups.update(groupId, { title: rule.groupName, color: rule.color || 'blue' });
      groupNameToId.set(groupName, groupId);
      if (ids.length > 1) await groupTabs({ tabIds: ids.slice(1), groupId });
    } else {
      await groupTabs({ tabIds: ids, groupId });
    }
  }

  if (tabsToUngroup.length > 0) {
    await ungroupTabs(tabsToUngroup);
  }

  if (settings.groupUnmatchedByDomain) {
    await new Promise((r) => setTimeout(r, 200));
    const freshTabs = await chrome.tabs.query({ windowId });
    await sortUnmatchedByDomain(freshTabs);
  }
}

async function sortUnmatchedByDomain(tabs: chrome.tabs.Tab[]): Promise<void> {
  const unmatched: { id: number; hostname: string }[] = [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url || isSkippableUrl(tab.url)) continue;
    if (tab.groupId !== -1) continue;

    try {
      const hostname = new URL(tab.url).hostname;
      unmatched.push({ id: tab.id, hostname });
    } catch {
      continue;
    }
  }

  unmatched.sort((a, b) => a.hostname.localeCompare(b.hostname));

  for (const tab of unmatched) {
    await retryTabMutation(() =>
      chrome.tabs.move(tab.id, { index: -1 })
    );
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.groupId !== undefined) {
    handleGroupChange(tabId, changeInfo.groupId).catch((err) =>
      console.error('[Background] handleGroupChange failed', err)
    );
  }
  if (changeInfo.url && tab.id) {
    handleDuplicateTab(tab).then((handled) => {
      if (handled) return;
      processTab(tab).catch((err) =>
        console.error('[Background] processTab failed on onUpdated', err)
      );
    }).catch((err) =>
      console.error('[Background] handleDuplicateTab failed on onUpdated', err)
    );
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id) return;
  const tabId = tab.id;
  recordCreated(tabId).catch(() => {});
  markTabFresh(tabId).then(() => {
    // Link-opened tabs often have an empty url (only pendingUrl); the real URL
    // is evaluated when it arrives via onUpdated.
    if (!tab.url) return;
    return handleDuplicateTab(tab).then((handled) => {
      if (handled) return;
      setTimeout(() => {
        processTab(tab).catch((err) =>
          console.error('[Background] processTab failed on onCreated', err)
        );
      }, 100);
    });
  }).catch((err) =>
    console.error('[Background] handleDuplicateTab failed', err)
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetFreshTab(tabId).catch(() => {});
  expectedChanges.forget(tabId);
  clearOverrides([tabId]).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'organizeAllTabs') {
    const { windowId, allWindows } = request as OrganizeOptions;
    organizeAllTabs({ windowId, allWindows })
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Background] organizeAllTabs failed', err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }
  if (request.action === 'processTabs') {
    const { tabIds } = request as { tabIds: number[] };
    (async () => {
      for (const id of tabIds) {
        try {
          await processTab({ id });
        } catch (err) {
          console.error('[Background] processTabs failed for tab', id, err);
        }
      }
    })()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  if (request.action === 'switchToExisting') {
    const { existingTabId, newTabId } = request as { existingTabId: number; newTabId: number };
    switchToExistingAndClose(existingTabId, newTabId)
      .catch((err) => {
        console.error('[Background] switchToExisting failed', err);
      });
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'organize-tabs') {
    organizeAllTabs().catch((err) => console.error('[Background] organize command failed', err));
  }
});
