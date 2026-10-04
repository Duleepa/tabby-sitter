import { beforeEach, describe, expect, it } from 'vitest';
import { addOverrides, clearOverrides, getOverrides, isOverridden } from './overrides';

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  const session = (globalThis as unknown as { chrome: { storage: { session: Record<string, unknown> } } }).chrome.storage.session;
  session.get = (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {});
  session.set = (items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  };
});

describe('overrides', () => {
  it('adds, reads and clears ids', async () => {
    await clearOverrides([1, 2, 3]);
    await addOverrides([1, 2]);
    expect(await isOverridden(1)).toBe(true);
    expect(await isOverridden(3)).toBe(false);
    expect([...(await getOverrides())].sort()).toEqual([1, 2]);
    await clearOverrides([1]);
    expect(await isOverridden(1)).toBe(false);
    expect(store.manualTabs).toEqual([2]);
    await clearOverrides([2]);
  });

  it('merges with ids written by another context', async () => {
    await addOverrides([5]);
    store.manualTabs = [5, 6]; // written elsewhere
    await addOverrides([7]);
    expect(new Set(store.manualTabs as number[])).toEqual(new Set([5, 6, 7]));
    await clearOverrides([5, 6, 7]);
  });
});
