import type { ExtensionSettings } from '../storage/config';

const THEME_LABELS: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export const SETTINGS_OPEN_KEY = 'settingsOpen';

/**
 * One-line state shown under each collapsed settings card title.
 * `discardLabel` is the selected option's text (e.g. "1 hour"); falls back to minutes.
 */
export function settingSummaries(
  s: ExtensionSettings,
  discardLabel?: string,
): { theme: string; duplicates: string; keep: string; memory: string; sort: string } {
  let duplicates = 'Off';
  if (s.duplicateTabMode !== 'allow') {
    duplicates = s.duplicateTabMode === 'prevent-specific' ? 'Specific sites' : 'All sites';
    if (s.duplicateTabConfirm) duplicates += ' · asks first';
  }
  let memory = 'Off';
  if (s.autoDiscardMinutes > 0) {
    memory = `Unload after ${discardLabel || `${s.autoDiscardMinutes} min`}`;
    if (s.autoDiscardPinned) memory += ' · pinned too';
  }
  return {
    theme: THEME_LABELS[s.theme] ?? 'System',
    duplicates,
    keep: s.keepOpenedTabsInGroup ? 'On' : 'Off',
    memory,
    sort: s.groupUnmatchedByDomain ? 'On' : 'Off',
  };
}
