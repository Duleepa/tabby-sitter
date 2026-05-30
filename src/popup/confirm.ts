const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
const newTabId = Number(params.get('newTabId'));
const existingTabId = Number(params.get('existingTabId'));

try {
  const parsed = new URL(url);
  document.getElementById('urlDisplay')!.textContent = parsed.hostname + parsed.pathname;
} catch {
  document.getElementById('urlDisplay')!.textContent = url || '';
}

let settled = false;

async function send(action: string) {
  if (settled) return;
  settled = true;
  
  const currentWindow = await chrome.windows.getCurrent();
  chrome.runtime.sendMessage({ 
    action, 
    existingTabId, 
    newTabId,
    popupWindowId: currentWindow.id 
  });
}

const switchBtn = document.getElementById('switchBtn');
const keepBtn = document.getElementById('keepBtn');

switchBtn?.addEventListener('click', () => send('switchToExisting'));
keepBtn?.addEventListener('click', () => send('dismiss'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') send('dismiss');
});
