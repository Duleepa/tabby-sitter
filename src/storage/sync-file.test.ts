import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './config';
import {
  buildSyncFile,
  canonicalJson,
  contentHash,
  decideSync,
  isNewerVersion,
  parseSyncFile,
  suggestedSyncFileName,
  syncContent,
  type FileMeta,
  type SyncContent,
} from './sync-file';

const rule = { id: 'r1', patterns: ['github.com'], groupName: 'Dev', matchMode: 'domain' as const };
const group = {
  id: 'g1',
  title: 'Work',
  color: 'blue' as const,
  createdAt: 1,
  updatedAt: 2,
  tabs: [{ url: 'https://a.com', title: 'A' }],
};
const wrap = (inner: Record<string, unknown>) => JSON.stringify({ tabbySitter: { version: '0.3.0', ...inner } });

describe('parseSyncFile', () => {
  it('rejects bad JSON, wrong shape, oversize and newer versions', () => {
    expect(() => parseSyncFile('{nope')).toThrow(/not valid JSON/);
    expect(() => parseSyncFile('[]')).toThrow(/Invalid config file/);
    expect(() => parseSyncFile(JSON.stringify({ tabbySitter: {} }))).toThrow(/Invalid config file/);
    expect(() => parseSyncFile('x'.repeat(5 * 1024 * 1024 + 1))).toThrow(/too large/);
    expect(() => parseSyncFile(wrap({ version: '9.0.0', rules: [] }))).toThrow(/newer version/);
  });

  it('rejects rules with empty patterns or non-object entries', () => {
    expect(() => parseSyncFile(wrap({ rules: [{ patterns: [] }] }))).toThrow(/patterns cannot be empty/);
    expect(() => parseSyncFile(wrap({ rules: ['x'] }))).toThrow(/expected an object/);
  });

  it('reads v0.2 rules-only files, old single-pattern rules and defaults matchMode', () => {
    const text = JSON.stringify({
      tabbySitter: { version: '0.2.0', rules: [{ id: 'a', pattern: 'x.com', groupName: 'X', matchMode: 'bogus' }] },
    });
    const parsed = parseSyncFile(text);
    expect(parsed.meta).toBeNull();
    expect(parsed.content.settings).toBeUndefined();
    expect(parsed.content.savedGroups).toBeUndefined();
    expect(parsed.content.rules[0]).toMatchObject({ patterns: ['x.com'], matchMode: 'contains' });
  });

  it('reads metadata when both savedAt and deviceId are present', () => {
    const parsed = parseSyncFile(wrap({ savedAt: 't', deviceId: 'd', rules: [] }));
    expect(parsed.meta).toEqual({ savedAt: 't', deviceId: 'd' });
    expect(parseSyncFile(wrap({ savedAt: 't', rules: [] })).meta).toBeNull();
  });

  it('keeps only known settings keys with the default type and valid values', () => {
    const parsed = parseSyncFile(
      wrap({
        rules: [],
        settings: {
          duplicateBadge: false,
          duplicateTabMode: 'prevent-all',
          autoDiscardMinutes: 60,
          keepOpenedTabsInGroup: 'yes',
          unknownKey: 1,
        },
      })
    );
    expect(parsed.content.settings).toEqual({
      duplicateBadge: false,
      duplicateTabMode: 'prevent-all',
      autoDiscardMinutes: 60,
    });
    const bad = parseSyncFile(wrap({ rules: [], settings: { duplicateTabMode: 'sometimes', autoDiscardMinutes: -5 } }));
    expect(bad.content.settings).toEqual({});
    expect(() => parseSyncFile(wrap({ rules: [], settings: [] }))).toThrow(/settings must be an object/);
  });

  it('validates saved groups', () => {
    expect(() => parseSyncFile(wrap({ rules: [], savedGroups: {} }))).toThrow(/savedGroups must be an array/);
    const parsed = parseSyncFile(
      wrap({
        rules: [],
        savedGroups: [
          group,
          { ...group, id: 'g2', color: 'neon', tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://b.com' }] },
          { ...group, id: '' },
          { ...group, id: 'g4', tabs: [{ url: 'about:blank' }] },
          'junk',
        ],
      })
    );
    expect(parsed.content.savedGroups).toHaveLength(2);
    expect(parsed.content.savedGroups?.[1]).toMatchObject({
      id: 'g2',
      color: 'grey',
      tabs: [{ url: 'https://b.com', title: 'https://b.com' }],
    });
  });

  it('round-trips through buildSyncFile', () => {
    const content: SyncContent = { rules: [rule], settings: { ...DEFAULT_SETTINGS }, savedGroups: [group] };
    const text = JSON.stringify(buildSyncFile(content, { savedAt: 't', deviceId: 'd' }));
    const parsed = parseSyncFile(text);
    expect(contentHash(parsed.content)).toBe(contentHash(content));
  });
});

describe('syncContent / isNewerVersion', () => {
  it('drops excluded parts', () => {
    const c: SyncContent = { rules: [rule], settings: {}, savedGroups: [group] };
    expect(syncContent(c, { includeSettings: false, includeSavedGroups: true })).toEqual({
      rules: [rule],
      savedGroups: [group],
    });
    expect(syncContent(c, { includeSettings: false, includeSavedGroups: false })).toEqual({ rules: [rule] });
  });
  it('compares versions', () => {
    expect(isNewerVersion('0.3.9')).toBe(false);
    expect(isNewerVersion('0.4.0')).toBe(true);
    expect(isNewerVersion('1.0.0')).toBe(true);
    expect(isNewerVersion('0.2.0')).toBe(false);
  });
});

describe('contentHash', () => {
  it('is stable across key order and ignores undefined values', () => {
    const a: SyncContent = { rules: [{ ...rule, description: undefined }] };
    const b: SyncContent = { rules: [{ matchMode: 'domain', groupName: 'Dev', patterns: ['github.com'], id: 'r1' }] };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it('changes with content and rule order, and completes partial settings', () => {
    const r2 = { ...rule, id: 'r2' };
    expect(contentHash({ rules: [rule, r2] })).not.toBe(contentHash({ rules: [r2, rule] }));
    expect(contentHash({ rules: [rule] })).not.toBe(contentHash({ rules: [rule], savedGroups: [] }));
    expect(contentHash({ rules: [], settings: {} })).toBe(contentHash({ rules: [], settings: { ...DEFAULT_SETTINGS } }));
    expect(contentHash({ rules: [], settings: { duplicateBadge: false } })).not.toBe(
      contentHash({ rules: [], settings: {} })
    );
  });
});

describe('decideSync', () => {
  const meta = (savedAt: string, deviceId = 'd1'): FileMeta => ({ savedAt, deviceId });
  const base = { autoLoad: true, localHash: 'L', fileHash: 'F' };

  it('writes into an empty file', () => {
    expect(
      decideSync({ ...base, fileMeta: null, fileHash: null, state: { lastHash: null, lastSeen: null } })
    ).toBe('write');
  });
  it('adopts a metadata-less file when equal, asks when different', () => {
    const state = { lastHash: null, lastSeen: null };
    expect(decideSync({ ...base, fileMeta: null, fileHash: 'L', state })).toBe('write');
    expect(decideSync({ ...base, fileMeta: null, state })).toBe('conflict');
  });
  it('is in sync when file is unchanged and no local edits', () => {
    const state = { lastHash: 'L', lastSeen: meta('t1') };
    expect(decideSync({ ...base, fileMeta: meta('t1'), state })).toBe('in-sync');
  });
  it('writes when only local changed', () => {
    const state = { lastHash: 'old', lastSeen: meta('t1') };
    expect(decideSync({ ...base, fileMeta: meta('t1'), state })).toBe('write');
  });
  it('loads when only the file changed and auto-load is on', () => {
    const state = { lastHash: 'L', lastSeen: meta('t1') };
    expect(decideSync({ ...base, fileMeta: meta('t2'), state })).toBe('load');
    expect(decideSync({ ...base, fileMeta: meta('t1', 'd2'), state })).toBe('load');
  });
  it('asks instead of loading when auto-load is off', () => {
    const state = { lastHash: 'L', lastSeen: meta('t1') };
    expect(decideSync({ ...base, autoLoad: false, fileMeta: meta('t2'), state })).toBe('conflict');
  });
  it('conflicts when both changed, never writing', () => {
    const state = { lastHash: 'old', lastSeen: meta('t1') };
    expect(decideSync({ ...base, fileMeta: meta('t2'), state })).toBe('conflict');
  });
  it('is in sync when the file changed but already equals local', () => {
    const state = { lastHash: 'old', lastSeen: meta('t1') };
    expect(decideSync({ ...base, fileHash: 'L', fileMeta: meta('t2'), state })).toBe('in-sync');
  });
  it('conflicts on first link when contents differ', () => {
    expect(decideSync({ ...base, fileMeta: meta('t1'), state: { lastHash: null, lastSeen: null } })).toBe('conflict');
    expect(decideSync({ ...base, fileHash: 'L', fileMeta: meta('t1'), state: { lastHash: null, lastSeen: null } })).toBe(
      'in-sync'
    );
  });
});

describe('suggestedSyncFileName', () => {
  it('uses the plain name without a usable label', () => {
    expect(suggestedSyncFileName('')).toBe('tabby-sitter.conf.json');
    expect(suggestedSyncFileName('  !!! ')).toBe('tabby-sitter.conf.json');
  });
  it('slugifies the label', () => {
    expect(suggestedSyncFileName('Work')).toBe('tabby-sitter-work.conf.json');
    expect(suggestedSyncFileName('  My  Home/Laptop! ')).toBe('tabby-sitter-my-home-laptop.conf.json');
  });
  it('caps the slug at 40 characters without a trailing dash', () => {
    const name = suggestedSyncFileName('a'.repeat(39) + ' bbbb');
    expect(name).toBe(`tabby-sitter-${'a'.repeat(39)}.conf.json`);
    expect(suggestedSyncFileName('x'.repeat(100))).toBe(`tabby-sitter-${'x'.repeat(40)}.conf.json`);
  });
});
