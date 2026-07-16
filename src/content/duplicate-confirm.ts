interface DuplicateConfirmData {
  newTabId: number;
  existingTabId: number;
  url: string;
}

let barHost: HTMLDivElement | null = null;
let barEl: HTMLDivElement | null = null;
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

function createBar(data: DuplicateConfirmData): void {
  destroyBar();

  barHost = document.createElement('div');
  barHost.id = 'tabby-sitter-confirm-host';
  barHost.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none;';

  const shadow = barHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .confirm-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      background: linear-gradient(to bottom, #fef3c7 0%, #fde68a 100%);
      border-bottom: 3px solid #f59e0b;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transform: translateY(-100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
    }

    .confirm-bar.visible {
      transform: translateY(0);
    }

    .confirm-bar-content {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .banner-icon {
      font-size: 1.25rem;
    }

    .banner-text {
      font-size: 0.9rem;
      font-weight: 600;
      color: #92400e;
      white-space: nowrap;
    }

    .url-display {
      flex: 1;
      font-size: 0.8rem;
      color: #64748b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    button {
      border: none;
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, transform 0.1s;
    }

    button:active {
      transform: scale(0.97);
    }

    .btn-switch {
      background: #2563eb;
      color: #fff;
    }

    .btn-switch:hover {
      background: #1d4ed8;
    }

    .btn-keep {
      background: transparent;
      color: #64748b;
      border: 1px solid #d1d5db;
    }

    .btn-keep:hover {
      background: rgba(255, 255, 255, 0.5);
      color: #374151;
    }

    @media (max-width: 768px) {
      .confirm-bar-content {
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .url-display {
        order: 3;
        flex-basis: 100%;
      }
    }
  `;
  shadow.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'confirm-bar';

  let displayUrl = data.url;
  try {
    const parsed = new URL(data.url);
    displayUrl = parsed.hostname + parsed.pathname;
  } catch {
  }

  bar.innerHTML = `
    <div class="confirm-bar-content">
      <div class="banner">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">Duplicate Tab</span>
      </div>
      <div class="url-display" title="${data.url}">${displayUrl}</div>
      <div class="actions">
        <button class="btn-switch">Switch to existing</button>
        <button class="btn-keep">Keep this tab</button>
      </div>
    </div>
  `;

  shadow.appendChild(bar);
  barEl = bar;
  document.documentElement.appendChild(barHost);

  requestAnimationFrame(() => {
    bar.classList.add('visible');
  });

  const switchBtn = shadow.querySelector('.btn-switch');
  const keepBtn = shadow.querySelector('.btn-keep');

  switchBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'switchToExisting',
      existingTabId: data.existingTabId,
      newTabId: data.newTabId,
    });
    destroyBar();
  });

  keepBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      action: 'dismiss',
    });
    destroyBar();
  });

  autoDismissTimer = setTimeout(() => {
    destroyBar();
  }, 10000);

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      destroyBar();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);
}

function destroyBar(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  if (barEl) {
    barEl.classList.remove('visible');
    const host = barHost;
    setTimeout(() => {
      host?.remove();
    }, 300);
    barEl = null;
    barHost = null;
  } else if (barHost) {
    barHost.remove();
    barHost = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'showDuplicateConfirm') {
    createBar(message.data as DuplicateConfirmData);
    sendResponse({ success: true });
  }
  return false;
});

console.log('[Tabby Sitter] Duplicate confirm content script loaded');
