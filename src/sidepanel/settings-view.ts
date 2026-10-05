import {
  exportConfigFile,
  importConfigFile,
  downloadStarterConfig,
  getSettings,
  saveSettings,
  type DuplicateTabMode,
  type ExtensionSettings,
} from '../storage/config';
import { showStatus } from './dom';
import { refreshRules } from './rules-view';

const $ = (id: string) => document.getElementById(id);

/** Fill the controls from stored settings (also used when a sync file or import changes them). */
function populate(settings: ExtensionSettings): void {
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
}

export async function initSettingsView() {
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

  $('createConfig')?.addEventListener('click', () => {
    downloadStarterConfig();
    showStatus('Starter config downloaded!');
  });

  // Load and save domain grouping setting
  populate(await getSettings());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) getSettings().then(populate, () => undefined);
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
