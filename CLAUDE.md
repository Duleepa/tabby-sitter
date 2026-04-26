# Tabby Sitter — Agent Coding Guide

## Project Overview

**Tabby Sitter** is a Chrome Manifest V3 extension written in TypeScript.
It auto-organizes browser tabs into tab groups based on user-defined URL patterns.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Bundler**: Vite with `@crxjs/vite-plugin`
- **Extension API**: Chrome Manifest V3 (`chrome.tabs`, `chrome.tabGroups`, `chrome.storage`)
- **Storage**: `chrome.storage.local` for rule persistence
- **No external runtime dependencies** — keep it lightweight.

## Architecture

```
src/
  background/         Service worker — event-driven tab processing
  popup/              Extension popup UI (HTML + TS)
  storage/            Shared rule storage helpers + types
```

### Key Files

| File | Responsibility |
|------|--------------|
| `src/background/background.ts` | Listens to `chrome.tabs.onUpdated` and `onCreated`, matches URLs against rules, moves/creates tab groups |
| `src/storage/rules.ts` | CRUD for grouping rules via `chrome.storage.local` |
| `src/popup/popup.ts` | Popup UI logic: add/remove rules, render list |
| `src/popup/popup.html` | Popup markup |

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

### 3. URL Matching Logic
```typescript
// Current implementation uses hostname inclusion
function matchesPattern(url: string, pattern: string): boolean {
  try {
    return new URL(url).hostname.includes(pattern);
  } catch {
    return false;
  }
}
```
Keep matching simple and fast — exact hostname fragments, no regex.

### 4. Storage Schema
```typescript
interface GroupRule {
  id: string;
  pattern: string;          // e.g. "github.com"
  groupName: string;        // e.g. "Dev"
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
}
```

### 5. Types & Type Safety
- Always import `chrome` types from `@types/chrome` (already in devDependencies).
- Use `chrome.tabGroups.ColorEnum` not `chrome.tabGroups.Color` (the namespace exports `ColorEnum`).

### 6. Icons
- Place source icons in `public/icons/` (sizes: 16, 48, 128).
- Vite/CRXJS copies `public/` into `dist/` automatically.

### 7. Adding New Features

When adding a new feature:
1. Keep it inside the existing `src/background`, `src/popup`, or `src/storage` hierarchy.
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

## Testing in Chrome

1. Build → `npm run build`
2. Chrome → `chrome://extensions/` → Developer mode ON
3. Load unpacked → Select `dist/`
4. Test by opening tabs matching your rules

---

If you modify manifest permissions, code style, or storage schema, update this file.
