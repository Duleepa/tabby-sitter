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
  for (const rule of rules) {
    if (matchesRule(tab.url, rule)) {
      let groupId = await findOrReserveGroupInWindow(rule.groupName, tab.windowId);

      if (groupId === -1) {
        // Group doesn't exist yet in this window; create it from this tab
        groupId = await chrome.tabs.group({ tabIds: tab.id });
        await chrome.tabGroups.update(groupId, {
          title: rule.groupName,
          color: rule.color || 'blue',
        });
      } else {
        await chrome.tabs.move(tab.id, { index: -1 });
        await chrome.tabs.group({ tabIds: tab.id, groupId });
      }

      tabGroupMap.set(tab.id, groupId);
      console.log(`[Background] Tab ${tab.id} moved to group "${rule.groupName}" in window ${tab.windowId}`);
      return;
    }
  }
}

/** Process all open tabs in the current window against current rules */
export async function organizeAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length === 0) return;

  const windowId = tabs[0].windowId;
  const rules = await getRules();
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

    for (const rule of rules) {
      if (matchesRule(tab.url, rule)) {
        let groupId = groupNameToId.get(rule.groupName) ?? -1;

        if (groupId === -1) {
          groupId = await chrome.tabs.group({ tabIds: tab.id });
          await chrome.tabGroups.update(groupId, {
            title: rule.groupName,
            color: rule.color || 'blue',
          });
          groupNameToId.set(rule.groupName, groupId);
        } else {
          await chrome.tabs.move(tab.id, { index: -1 });
          await chrome.tabs.group({ tabIds: tab.id, groupId });
        }

        tabGroupMap.set(tab.id, groupId);
        break;
      }
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
