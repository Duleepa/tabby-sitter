import { addNoticeTo, pruneNotices, removeFlaggedForTab, type DuplicateNotice } from '../utils/notices';

// Duplicate-handling state in chrome.storage.session. Only the background
// writes (serialised through a queue); the side panel reads and listens.

export const NOTICES_KEY = 'duplicateNotices';
const ALLOWED_KEY = 'allowedDuplicateTabs';

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function getNotices(): Promise<DuplicateNotice[]> {
  const result = await chrome.storage.session.get<{ duplicateNotices?: DuplicateNotice[] }>(NOTICES_KEY);
  return result.duplicateNotices ?? [];
}

async function saveNotices(notices: DuplicateNotice[]): Promise<void> {
  await chrome.storage.session.set({ [NOTICES_KEY]: notices });
}

export function addNotice(notice: DuplicateNotice): Promise<void> {
  return enqueue(async () => saveNotices(addNoticeTo(await getNotices(), notice, Date.now())));
}

export function removeNotice(id: string): Promise<void> {
  return enqueue(async () => {
    const notices = await getNotices();
    const next = pruneNotices(notices.filter((n) => n.id !== id), Date.now());
    if (next.length !== notices.length) await saveNotices(next);
  });
}

export function removeFlaggedNoticesForTab(tabId: number): Promise<void> {
  return enqueue(async () => {
    const notices = await getNotices();
    const next = removeFlaggedForTab(notices, tabId);
    if (next.length !== notices.length) await saveNotices(next);
  });
}

/** tabId -> normalised URL the user chose to keep as a duplicate. */
export async function getAllowedDuplicates(): Promise<Record<string, string>> {
  const result = await chrome.storage.session.get<{ allowedDuplicateTabs?: Record<string, string> }>(ALLOWED_KEY);
  return result.allowedDuplicateTabs ?? {};
}

export function allowDuplicateTab(tabId: number, normalizedUrl: string): Promise<void> {
  return enqueue(async () => {
    const allowed = await getAllowedDuplicates();
    allowed[String(tabId)] = normalizedUrl;
    await chrome.storage.session.set({ [ALLOWED_KEY]: allowed });
  });
}

export function forgetAllowedDuplicate(tabId: number): Promise<void> {
  return enqueue(async () => {
    const allowed = await getAllowedDuplicates();
    if (!(String(tabId) in allowed)) return;
    delete allowed[String(tabId)];
    await chrome.storage.session.set({ [ALLOWED_KEY]: allowed });
  });
}
