import { el } from './dom';
import { GROUP_COLORS } from './tab-tree';

export type MenuItem =
  | { type: 'item'; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; items: MenuItem[] }
  | { type: 'input'; label: string; placeholder: string; onSubmit: (value: string) => void }
  | { type: 'swatches'; current?: string; onPick: (color: (typeof GROUP_COLORS)[number]) => void };

let menuEl: HTMLElement | null = null;
let restoreFocus: HTMLElement | null = null;
let restoreKey: string | null = null;

export function isMenuOpen(): boolean {
  return menuEl !== null;
}

export function closeMenu(): void {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('keydown', onMenuKey, true);
  window.removeEventListener('blur', closeMenu);
  // The row may have been re-rendered while the menu was open; find it by key.
  const target = restoreFocus?.isConnected
    ? restoreFocus
    : restoreKey
      ? document.querySelector<HTMLElement>(`[data-key="${restoreKey}"]`)
      : null;
  target?.focus({ preventScroll: true });
  restoreFocus = null;
  restoreKey = null;
}

function onOutsidePointer(e: Event): void {
  if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
}

function onMenuKey(e: KeyboardEvent): void {
  if (!menuEl) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const focusables = Array.from(
      menuEl.querySelectorAll<HTMLElement>('button:not([disabled]), input')
    );
    if (focusables.length === 0) return;
    e.preventDefault();
    const at = focusables.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    focusables[(next + focusables.length) % focusables.length].focus();
  }
}

function renderItems(items: MenuItem[], container: HTMLElement): void {
  for (const item of items) {
    if (item.type === 'separator') {
      container.appendChild(el('div', 'menu-sep', { role: 'separator' }));
    } else if (item.type === 'item') {
      const btn = el('button', `menu-item${item.danger ? ' danger' : ''}`, { role: 'menuitem', type: 'button' }, item.label);
      btn.disabled = !!item.disabled;
      btn.addEventListener('click', () => {
        closeMenu();
        item.onSelect();
      });
      container.appendChild(btn);
    } else if (item.type === 'submenu') {
      const btn = el('button', 'menu-item has-sub', { role: 'menuitem', type: 'button', 'aria-expanded': 'false' }, item.label);
      const sub = el('div', 'menu-sub hidden', { role: 'menu' });
      renderItems(item.items, sub);
      btn.addEventListener('click', () => {
        const open = sub.classList.toggle('hidden') === false;
        btn.setAttribute('aria-expanded', String(open));
        if (open) sub.querySelector<HTMLElement>('button:not([disabled]), input')?.focus();
      });
      container.append(btn, sub);
    } else if (item.type === 'input') {
      const btn = el('button', 'menu-item', { role: 'menuitem', type: 'button' }, item.label);
      const input = el('input', 'menu-input hidden', { type: 'text', placeholder: item.placeholder, 'aria-label': item.label });
      btn.addEventListener('click', () => {
        btn.classList.add('hidden');
        input.classList.remove('hidden');
        input.focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const value = input.value.trim();
          closeMenu();
          item.onSubmit(value);
        }
        // Keep arrow keys inside the text field.
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.stopPropagation();
      });
      container.append(btn, input);
    } else {
      const row = el('div', 'menu-swatches', { role: 'group', 'aria-label': 'Group color' });
      for (const color of GROUP_COLORS) {
        const b = el('button', `swatch${item.current === color ? ' current' : ''}`, {
          type: 'button',
          title: color,
          'aria-label': color,
        });
        b.style.setProperty('--swatch', `var(--group-${color})`);
        b.addEventListener('click', () => {
          closeMenu();
          item.onPick(color);
        });
        row.appendChild(b);
      }
      container.appendChild(row);
    }
  }
}

/** Open a custom in-panel menu at viewport coordinates. */
export function openMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  restoreKey = restoreFocus?.dataset.key ?? null;

  const menu = el('div', 'ctx-menu', { role: 'menu' });
  renderItems(items, menu);
  document.body.appendChild(menu);
  menuEl = menu;

  const place = () => {
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  };
  place();
  // Submenus and inputs change the height; keep the menu on screen.
  menu.addEventListener('click', () => requestAnimationFrame(place));

  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('keydown', onMenuKey, true);
  window.addEventListener('blur', closeMenu);
  menu.querySelector<HTMLElement>('button:not([disabled])')?.focus();
}
