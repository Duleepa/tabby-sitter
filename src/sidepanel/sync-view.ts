import { el, showStatus } from './dom';
import {
  clearHandle,
  fileLinkSupported,
  hasPermission,
  isAbort,
  loadHandle,
  pickExistingFile,
  pickNewFile,
  readFileText,
  requestPermission,
  storeHandle,
  writeFileText,
  type LinkedFileHandle,
} from './file-link';
import { refreshRules } from './rules-view';
import { applyContent, readLocalContent } from '../storage/config';
import {
  buildSyncFile,
  contentHash,
  decideSync,
  parseSyncFile,
  suggestedSyncFileName,
  syncContent,
  type ParsedSyncFile,
  type SyncContent,
} from '../storage/sync-file';
import {
  clearSyncState,
  getDeviceId,
  getSyncState,
  newSyncState,
  saveSyncState,
  type SyncFileState,
} from '../storage/sync-state';

const LOCK = 'tabby-sitter-sync';
const DEBOUNCE_MS = 1500;

type Problem = { kind: 'conflict'; first: boolean } | { kind: 'error'; message: string };
interface Notice {
  text: string;
  undo?: () => void;
}

let handle: LinkedFileHandle | null = null;
let state: SyncFileState | null = null;
let problem: Problem | null = null;
let notice: Notice | null = null;
let busy = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const $ = (id: string) => document.getElementById(id);

function fail(err: unknown): void {
  console.error('[Sidepanel] sync', err);
  showStatus('Sync failed: ' + (err instanceof Error ? err.message : String(err)));
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return (await navigator.locks.request(LOCK, fn));
}

// ---------- state ----------

/** Re-read the stored state (another panel may have changed it) and the file handle. */
async function refreshState(): Promise<void> {
  state = await getSyncState();
  if (!state) {
    handle = null;
    return;
  }
  handle ??= await loadHandle();
  if (!handle) problem = { kind: 'error', message: 'The linked file is no longer available. Unlink and link it again.' };
}

async function patchState(patch: Partial<SyncFileState>): Promise<void> {
  const current = (await getSyncState()) ?? state;
  if (!current) return;
  state = { ...current, ...patch };
  await saveSyncState(state);
}

// ---------- file IO (call inside the lock) ----------

interface Evaluation {
  local: SyncContent;
  localHash: string;
  parsed: ParsedSyncFile | null;
  fileContent: SyncContent | null;
  fileHash: string | null;
}

/** Read the file and local data and hash both, restricted to the parts being synced. */
async function evaluate(s: SyncFileState, h: LinkedFileHandle): Promise<Evaluation | null> {
  const text = await readFileText(h);
  const local = syncContent(await readLocalContent(), s);
  let parsed: ParsedSyncFile | null = null;
  if (text.trim() !== '') {
    try {
      parsed = parseSyncFile(text);
    } catch (err) {
      problem = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
      return null;
    }
  }
  const fileContent = parsed ? syncContent(parsed.content, s) : null;
  return {
    local,
    localHash: contentHash(local),
    parsed,
    fileContent,
    fileHash: fileContent ? contentHash(fileContent) : null,
  };
}

async function writeToFile(h: LinkedFileHandle, local: SyncContent, localHash: string): Promise<void> {
  const meta = { savedAt: new Date().toISOString(), deviceId: await getDeviceId() };
  const text = JSON.stringify(buildSyncFile(local, meta), null, 2);
  try {
    parseSyncFile(text); // never write something this extension could not read back
  } catch (err) {
    problem = { kind: 'error', message: "This device's data can't be saved: " + (err instanceof Error ? err.message : '') };
    return;
  }
  await writeFileText(h, text);
  await patchState({ lastSeen: meta, lastHash: localHash, lastWriteAt: Date.now(), pending: false });
  problem = null;
}

/** Apply the file to local storage. lastHash/lastSeen are set first so the change is not written back. */
async function applyFromFile(ev: Evaluation, withUndo: boolean): Promise<void> {
  if (!ev.parsed || !ev.fileContent || !ev.fileHash) return;
  const snapshot = ev.local;
  await patchState({ lastHash: ev.fileHash, lastSeen: ev.parsed.meta, pending: false });
  await applyContent(ev.fileContent);
  // Local can still differ from the file (missing parts, partial settings); record what it now
  // holds so only later edits count as local changes. Runs inside the lock, before any write-back.
  if (state) await patchState({ lastHash: contentHash(syncContent(await readLocalContent(), state)) });
  problem = null;
  await refreshRules().catch(fail);
  notice = {
    text: 'Updated from sync file',
    undo: withUndo ? () => applyContent(snapshot).then(() => setNotice(null), fail) : undefined,
  };
}

function setNotice(n: Notice | null): void {
  notice = n;
  render();
}

// ---------- sync flow ----------

async function syncLocked(): Promise<void> {
  await refreshState();
  if (!state || !handle) return;
  if (!(await hasPermission(handle))) {
    if (!state.pending) await patchState({ pending: true });
    return;
  }
  const ev = await evaluate(state, handle);
  if (!ev) return; // unreadable file: never write over it
  const decision = decideSync({
    fileMeta: ev.parsed?.meta ?? null,
    fileHash: ev.fileHash,
    localHash: ev.localHash,
    state: state,
    autoLoad: state.autoLoad,
  });
  if (decision === 'write') await writeToFile(handle, ev.local, ev.localHash);
  else if (decision === 'load') await applyFromFile(ev, true);
  else if (decision === 'conflict') problem = { kind: 'conflict', first: state.lastSeen === null };
  else {
    problem = null;
    if (state.pending) await patchState({ pending: false });
    const meta = ev.parsed?.meta;
    const seen = state.lastSeen;
    if (meta && (meta.savedAt !== seen?.savedAt || meta.deviceId !== seen?.deviceId || state.lastHash !== ev.localHash)) {
      await patchState({ lastSeen: meta, lastHash: ev.localHash });
    }
  }
}

let rerun = false;

async function runSync(): Promise<void> {
  if (busy) {
    rerun = true; // a change arrived mid-sync: run once more afterwards
    return;
  }
  busy = true;
  render();
  try {
    do {
      rerun = false;
      await withLock(syncLocked);
    } while (rerun);
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

function scheduleSync(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void runSync(), DEBOUNCE_MS);
}

/** Run `fn` against a freshly evaluated file, inside the lock, then re-render. */
async function explicit(fn: (ev: Evaluation, h: LinkedFileHandle) => Promise<void>): Promise<void> {
  busy = true;
  render();
  try {
    await withLock(async () => {
      await refreshState();
      if (!state || !handle) return;
      if (!(await hasPermission(handle))) {
        await patchState({ pending: true });
        return;
      }
      const ev = await evaluate(state, handle);
      if (ev) await fn(ev, handle);
    });
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

const useFile = () =>
  explicit(async (ev, h) => {
    if (ev.parsed) await applyFromFile(ev, true);
    else await writeToFile(h, ev.local, ev.localHash);
  });

const keepLocal = () => explicit((ev, h) => writeToFile(h, ev.local, ev.localHash));

/** Overwrite the file after the user confirmed, even if it could not be read. */
async function forceWriteUnreadable(): Promise<void> {
  busy = true;
  render();
  try {
    await withLock(async () => {
      await refreshState();
      if (!state || !handle) return;
      if (!(await hasPermission(handle))) return void (await patchState({ pending: true }));
      const local = syncContent(await readLocalContent(), state);
      await writeToFile(handle, local, contentHash(local));
    });
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    render();
  }
}

// ---------- user actions ----------

async function link(create: boolean): Promise<void> {
  try {
    const label = labelInput()?.value.trim() ?? '';
    const picked = create ? await pickNewFile(suggestedSyncFileName(label)) : await pickExistingFile();
    await storeHandle(picked);
    handle = picked;
    problem = null;
    state = { ...newSyncState(picked.name), profileLabel: label };
    await saveSyncState(state);
    if (!(await requestPermission(picked))) {
      await patchState({ pending: true });
      render();
      return;
    }
    await runSync();
  } catch (err) {
    if (!isAbort(err)) fail(err);
  }
}

async function unlink(): Promise<void> {
  await withLock(async () => {
    await clearHandle();
    await clearSyncState();
  });
  handle = null;
  state = null;
  problem = null;
  notice = null;
  render();
}

async function reconnect(): Promise<void> {
  if (!handle) return;
  try {
    if (await requestPermission(handle)) {
      await patchState({ pending: false });
      await runSync();
    } else {
      showStatus('Permission was not granted');
    }
  } catch (err) {
    fail(err);
  }
}

async function writeNow(): Promise<void> {
  if (problem?.kind === 'error') {
    if (!confirm('Overwrite the sync file with this device’s data? Its current content is not valid.')) return;
    await forceWriteUnreadable();
  } else {
    await runSync();
  }
}

async function toggleOption(key: 'includeSavedGroups' | 'includeSettings' | 'autoLoad', value: boolean): Promise<void> {
  await withLock(() => patchState({ [key]: value }));
  await runSync();
}

// ---------- render ----------

function labelInput(): HTMLInputElement | null {
  return $('syncProfileLabel') as HTMLInputElement | null;
}

function statusText(): string {
  if (!state) return '';
  const parts = [state.profileLabel ? `${state.profileLabel} · linked to ${state.name}` : state.name];
  if (state.lastWriteAt) parts.push(`last saved ${new Date(state.lastWriteAt).toLocaleTimeString()}`);
  if (busy) parts.push('syncing…');
  else if (problem?.kind === 'error') parts.push(`problem: ${problem.message}`);
  else if (problem?.kind === 'conflict') parts.push('file changed elsewhere');
  else if (state.pending) parts.push('waiting for you to reconnect');
  else parts.push('in sync');
  return parts.join(' · ');
}

function noticeRow(kind: string, text: string, buttons: [string, () => void][]): HTMLElement {
  const row = el('div', `notice ${kind}`, { role: 'status' });
  row.append(el('span', 'notice-text', undefined, text));
  for (const [label, onClick] of buttons) {
    const b = el('button', 'notice-btn', { type: 'button' }, label);
    b.addEventListener('click', onClick);
    row.appendChild(b);
  }
  return row;
}

function renderNotices(): void {
  const rows: HTMLElement[] = [];
  if (problem?.kind === 'conflict') {
    rows.push(
      problem.first
        ? noticeRow('sync', 'This file already has different content', [
            ['Use the file’s settings', () => void useFile()],
            ['Replace the file with this device’s', () => void keepLocal()],
          ])
        : noticeRow('sync', 'Sync file changed on another device', [
            ['Use file', () => void useFile()],
            ['Keep this device’s', () => void keepLocal()],
          ])
    );
  }
  if (problem?.kind === 'error') rows.push(noticeRow('sync', `Sync paused: ${problem.message}`, []));
  if (state?.pending && handle) rows.push(noticeRow('sync', 'Sync needs permission to the file', [['Reconnect', () => void reconnect()]]));
  if (notice) {
    const buttons: [string, () => void][] = [];
    if (notice.undo) buttons.push(['Undo', notice.undo]);
    buttons.push(['×', () => setNotice(null)]);
    rows.push(noticeRow('sync', notice.text, buttons));
  }
  $('syncNotices')?.replaceChildren(...rows);
}

function setChecked(id: string, value: boolean): void {
  const box = $(id) as HTMLInputElement | null;
  if (box) box.checked = value;
}

function render(): void {
  const linked = !!state;
  $('syncUnlinked')?.classList.toggle('hidden', linked);
  $('syncLinked')?.classList.toggle('hidden', !linked);
  $('syncReconnect')?.classList.toggle('hidden', !state?.pending);
  const status = $('syncStatus');
  if (status) status.textContent = linked ? statusText() : 'Not linked';
  const label = labelInput();
  if (state && label && document.activeElement !== label) label.value = state.profileLabel;
  if (state) {
    setChecked('syncIncludeGroups', state.includeSavedGroups);
    setChecked('syncIncludeSettings', state.includeSettings);
    setChecked('syncAutoLoad', state.autoLoad);
  }
  renderNotices();
}

// ---------- init ----------

function bind(id: string, onClick: () => void | Promise<void>): void {
  $(id)?.addEventListener('click', () => void Promise.resolve(onClick()).catch(fail));
}

function bindToggle(id: string, key: 'includeSavedGroups' | 'includeSettings' | 'autoLoad'): void {
  $(id)?.addEventListener('change', (e) => void toggleOption(key, (e.target as HTMLInputElement).checked).catch(fail));
}

export async function initSyncView(): Promise<void> {
  if (!fileLinkSupported()) {
    $('syncUnsupported')?.classList.remove('hidden');
    $('syncUnlinked')?.classList.add('hidden');
    return;
  }
  bind('syncCreate', () => link(true));
  bind('syncLink', () => link(false));
  bind('syncNow', writeNow);
  bind('syncReload', useFile);
  bind('syncUnlink', unlink);
  bind('syncReconnect', reconnect);
  labelInput()?.addEventListener('change', () => {
    const value = labelInput()?.value.trim() ?? '';
    if (state) void withLock(() => patchState({ profileLabel: value })).catch(fail);
  });
  bindToggle('syncIncludeGroups', 'includeSavedGroups');
  bindToggle('syncIncludeSettings', 'includeSettings');
  bindToggle('syncAutoLoad', 'autoLoad');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !state) return;
    if (changes.rules || changes.settings || changes.savedGroups) scheduleSync();
    if (changes.syncFile) {
      void refreshState().then(render, fail);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSync();
  });

  await refreshState();
  render();
  await runSync();
}
