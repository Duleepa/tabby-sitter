import { normalizeTheme, type ThemeSetting } from '../storage/config';

const CACHE_KEY = 'tabbySitterTheme';

/** Apply a theme: absent data-theme = follow the system, 'light' / 'dark' force it. */
export function applyTheme(theme: ThemeSetting): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Mirror the theme to localStorage so the next open can apply it before storage resolves. */
export function cacheTheme(theme: ThemeSetting): void {
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    /* storage may be unavailable; the stored setting is applied once loaded */
  }
}

/** Synchronously apply the mirrored theme (no flash of the wrong theme). */
export function applyCachedTheme(): void {
  try {
    applyTheme(normalizeTheme(localStorage.getItem(CACHE_KEY)));
  } catch {
    /* ignore */
  }
}

/** Apply and mirror a theme in one step. */
export function setTheme(theme: ThemeSetting): void {
  applyTheme(theme);
  cacheTheme(theme);
}
