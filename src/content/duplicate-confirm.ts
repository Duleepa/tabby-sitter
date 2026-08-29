import type { DuplicateConfirmData, RuntimeMessage } from '../storage/messages';

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
    // Fall back to the raw string if the URL cannot be parsed.
  }

  // Build the bar as DOM nodes rather than an HTML string so the page URL
  // (attacker-controllable) can never break out of markup / inject content.
  const content = document.createElement('div');
  content.className = 'confirm-bar-content';

  const banner = document.createElement('div');
  banner.className = 'banner';
  const bannerIcon = document.createElement('span');
  bannerIcon.className = 'banner-icon';
  bannerIcon.textContent = '⚠️';
  const bannerText = document.createElement('span');
  bannerText.className = 'banner-text';
  bannerText.textContent = 'Duplicate Tab';
  banner.append(bannerIcon, bannerText);

  const urlDisplay = document.createElement('div');
  urlDisplay.className = 'url-display';
  urlDisplay.title = data.url;
  urlDisplay.textContent = displayUrl;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const switchBtn = document.createElement('button');
  switchBtn.className = 'btn-switch';
  switchBtn.textContent = 'Switch to existing';
  const keepBtn = document.createElement('button');
  keepBtn.className = 'btn-keep';
  keepBtn.textContent = 'Keep this tab';
  actions.append(switchBtn, keepBtn);

  content.append(banner, urlDisplay, actions);
  bar.appendChild(content);

  shadow.appendChild(bar);
  barEl = bar;
  document.documentElement.appendChild(barHost);

  requestAnimationFrame(() => {
    bar.classList.add('visible');
  });

  switchBtn.addEventListener('click', () => {
    void chrome.runtime.sendMessage({
      action: 'switchToExisting',
      existingTabId: data.existingTabId,
      newTabId: data.newTabId,
    } satisfies RuntimeMessage);
    destroyBar();
  });

  // "Keep this tab" simply dismisses the bar; the tab already exists so the
  // background worker needs to do nothing.
  keepBtn.addEventListener('click', () => {
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

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.action === 'showDuplicateConfirm') {
    createBar(message.data);
    sendResponse({ success: true });
  }
  return false;
});

console.log('[Tabby Sitter] Duplicate confirm content script loaded');
