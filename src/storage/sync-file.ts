import { DEFAULT_SETTINGS, type ExtensionSettings } from './config';
import type { GroupColor, GroupRule, MatchMode } from './rules';
import { isSavableUrl, type SavedGroup, type SavedTab } from './saved-groups';
import { generateId } from '../utils/id';

/** Version written by this build. Files up to this version are readable. */
export const SYNC_VERSION = '0.3.0';
export const MAX_SYNC_FILE_CHARS = 5 * 1024 * 1024;

const MATCH_MODES = new Set<string>(['contains', 'regex', 'domain']);
const COLORS = new Set<string>(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const DUPLICATE_MODES = new Set<string>(['allow', 'prevent-all', 'prevent-specific']);

export interface SyncContent {
  rules: GroupRule[];
  /** Possibly partial when parsed from a file; completed with defaults when hashed or applied. */
  settings?: Partial<ExtensionSettings>;
  savedGroups?: SavedGroup[];
}

export interface SyncFile {
  tabbySitter: {
    version: string;
    savedAt?: string;
    deviceId?: string;
    rules: GroupRule[];
    settings?: Partial<ExtensionSettings>;
    savedGroups?: SavedGroup[];
  };
}

/** Identifies one write of the file; a different value means it changed elsewhere. */
export interface FileMeta {
  savedAt: string;
  deviceId: string;
}

export interface SyncOptions {
  includeSettings: boolean;
  includeSavedGroups: boolean;
}

// ---------- build ----------

/** Pure: keep only the parts the user chose to sync. */
export function syncContent(content: SyncContent, opts: SyncOptions): SyncContent {
  const out: SyncContent = { rules: content.rules };
  if (opts.includeSettings && content.settings) out.settings = content.settings;
  if (opts.includeSavedGroups && content.savedGroups) out.savedGroups = content.savedGroups;
  return out;
}

export function buildSyncFile(content: SyncContent, meta?: Partial<FileMeta>): SyncFile {
  const tabbySitter: SyncFile['tabbySitter'] = { version: SYNC_VERSION, rules: content.rules };
  if (meta?.savedAt) tabbySitter.savedAt = meta.savedAt;
  if (meta?.deviceId) tabbySitter.deviceId = meta.deviceId;
  if (content.settings) tabbySitter.settings = content.settings;
  if (content.savedGroups) tabbySitter.savedGroups = content.savedGroups;
  return { tabbySitter };
}

// ---------- hash ----------

/** JSON with object keys sorted and undefined values dropped, so key order never matters. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fnv1a(text: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable hash of the synced content (never the savedAt/deviceId metadata). */
export function contentHash(content: SyncContent): string {
  const normalised: SyncContent = content.settings
    ? { ...content, settings: { ...DEFAULT_SETTINGS, ...content.settings } }
    : content;
  const json = canonicalJson(normalised);
  // Two differently seeded 32-bit FNV-1a passes give 64 bits.
  return fnv1a(json, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(json, 0x9747b28c).toString(16).padStart(8, '0');
}

// ---------- parse + validate ----------

export interface ParsedSyncFile {
  version: string;
  /** Null for files written by hand or by v0.2 (no metadata). */
  meta: FileMeta | null;
  content: SyncContent;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Pure: true if `version` (x.y.z) is newer than this build understands. */
export function isNewerVersion(version: string): boolean {
  const [a, b] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const [ca, cb] = SYNC_VERSION.split('.').map(Number);
  return a > ca || (a === ca && b > cb);
}

/** Validate and normalise rules; accepts the old single-`pattern` schema. */
export function normalizeRules(raw: unknown[]): GroupRule[] {
  return raw.map((entry) => {
    if (!isObject(entry)) throw new Error('Invalid rule: expected an object');
    const patterns = Array.isArray(entry.patterns)
      ? entry.patterns.filter((p): p is string => typeof p === 'string' && p !== '')
      : typeof entry.pattern === 'string' && entry.pattern
        ? [entry.pattern]
        : [];
    if (patterns.length === 0) throw new Error('Invalid rule: patterns cannot be empty');
    const color = optString(entry.color);
    return {
      id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
      patterns,
      groupName: optString(entry.groupName) ?? '',
      description: optString(entry.description),
      color: color && COLORS.has(color) ? (color as GroupColor) : undefined,
      matchMode: MATCH_MODES.has(String(entry.matchMode)) ? (entry.matchMode as MatchMode) : 'contains',
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
    };
  });
}

/** Keep only known keys whose value has the default's type (and passes per-key checks). */
export function normalizeSettings(raw: Record<string, unknown>): Partial<ExtensionSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[]) {
    const value = raw[key];
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
    if (key === 'duplicateTabMode' && !DUPLICATE_MODES.has(value as string)) continue;
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) continue;
    out[key] = value;
  }
  return out;
}

/** Valid groups only; invalid entries and unrestorable tab URLs are dropped. */
export function normalizeSavedGroups(raw: unknown[]): SavedGroup[] {
  const groups: SavedGroup[] = [];
  for (const g of raw) {
    if (!isObject(g) || typeof g.id !== 'string' || !g.id || typeof g.title !== 'string') continue;
    const tabs: SavedTab[] = [];
    for (const t of Array.isArray(g.tabs) ? (g.tabs as unknown[]) : []) {
      if (!isObject(t) || typeof t.url !== 'string' || !isSavableUrl(t.url)) continue;
      tabs.push({ url: t.url, title: typeof t.title === 'string' && t.title ? t.title : t.url });
    }
    if (tabs.length === 0) continue;
    groups.push({
      id: g.id,
      title: g.title,
      color: typeof g.color === 'string' && COLORS.has(g.color) ? (g.color as GroupColor) : 'grey',
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
      updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : 0,
      tabs,
    });
  }
  return groups;
}

/** Parse a sync/config file. Throws an Error with a user-readable message when invalid. */
export function parseSyncFile(text: string): ParsedSyncFile {
  if (text.length > MAX_SYNC_FILE_CHARS) throw new Error('Config file is too large (max 5 MB)');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Config file is not valid JSON');
  }
  const root = isObject(json) ? json.tabbySitter : undefined;
  if (!isObject(root) || !Array.isArray(root.rules)) {
    throw new Error('Invalid config file: expected { tabbySitter: { rules: [...] } }');
  }
  const version = typeof root.version === 'string' ? root.version : '0.2.0';
  if (isNewerVersion(version)) throw new Error(`Config file is from a newer version (${version})`);

  const content: SyncContent = { rules: normalizeRules(root.rules) };
  if (root.settings !== undefined) {
    if (!isObject(root.settings)) throw new Error('Invalid config file: settings must be an object');
    content.settings = normalizeSettings(root.settings);
  }
  if (root.savedGroups !== undefined) {
    if (!Array.isArray(root.savedGroups)) throw new Error('Invalid config file: savedGroups must be an array');
    content.savedGroups = normalizeSavedGroups(root.savedGroups);
  }
  const meta =
    typeof root.savedAt === 'string' && typeof root.deviceId === 'string'
      ? { savedAt: root.savedAt, deviceId: root.deviceId }
      : null;
  return { version, meta, content };
}

// ---------- decision ----------

export interface SyncState {
  /** Hash of the content last known to be in both local storage and the file. */
  lastHash: string | null;
  /** Metadata of the file version this device last read or wrote. */
  lastSeen: FileMeta | null;
}

export type SyncDecision = 'in-sync' | 'write' | 'load' | 'conflict';

function sameMeta(a: FileMeta | null, b: FileMeta | null): boolean {
  return !!a && !!b && a.savedAt === b.savedAt && a.deviceId === b.deviceId;
}

/**
 * Pure: what to do given the file's identity/content hash, the local content hash and what this
 * device last saw. Never returns 'write' for a file that changed elsewhere. On 'in-sync' with
 * differing `lastSeen`, the caller records the file's meta/hash (contents already match).
 * `fileHash` is null for an empty file; `fileMeta` is null for a file without metadata (hand-written, v0.2).
 */
export function decideSync(input: {
  fileMeta: FileMeta | null;
  fileHash: string | null;
  localHash: string;
  state: SyncState;
  autoLoad: boolean;
}): SyncDecision {
  const { fileMeta, fileHash, localHash, state, autoLoad } = input;
  if (fileHash === null) return 'write'; // empty file: nothing to lose
  if (!fileMeta) return fileHash === localHash ? 'write' : 'conflict'; // hand-written file: adopt it or ask
  const localEdited = localHash !== state.lastHash;
  if (sameMeta(fileMeta, state.lastSeen)) return localEdited ? 'write' : 'in-sync';
  if (fileHash === localHash) return 'in-sync';
  return !localEdited && autoLoad ? 'load' : 'conflict';
}

/** Pure: `tabby-sitter-<slug>.conf.json` for a profile label, or the plain name when it has no usable characters. */
export function suggestedSyncFileName(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug ? `tabby-sitter-${slug}.conf.json` : 'tabby-sitter.conf.json';
}
