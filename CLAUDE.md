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

`tabs`, `tabGroups`, `storage`, `sidePanel` (side panel), `alarms` (auto-unload timer; no install warning). No host permissions, no content scripts, no `scripting`: duplicate notices live in the side panel. The toolbar action opens the side panel (`setPanelBehavior({ openPanelOnActionClick: true })` in the background); there is no popup. Commands: `organize-tabs` (`Ctrl/Cmd+Shift+O`), `_execute_action` (`Ctrl/Cmd+Shift+Y`). Favicons use `tab.favIconUrl` (http/https/data only); the `favicon` permission is not used.

## Workspaces & memory

Saved groups restore through the background (`restoreSavedGroup`) inside a quiet window; restored tabs are also marked manual and allowed as duplicates. An alarm `auto-discard` (every 5 min) unloads idle tabs via `pickTabsToDiscard`; it is reconciled idempotently at SW start, install, startup and every settings change. Group menu actions: Save group, Save & close, Unload group, Sort tabs by site, Merge groups named "X" here (reuses `applyDrop` with a group "into" target).

## Split view (side by side)

Chrome 155+ API, no permission: `tab.splitViewId` (-1 = none), `chrome.tabs.createSplit([a, b])`, `chrome.tabs.create({ splitWithTabId, index? })`, `chrome.tabs.unsplit(id)`. Pairs are 2 adjacent tabs in one window with the same group and pinned state. `src/utils/split.ts` is the typed shim (`splitSupported()`, wrappers, pure `partnerOf` / `expandSelectionWithPartners` / `pairsIn` / `nextSplitFix`); when unsupported every split UI element is absent. The panel fixes constraints instead of erroring: `pairTabs(anchor, other)` loops `nextSplitFix` (unsplit -> match pinned -> move beside the anchor, into its window -> match group), marks the moved tab manual, then `createSplit`. Pairs render as one `.split-pair` container (also in the pinned strip); each paired row has an Unsplit button, others a "beside" button; key `S`. Drag/move/pin/group actions carry the partner (`computeDrop` expands it; a drop between halves snaps after the pair; `planSortMoves` sorts pairs as units keyed by the left tab). Panel mutations run inside `keepingPairs` (unsplit, act, re-pair). Background: `decideTabAction({ paired })` -> none, duplicates never auto-close or `closeDuplicates` a paired tab (flag only), `sortUnmatchedByDomain` skips them. Settings has a "Side by side" card: how to use it, or (via `chromeMajor` / `splitAvailabilityText`) why it is missing, e.g. "Needs Chrome 155 (you have 154)". Chrome moves of a single half break the pair (WECG proposal), hence `keepingPairs`.

## Theming

- Tokens live in `src/sidepanel/theme.css` (documented contract at the top): surfaces, text, lines, interaction, accent, status, `--group-<name>` (Chrome's tab-group palette), radii, spacing, type, motion, shadows. It is the only place colour values may appear.
- `src/sidepanel/styles.css` must use tokens only; `src/sidepanel/theme.test.ts` fails on hex/`rgb(`/`hsl(`/named colours (allowed: `transparent`, `currentColor`, `inherit`, `var(...)`). No colour literals in TS either: set `--gc: var(--group-X)` and style in CSS. The toolbar badge hex (`BADGE_COLOR` in background.ts) mirrors `--accent` and is the one deliberate exception.
- Light/dark uses `light-dark()` + `color-scheme` (hence `minimum_chrome_version` 123). `<html data-theme>` absent = follow system; `light`/`dark` forces it.
- Add a theme: a `:root[data-theme="<name>"]` block in theme.css overriding tokens (+ `color-scheme`), then add the name to `THEMES` in `src/storage/config.ts` and an option in the Appearance select.
- Setting key: `settings.theme` (`'system' | 'light' | 'dark'`, `normalizeTheme` whitelists it). `src/sidepanel/theme.ts` applies it and mirrors it to `localStorage` so `sidepanel.ts` can apply it synchronously on open.

## Duplicate handling

Order in `handleDuplicateTab`: fresh vs non-fresh (consumed once) -> startup grace -> mode/domain gate -> `allowOnce` / `allowedDuplicateTabs` -> pick existing tab (same window first, then most recently accessed). Only a *fresh* tab with "Ask before closing" off is closed (with an Undo notice); every other duplicate is only *flagged*. Navigated tabs are never closed. The toolbar badge shows `duplicateCount` (debounced `setTimeout`, never `setInterval`).

## Sync file

Sync is a file the user picks (File System Access API, handle in IndexedDB `tabby-sitter`/`handles`), driven from the side panel only (`sync-view.ts`); the background is not involved. **`chrome.storage.sync` is deliberately not used** (no data held by Google on the user's behalf; no server, no login). Panel flow under `navigator.locks` (`tabby-sitter-sync`): permission check (else `pending` + Reconnect) -> read/parse file -> `decideSync` -> write / auto-load (Undo = in-memory snapshot) / conflict banner. Applying a file sets `lastHash`/`lastSeen` first so it is never written back. An unparseable file is never overwritten without confirmation. The in-panel help holds a disclaimer: Tabby Sitter only touches the picked file; copying is the user's sync service's job and the file holds rules and saved-group URLs. Each Chrome profile has its own `syncDeviceId`.

## Manual overrides

Tabs the user places by hand (side panel drag/drop and group menu actions, or a group change in the tab strip that the extension did not cause) are stored as overrides. `processTab` and `organizeAllTabs` skip them. Background code must call `groupTabs()`/`ungroupTabs()` (which record the tab ids in `ExpectedGroupChanges` first) instead of `chrome.tabs.group/ungroup` directly, otherwise its own changes would be mistaken for manual moves. Group changes within 1.5 s of tab creation are ignored (Chrome puts link-opened tabs into the opener's group natively). "Let rules manage" clears the override. Setting `keepOpenedTabsInGroup` (default on) stops unmatched tabs opened from a group tab from being ungrouped.

### Local storage keys (`chrome.storage.local`)
- `syncFile` (`SyncFileState`: name, profileLabel (local only, never in the file), include flags, autoLoad, lastHash, lastSeen, lastWriteAt, pending), `syncDeviceId` (per profile)
- `rules`, `settings` (incl. `theme`, `autoDiscardMinutes`, `autoDiscardPinned`, `autoDiscardExceptDomains`), `savedGroups` (`SavedGroup[]`: title, colour, tab URLs/titles; no favicons)

### Session storage keys (`chrome.storage.session`)
- `freshTabs`: tabId → creation time, consumed on first real-URL evaluation (duplicate handling)
- `tabCreated`: tabId → creation time (5 s), for the new-tab grace period
- `manualTabs`: number[] of overridden tab ids
- `duplicateNotices`: `DuplicateNotice[]` (max 5, 60 s TTL; `closed` = auto-closed new duplicate with Undo, `flagged` = duplicate kept)
- `allowedDuplicateTabs`: tabId → normalised URL the user chose to keep
- `startupAt`: browser start time; tabs created within 10 s are session restores, never "fresh" and never duplicate-handled

### Runtime messages (to background)
- `{ action: 'organizeAllTabs', windowId?, allWindows? }`
- `{ action: 'processTabs', tabIds }`: re-run rules for those tabs now
- `{ action: 'duplicateNotice', id, choice: 'switch' | 'keep' | 'undo' | 'dismiss' }`
- `{ action: 'restoreSavedGroup', id, newWindow?, windowId? }`: recreate a saved group (inactive tabs, saved order, saved title/colour, marked manual)
- `{ action: 'openSavedTab', url, windowId? }`: open one saved tab without tripping duplicate logic
- `{ action: 'closeDuplicates', keys? }`: close all duplicates except `pickKeeper` per cluster (never pinned tabs)

## Architecture

```
src/
  background/         Service worker — event-driven tab processing
  sidepanel/          Side panel UI (HTML + TS + CSS): tab tree, rules, settings
  test/               Vitest setup (chrome stub)
  storage/            Shared rule storage helpers + types
  utils/              Shared utilities
```

### Key Files

| File | Responsibility |
|------|--------------|
| `src/background/background.ts` | Listens to `chrome.tabs.onUpdated` and `onCreated`, matches URLs against rules, moves/creates tab groups. Exposes `organizeAllTabs()` via message passing. Includes retry logic for transient Chrome tab mutation errors. |
| `src/storage/rules.ts` | CRUD for grouping rules via `chrome.storage.local`. Supports multiple patterns per rule and `contains`/`regex` match modes. |
| `src/storage/config.ts` | Import/export of the shared config format (rules, settings, saved groups; v0.2 rules-only files still import), `readLocalContent`/`applyContent`, `DEFAULT_SETTINGS`. |
| `src/storage/starter-rules.ts` | `STARTER_RULES` (domain mode) and pure `newStarterRules` (skips group names already in use); `addStarterRules` / `removeRulesById` (Undo). Never added automatically: offered on the empty Rules tab and the Settings "Example rules" card. |
| `src/storage/sync-file.ts` | Pure: v0.3 format (`buildSyncFile`, `parseSyncFile` with validation, `syncContent`), `contentHash` (canonical JSON + FNV-1a), `decideSync`, `suggestedSyncFileName`. Unit-tested. |
| `src/storage/sync-state.ts` | `syncFile` state and `syncDeviceId` in `chrome.storage.local`. |
| `src/sidepanel/file-link.ts` | File System Access pickers, permission, read/write and IndexedDB handle storage. |
| `src/sidepanel/sync-view.ts` | "Sync file" card in Settings, sync triggers (debounced storage changes, panel open, visibility), conflict/auto-load notices, help. |
| `src/sidepanel/sidepanel.html` / `sidepanel.ts` / `styles.css` | Side panel shell: one header row: Tabs/Saved/Rules/Settings tablist plus icon buttons Organize (wand) and New tab (no brand row: Chrome already shows the name above the panel), styles (light/dark, 28px rows). Opens from the toolbar icon and `Ctrl/Cmd+Shift+Y`. |
| `src/sidepanel/tabs-view.ts` | Live tab tree: event-coalesced render (one per animation frame), selection, keyboard nav, search, DnD wiring, context/group menus, inline group rename. Never put tab titles/URLs in `innerHTML`. |
| `src/sidepanel/tab-tree.ts` | Pure: `buildWindowTree`, `filterTree`, group colors. Unit-tested. |
| `src/sidepanel/drop.ts` | Pure: `computeDrop` (tab drags) and `computeGroupMove` (group drags). Unit-tested. |
| `src/sidepanel/tab-actions.ts` | `chrome.tabs`/`tabGroups` mutations (move, group, ungroup, pin, discard, close) wrapped in `retryTabMutation`. |
| `src/sidepanel/context-menu.ts` | Custom in-panel menu (items, submenus, inline input, color swatches). |
| `src/sidepanel/theme.css` / `theme.ts` | Token contract (all colours) and theme apply/cache helpers; see Theming. |
| `src/sidepanel/rules-view.ts` / `settings-view.ts` | Rules list + add/edit form; import/export, example rules (empty state + toast with Organize/Undo), duplicate-tab (mode, ask first, toolbar badge, extra ignored params), keep-in-group and domain-sorting settings. |
| `src/sidepanel/setting-summaries.ts` | Pure `settingSummaries(settings, discardLabel)`: the one-line state under each Settings card. Settings tab is an exclusive accordion (`<details class="card setting" name="settings">`); the open card is remembered in `localStorage` key `settingsOpen`. |
| `src/background/decide.ts` | Pure `decideTabAction({ url, rules, currentGroupTitle, manual, keepWithOpener })` → group / ungroup / none. Used by both `processTab` and `organizeAllTabs`. |
| `src/background/expected-changes.ts` | `ExpectedGroupChanges`: tab ids whose group change the extension itself is causing (3 s TTL, injectable clock). Not single-use: every groupId event inside the TTL counts as expected (one action can emit several). `processTab` runs are serialised per tab (`tabRuns`). |
| `src/storage/overrides.ts` | Manual overrides (`getOverrides`, `isOverridden`, `addOverrides`, `clearOverrides`) in `chrome.storage.session`; per-call read-modify-write, cache invalidated by `storage.onChanged`. |
| `src/utils/url.ts` | Shared skip-prefix list, `isRealPageUrl`, `normalizeUrlForDuplicate(url, extraIgnoredParams)` (drops fragment, `www.`, tracking params, sorts params), `parseIgnoreParams`. |
| `src/utils/duplicates.ts` | Pure: `findDuplicateClusters`, `pickKeeper`, `tabsToClose`, `duplicateCount`, `pickExistingTab`. Shared by background (badge, closeDuplicates) and panel (chip, Duplicates view) so counts agree. |
| `src/storage/saved-groups.ts` | Saved groups CRUD plus pure `isSavableUrl` / `snapshotFromTabs`. |
| `src/sidepanel/saved-view.ts` | Saved tab: cards, expand, Restore / New window / Rename / Delete with Undo. Saved titles are page-controlled: `textContent` only. |
| `src/sidepanel/sort.ts` | Pure `planSortMoves` (selection-insertion sort by site) and `compareBySite`. |
| `src/utils/discard.ts` | Pure `pickTabsToDiscard` for auto-unload. |
| `src/background/quiet-window.ts` | `QuietWindows`: while the extension restores a saved group, tabs it creates (judged by their `createdAt`) skip fresh-marking, duplicate and rule handling. The window opens before the first `tabs.create` and closes 500 ms after grouping. |
| `src/utils/notices.ts` | Pure notice-list helpers (`pruneNotices`, `addNoticeTo`, `removeFlaggedForTab`). |
| `src/storage/duplicates.ts` | Session storage for notices and allowed duplicate tabs (background is the only writer, serialised). |
| `src/background/allow-once.ts` | `AllowOnce`: URLs reopened by Undo are not treated as duplicates for 10 s. |
| `src/sidepanel/duplicates-view.ts` | Notice bar, Duplicates chip and Duplicates view. |
| `src/utils/split.ts` | Split View shim + pure pair helpers and `nextSplitFix` (constraint fixing plan). Unit-tested. |
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
    version: string;   // "0.3.0" (0.2.x rules-only files still import)
    savedAt?: string; deviceId?: string;
    rules: GroupRule[];
    settings?: Partial<ExtensionSettings>;
    savedGroups?: SavedGroup[];
  };
}
```

**Workflow:**
1. Add rules in the side panel (Rules tab) → click **Export…** (Settings → Import & export)
2. Save `tabby-sitter.conf.json` to a synced folder (e.g. Dropbox, Obsidian vault, iCloud)
3. On another machine, click **Import…** and pick the synced file

**Example rules:** Nothing is pre-loaded on install (it would regroup tabs the user didn't ask about and clash with linking an existing sync file). The empty Rules tab and Settings → Example rules offer one-click domain rules (Dev, Docs, Mail, Media, Social) with Undo; open tabs only move when the user organizes.

**Safety:** Imported files are capped at 5 MB. Regex patterns are capped at 5000 characters.

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

Node.js is pinned in `mise.toml` (`mise install`). mise tasks wrap the npm scripts: `mise run setup | build | dev | test | lint | check` (`check` = build + test + lint; run it before a PR).

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
