import { getRules, getActiveRules, type GroupRule } from '../storage/rules';
import { getSettings } from '../storage/config';
import { addOverrides, clearOverrides, getOverrides } from '../storage/overrides';
import { decideTabAction, type TabAction } from './decide';
import { ExpectedGroupChanges } from './expected-changes';
import { retryTabMutation } from '../utils/tabs';
import {
  hostnameMatchesDomain,
  isRealPageUrl,
  isSkippableUrl,
  normalizeUrlForDuplicate,
  parseDomains,
  parseIgnoreParams,
} from '../utils/url';
import { duplicateCount, findDuplicateClusters, pickExistingTab, tabsToClose } from '../utils/duplicates';
import {
  addNotice,
  allowDuplicateTab,
  forgetAllowedDuplicate,
  getAllowedDuplicates,
  getNotices,
  removeFlaggedNoticesForTab,
  removeNotice,
} from '../storage/duplicates';
import { AllowOnce } from './allow-once';
import { QuietWindows } from './quiet-window';
import { listSavedGroups } from '../storage/saved-groups';
import { pickTabsToDiscard } from '../utils/discard';
import { generateId } from '../utils/id';

console.log('[Background] Tabby Sitter started.');

function enableSidePanelOnActionClick(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[Background] setPanelBehavior failed', err));
}

enableSidePanelOnActionClick();
chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);

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

// Saved-group restores in progress (in memory; the SW stays alive while a restore runs).
const quietWindows = new QuietWindows();

/** Created inside a quiet window: the extension itself opened this tab. */
async function isQuietTab(tabId: number): Promise<boolean> {
  await loadCreated();
  const t = createdAt.get(tabId);
  return t !== undefined && quietWindows.isQuiet(t);
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

async function switchToExistingAndClose(existingTabId: number, newTabId: number): Promise<void> {
  const existing = await chrome.tabs.get(existingTabId);
  await chrome.tabs.update(existingTabId, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
  await retryTabMutation(async () => {
    await chrome.tabs.remove(newTabId);
  });
}

const STARTUP_GRACE_MS = 10000;
const STARTUP_KEY = 'startupAt';

// Browser start time. Set synchronously in onStartup (so onCreated events that
// race the storage write still see it) and persisted for service worker restarts.
let startupAt: number | undefined;
let startupLoaded: Promise<void> | null = null;

function loadStartup(): Promise<void> {
  startupLoaded ??= (async () => {
    try {
      const result = await chrome.storage.session.get<{ startupAt?: number }>(STARTUP_KEY);
      if (startupAt === undefined && result.startupAt !== undefined) startupAt = result.startupAt;
    } catch (err) {
      console.warn('[Background] Failed to load startup time', err);
    }
  })();
  return startupLoaded;
}

async function inStartupGrace(): Promise<boolean> {
  await loadStartup();
  return startupAt !== undefined && Date.now() - startupAt < STARTUP_GRACE_MS;
}

chrome.runtime.onStartup.addListener(() => {
  startupAt = Date.now();
  chrome.storage.session
    .set({ [STARTUP_KEY]: startupAt })
    .catch((err) => console.warn('[Background] Failed to persist startup time', err));
  scheduleBadgeUpdate();
});

// URLs the user just asked to reopen (Undo); not treated as duplicates for 10 s.
const allowOnce = new AllowOnce();

/**
 * Decision order: fresh vs non-fresh (consumed exactly once) -> startup grace ->
 * mode/domain gate -> allowOnce / allowedDuplicateTabs -> pick the existing tab.
 * Only a fresh tab with "ask first" off is closed; every other duplicate just
 * gets a flagged notice. Returns true only when the tab was closed.
 */
async function handleDuplicateTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.id || !isRealPageUrl(tab.url)) return false;
  const tabId = tab.id;
  const url = tab.url;
  if (await isQuietTab(tabId)) return false;

  const fresh = await consumeFreshTab(tabId);
  if (await inStartupGrace()) return false;

  const settings = await getSettings();
  if (settings.duplicateTabMode === 'allow') return false;
  if (settings.duplicateTabMode === 'prevent-specific') {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (!parseDomains(settings.duplicateTabDomains).some((d) => hostnameMatchesDomain(hostname, d))) return false;
    } catch {
      return false;
    }
  }

  const extra = parseIgnoreParams(settings.duplicateIgnoreParams);
  const normalized = normalizeUrlForDuplicate(url, extra);
  if (!normalized) return false;

  if (allowOnce.consume(normalized)) {
    await allowDuplicateTab(tabId, normalized);
    return false;
  }
  if ((await getAllowedDuplicates())[String(tabId)] === normalized) return false;

  const allTabs = await chrome.tabs.query({});
  const existing = pickExistingTab(
    allTabs.filter(
      (t) =>
        t.id !== tabId &&
        !t.pendingUrl &&
        isRealPageUrl(t.url) &&
        normalizeUrlForDuplicate(t.url, extra) === normalized
    ),
    tab.windowId
  );
  if (!existing?.id) return false;

  const notice = {
    id: generateId(),
    tabId,
    existingTabId: existing.id,
    url,
    title: tab.title,
    windowId: tab.windowId,
    index: tab.index,
    at: Date.now(),
  };

  if (fresh && !settings.duplicateTabConfirm) {
    await switchToExistingAndClose(existing.id, tabId);
    await addNotice({ ...notice, kind: 'closed' });
    console.log(`[Background] Switched to existing tab ${existing.id}, closed duplicate ${tabId}`);
    return true;
  }

  await addNotice({ ...notice, kind: 'flagged' });
  return false;
}

async function handleDuplicateNotice(id: string, choice: string): Promise<void> {
  const notice = (await getNotices()).find((n) => n.id === id);
  if (!notice) return;
  const extra = parseIgnoreParams((await getSettings()).duplicateIgnoreParams);
  const normalized = normalizeUrlForDuplicate(notice.url, extra);

  if (choice === 'switch' && notice.tabId !== undefined) {
    try {
      await switchToExistingAndClose(notice.existingTabId, notice.tabId);
    } catch (err) {
      console.warn('[Background] switch from notice failed', err);
    }
  } else if (choice === 'keep' && notice.tabId !== undefined && normalized) {
    await allowDuplicateTab(notice.tabId, normalized);
  } else if (choice === 'undo' && normalized) {
    allowOnce.allow(normalized);
    let created: chrome.tabs.Tab;
    try {
      created = await chrome.tabs.create({ url: notice.url, windowId: notice.windowId, index: notice.index });
    } catch {
      created = await chrome.tabs.create({ url: notice.url }); // window or index no longer valid
    }
    if (created.id !== undefined) await allowDuplicateTab(created.id, normalized);
  }
  await removeNotice(id);
}

async function closeDuplicates(keys?: string[]): Promise<void> {
  const extra = parseIgnoreParams((await getSettings()).duplicateIgnoreParams);
  const focused = (await chrome.windows.getLastFocused()).id;
  const wanted = keys ? new Set(keys) : null;
  const clusters = findDuplicateClusters(await chrome.tabs.query({}), extra).filter(
    (c) => !wanted || wanted.has(c.key)
  );
  const ids = clusters.flatMap((c) => tabsToClose(c, focused).flatMap((t) => (t.id === undefined ? [] : [t.id])));
  if (ids.length > 0) await retryTabMutation(() => chrome.tabs.remove(ids));
}

const RESTORE_QUIET_GRACE_MS = 500;

async function restoreSavedGroup(id: string, newWindow: boolean, windowId?: number): Promise<void> {
  const group = (await listSavedGroups()).find((g) => g.id === id);
  if (!group || group.tabs.length === 0) throw new Error('Saved group not found or empty');

  const quiet = quietWindows.open(Date.now());
  const created: number[] = [];
  let failure: unknown;
  try {
    let targetWindow = windowId;
    let rest = group.tabs;
    if (newWindow) {
      const win = await chrome.windows.create({ url: group.tabs[0].url, focused: true });
      targetWindow = win.id;
      const first = win.tabs?.[0]?.id;
      if (first !== undefined) created.push(first);
      rest = group.tabs.slice(1);
    } else if (targetWindow === undefined) {
      targetWindow = (await chrome.windows.getLastFocused()).id;
    }
    // Inactive tabs, created in saved order so the strip order is preserved.
    for (const t of rest) {
      const tab = await chrome.tabs.create({ windowId: targetWindow, url: t.url, active: false });
      if (tab.id !== undefined) created.push(tab.id);
    }
  } catch (err) {
    failure = err;
  }

  try {
    if (created.length > 0) {
      await addOverrides(created);
      const extra = parseIgnoreParams((await getSettings()).duplicateIgnoreParams);
      for (let i = 0; i < created.length; i++) {
        const normalized = normalizeUrlForDuplicate(group.tabs[i]?.url ?? '', extra);
        if (normalized) await allowDuplicateTab(created[i], normalized);
      }
      const groupId = await groupTabs({ tabIds: created });
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
    }
  } finally {
    quietWindows.close(quiet, Date.now() + RESTORE_QUIET_GRACE_MS);
    setTimeout(() => quietWindows.prune(Date.now()), 5000);
  }
  if (failure) throw failure instanceof Error ? failure : new Error('Restore failed');
}

async function openSavedTab(url: string, windowId?: number): Promise<void> {
  const quiet = quietWindows.open(Date.now());
  try {
    const tab = await chrome.tabs.create({ url, windowId });
    const normalized = normalizeUrlForDuplicate(url, parseIgnoreParams((await getSettings()).duplicateIgnoreParams));
    if (tab.id !== undefined && normalized) await allowDuplicateTab(tab.id, normalized);
  } finally {
    quietWindows.close(quiet, Date.now() + RESTORE_QUIET_GRACE_MS);
  }
}

const DISCARD_ALARM = 'auto-discard';

/** Idempotent: create the alarm when auto-unload is on, clear it when off. */
async function reconcileDiscardAlarm(): Promise<void> {
  const { autoDiscardMinutes } = await getSettings();
  const existing = await chrome.alarms.get(DISCARD_ALARM);
  if (autoDiscardMinutes > 0) {
    if (!existing) await chrome.alarms.create(DISCARD_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
  } else if (existing) {
    await chrome.alarms.clear(DISCARD_ALARM);
  }
}

async function runAutoDiscard(): Promise<void> {
  const settings = await getSettings();
  const picked = pickTabsToDiscard(await chrome.tabs.query({}), settings, Date.now());
  let count = 0;
  for (const tab of picked) {
    try {
      await chrome.tabs.discard(tab.id as number);
      count++;
    } catch {
      /* tab closed or not discardable */
    }
  }
  if (count > 0) console.log(`[Background] Auto-unloaded ${count} idle tab(s)`);
}

function reconcileDiscardAlarmSafe(): void {
  reconcileDiscardAlarm().catch((err) => console.warn('[Background] alarm reconcile failed', err));
}

reconcileDiscardAlarmSafe();
chrome.runtime.onInstalled.addListener(reconcileDiscardAlarmSafe);
chrome.runtime.onStartup.addListener(reconcileDiscardAlarmSafe);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DISCARD_ALARM) {
    runAutoDiscard().catch((err) => console.warn('[Background] auto-discard failed', err));
  }
});

let badgeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleBadgeUpdate(): void {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    updateBadge().catch((err) => console.warn('[Background] badge update failed', err));
  }, 300);
}

/** Badge background: the theme accent (indigo) as a hex, since the badge cannot use CSS tokens. */
const BADGE_COLOR = '#4f46e5';

async function updateBadge(): Promise<void> {
  const settings = await getSettings();
  if (!settings.duplicateBadge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const count = duplicateCount(
    findDuplicateClusters(await chrome.tabs.query({}), parseIgnoreParams(settings.duplicateIgnoreParams))
  );
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count === 0 ? '' : count > 99 ? '99+' : String(count) });
}

scheduleBadgeUpdate();
chrome.runtime.onInstalled.addListener(scheduleBadgeUpdate);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    scheduleBadgeUpdate();
    reconcileDiscardAlarmSafe();
  }
});


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
  if (await isQuietTab(tabId)) return;

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
    scheduleBadgeUpdate();
    // A flagged notice is obsolete once its tab navigates; then re-evaluate.
    removeFlaggedNoticesForTab(tab.id)
      .then(() => handleDuplicateTab(tab))
      .then((handled) => {
        if (handled) return;
        return processTab(tab);
      })
      .catch((err) => console.error('[Background] onUpdated handling failed', err));
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id) return;
  const tabId = tab.id;
  scheduleBadgeUpdate();
  recordCreated(tabId)
    .catch(() => {})
    .then(async () => {
      // Tabs created during browser startup (session restore) or by a saved-group
      // restore are never fresh and skip duplicate/rule handling.
      const quiet = await isQuietTab(tabId);
      if (!quiet && !(await inStartupGrace())) await markTabFresh(tabId);
      // Link-opened tabs often have an empty url (only pendingUrl); the real URL
      // is evaluated when it arrives via onUpdated.
      if (quiet || !tab.url) return;
      const handled = await handleDuplicateTab(tab);
      if (handled) return;
      setTimeout(() => {
        processTab(tab).catch((err) =>
          console.error('[Background] processTab failed on onCreated', err)
        );
      }, 100);
    })
    .catch((err) => console.error('[Background] onCreated handling failed', err));
});

chrome.tabs.onReplaced.addListener(scheduleBadgeUpdate);

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetFreshTab(tabId).catch(() => {});
  removeFlaggedNoticesForTab(tabId).catch(() => {});
  forgetAllowedDuplicate(tabId).catch(() => {});
  scheduleBadgeUpdate();
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
  if (request.action === 'duplicateNotice') {
    const { id, choice } = request as { id: string; choice: string };
    handleDuplicateNotice(id, choice)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  if (request.action === 'restoreSavedGroup') {
    const { id, newWindow, windowId } = request as { id: string; newWindow?: boolean; windowId?: number };
    restoreSavedGroup(id, !!newWindow, windowId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Background] restoreSavedGroup failed', err);
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }
  if (request.action === 'openSavedTab') {
    const { url, windowId } = request as { url: string; windowId?: number };
    openSavedTab(url, windowId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  if (request.action === 'closeDuplicates') {
    const { keys } = request as { keys?: string[] };
    closeDuplicates(keys)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'organize-tabs') {
    organizeAllTabs().catch((err) => console.error('[Background] organize command failed', err));
  }
});
