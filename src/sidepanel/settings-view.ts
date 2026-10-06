import {
  exportConfigFile,
  importConfigFile,
  getSettings,
  normalizeTheme,
  saveSettings,
  type DuplicateTabMode,
  type ExtensionSettings,
} from '../storage/config';
import { showStatus } from './dom';
import { addExampleRules, refreshRules } from './rules-view';
import { setTheme } from './theme';
import { chromeMajor, SPLIT_MIN_CHROME, splitAvailabilityText, splitSupported } from '../utils/split';
import { SETTINGS_OPEN_KEY, settingSummaries } from './setting-summaries';

const $ = (id: string) => document.getElementById(id);

/** Fill the controls from stored settings (also used when a sync file or import changes them). */
function populate(settings: ExtensionSettings): void {
  ($('theme') as HTMLSelectElement).value = settings.theme;
  setTheme(settings.theme);
  ($('groupUnmatchedByDomain') as HTMLInputElement).checked = settings.groupUnmatchedByDomain;
  ($('duplicateBadge') as HTMLInputElement).checked = settings.duplicateBadge;
  ($('duplicateIgnoreParams') as HTMLInputElement).value = settings.duplicateIgnoreParams;
  ($('autoDiscardMinutes') as HTMLSelectElement).value = String(settings.autoDiscardMinutes);
  ($('autoDiscardPinned') as HTMLInputElement).checked = settings.autoDiscardPinned;
  ($('autoDiscardExceptDomains') as HTMLInputElement).value = settings.autoDiscardExceptDomains;
  ($('keepOpenedTabsInGroup') as HTMLInputElement).checked = settings.keepOpenedTabsInGroup;
  ($('duplicateTabMode') as HTMLSelectElement).value = settings.duplicateTabMode;
  ($('duplicateTabDomains') as HTMLInputElement).value = settings.duplicateTabDomains;
  ($('duplicateTabConfirm') as HTMLInputElement).checked = settings.duplicateTabConfirm;
  ($('duplicateDomainsGroup') as HTMLElement).style.display =
    settings.duplicateTabMode === 'prevent-specific' ? '' : 'none';

  const discard = $('autoDiscardMinutes') as HTMLSelectElement;
  const sum = settingSummaries(settings, discard.selectedOptions[0]?.text);
  const set = (id: string, text: string) => {
    const node = $(id);
    if (node) node.textContent = text;
  };
  set('themeSummary', sum.theme);
  set('dupSummary', sum.duplicates);
  set('keepSummary', sum.keep);
  set('memorySummary', sum.memory);
  set('sortSummary', sum.sort);
  set('exportSummary', 'Back up or move your setup by hand');
  set('starterSummary', 'Dev, Docs, Mail, Media and Social, ready to edit');
}

/** Exclusive accordion (native `name`); remembers the open card in localStorage. */
function initAccordion(): void {
  const cards = Array.from(document.querySelectorAll<HTMLDetailsElement>('#settingsPanel details.setting'));
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SETTINGS_OPEN_KEY);
  } catch {
    /* storage unavailable */
  }
  cards.forEach((card) => {
    if (saved && card.dataset.key === saved) card.open = true;
    card.addEventListener('toggle', () => {
      try {
        if (card.open) localStorage.setItem(SETTINGS_OPEN_KEY, card.dataset.key ?? '');
        else if (localStorage.getItem(SETTINGS_OPEN_KEY) === card.dataset.key) localStorage.removeItem(SETTINGS_OPEN_KEY);
      } catch {
        /* storage unavailable */
      }
    });
  });
}

/** Side by side card: how to use it, or why it is missing (Chrome too old). */
function initSplitCard(): void {
  const supported = splitSupported();
  const major = chromeMajor(navigator.userAgent);
  const summary = $('splitSummary');
  if (summary) summary.textContent = splitAvailabilityText(supported, major);
  if (supported) return;
  const why = $('splitUnavailable');
  if (why) {
    why.textContent =
      major !== null && major < SPLIT_MIN_CHROME
        ? `Your Chrome is version ${major}. Side by side needs Chrome ${SPLIT_MIN_CHROME} or newer: open the Chrome menu, then Help → About Google Chrome to update, and reopen this panel. The steps above will work once you have updated.`
        : 'This browser does not let extensions open tabs side by side.';
    why.classList.remove('hidden');
  }
}

export async function initSettingsView() {
  initAccordion();
  initSplitCard();
  // Config file actions
  $('exportConfig')?.addEventListener('click', async () => {
    try {
      await exportConfigFile();
      showStatus('Config exported!');
    } catch (err) {
      showStatus('Export failed: ' + String(err));
    }
  });

  $('importConfig')?.addEventListener('click', () => {
    ($('configFileInput') as HTMLInputElement)?.click();
  });

  $('configFileInput')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const action = confirm('Merge with existing rules and saved groups?\n\nOK = Merge\nCancel = Replace all');
    const mode = action ? 'merge' : 'replace';
    const actionLabel = mode === 'merge' ? 'Merged' : 'Replaced';

    try {
      await importConfigFile(file, mode);
      await refreshRules();
      showStatus(`Config ${actionLabel}!`);
    } catch (err) {
      showStatus('Import failed: ' + String(err));
    } finally {
      input.value = '';
    }
  });

  $('addExampleRules')?.addEventListener('click', () => {
    // Show the Rules tab so the result and its Undo are visible.
    document.querySelector<HTMLElement>('.tab-btn[data-tab="rules"]')?.click();
    addExampleRules().catch((err) => showStatus('Could not add example rules: ' + String(err)));
  });

  // Load and save domain grouping setting
  populate(await getSettings());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) getSettings().then(populate, () => undefined);
  });

  const themeSelect = $('theme') as HTMLSelectElement;
  themeSelect.addEventListener('change', async () => {
    const theme = normalizeTheme(themeSelect.value);
    setTheme(theme);
    const current = await getSettings();
    current.theme = theme;
    await saveSettings(current);
  });

  $('groupUnmatchedByDomain')?.addEventListener('change', async () => {
    const checked = ($('groupUnmatchedByDomain') as HTMLInputElement).checked;
    const current = await getSettings();
    current.groupUnmatchedByDomain = checked;
    await saveSettings(current);
  });

  const badgeToggle = $('duplicateBadge') as HTMLInputElement;
  const ignoreInput = $('duplicateIgnoreParams') as HTMLInputElement;
  badgeToggle.addEventListener('change', async () => {
    const current = await getSettings();
    current.duplicateBadge = badgeToggle.checked;
    await saveSettings(current);
  });
  ignoreInput.addEventListener('change', async () => {
    const current = await getSettings();
    current.duplicateIgnoreParams = ignoreInput.value.trim();
    await saveSettings(current);
  });

  const discardMinutes = $('autoDiscardMinutes') as HTMLSelectElement;
  const discardPinned = $('autoDiscardPinned') as HTMLInputElement;
  const discardExcept = $('autoDiscardExceptDomains') as HTMLInputElement;
  discardMinutes.addEventListener('change', async () => {
    const current = await getSettings();
    current.autoDiscardMinutes = Number(discardMinutes.value);
    await saveSettings(current);
  });
  discardPinned.addEventListener('change', async () => {
    const current = await getSettings();
    current.autoDiscardPinned = discardPinned.checked;
    await saveSettings(current);
  });
  discardExcept.addEventListener('change', async () => {
    const current = await getSettings();
    current.autoDiscardExceptDomains = discardExcept.value.trim();
    await saveSettings(current);
  });

  const keepToggle = $('keepOpenedTabsInGroup') as HTMLInputElement;
  keepToggle.addEventListener('change', async () => {
    const current = await getSettings();
    current.keepOpenedTabsInGroup = keepToggle.checked;
    await saveSettings(current);
  });

  const modeSelect = $('duplicateTabMode') as HTMLSelectElement;
  const domainsInput = $('duplicateTabDomains') as HTMLInputElement;
  const confirmToggle = $('duplicateTabConfirm') as HTMLInputElement;
  const domainsGroup = $('duplicateDomainsGroup') as HTMLElement;


  modeSelect.addEventListener('change', async () => {
    domainsGroup.style.display = modeSelect.value === 'prevent-specific' ? '' : 'none';
    const current = await getSettings();
    current.duplicateTabMode = modeSelect.value as DuplicateTabMode;
    await saveSettings(current);
  });

  domainsInput.addEventListener('change', async () => {
    const current = await getSettings();
    current.duplicateTabDomains = domainsInput.value.trim();
    await saveSettings(current);
  });

  confirmToggle.addEventListener('change', async () => {
    const current = await getSettings();
    current.duplicateTabConfirm = confirmToggle.checked;
    await saveSettings(current);
  });
}
