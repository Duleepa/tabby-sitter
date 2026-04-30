import { getRules, matchesRule } from '../storage/rules';

console.log('[Background] Tabby Sitter started.');

const tabGroupMap = new Map<number, number>(); // tabId -> groupId

/** Returns an existing group ID for the name in a specific window, or -1 to signal "create new with next tab" */
async function findOrReserveGroupInWindow(
  groupName: string,
  windowId: number
): Promise<number> {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find((g) => g.title === groupName)?.id ?? -1;
}

async function processTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url || !tab.windowId) return;

  const rules = await getRules();
  const ruleGroupNames = new Set(rules.map((r) => r.groupName));

  // Determine which rule (if any) matches the current URL
  const matchedRule = rules.find((r) => matchesRule(tab.url!, r)) ?? null;

  // Read current tab grouping state
  const currentGroupId = tab.groupId ?? -1;
  let isAutoManaged = false;
  if (currentGroupId !== -1) {
    try {
      const grp = await chrome.tabGroups.get(currentGroupId);
      isAutoManaged = ruleGroupNames.has(grp.title ?? '');
    } catch {
      // group may have been removed
    }
  }

  if (matchedRule) {
    // Already in the right group -> nothing to do
    if (
      currentGroupId !== -1 &&
      (await chrome.tabGroups.get(currentGroupId)).title === matchedRule.groupName
    ) {
      return;
    }

    let groupId = await findOrReserveGroupInWindow(matchedRule.groupName, tab.windowId);

    if (groupId === -1) {
      groupId = await chrome.tabs.group({ tabIds: tab.id });
      await chrome.tabGroups.update(groupId, {
        title: matchedRule.groupName,
        color: matchedRule.color || 'blue',
      });
    } else {
      await chrome.tabs.move(tab.id, { index: -1 });
      await chrome.tabs.group({ tabIds: tab.id, groupId });
    }

    tabGroupMap.set(tab.id, groupId);
    console.log(
      `[Background] Tab ${tab.id} moved to group "${matchedRule.groupName}" in window ${tab.windowId}`
    );
    return;
  }

  // No rule matched — ungroup only if currently in an auto-managed group
  if (currentGroupId !== -1 && isAutoManaged) {
    await chrome.tabs.ungroup(tab.id);
    tabGroupMap.delete(tab.id);
    console.log(`[Background] Tab ${tab.id} ungrouped (no matching rule)`);
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
    const tabId = tab.id;

    const matchedRule = rules.find((r) => matchesRule(tab.url!, r)) ?? null;
    const currentGroupId = tab.groupId ?? -1;

    let isAutoManaged = false;
    let currentGroupTitle: string | undefined;
    if (currentGroupId !== -1) {
      try {
        const grp = groups.find((g) => g.id === currentGroupId);
        currentGroupTitle = grp?.title;
        isAutoManaged = !!currentGroupTitle && ruleGroupNames.has(currentGroupTitle);
      } catch {
        // ignore
      }
    }

    if (matchedRule) {
      // Already in the correct group -> skip
      if (currentGroupTitle === matchedRule.groupName) continue;

      let groupId = groupNameToId.get(matchedRule.groupName) ?? -1;

      if (groupId === -1) {
        groupId = await chrome.tabs.group({ tabIds: tabId });
        await chrome.tabGroups.update(groupId, {
          title: matchedRule.groupName,
          color: matchedRule.color || 'blue',
        });
        groupNameToId.set(matchedRule.groupName, groupId);
      } else {
        await chrome.tabs.move(tabId, { index: -1 });
        await chrome.tabs.group({ tabIds: tabId, groupId });
      }

      tabGroupMap.set(tabId, groupId);
      continue;
    }

    // No rule matched — ungroup only auto-managed groups
    if (currentGroupId !== -1 && isAutoManaged) {
      await chrome.tabs.ungroup(tabId);
      tabGroupMap.delete(tabId);
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
    return true; // keep channel open for async response
  }
  return false;
});
