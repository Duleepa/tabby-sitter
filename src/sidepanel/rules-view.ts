import {
  addRule,
  getRules,
  removeRule,
  reorderRule,
  toggleRule,
  updateRule,
  type GroupColor,
  type GroupRule,
  type MatchMode,
} from '../storage/rules';
import { showStatus } from './dom';
import { GROUP_COLORS } from './tab-tree';

const $ = (id: string) => document.getElementById(id);
const $$ = (sel: string) => document.querySelector(sel);

const COLORS: readonly string[] = GROUP_COLORS;

function safeColor(c: string | undefined): string {
  return c && COLORS.includes(c) ? c : 'blue';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPatterns(patterns: string[], mode: MatchMode): string {
  const joined = patterns.join(', ');
  const text = joined.length > 50 ? joined.slice(0, 50) + '…' : joined;
  return `${escapeHtml(text)} <span class="rule-mode">(${mode})</span>`;
}

function renderRules(rules: GroupRule[]) {
  const list = $('rulesList');
  if (!list) return;

  if (rules.length === 0) {
    list.innerHTML = '<div class="empty">No rules yet. Click “Add rule” to create one.</div>';
    return;
  }

  list.innerHTML = rules
    .map(
      (r, i) => `
    <div class="rule-item${r.enabled === false ? ' rule-disabled' : ''}" data-id="${escapeHtml(r.id)}">
      <div class="rule-info">
        <div class="rule-header">
          <span class="rule-pill" style="background-color: var(--color-${safeColor(r.color)}); color: #fff;">${escapeHtml(r.groupName)}</span>
          ${r.description ? '<span class="rule-desc">' + escapeHtml(r.description) + '</span>' : ''}
        </div>
        <div class="rule-meta">
          ${renderPatterns(r.patterns, r.matchMode)}
        </div>
      </div>
      <div class="rule-actions">
        <button class="icon-btn" data-reorder="up" data-id="${escapeHtml(r.id)}"${i === 0 ? ' disabled' : ''} title="Move up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="icon-btn" data-reorder="down" data-id="${escapeHtml(r.id)}"${i === rules.length - 1 ? ' disabled' : ''} title="Move down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="icon-btn" data-edit="${escapeHtml(r.id)}" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn" data-remove="${escapeHtml(r.id)}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <input type="checkbox" class="rule-toggle" data-toggle="${escapeHtml(r.id)}"${r.enabled !== false ? ' checked' : ''} title="${r.enabled === false ? 'Enable rule' : 'Disable rule'}" />
      </div>
    </div>
  `
    )
    .join('');
}

function renderEditForm(rule: GroupRule): string {
  const colorOptions = COLORS.map((c) =>
    `<option value="${c}"${c === rule.color ? ' selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
  ).join('');

  return `
    <div class="rule-item rule-item-edit" data-id="${escapeHtml(rule.id)}">
      <label class="edit-label">Patterns</label>
      <textarea class="edit-patterns" rows="2">${escapeHtml(rule.patterns.join(', '))}</textarea>

      <label class="edit-label">Match Mode</label>
      <select class="edit-matchMode">
        <option value="contains"${rule.matchMode === 'contains' ? ' selected' : ''}>Contains</option>
        <option value="regex"${rule.matchMode === 'regex' ? ' selected' : ''}>Regex</option>
        <option value="domain"${rule.matchMode === 'domain' ? ' selected' : ''}>Domain</option>
      </select>

      <label class="edit-label">Group Name</label>
      <input class="edit-groupName" type="text" value="${escapeHtml(rule.groupName)}" />

      <label class="edit-label">Color</label>
      <select class="edit-color">${colorOptions}</select>

      <label class="edit-label">Description (optional)</label>
      <input class="edit-description" type="text" value="${escapeHtml(rule.description ?? '')}" />

      <div class="edit-actions">
        <button class="small" data-save="${escapeHtml(rule.id)}">Save</button>
        <button class="outline small" data-cancel="${escapeHtml(rule.id)}">Cancel</button>
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

export async function refreshRules() {
  const rules = await getRules();
  renderRules(rules);
}

const refresh = refreshRules;

function toggleAddForm(show: boolean) {
  $('addRulePanel')?.classList.toggle('hidden', !show);
  $('showAddRule')?.setAttribute('aria-expanded', String(show));
  if (show) $('patterns')?.focus();
}

export async function initRulesView() {
  await refresh();

  $('showAddRule')?.addEventListener('click', () => {
    toggleAddForm($('addRulePanel')?.classList.contains('hidden') ?? true);
  });
  $('cancelAddRule')?.addEventListener('click', () => toggleAddForm(false));

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
    const toggle = target.closest<HTMLElement>('.rule-toggle');
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
      const color = ($$('.edit-color') as HTMLSelectElement)?.value as GroupColor;
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
    const color = ($('color') as HTMLSelectElement)?.value as GroupColor;
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
    toggleAddForm(false);
  });
}
