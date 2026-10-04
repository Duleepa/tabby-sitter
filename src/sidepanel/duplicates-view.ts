import { el } from './dom';
import { activateTab, closeTabs } from './tab-actions';
import { onViewData, type ViewData } from './tabs-view';
import { getSettings } from '../storage/config';
import { getNotices } from '../storage/duplicates';
import { duplicateCount, findDuplicateClusters } from '../utils/duplicates';
import { NOTICE_TTL_MS, type DuplicateNotice } from '../utils/notices';
import { parseIgnoreParams } from '../utils/url';

let data: ViewData | null = null;
let ignoreParams: string[] = [];
let notices: DuplicateNotice[] = [];
let open = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

let chipEl: HTMLButtonElement;
let viewEl: HTMLElement;
let treeEl: HTMLElement;
let noticesEl: HTMLElement;

function fail(err: unknown): void {
  console.error('[Sidepanel]', err);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function send(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(fail);
}

// ---------- notices ----------

function noticeButton(label: string, onClick: () => void, className = 'notice-btn'): HTMLButtonElement {
  const b = el('button', className, { type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function respond(id: string, choice: string): void {
  notices = notices.filter((n) => n.id !== id);
  renderNotices();
  send({ action: 'duplicateNotice', id, choice });
}

export function renderNotices(): void {
  clearTimeout(expiryTimer);
  const now = Date.now();
  const visible = notices.filter(
    (n) => now - n.at <= NOTICE_TTL_MS && (!data || data.allWindows || n.windowId === data.windowId)
  );

  noticesEl.replaceChildren(
    ...visible.map((n) => {
      const row = el('div', `notice ${n.kind}`, { role: 'status', 'data-id': n.id });
      const name = n.title || hostOf(n.url);
      if (n.kind === 'closed') {
        row.append(
          el('span', 'notice-text', undefined, `Switched to your existing tab for ${name}`),
          noticeButton('Undo', () => respond(n.id, 'undo'))
        );
      } else {
        row.append(
          el('span', 'notice-text', undefined, `${name} is already open`),
          noticeButton('Switch & close this', () => respond(n.id, 'switch')),
          noticeButton('Keep both', () => respond(n.id, 'keep'))
        );
      }
      const x = noticeButton('×', () => respond(n.id, 'dismiss'), 'notice-x');
      x.setAttribute('aria-label', 'Dismiss');
      row.appendChild(x);
      return row;
    })
  );

  if (visible.length > 0) {
    const next = Math.min(...visible.map((n) => n.at + NOTICE_TTL_MS)) - now;
    expiryTimer = setTimeout(renderNotices, Math.max(next, 0) + 50);
  }
}

async function loadNotices(): Promise<void> {
  notices = await getNotices();
  renderNotices();
}

// ---------- duplicates view ----------

function windowLabeller(d: ViewData): (windowId: number) => string {
  const ids = [...new Set(d.tabs.map((t) => t.windowId))].sort((a, b) => a - b);
  return (id) => (id === d.windowId ? 'This window' : `Window ${ids.indexOf(id) + 1}`);
}

function renderDuplicates(): void {
  if (!data) return;
  const d = data;
  const clusters = findDuplicateClusters(d.tabs, ignoreParams);
  const count = duplicateCount(clusters);

  chipEl.textContent = `Duplicates (${count})`;
  chipEl.classList.toggle('hidden', count === 0);
  if (count === 0 && open) setOpen(false);
  if (!open) return;

  const label = windowLabeller(d);
  const groupTitle = (id: number) => d.groups.find((g) => g.id === id)?.title;
  const header = el('div', 'dup-header');
  header.append(el('span', 'dup-summary', undefined, `${count} duplicate tab${count === 1 ? '' : 's'}`));
  const all = el('button', 'small', { type: 'button' }, 'Close all duplicates');
  all.addEventListener('click', () => send({ action: 'closeDuplicates' }));
  header.appendChild(all);

  const cards = clusters.map((c) => {
    const card = el('div', 'dup-card');
    card.append(
      el('div', 'dup-title', undefined, c.tabs[0].title || c.key),
      el('div', 'dup-url', undefined, c.key)
    );
    for (const tab of c.tabs) {
      const where = [
        label(tab.windowId),
        tab.groupId !== -1 ? groupTitle(tab.groupId) : undefined,
        tab.pinned ? 'pinned' : undefined,
        tab.active ? 'active' : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
      const row = el('div', 'dup-row', { tabindex: '0', role: 'button', title: tab.url ?? '' });
      row.append(el('span', 'dup-where', undefined, where));
      const keep = el('button', 'dup-keep', { type: 'button' }, 'Keep this one');
      keep.addEventListener('click', (e) => {
        e.stopPropagation();
        const others = c.tabs.filter((t) => t !== tab && !t.pinned).flatMap((t) => (t.id === undefined ? [] : [t.id]));
        closeTabs(others).catch(fail);
      });
      const close = el('button', 'dup-close', { type: 'button', 'aria-label': 'Close tab' }, '×');
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        if (tab.id !== undefined) closeTabs([tab.id]).catch(fail);
      });
      row.append(keep, close);
      const activate = () => activateTab(tab).catch(fail);
      row.addEventListener('click', activate);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') activate();
      });
      card.appendChild(row);
    }
    return card;
  });

  const scroll = viewEl.scrollTop;
  viewEl.replaceChildren(header, ...cards);
  viewEl.scrollTop = scroll;
}

function setOpen(next: boolean): void {
  open = next;
  chipEl.setAttribute('aria-pressed', String(open));
  chipEl.classList.toggle('active', open);
  viewEl.classList.toggle('hidden', !open);
  treeEl.classList.toggle('hidden', open);
  if (open) renderDuplicates();
}

export function initDuplicatesView(): void {
  chipEl = document.getElementById('dupChip') as HTMLButtonElement;
  viewEl = document.getElementById('dupView') as HTMLElement;
  treeEl = document.getElementById('tree') as HTMLElement;
  noticesEl = document.getElementById('notices') as HTMLElement;

  chipEl.addEventListener('click', () => setOpen(!open));

  onViewData((d) => {
    data = d;
    renderDuplicates();
    renderNotices();
  });

  const loadSettings = () =>
    getSettings()
      .then((s) => {
        ignoreParams = parseIgnoreParams(s.duplicateIgnoreParams);
        renderDuplicates();
      })
      .catch(fail);
  loadSettings().catch(fail);
  loadNotices().catch(fail);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) loadSettings().catch(fail);
    if (area === 'session' && changes.duplicateNotices) loadNotices().catch(fail);
  });
}
