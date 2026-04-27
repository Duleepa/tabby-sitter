import { addRule, getRules, removeRule, type GroupRule, type MatchMode } from '../storage/rules';
import {
  exportConfigFile,
  importConfigFile,
  downloadStarterConfig,
} from '../storage/config';

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

function showStatus(msg: string) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => (el.textContent = ''), 3000);
}

function setActiveTab(tabName: string) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `${tabName}Panel`);
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderPatterns(patterns: string[], mode: MatchMode): string {
  const joined = escapeHtml(patterns.join(', '));
  if (joined.length > 50) {
    return joined.slice(0, 50) + '…';
  }
  return `${joined} <span class="rule-mode">(${mode})</span>`;
}

function renderRules(rules: GroupRule[]) {
  const list = $('rulesList');
  if (!list) return;

  if (rules.length === 0) {
    list.innerHTML = '<div class="empty">No rules yet. Open the Add tab to create one.</div>';
    return;
  }

  list.innerHTML = rules
    .map(
      (r) => `
    <div class="rule-item" data-id="${r.id}">
      <div class="rule-info">
        <div class="rule-title">${escapeHtml(r.description || r.groupName)}</div>
        <div class="rule-meta">
          ${r.description ? escapeHtml(r.groupName) + ' · ' : ''}
          ${renderPatterns(r.patterns, r.matchMode)}
        </div>
      </div>
      <button class="outline small" data-id="${r.id}">Remove</button>
    </div>
  `
    )
    .join('');

  list.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id;
      if (!id) return;
      await removeRule(id);
      await refresh();
      showStatus('Rule removed');
    });
  });
}

async function refresh() {
  const rules = await getRules();
  renderRules(rules);
}

function parsePatterns(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function init() {
  await refresh();

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab || 'rules';
      setActiveTab(tab);
    });
  });

  // Add Rule
  $('addRule')?.addEventListener('click', async () => {
    const patternsRaw = ($('patterns') as HTMLTextAreaElement)?.value.trim();
    const groupName = ($('groupName') as HTMLInputElement)?.value.trim();
    const color = ($('color') as HTMLSelectElement)?.value as chrome.tabGroups.ColorEnum;
    const matchMode = ($('matchMode') as HTMLSelectElement)?.value as MatchMode;
    const description = ($('description') as HTMLInputElement)?.value.trim();

    const patterns = parsePatterns(patternsRaw);

    if (patterns.length === 0 || !groupName) {
      showStatus('At least one pattern and a group name are required');
      return;
    }

    if (matchMode === 'regex') {
      const invalid = patterns.find((p) => {
        try { new RegExp(p); return false; }
        catch { return true; }
      });
      if (invalid !== undefined) {
        showStatus(`Invalid regex: "${invalid}"`);
        return;
      }
    }

    await addRule({ patterns, groupName, color, matchMode, description: description || undefined });

    ($('patterns') as HTMLTextAreaElement).value = '';
    ($('groupName') as HTMLInputElement).value = '';
    ($('description') as HTMLInputElement).value = '';
    ($('matchMode') as HTMLSelectElement).value = 'contains';

    await refresh();
    showStatus('Rule added');
    setActiveTab('rules');
  });

  // Organize All Tabs (header button)
  $('organizeTabs')?.addEventListener('click', async () => {
    const btn = $('organizeTabs') as HTMLButtonElement;
    if (!btn) return;
    const originalText = btn.textContent || '📋 Organize All Tabs';
    btn.textContent = '📋 Organizing...';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({ action: 'organizeAllTabs' });
      if (response?.success) {
        showStatus('Tabs organized!');
      } else {
        showStatus('Failed to organize tabs');
      }
    } catch (err) {
      showStatus('Error: ' + String(err));
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // Config file actions
  $('exportConfig')?.addEventListener('click', async () => {
    try {
      await exportConfigFile();
      showStatus('Config exported!');
    } catch (err) {
      showStatus('Export failed: ' + String(err));
    }
  });

  $('importConfig')?.addEventListener('click', () => {
    ($('configFileInput') as HTMLInputElement)?.click();
  });

  $('configFileInput')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      await importConfigFile(file);
      await refresh();
      showStatus('Config imported!');
    } catch (err) {
      showStatus('Import failed: ' + String(err));
    } finally {
      input.value = '';
    }
  });

  $('createConfig')?.addEventListener('click', () => {
    downloadStarterConfig();
    showStatus('Starter config downloaded!');
  });
}

init();
