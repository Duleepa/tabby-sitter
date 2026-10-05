// File System Access + IndexedDB plumbing for the linked sync file. Side panel only.

type Mode = { mode: 'readwrite' };

/** `queryPermission` / `requestPermission` are not in the TS DOM lib yet. */
export interface LinkedFileHandle extends FileSystemFileHandle {
  queryPermission(descriptor?: Mode): Promise<PermissionState>;
  requestPermission(descriptor?: Mode): Promise<PermissionState>;
}

interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}

interface FsWindow {
  showSaveFilePicker?: (options?: PickerOptions) => Promise<LinkedFileHandle>;
  showOpenFilePicker?: (options?: PickerOptions) => Promise<LinkedFileHandle[]>;
}

const DB_NAME = 'tabby-sitter';
const STORE = 'handles';
const HANDLE_KEY = 'syncFile';
const RW: Mode = { mode: 'readwrite' };
const JSON_TYPES = [{ description: 'Tabby Sitter config', accept: { 'application/json': ['.json'] } }];

export function fileLinkSupported(): boolean {
  const w = window as unknown as FsWindow;
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
}

/** Pickers reject with an AbortError when the user cancels. */
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

// ---------- IndexedDB ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
    });
  } finally {
    db.close();
  }
}

export async function loadHandle(): Promise<LinkedFileHandle | null> {
  const handle = await withStore<unknown>('readonly', (s) => s.get(HANDLE_KEY));
  return (handle as LinkedFileHandle | undefined) ?? null;
}

export async function storeHandle(handle: LinkedFileHandle): Promise<void> {
  await withStore('readwrite', (s) => s.put(handle, HANDLE_KEY));
}

export async function clearHandle(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(HANDLE_KEY));
}

// ---------- pickers ----------

export async function pickNewFile(suggestedName: string): Promise<LinkedFileHandle> {
  const w = window as unknown as FsWindow;
  if (!w.showSaveFilePicker) throw new Error('File access is not supported in this browser');
  return w.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
}

export async function pickExistingFile(): Promise<LinkedFileHandle> {
  const w = window as unknown as FsWindow;
  if (!w.showOpenFilePicker) throw new Error('File access is not supported in this browser');
  const [handle] = await w.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
  return handle;
}

// ---------- permission + IO ----------

export async function hasPermission(handle: LinkedFileHandle): Promise<boolean> {
  return (await handle.queryPermission(RW)) === 'granted';
}

/** Needs a user gesture unless already granted; false (never a throw) when Chrome refuses, so the caller can offer Reconnect. */
export async function requestPermission(handle: LinkedFileHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission(RW)) === 'granted';
  } catch {
    return false;
  }
}

export async function readFileText(handle: LinkedFileHandle): Promise<string> {
  return (await handle.getFile()).text();
}

export async function writeFileText(handle: LinkedFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } catch (err) {
    await writable.abort().catch(() => undefined); // never commit a partial file
    throw err;
  }
  await writable.close();
}
