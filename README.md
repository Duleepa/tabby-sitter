# Tabby Sitter

> A Chrome extension that automatically groups your tabs by site rules.

## Overview

**Tabby Sitter** watches your browser tabs and automatically moves them into organized Chrome tab groups based on URL patterns you define. No more manually dragging tabs around — just set your rules once and let Tabby Sitter herd your tabs into place.

## Features

- **Rule-based auto-grouping**: Define URL patterns (e.g. `github.com`) and assign them to named tab groups.
- **Automatic group creation**: If a group doesn't exist yet, Tabby Sitter creates it on the fly.
- **Color coding**: Choose from 9 group colors to visually distinguish your workflows.
- **Persistent rules**: Your grouping rules are saved in Chrome storage and survive browser restarts.
- **Clean popup UI**: Add, view, and delete rules from a simple popup interface.

## Installation (Developer Mode)

1. **Build the extension** (or use the pre-built `dist/` folder):
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

5. **Pin the extension** (optional):
   Click the puzzle icon in Chrome's toolbar, find **Tabby Sitter**, and click the pin to keep it visible.

## Usage

1. Click the **Tabby Sitter** icon in your Chrome toolbar.
2. **Add a rule**:
   - **Pattern**: Enter a hostname fragment to match (e.g. `github.com`, `docs.google.com`).
   - **Group Name**: Give your group a name (e.g. `Dev`, `Docs`).
   - **Color**: Pick a color for the group.
   - **Description** (optional): Add a note for yourself.
3. Click **Add Rule**.
4. Open a tab matching that pattern — it will automatically snap into the configured group.

## Example Rules

| Pattern | Group Name | Color | Description |
|---------|-----------|-------|-------------|
| `github.com` | Dev | Blue | Coding projects |
| `docs.google.com` | Work | Green | Google Docs |
| `youtube.com` | Media | Red | Videos |

## Development Stack

| Tech | Purpose |
|------|---------|
| TypeScript | Type-safe extension code |
| Vite | Fast bundling |
| CRXJS | Chrome extension plugin for Vite |
| Manifest V3 | Modern Chrome extension format |

## Remote

```bash
git remote add origin git@github.com:Duleepa/tabby-sitter.git
```

## License

MIT
