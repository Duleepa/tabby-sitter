import { addRule, getRules, removeRule, reorderRule, toggleRule, updateRule, type GroupRule, type MatchMode } from '../storage/rules';
import {
  exportConfigFile,
  importConfigFile,
  downloadStarterConfig,
} from '../storage/config';

const $ = (id: string) => document.getElementById(id);
const $$ = (sel: string) => document.querySelector(sel);

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
      (r, i) => `
    <div class="rule-item${r.enabled === false ? ' rule-disabled' : ''}" data-id="${r.id}">
      <div class="rule-info">
        <div class="rule-header">
          <span class="rule-pill" style="background-color: var(--color-${r.color || 'blue'}); color: #fff;">${escapeHtml(r.groupName)}</span>
          ${r.description ? '<span class="rule-desc">' + escapeHtml(r.description) + '</span>' : ''}
        </div>
        <div class="rule-meta">
          ${renderPatterns(r.patterns, r.matchMode)}
        </div>
      </div>
      <div class="rule-actions">
        <button class="icon-btn" data-reorder="up" data-id="${r.id}"${i === 0 ? ' disabled' : ''} title="Move up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="icon-btn" data-reorder="down" data-id="${r.id}"${i === rules.length - 1 ? ' disabled' : ''} title="Move down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="icon-btn" data-edit="${r.id}" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" data-remove="${r.id}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <input type="checkbox" class="rule-toggle" data-toggle="${r.id}"${r.enabled !== false ? ' checked' : ''} title="${r.enabled === false ? 'Enable rule' : 'Disable rule'}" />
      </div>
    </div>
  `
    )
    .join('');
}

function renderEditForm(rule: GroupRule): string {
  const colors = ['blue', 'red', 'yellow', 'green', 'cyan', 'purple', 'orange', 'pink', 'grey'];
  const colorOptions = colors.map((c) =>
    `<option value="${c}"${c === rule.color ? ' selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');

  return `
    <div class="rule-item rule-item-edit" data-id="${rule.id}">
      <label class="edit-label">Patterns</label>
      <textarea class="edit-patterns" rows="2">${escapeHtml(rule.patterns.join(', '))}</textarea>

      <label class="edit-label">Match Mode</label>
      <select class="edit-matchMode">
        <option value="contains"${rule.matchMode === 'contains' ? ' selected' : ''}>Contains</option>
        <option value="regex"${rule.matchMode === 'regex' ? ' selected' : ''}>Regex</option>
      </select>

      <label class="edit-label">Group Name</label>
      <input class="edit-groupName" type="text" value="${escapeHtml(rule.groupName)}" />

      <label class="edit-label">Color</label>
      <select class="edit-color">${colorOptions}</select>

      <label class="edit-label">Description (optional)</label>
      <input class="edit-description" type="text" value="${escapeHtml(rule.description || '')}" />

      <div class="edit-actions">
        <button class="small" data-save="${rule.id}">Save</button>
        <button class="outline small" data-cancel="${rule.id}">Cancel</button>
      </div>
    </div>
  `;
}

function parsePatterns(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function refresh() {
  const rules = await getRules();
  renderRules(rules);
}

async function init() {
  // Set version from manifest
  const manifest = chrome.runtime.getManifest();
  const versionEl = $('version');
  if (versionEl) {
    versionEl.textContent = `v${manifest.version}`;
  }

  await refresh();

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab || 'rules';
      setActiveTab(tab);
    });
  });

  // Event delegation for rule list actions
  $('rulesList')?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Remove button
    const removeBtn = target.closest('[data-remove]');
    if (removeBtn) {
      const id = (removeBtn as HTMLElement).dataset.remove;
      if (!id) return;

      const rules = await getRules();
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;

      if (!confirm(`Remove rule "${rule.groupName}"?`)) return;

      await removeRule(id);
      await refresh();
      showStatus('Rule removed');
      return;
    }

    // Toggle checkbox
    const toggle = target.closest('.rule-toggle') as HTMLInputElement | null;
    if (toggle) {
      const id = toggle.dataset.toggle;
      if (!id) return;
      const enabled = await toggleRule(id);
      if (enabled === null) return;
      await refresh();
      showStatus(enabled ? 'Rule enabled' : 'Rule disabled');
      return;
    }

    // Reorder buttons
    const reorderBtn = target.closest('[data-reorder]');
    if (reorderBtn) {
      const direction = (reorderBtn as HTMLElement).dataset.reorder as 'up' | 'down';
      const id = (reorderBtn as HTMLElement).dataset.id;
      if (!id || !direction) return;
      await reorderRule(id, direction);
      await refresh();
      return;
    }

    // Edit button
    const editBtn = target.closest('[data-edit]');
    if (editBtn) {
      const id = (editBtn as HTMLElement).dataset.edit;
      if (!id) return;
      const rules = await getRules();
      const rule = rules.find((r) => r.id === id);
      if (!rule) return;
      const list = $('rulesList');
      if (list) list.innerHTML = renderEditForm(rule);
      return;
    }

    // Save button (edit form)
    const saveBtn = target.closest('[data-save]');
    if (saveBtn) {
      const id = (saveBtn as HTMLElement).dataset.save;
      if (!id) return;

      const patternsRaw = ($$('.edit-patterns') as HTMLTextAreaElement)?.value.trim();
      const groupName = ($$('.edit-groupName') as HTMLInputElement)?.value.trim();
      const color = ($$('.edit-color') as HTMLSelectElement)?.value as chrome.tabGroups.ColorEnum;
      const matchMode = ($$('.edit-matchMode') as HTMLSelectElement)?.value as MatchMode;
      const description = ($$('.edit-description') as HTMLInputElement)?.value.trim();

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

      const result = await updateRule(id, { patterns, groupName, color, matchMode, description: description || undefined });
      if (!result) {
        showStatus('Rule not found');
        return;
      }
      await refresh();
      showStatus('Rule updated');
      return;
    }

    // Cancel button (edit form)
    const cancelBtn = target.closest('[data-cancel]');
    if (cancelBtn) {
      await refresh();
      return;
    }
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

    const result = await addRule({ patterns, groupName, color, matchMode, description: description || undefined });
    if (!result) {
      showStatus('A rule with these patterns and group name already exists');
      return;
    }

    ($('patterns') as HTMLTextAreaElement).value = '';
    ($('groupName') as HTMLInputElement).value = '';
    ($('description') as HTMLInputElement).value = '';
    ($('matchMode') as HTMLSelectElement).value = 'contains';

    await refresh();
    showStatus('Rule added');
    setActiveTab('rules');
  });

  const ORGANIZE_IDLE = '📋 Organize All Tabs';
  const ORGANIZE_DELAY_MS = 2000;

  // Organize All Tabs (header button)
  $('organizeTabs')?.addEventListener('click', async () => {
    const btn = $('organizeTabs') as HTMLButtonElement;
    if (!btn || btn.disabled) return;
    btn.textContent = '📋 ...';
    btn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({ action: 'organizeAllTabs' });
      if (response?.success) {
        btn.textContent = '✅ Tabs Organized';
      } else {
        btn.textContent = '❌ Failed!';
      }
    } catch (err) {
      btn.textContent = '❌ Error!';
      console.error(err);
    }

    setTimeout(() => {
      btn.textContent = ORGANIZE_IDLE;
      btn.disabled = false;
    }, ORGANIZE_DELAY_MS);
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

    const action = confirm('Merge with existing rules?\n\nOK = Merge\nCancel = Replace all');
    const mode = action ? 'merge' : 'replace';
    const actionLabel = mode === 'merge' ? 'Merged' : 'Replaced';

    try {
      await importConfigFile(file, mode);
      await refresh();
      showStatus(`Config ${actionLabel}!`);
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
