# Tabby Sitter

> A Chrome extension that automatically groups your tabs by site rules.

## Overview

**Tabby Sitter** watches your browser tabs and automatically moves them into organized Chrome tab groups based on URL patterns you define. No more manually dragging tabs around — just set your rules once and let Tabby Sitter herd your tabs into place.

## Features

- **Rule-based auto-grouping**: Define URL patterns (e.g. `github.com`, `stackoverflow.com`) and assign them to named tab groups. Multiple patterns per rule supported.
- **Match modes**: Choose between `contains` (substring match against the full URL) or `regex` (case-insensitive regular expression).
- **Automatic group creation**: If a group doesn't exist yet, Tabby Sitter creates it on the fly.
- **Auto-ungrouping**: Tabs that no longer match any rule are automatically removed from auto-managed groups.
- **Organize All Tabs**: One-click button to re-organize all open tabs in the current window against your rules.
- **Color coding**: Choose from 9 group colors to visually distinguish your workflows.
- **Persistent rules**: Your grouping rules are saved in Chrome storage and survive browser restarts.
- **Config file sync**: Export/import rules as JSON for cross-machine sync (e.g. via Dropbox, iCloud, Obsidian vault). Starter config included.
- **Tabbed popup UI**: Switch between Rules, Add, and Config tabs for easy management.

## Installation (Developer Mode)

1. **Build the extension**:
   ```bash
   npm install
   npm run build
   ```

2. **Open Chrome Extensions page**:
   Navigate to `chrome://extensions/`

3. **Enable Developer Mode**:
   Toggle the switch in the top-right corner.

4. **Load Unpacked**:
   Click **Load unpacked** and select the `dist/` folder inside this project.

5. **Pin the Extension** (optional):
   Click the puzzle icon in Chrome's toolbar, find **Tabby Sitter**, and click the pin to keep it visible.

## Usage

1. Click the **Tabby Sitter** icon in your Chrome toolbar.
2. **Add a rule** (Add tab):
   - **Patterns**: Enter one or more URL patterns, separated by commas, newlines, or semicolons (e.g. `github.com, gitlab.com`).
   - **Match Mode**: Choose `contains` (default) for substring matching or `regex` for regular expressions.
   - **Group Name**: Give your group a name (e.g. `Dev`, `Docs`).
   - **Color**: Pick a color for the group.
   - **Description** (optional): Add a note for yourself.
3. Click **Add Rule**.
4. Open a tab matching that pattern — it will automatically snap into the configured group.
5. **Organize All Tabs**: Click the header button to re-sort all open tabs in the current window at once.

## Example Rules

| Patterns | Group Name | Color | Mode | Description |
|----------|-----------|-------|------|-------------|
| `github.com, stackoverflow.com` | Dev | Blue | contains | Coding sites |
| `docs\.google\.com` | Work | Green | regex | Google Docs (regex) |
| `youtube.com` | Media | Red | contains | Videos |
| `x.com, twitter.com, instagram.com` | Social | Cyan | contains | Social media |

## Config File Sync

Export your rules as a JSON file to sync across computers:

1. Go to the **Config** tab in the popup.
2. Click **Export Rules** to download `tabby-sitter.conf.json`.
3. Save it in a synced folder (Dropbox, iCloud, etc.).
4. On another machine, click **Import Rules** and select the file.

A **Starter Config** with example rules is also available for download.

## Development

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev mode with HMR
npm run build        # Type-check + bundle into dist/
npm run preview      # Preview the production build locally
```

## Development Stack

| Tech | Purpose |
|------|---------|
| TypeScript | Type-safe extension code |
| Vite 6 | Fast bundling |
| CRXJS | Chrome extension plugin for Vite |
| Manifest V3 | Modern Chrome extension format |

## License

MIT
