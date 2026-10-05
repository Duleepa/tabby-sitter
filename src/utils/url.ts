export const SKIP_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'brave://',
  'about:',
  'devtools://',
  'view-source:',
];

export function isSkippableUrl(url: string): boolean {
  return SKIP_URL_PREFIXES.some((p) => url.startsWith(p));
}

/** True for URLs of real pages (http, https, file). */
export function isRealPageUrl(url: string | undefined): url is string {
  return !!url && /^(https?|file):/i.test(url);
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid', 'ref_src', 'ref_url', 'si', 'spm',
]);

/** Parse the comma-separated "extra query parameters to ignore" setting. */
export function parseIgnoreParams(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

/**
 * Normalise a URL for duplicate comparison: drop the fragment, `www.`, tracking
 * query parameters (plus the user's extra list), sort the remaining parameters,
 * and strip a trailing slash on non-root paths. Returns null for unparsable URLs.
 */
export function normalizeUrlForDuplicate(url: string, extraIgnoredParams: string[] = []): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.hostname.startsWith('www.')) parsed.hostname = parsed.hostname.slice(4);
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    const extra = new Set(extraIgnoredParams.map((p) => p.toLowerCase()));
    const params = parsed.searchParams;
    const names = new Set<string>();
    params.forEach((_v, k) => names.add(k));
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower) || extra.has(lower)) params.delete(name);
    }
    params.sort();
    parsed.search = params.toString();
    return parsed.href;
  } catch {
    return null;
  }
}

/** Parse a comma-separated domain list into lowercase entries. */
export function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/** Hostname equals the domain or is a subdomain of it. */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith('.' + domain);
}
