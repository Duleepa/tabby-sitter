# Chrome Web Store listing

Copy for the Chrome Web Store Developer Dashboard (Store listing tab). Length limits are noted where the store sets one. The name and summary come from `manifest.json`; keep the two in step.

## Name (manifest `name`, max 75 characters)

```
Tabby Sitter - Auto Tab Groups & Tab Manager
```

44 characters. Users search for "tab groups" and "tab manager", and both phrases fit in the name without stuffing it.

## Summary (manifest `description`, max 132 characters)

```
Auto-group tabs with your own URL rules, plus a side panel tab manager: duplicates, saved groups, idle unload. No account needed.
```

129 characters. This line appears in search results, so it starts with the main job and ends with what makes Tabby Sitter different.

## Category

**Productivity > Workflow & Planning** (tab managers usually sit here). **Tools** is the fallback.

## Description

```
Tabby Sitter puts your tabs into Chrome tab groups automatically. Tell it once that GitHub and Stack Overflow belong in "Dev" and YouTube in "Media", and every matching tab you open goes to the right group. It runs from Chrome's side panel, which is also a full tab manager: search, drag and drop, saved groups, duplicate cleanup and memory saving, all in one place.

No account, no server, no tracking. Your rules stay in your browser.

AUTOMATIC TAB GROUPS
• Rules match by domain, by text anywhere in the URL, or by regular expression
• Groups are created with your chosen name and colour when needed
• Tabs leave a rule's group when you navigate away; tabs opened from a group can stay with it
• Moved a tab by hand? Tabby Sitter respects it and leaves it alone
• "Always group this site here" turns any tab into a rule in one click
• Organize button (Ctrl/Cmd+Shift+O) tidies everything at once, in one window or all of them

SIDE PANEL TAB MANAGER
• Live tree of windows, groups and tabs with instant search
• Multi-select, keyboard navigation, drag and drop in and out of groups
• Right-click menu to move, pin, unload or close; rename and recolour groups inline
• Sort a group by site, or merge groups with the same name across windows

SAVED GROUPS
• Save a group for later and close it to free up your tab bar
• Restore it in this window or a new one, with its title, colour and tab order

DUPLICATE TABS
• Stop the same page being open twice, across all windows or for chosen sites
• Ignores tracking parameters (utm_*, fbclid) and #fragments
• Closes the new copy and switches to the one you already had, with Undo
• See all duplicates in one view and close them in one click

SAVE MEMORY
• Unload tabs that have been idle for 15 minutes to 4 hours
• Never unloads the tab you're viewing or tabs playing audio; pinned tabs and chosen sites are skipped

SIDE BY SIDE (Chrome 155+)
• Open any tab beside the current one in Chrome's split view; Tabby Sitter fixes groups and pinning so the pair always works

SYNC WITHOUT AN ACCOUNT
• Keep rules, settings and saved groups in one file in a folder you already sync (Dropbox, iCloud Drive, OneDrive, Syncthing, an Obsidian vault)
• Or export and import the same file by hand

PRIVACY FIRST
• Minimal permissions: tabs, tab groups, storage, side panel, alarms
• Cannot read or change the content of web pages (no site access, no content scripts)
• Nothing is collected or sent anywhere

Light and dark themes. Open the panel with the toolbar icon or Ctrl/Cmd+Shift+Y.
```

## Screenshots (1280x800 or 640x400; up to 5)

The old screenshots have been removed. Capture new ones from v1.0.0, in this order, since the first one does most of the selling:

1. **Tab tree with rule-made groups**: the side panel next to a coloured tab strip. Caption: "Your tabs, grouped automatically by your rules"
2. **Rules tab** with a few rules in different match modes. Caption: "Group by domain, URL text or regex"
3. **Duplicates view** or the duplicate notice with Undo. Caption: "No more duplicate tabs"
4. **Saved tab** with a couple of saved groups. Caption: "Save groups and bring them back later"
5. **Settings > Sync file** (or dark theme). Caption: "Sync with your own file. No account."

Use clean demo tabs only, with no personal data in titles or URLs, and show both light and dark across the set.

## Promotional images

- Small promo tile (440x280): `tabbysitter-logo.png` is already the correct size.
- Marquee (1400x560): `marquee-tile.png`.

## How this is positioned against competitors

Other extensions such as Auto Tab Groups, Tab Groups Extension, Tab Grouper, Advance Tab Groups and Auto Group Tabs mostly do one thing: grouping by URL rules. Broader tab managers such as OneTab, Workona and Session Buddy don't group tabs by rules, and Workona needs an account and cloud storage. This listing works on that gap:

- **Use the words people search for**: "tab groups", "tab manager", "duplicate tabs", "save memory" and "regex" each appear naturally in the text.
- **Lead with the differences**: the only rule-based grouper that is also a full side panel tab manager, with no account and no site access.
- **Put trust signals up front**: "No account", "no tracking" and the short permission list are in the summary and the first lines of the description, since privacy is a common complaint about larger tab managers.

### Store rules to stay within

These come from the Chrome Web Store [listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) and [spam policy](https://developer.chrome.com/docs/webstore/program-policies/spam-faq):

- **Never name competitors** in the name, summary or description. The store guidelines say to avoid it, and it can count as keyword spam.
- **Don't repeat keywords**: no keyword lists, and no word repeated unnaturally (the store's example limit is more than 5 times). The description is already written with this in mind, so keep it that way when editing.
- **Avoid claims like "best" or "#1"** and fake badges such as "Editor's Choice".
- **Ratings and keeping installs drive ranking.** The store ranks by ratings and by installs compared with uninstalls. A good first-run experience (a starter config, a clear empty state) and an occasional, polite review prompt help more than any wording.
