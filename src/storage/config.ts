import { getRules, saveRules, type GroupRule } from './rules';

export interface ConfigFile {
  tabbySitter: {
    version: string;
    rules: GroupRule[];
  };
}

const CONFIG_FILE_NAME = 'tabby-sitter.conf.json';

/**
 * Download current rules as a JSON config file.
 * The user chooses the download location via the browser's native dialog.
 */
export async function exportConfigFile(): Promise<void> {
  const rules = await getRules();
  const config: ConfigFile = {
    tabbySitter: {
      version: '1.0.0',
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
 */
export async function importConfigFile(file: File): Promise<GroupRule[]> {
  const text = await file.text();
  const parsed = JSON.parse(text) as ConfigFile;

  if (!parsed.tabbySitter?.rules || !Array.isArray(parsed.tabbySitter.rules)) {
    throw new Error('Invalid config file: expected { tabbySitter: { rules: [...] } }');
  }

  const rules = parsed.tabbySitter.rules.map((r) => ({
    id: r.id || crypto.randomUUID(),
    pattern: r.pattern,
    groupName: r.groupName,
    description: r.description,
    color: r.color,
  }));

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
      version: '1.0.0',
      rules: [
        {
          id: generateId(),
          pattern: 'github.com',
          groupName: 'Dev',
          description: 'GitHub repos, PRs, issues',
          color: 'blue',
        },
        {
          id: generateId(),
          pattern: 'stackoverflow.com',
          groupName: 'Dev',
          description: 'Stack Overflow questions',
          color: 'blue',
        },
        {
          id: generateId(),
          pattern: 'docs.google.com',
          groupName: 'Docs',
          description: 'Google Docs',
          color: 'green',
        },
        {
          id: generateId(),
          pattern: 'mail.google.com',
          groupName: 'Comms',
          description: 'Gmail',
          color: 'red',
        },
        {
          id: generateId(),
          pattern: 'youtube.com',
          groupName: 'Media',
          description: 'YouTube videos',
          color: 'purple',
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
