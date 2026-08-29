import { getRules, getActiveRules, matchesRule } from '../storage/rules';
import { getSettings } from '../storage/config';
import type { RuntimeMessage, OrganizeResponse } from '../storage/messages';

console.log('[Background] Tabby Sitter started.');

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain);
}

const DUPLICATE_SKIP_PREFIXES = ['chrome://', 'about:blank', 'about:newtab', 'edge://', 'brave://'];

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
  await chrome.tabs.update(existingTabId, { active: true });
  await retryTabMutation(async () => {
    await chrome.tabs.remove(newTabId);
  });
}

async function handleDuplicateTab(tab: chrome.tabs.Tab): Promise<boolean> {
  const { id: newTabId, url, windowId } = tab;
  if (!newTabId || !url || !windowId) return false;

  if (DUPLICATE_SKIP_PREFIXES.some((p) => url.startsWith(p))) return false;

  const settings = await getSettings();

  if (settings.duplicateTabMode === 'allow') return false;

  const allTabs = await chrome.tabs.query({ windowId });
  const existingTab = allTabs.find((t) => t.id !== newTabId && t.url === url);
  if (!existingTab?.id) return false;

  if (settings.duplicateTabMode === 'prevent-specific') {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const domains = parseDomains(settings.duplicateTabDomains);
      if (!domains.some((d) => hostnameMatchesDomain(hostname, d))) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const existingTabId = existingTab.id;

  if (settings.duplicateTabConfirm) {
    try {
      await waitForTabReady(newTabId);
      await chrome.tabs.sendMessage(newTabId, {
        action: 'showDuplicateConfirm',
        data: { newTabId, existingTabId, url },
      } satisfies RuntimeMessage);
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


async function retryTabMutation<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('user may be dragging a tab') || msg.includes('cannot be edited right now')) {
      await new Promise((r) => setTimeout(r, 300));
      return await fn();
    }
    throw e;
  }
}

async function findOrReserveGroupInWindow(
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
  const { id: tabId, url, windowId } = freshTab;
  if (!tabId || !url || !windowId) return;

  const rules = getActiveRules(await getRules());
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));

  const matchedRule = rules.find((r) => matchesRule(url, r)) ?? null;
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

    let groupId = await findOrReserveGroupInWindow(matchedRule.groupName, windowId);
    if (groupId === -1) {
      groupId = await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: tabId })
      );
      await chrome.tabGroups.update(groupId, {
        title: matchedRule.groupName,
        color: matchedRule.color ?? 'blue',
      });
    } else {
      await retryTabMutation(() => chrome.tabs.move(tabId, { index: -1 }));
      await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: tabId, groupId })
      );
    }

    console.log(
      `[Background] Tab ${tabId} moved to group "${matchedRule.groupName}" in window ${windowId}`
    );
    return;
  }

  if (currentGroupId !== -1 && isAutoManaged) {
    await retryTabMutation(() => chrome.tabs.ungroup(tabId));
    console.log(`[Background] Tab ${tabId} ungrouped (no matching rule)`);
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
    const { id: tabId, url } = tab;
    if (!tabId || !url || url.startsWith('chrome://')) continue;

    const matchedRule = rules.find((r) => matchesRule(url, r)) ?? null;
    const currentGroupId = tab.groupId ?? -1;
    const currentGroupTitle = groupIdToTitle.get(currentGroupId) ?? '';
    const isAutoManaged = !!currentGroupTitle && ruleGroupNames.has(currentGroupTitle);

    if (matchedRule) {
      if (currentGroupTitle === matchedRule.groupName) continue;
      const bucket = tabsToGroup.get(matchedRule.groupName) ?? [];
      bucket.push(tabId);
      tabsToGroup.set(matchedRule.groupName, bucket);
    } else if (currentGroupId !== -1 && isAutoManaged) {
      tabsToUngroup.push(tabId);
    }
  }

  for (const [groupName, tabIds] of tabsToGroup) {
    if (tabIds.length === 0) continue;

    let groupId = groupNameToId.get(groupName) ?? -1;

    if (groupId === -1) {
      const rule = rules.find((r) => r.groupName === groupName);
      if (!rule) continue;
      groupId = await retryTabMutation(() =>
        chrome.tabs.group({ tabIds: [tabIds[0]] })
      );
      await chrome.tabGroups.update(groupId, {
        title: rule.groupName,
        color: rule.color ?? 'blue',
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
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue;
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
  if (!tab.id || !tab.url) return;
  handleDuplicateTab(tab).then((handled) => {
    if (handled) return;
    setTimeout(() => {
      processTab(tab).catch((err) =>
        console.error('[Background] processTab failed on onCreated', err)
      );
    }, 100);
  }).catch((err) =>
    console.error('[Background] handleDuplicateTab failed', err)
  );
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.action === 'organizeAllTabs') {
    organizeAllTabs()
      .then(() => sendResponse({ success: true } satisfies OrganizeResponse))
      .catch((err: unknown) => {
        console.error('[Background] organizeAllTabs failed', err);
        sendResponse({ success: false, error: String(err) } satisfies OrganizeResponse);
      });
    return true; // response sent asynchronously
  }
  if (message.action === 'switchToExisting') {
    switchToExistingAndClose(message.existingTabId, message.newTabId).catch((err: unknown) => {
      console.error('[Background] switchToExisting failed', err);
    });
    return false; // no response expected
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'organize-tabs') {
    void organizeAllTabs();
  }
});
