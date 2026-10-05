import { describe, expect, it } from 'vitest';
import { pickTabsToDiscard, type DiscardCandidate, type DiscardSettings } from './discard';

const NOW = 10_000_000;
const MIN = 60000;
const settings: DiscardSettings = { autoDiscardMinutes: 30, autoDiscardPinned: false, autoDiscardExceptDomains: '' };

function tab(over: Partial<DiscardCandidate> = {}): DiscardCandidate {
  return { id: 1, url: 'https://a.com/', lastAccessed: NOW - 60 * MIN, ...over };
}
const pick = (t: DiscardCandidate, s = settings) => pickTabsToDiscard([t], s, NOW).length === 1;

describe('pickTabsToDiscard', () => {
  it('picks an idle ordinary tab', () => {
    expect(pick(tab())).toBe(true);
  });
  it('does nothing when off', () => {
    expect(pick(tab(), { ...settings, autoDiscardMinutes: 0 })).toBe(false);
  });
  it('skips active, discarded and audible tabs', () => {
    expect(pick(tab({ active: true }))).toBe(false);
    expect(pick(tab({ discarded: true }))).toBe(false);
    expect(pick(tab({ audible: true }))).toBe(false);
  });
  it('skips tabs Chrome says are not auto-discardable', () => {
    expect(pick(tab({ autoDiscardable: false }))).toBe(false);
    expect(pick(tab({ autoDiscardable: true }))).toBe(true);
  });
  it('skips pinned tabs unless the setting allows them', () => {
    expect(pick(tab({ pinned: true }))).toBe(false);
    expect(pick(tab({ pinned: true }), { ...settings, autoDiscardPinned: true })).toBe(true);
  });
  it('skips non-real URLs', () => {
    expect(pick(tab({ url: 'chrome://settings' }))).toBe(false);
    expect(pick(tab({ url: undefined }))).toBe(false);
  });
  it('skips excepted domains including subdomains, not lookalikes', () => {
    const s = { ...settings, autoDiscardExceptDomains: 'github.com, b.org' };
    expect(pick(tab({ url: 'https://gist.github.com/x' }), s)).toBe(false);
    expect(pick(tab({ url: 'https://notgithub.com/x' }), s)).toBe(true);
  });
  it('skips tabs with missing or too-recent lastAccessed', () => {
    expect(pick(tab({ lastAccessed: undefined }))).toBe(false);
    expect(pick(tab({ lastAccessed: NOW - 29 * MIN }))).toBe(false);
    expect(pick(tab({ lastAccessed: NOW - 30 * MIN }))).toBe(true);
  });
  it('skips tabs without an id', () => {
    expect(pick(tab({ id: undefined }))).toBe(false);
  });
});
