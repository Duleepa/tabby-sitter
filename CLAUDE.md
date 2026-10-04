# Tabby Sitter — Agent Coding Guide

## Project Overview

**Tabby Sitter** is a Chrome Manifest V3 extension written in TypeScript.
It auto-organizes browser tabs into tab groups based on user-defined URL patterns.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Bundler**: Vite 6 with `@crxjs/vite-plugin`
- **Extension API**: Chrome Manifest V3 (`chrome.tabs`, `chrome.tabGroups`, `chrome.storage`)
- **Storage**: `chrome.storage.local` for rule persistence
- **No external runtime dependencies** — keep it lightweight.

## Permissions

`tabs`, `tabGroups`, `storage`, `scripting`, `sidePanel` (side panel), plus `<all_urls>` host access for the duplicate-confirm content script. The toolbar action opens the side panel (`setPanelBehavior({ openPanelOnActionClick: true })` in the background); there is no popup. Commands: `organize-tabs` (`Ctrl/Cmd+Shift+O`), `_execute_action` (`Ctrl/Cmd+Shift+Y`). Favicons use `tab.favIconUrl` (http/https/data only); the `favicon` permission is not used.

## Manual overrides

Tabs the user places by hand (side panel drag/drop and group menu actions, or a group change in the tab strip that the extension did not cause) are stored as overrides. `processTab` and `organizeAllTabs` skip them. Background code must call `groupTabs()`/`ungroupTabs()` (which record the tab ids in `ExpectedGroupChanges` first) instead of `chrome.tabs.group/ungroup` directly, otherwise its own changes would be mistaken for manual moves. Group changes within 1.5 s of tab creation are ignored (Chrome puts link-opened tabs into the opener's group natively). "Let rules manage" clears the override. Setting `keepOpenedTabsInGroup` (default on) stops unmatched tabs opened from a group tab from being ungrouped.

### Session storage keys (`chrome.storage.session`)
- `freshTabs`: tabId → creation time, consumed on first real-URL evaluation (duplicate handling)
- `tabCreated`: tabId → creation time (5 s), for the new-tab grace period
- `manualTabs`: number[] of overridden tab ids

### Runtime messages (to background)
- `{ action: 'organizeAllTabs', windowId?, allWindows? }`
- `{ action: 'processTabs', tabIds }`: re-run rules for those tabs now
- `{ action: 'switchToExisting', existingTabId, newTabId }`

## Architecture

```
src/
  background/         Service worker — event-driven tab processing
  sidepanel/          Side panel UI (HTML + TS + CSS): tab tree, rules, settings
  content/            Content script (in-page duplicate confirm bar)
  test/               Vitest setup (chrome stub)
  storage/            Shared rule storage helpers + types
  utils/              Shared utilities
```

### Key Files

| File | Responsibility |
|------|--------------|
| `src/background/background.ts` | Listens to `chrome.tabs.onUpdated` and `onCreated`, matches URLs against rules, moves/creates tab groups. Exposes `organizeAllTabs()` via message passing. Includes retry logic for transient Chrome tab mutation errors. |
| `src/storage/rules.ts` | CRUD for grouping rules via `chrome.storage.local`. Supports multiple patterns per rule and `contains`/`regex` match modes. |
| `src/storage/config.ts` | Import/export rules as JSON config files for cross-machine sync. Includes starter config generation. |
| `src/sidepanel/sidepanel.html` / `sidepanel.ts` / `styles.css` | Side panel shell: header (Organize, New tab), Tabs/Rules/Settings tablist, styles (light/dark, 28px rows). Opens from the toolbar icon and `Ctrl/Cmd+Shift+Y`. |
| `src/sidepanel/tabs-view.ts` | Live tab tree: event-coalesced render (one per animation frame), selection, keyboard nav, search, DnD wiring, context/group menus, inline group rename. Never put tab titles/URLs in `innerHTML`. |
| `src/sidepanel/tab-tree.ts` | Pure: `buildWindowTree`, `filterTree`, group colors. Unit-tested. |
| `src/sidepanel/drop.ts` | Pure: `computeDrop` (tab drags) and `computeGroupMove` (group drags). Unit-tested. |
| `src/sidepanel/tab-actions.ts` | `chrome.tabs`/`tabGroups` mutations (move, group, ungroup, pin, discard, close) wrapped in `retryTabMutation`. |
| `src/sidepanel/context-menu.ts` | Custom in-panel menu (items, submenus, inline input, color swatches). |
| `src/sidepanel/rules-view.ts` / `settings-view.ts` | Rules list + add/edit form; import/export/starter config, duplicate-tab and domain-sorting settings. |
| `src/background/decide.ts` | Pure `decideTabAction({ url, rules, currentGroupTitle, manual, keepWithOpener })` → group / ungroup / none. Used by both `processTab` and `organizeAllTabs`. |
| `src/background/expected-changes.ts` | `ExpectedGroupChanges`: tab ids whose group change the extension itself is causing (3 s TTL, injectable clock). |
| `src/storage/overrides.ts` | Manual overrides (`getOverrides`, `isOverridden`, `addOverrides`, `clearOverrides`) in `chrome.storage.session`; per-call read-modify-write, cache invalidated by `storage.onChanged`. |
| `src/utils/url.ts` | Shared skip-prefix list, `isRealPageUrl`, `normalizeUrlForDuplicate`. |
| `src/utils/tabs.ts` | `retryTabMutation` (shared by background and side panel). |
| `src/utils/id.ts` | Simple ID generation utility. |

## Development Rules

### 1. Service Worker Constraints (Manifest V3)
- Background scripts are **ephemeral** event-driven service workers.
- **Never** use `window`, `document`, or `setInterval` in background code.
- Use top-level `await` and promise-based Chrome APIs (MV3 style).

### 2. Chrome API Patterns

Use async/await with Chrome APIs:
```typescript
const groups = await chrome.tabGroups.query({});
const groupId = await chrome.tabs.group({ tabIds: tab.id });
await chrome.tabGroups.update(groupId, { title: 'My Group', color: 'blue' });
```

Transient tab mutation errors (e.g., during tab drag) are handled by `retryTabMutation()` in `background.ts`.

### 3. URL Matching Logic

Rules support two match modes:

```typescript
export type MatchMode = 'contains' | 'regex' | 'domain';

export interface GroupRule {
  id: string;
  patterns: string[];
  groupName: string;
  description?: string;
  color?: GroupColor;
  matchMode: MatchMode;
}
```

Matching uses the **full URL href** (not just hostname):

```typescript
export function matchesRule(url: string, rule: GroupRule): boolean {
  try {
    const parsed = new URL(url);
    const href = parsed.href.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    return rule.patterns.some((p) => {
      if (rule.matchMode === 'regex') {
        if (p.length > 5000) return false; // safety limit
        try { return new RegExp(p, 'i').test(href); }
        catch { return false; }
      }
      if (rule.matchMode === 'domain') return hostMatchesDomain(hostname, p);
      return href.includes(p.toLowerCase());
    });
  } catch {
    return false;
  }
}
```

- **`contains`** mode: case-insensitive substring match against the full URL
- **`domain`** mode: hostname-only. `github.com` matches `github.com` and `gist.github.com`, not `notgithub.com`; a leading `www.` in the pattern is ignored; invalid URLs never match
- **`regex`** mode: case-insensitive regex match (patterns capped at 5000 chars to prevent catastrophic backtracking)
- `matchesPattern()` is **removed** — use `matchesRule()` instead

### 4. Storage Schema

```typescript
interface GroupRule {
  id: string;
  patterns: string[];         // e.g. ["github.com", "gitlab.com"]
  groupName: string;          // e.g. "Dev"
  description?: string;
  color?: GroupColor;
  matchMode: MatchMode;       // "contains" | "regex" | "domain"
}
```

Old single-pattern rules (`pattern: string`) are shimmed at runtime in `getRules()`.

### 5. Config File Sync (Cross-Machine)

Rules can be exported/imported as JSON via the side panel (Settings tab) for syncing across computers:

```typescript
interface ConfigFile {
  tabbySitter: {
    version: string;   // "0.2.0"
    rules: GroupRule[];
  };
}
```

**Workflow:**
1. Add rules in the side panel (Rules tab) → click **Export Rules**
2. Save `tabby-sitter.conf.json` to a synced folder (e.g. Dropbox, Obsidian vault, iCloud)
3. On another machine, click **Import Rules** and pick the synced file

**Starter Config:** The Settings tab also offers a "Create Starter Config" button that downloads a pre-populated config with example rules.

**Safety:** Imported files are capped at 1 MB. Regex patterns are capped at 5000 characters.

**Why not auto-read from disk?**
Chrome extensions cannot access arbitrary filesystem paths for security. The user must explicitly choose the file via the browser's native file picker (`<input type="file">`).

### 6. Types & Type Safety
- Always import `chrome` types from `@types/chrome` (already in devDependencies).
- Use the `GroupColor` type from `src/storage/rules.ts` (`` `${chrome.tabGroups.Color}` ``); `@types/chrome` 0.0.326 has no `ColorEnum`.

### 7. Icons
- Place source icons in `public/icons/` (sizes: 16, 32, 48, 128).
- Vite/CRXJS copies `public/` into `dist/` automatically.

### 8. Adding New Features

When adding a new feature:
1. Keep it inside the existing `src/background`, `src/sidepanel`, `src/storage`, or `src/utils` hierarchy.
2. Export shared types from `src/storage/rules.ts`.
3. Update `manifest.json` **only** if new permissions are required.
4. Run `npm run build` before testing — CRXJS rebuilds the extension bundle.
5. Reload the extension in `chrome://extensions/` after each build.

## Build Scripts

| Command | Action |
|---------|--------|
| `npm install` | Install dependencies |
| `npm run dev` | Start Vite dev mode with HMR |
| `npm run build` | Type-check + bundle into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run unit tests (Vitest; `src/**/*.test.ts`, chrome stub in `src/test/setup.ts`) |
| `npm run lint` | ESLint (must report 0 errors) |

## Testing in Chrome

1. Build → `npm run build`
2. Chrome → `chrome://extensions/` → Developer mode ON
3. Load unpacked → Select `dist/`
4. Test by opening tabs matching your rules

---

If you modify manifest permissions, code style, or storage schema, update this file.
