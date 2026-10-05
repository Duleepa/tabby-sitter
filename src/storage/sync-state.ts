import type { FileMeta } from './sync-file';
import { generateId } from '../utils/id';

/** Settings and bookkeeping for the linked sync file (the file handle lives in IndexedDB). */
export interface SyncFileState {
  name: string;
  /** Names this profile in the suggested file name. Local only; never written to the sync file. */
  profileLabel: string;
  includeSavedGroups: boolean;
  includeSettings: boolean;
  autoLoad: boolean;
  lastHash: string | null;
  lastSeen: FileMeta | null;
  lastWriteAt: number | null;
  /** A write or read is waiting for the user to reconnect (permission needs a click). */
  pending: boolean;
}

const STATE_KEY = 'syncFile';
const DEVICE_KEY = 'syncDeviceId';

export function newSyncState(name: string): SyncFileState {
  return {
    name,
    profileLabel: '',
    includeSavedGroups: true,
    includeSettings: true,
    autoLoad: true,
    lastHash: null,
    lastSeen: null,
    lastWriteAt: null,
    pending: false,
  };
}

export async function getSyncState(): Promise<SyncFileState | null> {
  const result = await chrome.storage.local.get<{ syncFile?: SyncFileState }>(STATE_KEY);
  return result.syncFile ? { ...newSyncState(result.syncFile.name), ...result.syncFile } : null;
}

export async function saveSyncState(state: SyncFileState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

export async function clearSyncState(): Promise<void> {
  await chrome.storage.local.remove(STATE_KEY);
}

/** Random id for this browser profile, generated once. Lets other devices tell who wrote the file. */
export async function getDeviceId(): Promise<string> {
  const result = await chrome.storage.local.get<{ syncDeviceId?: string }>(DEVICE_KEY);
  if (result.syncDeviceId) return result.syncDeviceId;
  const id = generateId();
  await chrome.storage.local.set({ [DEVICE_KEY]: id });
  return id;
}
