import type { GroupColor } from './rules';

export interface SavedTab {
  url: string;
  title: string;
}

export interface SavedGroup {
  id: string;
  title: string;
  color: GroupColor;
  createdAt: number;
  updatedAt: number;
  tabs: SavedTab[];
}

const KEY = 'savedGroups';

/** Restorable URLs: http/https/file and chrome:// pages except the new-tab page. */
export function isSavableUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (/^(https?|file):/i.test(url)) return true;
  if (/^chrome:\/\//i.test(url)) return !/^chrome:\/\/(newtab|new-tab-page)/i.test(url);
  return false;
}

/** Pure: build a saved group from tabs (in order), dropping unrestorable ones. No favicons. */
export function snapshotFromTabs(
  title: string,
  color: GroupColor,
  tabs: { url?: string; pendingUrl?: string; title?: string }[],
  now: number,
  id: string
): SavedGroup {
  const saved: SavedTab[] = [];
  for (const t of tabs) {
    const url = t.url || t.pendingUrl;
    if (isSavableUrl(url)) saved.push({ url, title: t.title || url });
  }
  return { id, title, color, createdAt: now, updatedAt: now, tabs: saved };
}

export async function listSavedGroups(): Promise<SavedGroup[]> {
  const result = await chrome.storage.local.get<{ savedGroups?: SavedGroup[] }>(KEY);
  return result.savedGroups ?? [];
}

async function write(groups: SavedGroup[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: groups });
}

/** Replace the whole list (sync apply, undo, import). */
export async function replaceAllSavedGroups(groups: SavedGroup[]): Promise<void> {
  await write(groups);
}

export async function saveGroup(group: SavedGroup): Promise<void> {
  const groups = (await listSavedGroups()).filter((g) => g.id !== group.id);
  groups.push(group);
  await write(groups);
}

/** Replace an existing saved group's contents, keeping its id and creation date. */
export async function replaceSavedGroup(id: string, snapshot: SavedGroup): Promise<void> {
  const groups = await listSavedGroups();
  const at = groups.findIndex((g) => g.id === id);
  if (at === -1) {
    groups.push(snapshot);
  } else {
    groups[at] = { ...snapshot, id, createdAt: groups[at].createdAt };
  }
  await write(groups);
}

export async function renameSavedGroup(id: string, title: string): Promise<void> {
  const groups = await listSavedGroups();
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  g.title = title;
  g.updatedAt = Date.now();
  await write(groups);
}

export async function deleteSavedGroup(id: string): Promise<void> {
  await write((await listSavedGroups()).filter((g) => g.id !== id));
}
