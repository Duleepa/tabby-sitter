import { getRules, saveRules, type GroupRule } from './rules';
import { listSavedGroups, replaceAllSavedGroups } from './saved-groups';
import { getDeviceId } from './sync-state';
import { buildSyncFile, parseSyncFile, type SyncContent, type SyncFile } from './sync-file';

export type ConfigFile = SyncFile;

const CONFIG_FILE_NAME = 'tabby-sitter.conf.json';

/** Everything this device would sync: rules, settings and saved groups. */
export async function readLocalContent(): Promise<SyncContent> {
  const [rules, settings, savedGroups] = await Promise.all([getRules(), getSettings(), listSavedGroups()]);
  return { rules, settings, savedGroups };
}

/** Replace the local rules, and settings / saved groups when present in `content`. */
export async function applyContent(content: SyncContent): Promise<void> {
  await saveRules(content.rules);
  if (content.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...content.settings });
  if (content.savedGroups) await replaceAllSavedGroups(content.savedGroups);
}

function downloadJson(data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CONFIG_FILE_NAME;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download rules, settings and saved groups as a JSON config file.
 * The user chooses the download location via the browser's native dialog.
 */
export async function exportConfigFile(): Promise<void> {
  const content = await readLocalContent();
  const deviceId = await getDeviceId();
  downloadJson(buildSyncFile(content, { savedAt: new Date().toISOString(), deviceId }));
}

/**
 * Import a JSON config file picked by the user. Rules are replaced or merged; settings (if
 * present) overwrite the keys they contain; saved groups (if present) are replaced, or in merge
 * mode only those whose id is not already saved are added. Accepts v0.2 (rules only) files.
 */
export async function importConfigFile(file: File, mode: 'replace' | 'merge' = 'replace'): Promise<GroupRule[]> {
  const { content } = parseSyncFile(await file.text());
  const merge = mode === 'merge';

  let rules = content.rules;
  if (merge) {
    const existing = await getRules();
    const existingIds = new Set(existing.map((r) => r.id));
    rules = [...existing, ...content.rules.filter((r) => !existingIds.has(r.id))];
  }

  const next: SyncContent = { rules };
  if (content.settings) next.settings = { ...(await getSettings()), ...content.settings };
  if (content.savedGroups) {
    if (merge) {
      const existing = await listSavedGroups();
      const ids = new Set(existing.map((g) => g.id));
      next.savedGroups = [...existing, ...content.savedGroups.filter((g) => !ids.has(g.id))];
    } else {
      next.savedGroups = content.savedGroups;
    }
  }
  await applyContent(next);
  return rules;
}

export type DuplicateTabMode = 'allow' | 'prevent-all' | 'prevent-specific';

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeSetting = (typeof THEMES)[number];

/** Whitelist a theme value from storage or an imported file; anything unknown is 'system'. */
export function normalizeTheme(value: unknown): ThemeSetting {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
    ? (value as ThemeSetting)
    : 'system';
}

export interface ExtensionSettings {
  theme: ThemeSetting;
  groupUnmatchedByDomain: boolean;
  duplicateTabMode: DuplicateTabMode;
  duplicateTabDomains: string;
  duplicateTabConfirm: boolean;
  keepOpenedTabsInGroup: boolean;
  duplicateBadge: boolean;
  duplicateIgnoreParams: string;
  autoDiscardMinutes: number;
  autoDiscardPinned: boolean;
  autoDiscardExceptDomains: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  theme: 'system',
  groupUnmatchedByDomain: false,
  duplicateTabMode: 'allow',
  duplicateTabDomains: '',
  duplicateTabConfirm: true,
  keepOpenedTabsInGroup: true,
  duplicateBadge: true,
  duplicateIgnoreParams: '',
  autoDiscardMinutes: 0,
  autoDiscardPinned: false,
  autoDiscardExceptDomains: '',
};

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...(result.settings as Partial<ExtensionSettings>) };
  merged.theme = normalizeTheme(merged.theme);
  return merged;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
