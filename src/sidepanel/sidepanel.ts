import { showStatus } from './dom';
import { initRulesView } from './rules-view';
import { initSettingsView } from './settings-view';
import { initTabsView } from './tabs-view';

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

const ORGANIZE_IDLE = 'Organize';
const ORGANIZE_DELAY_MS = 2000;

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
    btn.textContent = '…';
    btn.disabled = true;

    try {
      const windowId = (await chrome.windows.getCurrent()).id;
      const response: { success?: boolean } | undefined = await chrome.runtime.sendMessage({
        action: 'organizeAllTabs',
        windowId,
        allWindows: e.shiftKey,
      });
      btn.textContent = response?.success ? 'Organized ✓' : 'Failed';
    } catch (err) {
      btn.textContent = 'Error';
      console.error(err);
    }

    setTimeout(() => {
      btn.textContent = ORGANIZE_IDLE;
      btn.disabled = false;
    }, ORGANIZE_DELAY_MS);
  });

  const versionEl = $('version');
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
}

initHeader();
initTabsView();
initRulesView().catch((err) => showStatus('Failed to load rules: ' + String(err)));
initSettingsView().catch((err) => showStatus('Failed to load settings: ' + String(err)));
