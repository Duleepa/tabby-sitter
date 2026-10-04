import {
  exportConfigFile,
  importConfigFile,
  downloadStarterConfig,
  getSettings,
  saveSettings,
  type DuplicateTabMode,
} from '../storage/config';
import { showStatus } from './dom';
import { refreshRules } from './rules-view';

const $ = (id: string) => document.getElementById(id);

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

    const action = confirm('Merge with existing rules?\n\nOK = Merge\nCancel = Replace all');
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
  const settings = await getSettings();
  ($('groupUnmatchedByDomain') as HTMLInputElement).checked = settings.groupUnmatchedByDomain;

  $('groupUnmatchedByDomain')?.addEventListener('change', async () => {
    const checked = ($('groupUnmatchedByDomain') as HTMLInputElement).checked;
    const current = await getSettings();
    current.groupUnmatchedByDomain = checked;
    await saveSettings(current);
  });

  const modeSelect = $('duplicateTabMode') as HTMLSelectElement;
  const domainsInput = $('duplicateTabDomains') as HTMLInputElement;
  const confirmToggle = $('duplicateTabConfirm') as HTMLInputElement;
  const domainsGroup = $('duplicateDomainsGroup') as HTMLElement;

  modeSelect.value = settings.duplicateTabMode;
  domainsInput.value = settings.duplicateTabDomains;
  confirmToggle.checked = settings.duplicateTabConfirm;
  domainsGroup.style.display = settings.duplicateTabMode === 'prevent-specific' ? '' : 'none';

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
