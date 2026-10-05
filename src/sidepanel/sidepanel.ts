import { applyCachedTheme } from './theme';
import { showStatus } from './dom';
import { initSavedView } from './saved-view';
import { initRulesView } from './rules-view';
import { initSettingsView } from './settings-view';
import { initSyncView } from './sync-view';
import { initDuplicatesView } from './duplicates-view';
import { initTabsView } from './tabs-view';

// Apply the mirrored theme synchronously, before anything renders.
applyCachedTheme();

const $ = (id: string) => document.getElementById(id);

function setActiveTab(tabName: string) {
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `${tabName}Panel`);
  });
}

function initHeader() {
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab ?? 'tabs'));
  });

  $('newTab')?.addEventListener('click', () => {
    chrome.tabs.create({}).catch((err) => console.error('[Sidepanel] new tab failed', err));
  });

  $('organizeTabs')?.addEventListener('click', async (e) => {
    const btn = $('organizeTabs') as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('busy');
    showStatus(e.shiftKey ? 'Organizing all windows…' : 'Organizing…');

    try {
      const windowId = (await chrome.windows.getCurrent()).id;
      const response: { success?: boolean } | undefined = await chrome.runtime.sendMessage({
        action: 'organizeAllTabs',
        windowId,
        allWindows: e.shiftKey,
      });
      showStatus(response?.success ? 'Organized ✓' : 'Organize failed');
    } catch (err) {
      showStatus('Organize failed');
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
  });

  const versionEl = $('version');
  const version = chrome.runtime.getManifest().version;
  if (versionEl) versionEl.textContent = `v${version}`;
  const aboutSummary = $('aboutSummary');
  if (aboutSummary) aboutSummary.textContent = `Version ${version} · open source`;
}

initHeader();
initTabsView();
initDuplicatesView();
initSavedView();
initRulesView().catch((err) => showStatus('Failed to load rules: ' + String(err)));
initSettingsView().catch((err) => showStatus('Failed to load settings: ' + String(err)));
initSyncView().catch((err) => showStatus('Failed to start sync: ' + String(err)));
