import { getRules, saveRules, type GroupRule } from './rules';
import { listSavedGroups, replaceAllSavedGroups } from './saved-groups';
import { getDeviceId } from './sync-state';
import { buildSyncFile, parseSyncFile, type SyncContent, type SyncFile } from './sync-file';
import { generateId } from '../utils/id';

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

/**
 * Create a fresh config file with a starter template.
 */
export function createStarterConfig(): ConfigFile {
  return buildSyncFile({
      rules: [
        {
          id: generateId(),
          patterns: ['github.com', 'stackoverflow.com'],
          groupName: 'Dev',
          description: 'GitHub repos and Stack Overflow',
          color: 'blue',
          matchMode: 'contains',
        },
        {
          id: generateId(),
          patterns: ['docs.google.com'],
          groupName: 'Docs',
          description: 'Google Docs',
          color: 'green',
          matchMode: 'contains',
        },
        {
          id: generateId(),
          patterns: ['mail.google.com'],
          groupName: 'Comms',
          description: 'Gmail',
          color: 'red',
          matchMode: 'contains',
        },
        {
          id: generateId(),
          patterns: ['youtube.com', 'www.youtube.com'],
          groupName: 'Media',
          description: 'YouTube videos',
          color: 'purple',
          matchMode: 'contains',
        },
        {
          id: generateId(),
          patterns: ['x.com', 'twitter.com', 'instagram.com'],
          groupName: 'Social',
          description: 'Social media sites',
          color: 'cyan',
          matchMode: 'contains',
        },
      ],
  });
}

/**
 * Download the starter config as a file the user can edit and sync.
 */
export function downloadStarterConfig(): void {
  downloadJson(createStarterConfig());
}

export type DuplicateTabMode = 'allow' | 'prevent-all' | 'prevent-specific';

export interface ExtensionSettings {
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
  return { ...DEFAULT_SETTINGS, ...(result.settings as Partial<ExtensionSettings>) };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
