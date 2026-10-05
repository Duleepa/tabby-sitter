import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../storage/config';
import { settingSummaries } from './setting-summaries';

const mk = (o: Partial<ExtensionSettings>): ExtensionSettings => ({ ...DEFAULT_SETTINGS, ...o });

describe('settingSummaries', () => {
  it('describes defaults', () => {
    const r = settingSummaries(DEFAULT_SETTINGS);
    expect(r).toEqual({ theme: 'System', duplicates: 'Off', keep: 'On', memory: 'Off', sort: 'Off' });
  });
  it('describes duplicate modes', () => {
    expect(settingSummaries(mk({ duplicateTabMode: 'prevent-all', duplicateTabConfirm: false })).duplicates).toBe('All sites');
    expect(settingSummaries(mk({ duplicateTabMode: 'prevent-specific', duplicateTabConfirm: true })).duplicates).toBe('Specific sites · asks first');
    expect(settingSummaries(mk({ duplicateTabMode: 'allow', duplicateTabConfirm: true })).duplicates).toBe('Off');
  });
  it('describes memory', () => {
    expect(settingSummaries(mk({ autoDiscardMinutes: 60 }), '1 hour').memory).toBe('Unload after 1 hour');
    expect(settingSummaries(mk({ autoDiscardMinutes: 60, autoDiscardPinned: true }), '1 hour').memory).toBe('Unload after 1 hour · pinned too');
    expect(settingSummaries(mk({ autoDiscardMinutes: 15 })).memory).toBe('Unload after 15 min');
    expect(settingSummaries(mk({ autoDiscardMinutes: 0, autoDiscardPinned: true })).memory).toBe('Off');
  });
  it('describes theme, keep and sort', () => {
    const r = settingSummaries(mk({ theme: 'dark', keepOpenedTabsInGroup: false, groupUnmatchedByDomain: true }));
    expect(r).toMatchObject({ theme: 'Dark', keep: 'Off', sort: 'On' });
  });
});
