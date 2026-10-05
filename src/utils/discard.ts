import { hostnameMatchesDomain, isRealPageUrl, parseDomains } from './url';

export interface DiscardSettings {
  /** 0 = off. */
  autoDiscardMinutes: number;
  autoDiscardPinned: boolean;
  /** Comma-separated domains (subdomains included). */
  autoDiscardExceptDomains: string;
}

export interface DiscardCandidate {
  id?: number;
  url?: string;
  active?: boolean;
  discarded?: boolean;
  audible?: boolean;
  pinned?: boolean;
  autoDiscardable?: boolean;
  lastAccessed?: number;
}

/** Tabs idle for longer than the threshold that are safe to unload. */
export function pickTabsToDiscard<T extends DiscardCandidate>(tabs: T[], settings: DiscardSettings, now: number): T[] {
  if (settings.autoDiscardMinutes <= 0) return [];
  const threshold = settings.autoDiscardMinutes * 60000;
  const excepted = parseDomains(settings.autoDiscardExceptDomains);

  return tabs.filter((t) => {
    if (t.id === undefined || t.active || t.discarded || t.audible) return false;
    if (t.autoDiscardable === false) return false;
    if (t.pinned && !settings.autoDiscardPinned) return false;
    if (!isRealPageUrl(t.url)) return false;
    if (t.lastAccessed === undefined || now - t.lastAccessed < threshold) return false;
    try {
      const host = new URL(t.url).hostname.toLowerCase();
      if (excepted.some((d) => hostnameMatchesDomain(host, d))) return false;
    } catch {
      return false;
    }
    return true;
  });
}
