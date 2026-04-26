import { addRule, getRules, removeRule, type GroupRule } from '../storage/rules';

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

function showStatus(msg: string) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  setTimeout(() => (el.textContent = ''), 3000);
}

function renderRules(rules: GroupRule[]) {
  const list = $('rulesList');
  if (!list) return;

  if (rules.length === 0) {
    list.innerHTML = `<div class="empty">No rules yet. Add one above.</div>`;
    return;
  }

  list.innerHTML = rules
    .map(
      (r) => `
    <div class="rule-item" data-id="${r.id}">
      <div class="rule-info">
        <div class="rule-pattern">${escapeHtml(r.pattern)}</div>
        <div class="rule-group">${escapeHtml(r.groupName)} ${r.description ? '— ' + escapeHtml(r.description) : ''}</div>
      </div>
      <div class="actions">
        <button class="delete" data-id="${r.id}">Remove</button>
      </div>
    </div>
  `
    )
    .join('');

  list.querySelectorAll('button.delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id;
      if (!id) return;
      await removeRule(id);
      await refresh();
      showStatus('Rule removed');
    });
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function refresh() {
  const rules = await getRules();
  renderRules(rules);
}

async function init() {
  await refresh();

  $('addRule')?.addEventListener('click', async () => {
    const pattern = ($('pattern') as HTMLInputElement)?.value.trim();
    const groupName = ($('groupName') as HTMLInputElement)?.value.trim();
    const color = ($('color') as HTMLSelectElement)?.value as chrome.tabGroups.ColorEnum;
    const description = ($('description') as HTMLInputElement)?.value.trim();

    if (!pattern || !groupName) {
      showStatus('Pattern and group name are required');
      return;
    }

    await addRule({ pattern, groupName, color, description: description || undefined });

    ($('pattern') as HTMLInputElement).value = '';
    ($('groupName') as HTMLInputElement).value = '';
    ($('description') as HTMLInputElement).value = '';

    await refresh();
    showStatus('Rule added');
  });

  $('organizeTabs')?.addEventListener('click', async () => {
    const btn = $('organizeTabs') as HTMLButtonElement;
    if (!btn) return;
    const originalText = btn.textContent || 'Organize Open Tabs';
    btn.textContent = 'Organizing...';
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
}

init();
