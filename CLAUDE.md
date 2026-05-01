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

## Architecture

```
src/
  background/         Service worker — event-driven tab processing
  popup/              Extension popup UI (HTML + TS + CSS)
  storage/            Shared rule storage helpers + types
  utils/              Shared utilities
```

### Key Files

| File | Responsibility |
|------|--------------|
| `src/background/background.ts` | Listens to `chrome.tabs.onUpdated` and `onCreated`, matches URLs against rules, moves/creates tab groups. Exposes `organizeAllTabs()` via message passing. Includes retry logic for transient Chrome tab mutation errors. |
| `src/storage/rules.ts` | CRUD for grouping rules via `chrome.storage.local`. Supports multiple patterns per rule and `contains`/`regex` match modes. |
| `src/storage/config.ts` | Import/export rules as JSON config files for cross-machine sync. Includes starter config generation. |
| `src/popup/popup.ts` | Popup UI logic: tabbed interface (Rules/Add/Config), add/remove rules, organize all tabs, import/export config. |
| `src/popup/popup.html` | Popup markup with tabbed layout. |
| `src/popup/styles.css` | Popup styles. |
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
export type MatchMode = 'contains' | 'regex';

export interface GroupRule {
  id: string;
  patterns: string[];
  groupName: string;
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
  matchMode: MatchMode;
}
```

Matching uses the **full URL href** (not just hostname):

```typescript
export function matchesRule(url: string, rule: GroupRule): boolean {
  try {
    const href = new URL(url).href.toLowerCase();
    return rule.patterns.some((p) => {
      if (rule.matchMode === 'regex') {
        if (p.length > 5000) return false; // safety limit
        try { return new RegExp(p, 'i').test(href); }
        catch { return false; }
      }
      return href.includes(p.toLowerCase());
    });
  } catch {
    return false;
  }
}
```

- **`contains`** mode: case-insensitive substring match against the full URL
- **`regex`** mode: case-insensitive regex match (patterns capped at 5000 chars to prevent catastrophic backtracking)
- `matchesPattern()` is **removed** — use `matchesRule()` instead

### 4. Storage Schema

```typescript
interface GroupRule {
  id: string;
  patterns: string[];         // e.g. ["github.com", "gitlab.com"]
  groupName: string;          // e.g. "Dev"
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
  matchMode: MatchMode;       // "contains" | "regex"
}
```

Old single-pattern rules (`pattern: string`) are shimmed at runtime in `getRules()`.

### 5. Config File Sync (Cross-Machine)

Rules can be exported/imported as JSON via the popup for syncing across computers:

```typescript
interface ConfigFile {
  tabbySitter: {
    version: string;   // "0.2.0"
    rules: GroupRule[];
  };
}
```

**Workflow:**
1. Add rules in the popup → click **Export Rules**
2. Save `tabby-sitter.conf.json` to a synced folder (e.g. Dropbox, Obsidian vault, iCloud)
3. On another machine, click **Import Rules** and pick the synced file

**Starter Config:** The popup also offers a "Create Starter Config" button that downloads a pre-populated config with example rules.

**Safety:** Imported files are capped at 1 MB. Regex patterns are capped at 5000 characters.

**Why not auto-read from disk?**
Chrome extensions cannot access arbitrary filesystem paths for security. The user must explicitly choose the file via the browser's native file picker (`<input type="file">`).

### 6. Types & Type Safety
- Always import `chrome` types from `@types/chrome` (already in devDependencies).
- Use `chrome.tabGroups.ColorEnum` not `chrome.tabGroups.Color` (the namespace exports `ColorEnum`).

### 7. Icons
- Place source icons in `public/icons/` (sizes: 16, 32, 48, 128).
- Vite/CRXJS copies `public/` into `dist/` automatically.

### 8. Adding New Features

When adding a new feature:
1. Keep it inside the existing `src/background`, `src/popup`, `src/storage`, or `src/utils` hierarchy.
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

## Testing in Chrome

1. Build → `npm run build`
2. Chrome → `chrome://extensions/` → Developer mode ON
3. Load unpacked → Select `dist/`
4. Test by opening tabs matching your rules

---

If you modify manifest permissions, code style, or storage schema, update this file.
