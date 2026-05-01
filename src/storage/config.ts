import { getRules, saveRules, type GroupRule } from './rules';

export interface ConfigFile {
  tabbySitter: {
    version: string;
    rules: GroupRule[];
  };
}

const CONFIG_FILE_NAME = 'tabby-sitter.conf.json';
const CONFIG_VERSION = '0.2.0';

/**
 * Download current rules as a JSON config file.
 * The user chooses the download location via the browser's native dialog.
 */
export async function exportConfigFile(): Promise<void> {
  const rules = await getRules();
  const config: ConfigFile = {
    tabbySitter: {
      version: CONFIG_VERSION,
      rules,
    },
  };

  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CONFIG_FILE_NAME;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import rules from a JSON config file dropped/picked by the user.
 * Accepts new schema (patterns + matchMode) and old single-pattern schema.
 */
export async function importConfigFile(file: File): Promise<GroupRule[]> {
  // Reject unreasonably large files as a hardening measure
  const MAX_SIZE = 1024 * 1024; // 1 MB
  if (file.size > MAX_SIZE) {
    throw new Error('Config file is too large (max 1 MB)');
  }

  const text = await file.text();
  const parsed = JSON.parse(text) as ConfigFile;

  if (!parsed.tabbySitter?.rules || !Array.isArray(parsed.tabbySitter.rules)) {
    throw new Error('Invalid config file: expected { tabbySitter: { rules: [...] } }');
  }

  const rules = (parsed.tabbySitter.rules as any[]).map((r) => ({
    id: (r.id || crypto.randomUUID()) as string,
    patterns:
      Array.isArray(r.patterns) && r.patterns.length > 0
        ? (r.patterns as string[])
        : r.pattern
          ? [r.pattern as string]
          : [],
    groupName: (r.groupName || '') as string,
    description: r.description as string | undefined,
    color: r.color as chrome.tabGroups.ColorEnum | undefined,
    matchMode: (r.matchMode || 'contains') as 'contains' | 'regex',
  }));

  if (rules.some((r) => r.patterns.length === 0)) {
    throw new Error('Invalid rule: patterns cannot be empty');
  }

  await saveRules(rules);
  return rules;
}

/**
 * Create a fresh config file with a starter template.
 */
export function createStarterConfig(): ConfigFile {
  function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  return {
    tabbySitter: {
      version: CONFIG_VERSION,
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
    },
  };
}

/**
 * Download the starter config as a file the user can edit and sync.
 */
export function downloadStarterConfig(): void {
  const config = createStarterConfig();
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CONFIG_FILE_NAME;
  a.click();
  URL.revokeObjectURL(url);
}
