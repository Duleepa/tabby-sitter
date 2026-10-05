import { el, showStatus } from './dom';
import { GROUP_COLORS } from './tab-tree';
import { deleteSavedGroup, listSavedGroups, renameSavedGroup, saveGroup, type SavedGroup } from '../storage/saved-groups';
import { relativeTime } from '../utils/time';

// All saved titles and URLs come from web pages: build the DOM with textContent only.

let groups: SavedGroup[] = [];
const expanded = new Set<string>();
let editing = false;
let pending = false;
let listEl: HTMLElement;
let toastEl: HTMLElement;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function fail(err: unknown): void {
  console.error('[Sidepanel]', err);
  showStatus('Action failed: ' + (err instanceof Error ? err.message : String(err)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function currentWindowId(): Promise<number | undefined> {
  return (await chrome.windows.getCurrent()).id;
}

async function send(message: Record<string, unknown>): Promise<{ success?: boolean; error?: string } | undefined> {
  return (await chrome.runtime.sendMessage(message));
}

async function restore(g: SavedGroup, newWindow: boolean): Promise<void> {
  const res = await send({ action: 'restoreSavedGroup', id: g.id, newWindow, windowId: await currentWindowId() });
  showStatus(res?.success ? `Restored “${g.title}”` : `Restore failed: ${res?.error ?? 'unknown error'}`);
}

function showUndo(deleted: SavedGroup): void {
  clearTimeout(toastTimer);
  const undo = el('button', 'toast-btn', { type: 'button' }, 'Undo');
  undo.addEventListener('click', () => {
    clearTimeout(toastTimer);
    toastEl.replaceChildren();
    saveGroup(deleted).catch(fail);
  });
  toastEl.replaceChildren(el('span', 'toast-text', undefined, `Deleted “${deleted.title}”`), undo);
  toastTimer = setTimeout(() => toastEl.replaceChildren(), 5000);
}

function startRename(g: SavedGroup, titleEl: HTMLElement): void {
  if (editing) return;
  editing = true;
  const input = el('input', 'rename-input', { type: 'text', 'aria-label': 'Saved group name', maxlength: '100' });
  input.value = g.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    editing = false;
    const value = input.value.trim();
    if (commit && value && value !== g.title) renameSavedGroup(g.id, value).catch(fail);
    else render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function action(label: string, onClick: () => void, className = 'small outline'): HTMLButtonElement {
  const b = el('button', className, { type: 'button' }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function card(g: SavedGroup): HTMLElement {
  const open = expanded.has(g.id);
  const c = el('div', 'saved-card');
  const color = (GROUP_COLORS as readonly string[]).includes(g.color) ? g.color : 'grey';

  const head = el('div', 'saved-head');
  const toggle = el('button', 'saved-toggle', { type: 'button', 'aria-expanded': String(open) });
  const dot = el('span', 'dot', { 'aria-hidden': 'true' });
  dot.style.setProperty('--gc', `var(--group-${color})`);
  const title = el('span', 'saved-title', undefined, g.title);
  toggle.append(
    el('span', `chevron${open ? '' : ' collapsed'}`, { 'aria-hidden': 'true' }, '▾'),
    dot,
    title,
    el('span', 'count', undefined, String(g.tabs.length)),
    el('span', 'saved-date', undefined, relativeTime(g.updatedAt, Date.now()))
  );
  toggle.addEventListener('click', () => {
    if (!expanded.delete(g.id)) expanded.add(g.id);
    render();
  });
  head.appendChild(toggle);
  c.appendChild(head);

  const actions = el('div', 'saved-actions');
  actions.append(
    action('Restore', () => restore(g, false).catch(fail), 'small'),
    action('New window', () => restore(g, true).catch(fail)),
    action('Rename', () => startRename(g, title)),
    action('Delete', () => {
      deleteSavedGroup(g.id)
        .then(() => showUndo(g))
        .catch(fail);
    })
  );
  c.appendChild(actions);

  if (open) {
    const list = el('div', 'saved-tabs');
    for (const t of g.tabs) {
      const row = el('button', 'saved-tab', { type: 'button', title: t.url });
      row.append(el('span', 'title', undefined, t.title), el('span', 'host', undefined, hostOf(t.url)));
      row.addEventListener('click', () => {
        currentWindowId()
          .then((windowId) => send({ action: 'openSavedTab', url: t.url, windowId }))
          .catch(fail);
      });
      list.appendChild(row);
    }
    c.appendChild(list);
  }
  return c;
}

function render(): void {
  if (editing) {
    pending = true;
    return;
  }
  pending = false;
  if (groups.length === 0) {
    listEl.replaceChildren(
      el(
        'div',
        'empty',
        undefined,
        'No saved groups yet. Open a group’s ⋯ menu in the Tabs view and choose “Save group”, or select tabs, right-click and choose “Save selection as group…”.'
      )
    );
    return;
  }
  listEl.replaceChildren(...[...groups].sort((a, b) => b.updatedAt - a.updatedAt).map(card));
}

async function load(): Promise<void> {
  groups = await listSavedGroups();
  render();
}

export function initSavedView(): void {
  listEl = document.getElementById('savedList') as HTMLElement;
  toastEl = document.getElementById('savedToast') as HTMLElement;
  load().catch(fail);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.savedGroups) load().catch(fail);
  });
  document.addEventListener('focusout', () => {
    if (pending && !editing) render();
  });
}
