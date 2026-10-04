// Tabs the user placed by hand. Rules never regroup/ungroup these.
// Stored in chrome.storage.session so it is shared by the background and the
// side panel and cleared when the browser closes. Each write is a small
// read-modify-write; the rare concurrent-write race is accepted.

const KEY = 'manualTabs';

let cache: Set<number> | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[KEY]) cache = null;
});

async function readStored(): Promise<Set<number>> {
  const result = await chrome.storage.session.get<{ manualTabs?: number[] }>(KEY);
  return new Set(result.manualTabs ?? []);
}

export async function getOverrides(): Promise<Set<number>> {
  if (cache === null) cache = await readStored();
  return cache;
}

export async function isOverridden(tabId: number): Promise<boolean> {
  return (await getOverrides()).has(tabId);
}

async function update(change: (set: Set<number>) => boolean): Promise<void> {
  const set = await readStored();
  if (!change(set)) {
    cache = set;
    return;
  }
  cache = null;
  await chrome.storage.session.set({ [KEY]: [...set] });
}

export async function addOverrides(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await update((set) => {
    const before = set.size;
    ids.forEach((id) => set.add(id));
    return set.size !== before;
  });
}

export async function clearOverrides(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await update((set) => {
    const before = set.size;
    ids.forEach((id) => set.delete(id));
    return set.size !== before;
  });
}
