import { getRules, matchesRule } from '../storage/rules';

console.log('[Background] Tabby Sitter started.');

/** Retry a tab mutation once if Chrome transiently rejects it */
async function retryTabMutation<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.includes('user may be dragging a tab') || msg.includes('cannot be edited right now')) {
      await new Promise((r) => setTimeout(r, 300));
      return await fn();
    }
    throw e;
  }
}

/** Returns an existing group ID for the name in a specific window, or -1 to signal "create new with next tab" */
async function findOrReserveGroupInWindow(
  groupName: string,
  windowId: number
): Promise<number> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => g.title === groupName)?.id ?? -1;
}

async function processTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.windowId) return;

  // Refresh tab state to avoid stale groupId / url
  let freshTab: chrome.tabs.Tab;
  try {
    freshTab = await chrome.tabs.get(tab.id);
  } catch {
    return;
  }
  if (!freshTab.url) return;

  const rules = await getRules();
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));

  const matchedRule = rules.find((r) => matchesRule(freshTab.url!, r)) ?? null;
  const currentGroupId = freshTab.groupId ?? -1;

  // Resolve current group title (if any)
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
    // Already correct -> noop
    if (currentGroupTitle === matchedRule.groupName) return;

    let groupId = await findOrReserveGroupInWindow(matchedRule.groupName, freshTab.windowId!);
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

  // No rule matched — ungroup only if currently in an auto-managed group
  if (currentGroupId !== -1 && isAutoManaged) {
    await retryTabMutation(() => chrome.tabs.ungroup(freshTab.id!));
    console.log(`[Background] Tab ${freshTab.id} ungrouped (no matching rule)`);
  }
}

/** Process all open tabs in the current window against current rules */
export async function organizeAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length === 0) return;

  const windowId = tabs[0].windowId;
  const rules = await getRules();
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));
  const groupNameToId = new Map<string, number>();

  // Pre-resolve existing groups in this window only
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    if (group.title) {
      groupNameToId.set(group.title, group.id);
    }
  }

  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) continue;

    // Refresh tab state inside the loop to avoid stale groupId
    let freshTab: chrome.tabs.Tab;
    try {
      freshTab = await chrome.tabs.get(tab.id);
    } catch {
      continue;
    }
    if (!freshTab.url) continue;

    const matchedRule = rules.find((r) => matchesRule(freshTab.url!, r)) ?? null;
    const currentGroupId = freshTab.groupId ?? -1;

    let currentGroupTitle: string | undefined;
    let isAutoManaged = false;
    if (currentGroupId !== -1) {
      try {
        currentGroupTitle = (await chrome.tabGroups.get(currentGroupId)).title;
        isAutoManaged = !!currentGroupTitle && ruleGroupNames.has(currentGroupTitle);
      } catch {
        // group closed
      }
    }

    if (matchedRule) {
      if (currentGroupTitle === matchedRule.groupName) continue;

      let groupId = groupNameToId.get(matchedRule.groupName) ?? -1;

      if (groupId === -1) {
        groupId = await retryTabMutation(() =>
          chrome.tabs.group({ tabIds: freshTab.id! })
        );
        await chrome.tabGroups.update(groupId, {
          title: matchedRule.groupName,
          color: matchedRule.color || 'blue',
        });
        groupNameToId.set(matchedRule.groupName, groupId);
      } else {
        await retryTabMutation(() => chrome.tabs.move(freshTab.id!, { index: -1 }));
        await retryTabMutation(() =>
          chrome.tabs.group({ tabIds: freshTab.id!, groupId })
        );
      }

      continue;
    }

    // No rule matched — ungroup only auto-managed groups
    if (currentGroupId !== -1 && isAutoManaged) {
      await retryTabMutation(() => chrome.tabs.ungroup(freshTab.id!));
      console.log(`[Background] Tab ${freshTab.id} ungrouped (no matching rule)`);
    }
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.id) {
    processTab(tab);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && tab.url) {
    setTimeout(() => processTab(tab), 100);
  }
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
  return false;
});
