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

/**
 * Lightly normalise a URL for duplicate comparison: strip the fragment and a
 * trailing slash on non-root paths. Returns null for unparsable URLs.
 */
export function normalizeUrlForDuplicate(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    return parsed.href;
  } catch {
    return null;
  }
}
