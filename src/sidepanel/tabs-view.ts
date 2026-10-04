import { el, showStatus } from './dom';
import { isMenuOpen, openMenu, type MenuItem } from './context-menu';
import { computeDrop, computeGroupMove, type DropTarget } from './drop';
import {
  activateTab,
  applyDrop,
  applyGroupMove,
  closeGroup,
  closeTabs,
  discardTabs,
  moveToGroup,
  moveToNewGroup,
  removeFromGroup,
  setPinned,
  toDropTabs,
  alwaysGroupSite,
  letRulesManage,
  siteHost,
  ungroupGroup,
  updateGroup,
} from './tab-actions';
import { getOverrides } from '../storage/overrides';
import { buildWindowTree, filterTree, GROUP_COLORS, type WindowTree } from './tab-tree';

interface RowRef {
  key: string;
  kind: 'tab' | 'group';
  id: number;
}

type DragState = { kind: 'tabs'; ids: number[] } | { kind: 'group'; id: number } | null;

const state = {
  windowId: -1,
  allWindows: false,
  query: '',
  selection: new Set<number>(),
  anchor: null as number | null,
  focusKey: null as string | null,
  tabs: [] as chrome.tabs.Tab[],
  groups: [] as chrome.tabGroups.TabGroup[],
  drag: null as DragState,
  editing: false,
  order: [] as RowRef[],
  manual: new Set<number>(),
};

let treeEl: HTMLElement;
let searchEl: HTMLInputElement;
let scheduled = false;
let pending = false;
let seq = 0;
let toggleTimer: ReturnType<typeof setTimeout> | undefined;
const TITLE_CLICK_DELAY_MS = 250;

function toggleGroup(groupId: number): void {
  const g = groupById(groupId);
  if (g) run(updateGroup(groupId, { collapsed: !g.collapsed }));
}

const isGroupColor = (c: string): c is (typeof GROUP_COLORS)[number] =>
  (GROUP_COLORS as readonly string[]).includes(c);
const colorVar = (c: string) => `var(--color-${isGroupColor(c) ? c : 'grey'})`;

function fail(err: unknown): void {
  console.error('[Sidepanel]', err);
  showStatus('Action failed: ' + (err instanceof Error ? err.message : String(err)));
}

function run(p: Promise<unknown>): void {
  p.catch(fail);
}

// ---------- data ----------

function blocked(): boolean {
  return state.drag !== null || state.editing;
}

async function refreshData(): Promise<void> {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowType: 'normal' }),
    chrome.tabGroups.query({}),
  ]);
  state.tabs = tabs;
  state.groups = groups;
  state.manual = new Set(await getOverrides());
  const ids = new Set(tabs.map((t) => t.id));
  for (const id of state.selection) if (!ids.has(id)) state.selection.delete(id);
}

export function scheduleRender(): void {
  if (blocked()) {
    pending = true;
    return;
  }
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const mine = ++seq;
    refreshData()
      .then(() => {
        if (mine !== seq) return;
        if (blocked()) {
          pending = true;
          return;
        }
        render();
      })
      .catch(fail);
  });
}

function flushPending(): void {
  if (pending && !blocked()) {
    pending = false;
    scheduleRender();
  }
}

// ---------- rendering ----------

function hostnameOf(url: string | undefined): string {
  if (!url || !/^(https?|file):/i.test(url)) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function safeFavicon(tab: chrome.tabs.Tab): string | null {
  const u = tab.favIconUrl;
  return u && /^(https?:|data:)/i.test(u) ? u : null;
}

function faviconEl(tab: chrome.tabs.Tab): HTMLElement {
  const src = safeFavicon(tab);
  const wrap = el('span', `favicon${tab.status === 'loading' ? ' loading' : ''}`);
  if (tab.status === 'loading') return wrap;
  if (src) {
    const img = el('img', undefined, { alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.remove());
    img.src = src;
    wrap.appendChild(img);
  }
  return wrap;
}

function tabLabel(tab: chrome.tabs.Tab): string {
  return tab.title || tab.url || 'New Tab';
}

function tabRow(tab: chrome.tabs.Tab, level: number): HTMLElement {
  const id = tab.id as number;
  const flags = [
    tab.active ? 'active' : '',
    state.selection.has(id) ? 'selected' : '',
    tab.discarded ? 'discarded' : '',
  ].filter(Boolean);
  const row = el('div', `row tab-row ${flags.join(' ')}`.trim(), {
    role: 'treeitem',
    tabindex: '-1',
    draggable: 'true',
    'aria-level': String(level),
    'aria-selected': String(state.selection.has(id)),
    'data-key': `t:${id}`,
    'data-tab-id': String(id),
    title: `${tabLabel(tab)}\n${tab.url ?? ''}`,
  });
  row.append(faviconEl(tab), el('span', 'title', undefined, tabLabel(tab)));
  const host = hostnameOf(tab.url);
  if (host) row.appendChild(el('span', 'host', undefined, host));
  if (tab.audible) row.appendChild(el('span', 'ind', { 'aria-label': 'Playing audio' }, '🔊'));
  else if (tab.mutedInfo?.muted) row.appendChild(el('span', 'ind', { 'aria-label': 'Muted' }, '🔇'));
  if (state.manual.has(id)) {
    row.appendChild(el('span', 'ind manual', { role: 'img', 'aria-label': 'Placed manually', title: "Rules won't move this tab" }, '✋'));
  }
  row.appendChild(el('button', 'close', { type: 'button', 'aria-label': 'Close tab', tabindex: '-1' }, '×'));
  state.order.push({ key: `t:${id}`, kind: 'tab', id });
  return row;
}

function pinnedRow(tab: chrome.tabs.Tab): HTMLElement {
  const id = tab.id as number;
  const row = el(
    'div',
    `row pin${tab.active ? ' active' : ''}${state.selection.has(id) ? ' selected' : ''}${tab.discarded ? ' discarded' : ''}`,
    {
      role: 'treeitem',
      tabindex: '-1',
      draggable: 'true',
      'aria-level': '1',
      'aria-selected': String(state.selection.has(id)),
      'aria-label': tabLabel(tab),
      'data-key': `t:${id}`,
      'data-tab-id': String(id),
      title: `${tabLabel(tab)}\n${tab.url ?? ''}`,
    }
  );
  row.appendChild(faviconEl(tab));
  state.order.push({ key: `t:${id}`, kind: 'tab', id });
  return row;
}

function groupNode(group: chrome.tabGroups.TabGroup, tabs: chrome.tabs.Tab[]): HTMLElement {
  const collapsed = group.collapsed && state.query.trim() === '';
  const wrap = el('div', 'group', { 'data-group-id': String(group.id) });
  wrap.style.setProperty('--gc', colorVar(group.color));

  const header = el('div', 'row group-header', {
    role: 'treeitem',
    tabindex: '-1',
    draggable: 'true',
    'aria-level': '1',
    'aria-expanded': String(!collapsed),
    'data-key': `g:${group.id}`,
    'data-group-id': String(group.id),
  });
  header.append(
    el('span', `chevron${collapsed ? ' collapsed' : ''}`, { 'aria-hidden': 'true' }, '▾'),
    el('span', 'dot', { 'aria-hidden': 'true' }),
    el('span', 'title group-title', undefined, group.title || 'Unnamed group'),
    el('span', 'count', undefined, String(tabs.length)),
    el('button', 'more', { type: 'button', 'aria-label': 'Group options', 'aria-haspopup': 'menu', tabindex: '-1' }, '⋯')
  );
  wrap.appendChild(header);
  state.order.push({ key: `g:${group.id}`, kind: 'group', id: group.id });

  if (!collapsed) {
    const body = el('div', 'group-tabs', { role: 'group' });
    for (const tab of tabs) body.appendChild(tabRow(tab, 2));
    wrap.appendChild(body);
  }
  return wrap;
}

function windowSection(tree: WindowTree, label: string | null, last: boolean): HTMLElement {
  const section = el('div', `window-section${last ? ' last' : ''}`, { 'data-window-id': String(tree.windowId) });
  if (label) section.appendChild(el('div', 'window-label', undefined, label));
  if (tree.pinned.length > 0) {
    const pins = el('div', 'pinned-row', { role: 'group', 'aria-label': 'Pinned tabs' });
    for (const t of tree.pinned) pins.appendChild(pinnedRow(t));
    section.appendChild(pins);
  }
  for (const node of tree.nodes) {
    section.appendChild(node.kind === 'tab' ? tabRow(node.tab, 1) : groupNode(node.group, node.tabs));
  }
  section.appendChild(el('div', 'drop-end', { 'data-window-id': String(tree.windowId), 'aria-hidden': 'true' }));
  return section;
}

function render(): void {
  const scrollTop = treeEl.scrollTop;
  const active = document.activeElement;
  const focusInTree = !!active && treeEl.contains(active) && active !== treeEl;
  const focusedKey = focusInTree ? (active as HTMLElement).dataset.key ?? null : null;
  if (focusedKey) state.focusKey = focusedKey;

  state.order = [];
  const windowIds = state.allWindows
    ? [...new Set(state.tabs.map((t) => t.windowId))].sort((a, b) =>
        a === state.windowId ? -1 : b === state.windowId ? 1 : a - b
      )
    : [state.windowId];

  const frag = document.createDocumentFragment();
  windowIds.forEach((wid, i) => {
    const tree = filterTree(buildWindowTree(state.tabs, state.groups, wid), state.query);
    const count = tree.pinned.length + tree.nodes.reduce((n, x) => n + (x.kind === 'tab' ? 1 : x.tabs.length), 0);
    if (state.allWindows && state.query.trim() !== '' && count === 0) return;
    const label = state.allWindows
      ? `${wid === state.windowId ? 'This window' : `Window ${i + 1}`} · ${count} tab${count === 1 ? '' : 's'}`
      : null;
    frag.appendChild(windowSection(tree, label, i === windowIds.length - 1));
  });
  if (state.order.length === 0 && state.query.trim() !== '') {
    frag.appendChild(el('div', 'empty', undefined, 'No matching tabs'));
  }

  treeEl.replaceChildren(frag);
  treeEl.scrollTop = scrollTop;

  const target = state.order.find((r) => r.key === state.focusKey) ?? state.order[0];
  if (target) {
    const row = rowByKey(target.key);
    if (row) {
      row.tabIndex = 0;
      if (focusInTree) row.focus({ preventScroll: true });
    }
  }
}

function rowByKey(key: string): HTMLElement | null {
  return treeEl.querySelector<HTMLElement>(`[data-key="${key}"]`);
}

function focusRow(key: string): void {
  const prev = treeEl.querySelector<HTMLElement>('.row[tabindex="0"]');
  if (prev) prev.tabIndex = -1;
  const row = rowByKey(key);
  if (!row) return;
  state.focusKey = key;
  row.tabIndex = 0;
  row.focus();
}

function paintSelection(): void {
  treeEl.querySelectorAll<HTMLElement>('.row[data-tab-id]').forEach((row) => {
    const sel = state.selection.has(Number(row.dataset.tabId));
    row.classList.toggle('selected', sel);
    row.setAttribute('aria-selected', String(sel));
  });
}

// ---------- helpers ----------

function tabById(id: number): chrome.tabs.Tab | undefined {
  return state.tabs.find((t) => t.id === id);
}

function groupById(id: number): chrome.tabGroups.TabGroup | undefined {
  return state.groups.find((g) => g.id === id);
}

function visibleTabIds(): number[] {
  return state.order.filter((r) => r.kind === 'tab').map((r) => r.id);
}

function actionTargets(id: number): number[] {
  if (state.selection.has(id)) return visibleTabIds().filter((i) => state.selection.has(i));
  return [id];
}

function rowOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.row') : null;
}

function refOf(row: HTMLElement): RowRef | null {
  return state.order.find((r) => r.key === row.dataset.key) ?? null;
}

// ---------- group rename ----------

function startRename(groupId: number): void {
  const header = rowByKey(`g:${groupId}`);
  const group = groupById(groupId);
  const titleEl = header?.querySelector<HTMLElement>('.group-title');
  if (!header || !group || !titleEl || state.editing) return;

  state.editing = true;
  const input = el('input', 'rename-input', { type: 'text', 'aria-label': 'Group name', maxlength: '100' });
  input.value = group.title ?? '';
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    state.editing = false;
    const value = input.value.trim();
    if (commit && value !== (group.title ?? '')) {
      updateGroup(groupId, { title: value }).catch(fail);
    }
    pending = true;
    // Always re-render to restore the title element, even if nothing changed.
    state.focusKey = `g:${groupId}`;
    flushPending();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

// ---------- menus ----------

function openGroupMenu(groupId: number, x: number, y: number): void {
  const group = groupById(groupId);
  if (!group) return;
  openMenu(x, y, [
    { type: 'swatches', current: group.color, onPick: (color) => run(updateGroup(groupId, { color })) },
    { type: 'separator' },
    { type: 'item', label: 'Rename', onSelect: () => setTimeout(() => startRename(groupId), 0) },
    { type: 'item', label: 'Ungroup all', onSelect: () => run(ungroupGroup(groupId)) },
    { type: 'item', label: 'Close group', danger: true, onSelect: () => run(closeGroup(groupId)) },
  ]);
}

function reportAlwaysGroup(
  p: Promise<{ host: string; groupTitle: string; result: string; changed: boolean; movedAbove?: string } | null>
): void {
  p.then((r) => {
    if (!r) return;
    if (!r.changed) showStatus(`${r.host} already groups into ${r.groupTitle}`);
    else if (r.movedAbove) {
      showStatus(`Added ${r.host} to ${r.groupTitle} (moved above “${r.movedAbove}” so it takes priority)`);
    } else showStatus(`Added ${r.host} to ${r.groupTitle}`);
  }).catch(fail);
}

function siteRuleItems(tab: chrome.tabs.Tab | undefined): MenuItem[] {
  const host = tab ? siteHost(tab.url) : null;
  if (!tab || !host) return [];
  const titled = state.groups.filter((g) => g.windowId === tab.windowId && g.title);
  const group = tab.groupId !== -1 ? groupById(tab.groupId) : undefined;
  const always = (g: chrome.tabGroups.TabGroup) => () =>
    reportAlwaysGroup(alwaysGroupSite(tab, g.title ?? '', g.color));
  if (group?.title) {
    return [{ type: 'item', label: `Always group “${host}” in “${group.title}”`, onSelect: always(group) }];
  }
  if (tab.groupId === -1 && titled.length > 0) {
    return [
      {
        type: 'submenu',
        label: `Always group “${host}” in`,
        items: titled.map((g) => ({ type: 'item' as const, label: g.title ?? '', onSelect: always(g) })),
      },
    ];
  }
  return [];
}

function openTabMenu(tabId: number, x: number, y: number): void {
  const ids = actionTargets(tabId);
  const tabs = ids.map(tabById).filter((t): t is chrome.tabs.Tab => !!t);
  if (tabs.length === 0) return;
  const first = tabs[0];
  const winGroups = state.groups.filter((g) => g.windowId === first.windowId);

  const groupItems: MenuItem[] = winGroups.map((g) => ({
    type: 'item',
    label: g.title || 'Unnamed group',
    onSelect: () => run(moveToGroup(ids, g.id)),
  }));
  groupItems.push({
    type: 'input',
    label: 'New group…',
    placeholder: 'Group name, then Enter',
    onSubmit: (name) =>
      run(moveToNewGroup(ids, first.windowId, name, winGroups.map((g) => g.color))),
  });

  const allPinned = tabs.every((t) => t.pinned);
  const items: MenuItem[] = [];
  if (tabs.some((t) => state.manual.has(t.id as number))) {
    items.push({
      type: 'item',
      label: 'Let rules manage',
      onSelect: () => run(letRulesManage(ids)),
    });
  }
  items.push(...siteRuleItems(tabById(tabId)));
  if (items.length > 0) items.push({ type: 'separator' });
  items.push(
    { type: 'submenu', label: 'Move to group', items: groupItems },
    {
      type: 'item',
      label: 'Remove from group',
      disabled: !tabs.some((t) => t.groupId !== -1),
      onSelect: () => run(removeFromGroup(tabs.filter((t) => t.groupId !== -1).map((t) => t.id as number))),
    },
    {
      type: 'item',
      label: allPinned ? 'Unpin' : 'Pin',
      onSelect: () => run(setPinned(ids, !allPinned)),
    },
    {
      type: 'item',
      label: 'Unload',
      disabled: tabs.every((t) => t.active || t.discarded),
      onSelect: () => run(discardTabs(tabs)),
    },
    { type: 'separator' },
    { type: 'item', label: ids.length > 1 ? `Close ${ids.length} tabs` : 'Close', danger: true, onSelect: () => run(closeTabs(ids)) }
  );
  if (first.groupId !== -1) {
    const others = state.tabs
      .filter((t) => t.groupId === first.groupId && t.id !== undefined && !ids.includes(t.id))
      .map((t) => t.id as number);
    items.push({
      type: 'item',
      label: 'Close other tabs in group',
      danger: true,
      disabled: others.length === 0,
      onSelect: () => run(closeTabs(others)),
    });
  }
  openMenu(x, y, items);
}

// ---------- drag & drop ----------

let indicatorEl: HTMLElement | null = null;
const INDICATOR_CLASSES = ['drop-before', 'drop-after', 'drop-into', 'drop-over'];

function clearIndicator(): void {
  indicatorEl?.classList.remove(...INDICATOR_CLASSES);
  indicatorEl = null;
}

function targetAt(e: DragEvent): { target: DropTarget; el: HTMLElement; cls: string } | null {
  const drag = state.drag;
  if (!drag || !(e.target instanceof Element)) return null;

  const end = e.target.closest<HTMLElement>('.drop-end');
  const section = e.target.closest<HTMLElement>('.window-section');
  const row = rowOf(e.target);

  let result: { target: DropTarget; el: HTMLElement; cls: string } | null = null;
  if (row && row.dataset.tabId) {
    const rect = row.getBoundingClientRect();
    const after = row.classList.contains('pin')
      ? e.clientX > rect.left + rect.width / 2
      : e.clientY > rect.top + rect.height / 2;
    result = {
      target: { kind: 'tab', tabId: Number(row.dataset.tabId), position: after ? 'after' : 'before' },
      el: row,
      cls: after ? 'drop-after' : 'drop-before',
    };
  } else if (row && row.dataset.groupId) {
    const rect = row.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    const groupId = Number(row.dataset.groupId);
    if (drag.kind === 'tabs') {
      const before = frac < 0.25;
      result = {
        target: { kind: 'group', groupId, position: before ? 'before' : 'into' },
        el: row,
        cls: before ? 'drop-before' : 'drop-into',
      };
    } else {
      const before = frac < 0.5;
      result = {
        target: { kind: 'group', groupId, position: before ? 'before' : 'into' },
        el: row,
        cls: before ? 'drop-before' : 'drop-after',
      };
    }
  } else {
    const zone = end ?? section;
    if (zone?.dataset.windowId) {
      result = {
        target: { kind: 'end', windowId: Number(zone.dataset.windowId) },
        el: end ?? zone,
        cls: 'drop-over',
      };
    }
  }
  if (!result) return null;

  const all = toDropTabs(state.tabs);
  const valid =
    drag.kind === 'tabs'
      ? computeDrop(all, drag.ids, result.target) !== null
      : computeGroupMove(all, drag.id, result.target) !== null;
  return valid ? result : null;
}

function endDrag(): void {
  clearIndicator();
  treeEl.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
  state.drag = null;
  flushPending();
}

function onDragStart(e: DragEvent): void {
  const row = rowOf(e.target);
  const ref = row ? refOf(row) : null;
  if (!row || !ref || !e.dataTransfer) return;
  if (ref.kind === 'tab') {
    state.drag = { kind: 'tabs', ids: actionTargets(ref.id) };
    const dragIds = new Set(state.drag.ids);
    requestAnimationFrame(() =>
      treeEl.querySelectorAll<HTMLElement>('.row[data-tab-id]').forEach((r) => {
        if (dragIds.has(Number(r.dataset.tabId))) r.classList.add('dragging');
      })
    );
  } else {
    state.drag = { kind: 'group', id: ref.id };
    requestAnimationFrame(() => row.classList.add('dragging'));
  }
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'tabby-sitter');
}

function onDragOver(e: DragEvent): void {
  if (!state.drag) return;
  const hit = targetAt(e);
  if (!hit) {
    clearIndicator();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    return;
  }
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (indicatorEl !== hit.el || !hit.el.classList.contains(hit.cls)) {
    clearIndicator();
    hit.el.classList.add(hit.cls);
    indicatorEl = hit.el;
  }
}

function onDrop(e: DragEvent): void {
  const drag = state.drag;
  if (!drag) return;
  e.preventDefault();
  const hit = targetAt(e);
  endDrag();
  if (!hit) return;
  run(drag.kind === 'tabs' ? applyDrop(drag.ids, hit.target) : applyGroupMove(drag.id, hit.target));
}

// ---------- events ----------

function onClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('input')) return;
  const row = rowOf(target);
  const ref = row ? refOf(row) : null;
  if (!row || !ref) return;
  state.focusKey = ref.key;

  if (ref.kind === 'group') {
    if (target.closest('.more')) {
      const r = target.closest('.more')!.getBoundingClientRect();
      openGroupMenu(ref.id, r.left, r.bottom);
      return;
    }
    if (target.closest('.chevron')) {
      clearTimeout(toggleTimer);
      toggleGroup(ref.id);
      return;
    }
    // Title area: wait briefly so a double-click can rename instead of toggling.
    clearTimeout(toggleTimer);
    if (e.detail > 1) return;
    const groupId = ref.id;
    toggleTimer = setTimeout(() => toggleGroup(groupId), TITLE_CLICK_DELAY_MS);
    return;
  }

  if (target.closest('.close')) {
    run(closeTabs([ref.id]));
    return;
  }
  if (e.shiftKey && state.anchor !== null) {
    const ids = visibleTabIds();
    const a = ids.indexOf(state.anchor);
    const b = ids.indexOf(ref.id);
    if (a !== -1 && b !== -1) {
      state.selection = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
      paintSelection();
      return;
    }
  }
  if (e.metaKey || e.ctrlKey) {
    if (!state.selection.delete(ref.id)) state.selection.add(ref.id);
    state.anchor = ref.id;
    paintSelection();
    return;
  }
  state.selection.clear();
  state.anchor = ref.id;
  paintSelection();
  const tab = tabById(ref.id);
  if (tab) run(activateTab(tab));
}

function onAuxClick(e: MouseEvent): void {
  if (e.button !== 1) return;
  const row = rowOf(e.target);
  const ref = row ? refOf(row) : null;
  if (ref?.kind === 'tab') {
    e.preventDefault();
    run(closeTabs(actionTargets(ref.id)));
  }
}

function onContextMenu(e: MouseEvent): void {
  const row = rowOf(e.target);
  const ref = row ? refOf(row) : null;
  if (!ref) return;
  e.preventDefault();
  if (ref.kind === 'tab') openTabMenu(ref.id, e.clientX, e.clientY);
  else openGroupMenu(ref.id, e.clientX, e.clientY);
}

function onDblClick(e: MouseEvent): void {
  const row = rowOf(e.target);
  const ref = row ? refOf(row) : null;
  if (ref?.kind === 'group' && !(e.target as Element).closest('.more, .chevron')) {
    clearTimeout(toggleTimer);
    startRename(ref.id);
  }
}

function move(delta: number, from: RowRef | null): void {
  if (state.order.length === 0) return;
  const at = from ? state.order.indexOf(from) : -1;
  const next = Math.min(state.order.length - 1, Math.max(0, at + delta));
  focusRow(state.order[next].key);
}

function onKeyDown(e: KeyboardEvent): void {
  if ((e.target as Element).closest('input')) return;
  const row = rowOf(e.target);
  const ref = row ? refOf(row) : null;
  if (!row || !ref) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      move(1, ref);
      break;
    case 'ArrowUp':
      e.preventDefault();
      move(-1, ref);
      break;
    case 'Home':
      e.preventDefault();
      move(-state.order.length, ref);
      break;
    case 'End':
      e.preventDefault();
      move(state.order.length, ref);
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (ref.kind !== 'group') break;
      const g = groupById(ref.id);
      const wantCollapsed = e.key === 'ArrowLeft';
      if (g && g.collapsed !== wantCollapsed) run(updateGroup(ref.id, { collapsed: wantCollapsed }));
      e.preventDefault();
      break;
    }
    case 'Enter':
      e.preventDefault();
      if (ref.kind === 'tab') {
        const tab = tabById(ref.id);
        if (tab) run(activateTab(tab));
      } else {
        const g = groupById(ref.id);
        if (g) run(updateGroup(ref.id, { collapsed: !g.collapsed }));
      }
      break;
    case ' ':
      e.preventDefault();
      if (ref.kind === 'tab') {
        if (!state.selection.delete(ref.id)) state.selection.add(ref.id);
        state.anchor = ref.id;
        paintSelection();
      } else {
        const g = groupById(ref.id);
        if (g) run(updateGroup(ref.id, { collapsed: !g.collapsed }));
      }
      break;
    case 'Delete':
    case 'Backspace':
      if (ref.kind === 'tab') {
        e.preventDefault();
        const ids = actionTargets(ref.id);
        const idx = state.order.indexOf(ref);
        run(closeTabs(ids));
        // Keep keyboard position near where the closed row was.
        const neighbour = state.order.find((r, i) => i > idx && !ids.includes(r.id)) ?? state.order[Math.max(0, idx - 1)];
        if (neighbour) state.focusKey = neighbour.key;
      }
      break;
    case 'F2': {
      const gid = ref.kind === 'group' ? ref.id : tabById(ref.id)?.groupId;
      if (gid !== undefined && gid !== -1) {
        e.preventDefault();
        startRename(gid);
      }
      break;
    }
    case 'ContextMenu':
    case 'F10': {
      if (e.key === 'F10' && !e.shiftKey) break;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      if (ref.kind === 'tab') openTabMenu(ref.id, r.left + 24, r.bottom);
      else openGroupMenu(ref.id, r.left + 24, r.bottom);
      break;
    }
  }
}

function firstMatchTab(): chrome.tabs.Tab | undefined {
  const first = state.order.find((r) => r.kind === 'tab');
  return first ? tabById(first.id) : undefined;
}

function onDocumentKeyDown(e: KeyboardEvent): void {
  if (document.getElementById('tabsPanel')?.classList.contains('hidden')) return;
  const t = e.target as Element;
  const typing = t.closest('input, textarea, select');
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (e.key === 'Escape' && !typing && !isMenuOpen()) {
    if (state.selection.size > 0) {
      state.selection.clear();
      paintSelection();
    } else if (state.query) {
      clearSearch();
    }
  }
}

function clearSearch(): void {
  searchEl.value = '';
  state.query = '';
  render();
}

export function initTabsView(): void {
  treeEl = document.getElementById('tree') as HTMLElement;
  searchEl = document.getElementById('search') as HTMLInputElement;
  const scopeEl = document.getElementById('scope') as HTMLSelectElement;

  treeEl.addEventListener('click', onClick);
  treeEl.addEventListener('auxclick', onAuxClick);
  treeEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // suppress autoscroll
  });
  treeEl.addEventListener('contextmenu', onContextMenu);
  treeEl.addEventListener('dblclick', onDblClick);
  treeEl.addEventListener('keydown', onKeyDown);
  treeEl.addEventListener('dragstart', onDragStart);
  treeEl.addEventListener('dragover', onDragOver);
  treeEl.addEventListener('drop', onDrop);
  treeEl.addEventListener('dragend', endDrag);
  treeEl.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !treeEl.contains(e.relatedTarget as Node)) clearIndicator();
  });
  document.addEventListener('keydown', onDocumentKeyDown);
  // A drop outside the tree never fires dragend on removed nodes reliably; always clean up.
  document.addEventListener('drop', () => {
    if (state.drag) endDrag();
  });

  searchEl.addEventListener('input', () => {
    state.query = searchEl.value;
    render();
  });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tab = firstMatchTab();
      if (tab) run(activateTab(tab));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (searchEl.value) clearSearch();
      else searchEl.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.order[0]) focusRow(state.order[0].key);
    }
  });
  scopeEl.addEventListener('change', () => {
    state.allWindows = scopeEl.value === 'all';
    render();
  });

  const events: { addListener(cb: () => void): void }[] = [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onUpdated,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached,
    chrome.tabs.onActivated,
    chrome.tabs.onReplaced,
    chrome.tabGroups.onCreated,
    chrome.tabGroups.onUpdated,
    chrome.tabGroups.onRemoved,
    chrome.tabGroups.onMoved,
  ];
  for (const ev of events) ev.addListener(scheduleRender);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.manualTabs) scheduleRender();
  });

  chrome.windows
    .getCurrent()
    .then((w) => {
      state.windowId = w.id ?? -1;
      return refreshData();
    })
    .then(render)
    .catch(fail);
}
