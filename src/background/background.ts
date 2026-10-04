import { getRules, getActiveRules, matchesRule } from '../storage/rules';
import { getSettings } from '../storage/config';
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

async function processTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.windowId) return;

  let freshTab: chrome.tabs.Tab;
  try {
    freshTab = await chrome.tabs.get(tab.id);
  } catch {
    return;
  }
  if (!freshTab.url) return;

  const rules = getActiveRules(await getRules());
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));

  const matchedRule = rules.find((r) => matchesRule(freshTab.url!, r)) ?? null;
  const currentGroupId = freshTab.groupId ?? -1;

  let currentGroupTitle: string | undefined;
  if (currentGroupId !== -1) {
    try {
      currentGroupTitle = (await chrome.tabGroups.get(currentGroupId)).title;
    } catch {
      /* group closed */
    }
  }
  const isAutoManaged = !!currentGroupTitle && ruleGroupNames.has(currentGroupTitle);

  if (matchedRule) {
    if (currentGroupTitle === matchedRule.groupName) return;

    let groupId = await findGroupInWindow(matchedRule.groupName, freshTab.windowId);
    if (groupId === -1) {
      groupId = await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: freshTab.id! })
      );
      await chrome.tabGroups.update(groupId, {
        title: matchedRule.groupName,
        color: matchedRule.color || 'blue',
      });
    } else {
      await retryTabMutation(() => chrome.tabs.move(freshTab.id!, { index: -1 }));
      await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: freshTab.id!, groupId })
      );
    }

    console.log(
      `[Background] Tab ${freshTab.id} moved to group "${matchedRule.groupName}" in window ${freshTab.windowId}`
    );
    return;
  }

  if (currentGroupId !== -1 && isAutoManaged) {
    await retryTabMutation(() => chrome.tabs.ungroup(freshTab.id!));
    console.log(`[Background] Tab ${freshTab.id} ungrouped (no matching rule)`);
  }
}

export async function organizeAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length === 0) return;

  const windowId = tabs[0].windowId;
  const rules = getActiveRules(await getRules());
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));

  const groups = await chrome.tabGroups.query({ windowId });
  const groupNameToId = new Map<string, number>();
  const groupIdToTitle = new Map<number, string>();
  for (const group of groups) {
    if (group.title) {
      groupNameToId.set(group.title, group.id);
      groupIdToTitle.set(group.id, group.title);
    }
  }

  const tabsToGroup = new Map<string, number[]>();
  const tabsToUngroup: number[] = [];

  for (const tab of tabs) {
    if (!tab.id || !tab.url || isSkippableUrl(tab.url)) continue;

    const matchedRule = rules.find((r) => matchesRule(tab.url!, r)) ?? null;
    const currentGroupId = tab.groupId ?? -1;
    const currentGroupTitle = groupIdToTitle.get(currentGroupId) || '';
    const isAutoManaged = !!currentGroupTitle && ruleGroupNames.has(currentGroupTitle);

    if (matchedRule) {
      if (currentGroupTitle === matchedRule.groupName) continue;
      if (!tabsToGroup.has(matchedRule.groupName)) {
        tabsToGroup.set(matchedRule.groupName, []);
      }
      tabsToGroup.get(matchedRule.groupName)!.push(tab.id);
    } else if (currentGroupId !== -1 && isAutoManaged) {
      tabsToUngroup.push(tab.id);
    }
  }

  for (const [groupName, tabIds] of tabsToGroup) {
    if (tabIds.length === 0) continue;

    let groupId = groupNameToId.get(groupName) ?? -1;

    if (groupId === -1) {
      const rule = rules.find((r) => r.groupName === groupName)!;
      groupId = await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: [tabIds[0]] })
      );
      await chrome.tabGroups.update(groupId, {
        title: rule.groupName,
        color: rule.color || 'blue',
      });
      groupNameToId.set(groupName, groupId);

      if (tabIds.length > 1) {
        await retryTabMutation(() =>
          chrome.tabs.group({ tabIds: tabIds.slice(1), groupId })
        );
      }
    } else {
      await retryTabMutation(() =>
        chrome.tabs.group({ tabIds, groupId })
      );
    }
  }

  if (tabsToUngroup.length > 0) {
    await retryTabMutation(() => chrome.tabs.ungroup(tabsToUngroup));
  }

  const settings = await getSettings();
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

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
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
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'organizeAllTabs') {
    organizeAllTabs()
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Background] organizeAllTabs failed', err);
        sendResponse({ success: false, error: String(err) });
      });
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
    organizeAllTabs();
  }
});
