import { describe, expect, it } from 'vitest';
import { matchesRule, parseRawRules, upsertDomainRule, type GroupRule } from './rules';

function rule(overrides: Partial<GroupRule>): GroupRule {
  return { id: 'r1', patterns: ['github.com'], groupName: 'Dev', matchMode: 'contains', ...overrides };
}

describe('matchesRule', () => {
  it('matches contains case-insensitively against the full URL', () => {
    expect(matchesRule('https://GitHub.com/foo', rule({}))).toBe(true);
    expect(matchesRule('https://example.com/?u=github.com', rule({}))).toBe(true);
    expect(matchesRule('https://example.com', rule({}))).toBe(false);
  });
  it('matches regex mode', () => {
    const r = rule({ patterns: ['^https://[a-z]+\\.github\\.com/'], matchMode: 'regex' });
    expect(matchesRule('https://gist.github.com/x', r)).toBe(true);
    expect(matchesRule('https://github.com/x', r)).toBe(false);
  });
  it('ignores invalid regex and over-long patterns', () => {
    expect(matchesRule('https://a.com', rule({ patterns: ['('], matchMode: 'regex' }))).toBe(false);
    expect(matchesRule('https://a.com', rule({ patterns: ['a'.repeat(5001)], matchMode: 'regex' }))).toBe(false);
  });
  it('ignores empty patterns and unparsable URLs', () => {
    expect(matchesRule('https://a.com', rule({ patterns: [''] }))).toBe(false);
    expect(matchesRule('nope', rule({}))).toBe(false);
  });
  it('matches if any pattern matches', () => {
    expect(matchesRule('https://gitlab.com', rule({ patterns: ['github.com', 'gitlab.com'] }))).toBe(true);
  });
});

describe('parseRawRules', () => {
  it('carries enabled through', () => {
    const [a, b, c] = parseRawRules([
      { id: '1', patterns: ['a'], groupName: 'A', enabled: false },
      { id: '2', patterns: ['b'], groupName: 'B', enabled: true },
      { id: '3', patterns: ['c'], groupName: 'C' },
    ]);
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(true);
    expect(c.enabled).toBeUndefined();
  });
  it('shims legacy single-pattern rules and defaults matchMode', () => {
    const [r] = parseRawRules([{ id: '1', pattern: 'x.com', groupName: 'X' }]);
    expect(r.patterns).toEqual(['x.com']);
    expect(r.matchMode).toBe('contains');
  });
  it('fills defaults for missing fields', () => {
    const [r] = parseRawRules([{}]);
    expect(r).toMatchObject({ id: '', patterns: [], groupName: '', matchMode: 'contains' });
  });
});

describe('domain match mode', () => {
  const d = (p: string) => rule({ patterns: [p], matchMode: 'domain' });
  it('matches the host and its subdomains', () => {
    expect(matchesRule('https://github.com/a', d('github.com'))).toBe(true);
    expect(matchesRule('https://gist.github.com/a', d('github.com'))).toBe(true);
    expect(matchesRule('https://GitHub.com:8080/a', d('GitHub.com'))).toBe(true);
  });
  it('does not match lookalikes or the pattern in the path', () => {
    expect(matchesRule('https://notgithub.com/', d('github.com'))).toBe(false);
    expect(matchesRule('https://example.com/github.com', d('github.com'))).toBe(false);
    expect(matchesRule('https://github.com.evil.io/', d('github.com'))).toBe(false);
  });
  it('ignores a leading www. in the pattern', () => {
    expect(matchesRule('https://github.com/', d('www.github.com'))).toBe(true);
    expect(matchesRule('https://www.github.com/', d('www.github.com'))).toBe(true);
  });
  it('never matches an invalid URL or an empty pattern', () => {
    expect(matchesRule('not a url', d('github.com'))).toBe(false);
    expect(matchesRule('https://github.com', d('www.'))).toBe(false);
  });
});

describe('upsertDomainRule', () => {
  const dom = (over: Partial<GroupRule>) => rule({ patterns: ['a.com'], matchMode: 'domain', ...over });

  it('creates an enabled rule when none exists for the group', () => {
    const rules: GroupRule[] = [rule({ groupName: 'Other', patterns: ['zzz'] })];
    const out = upsertDomainRule(rules, 'Example.com', 'Dev', 'red', () => 'n1');
    expect(out).toEqual({ result: 'created', changed: true });
    expect(rules[1]).toEqual({
      id: 'n1', patterns: ['example.com'], groupName: 'Dev', color: 'red', matchMode: 'domain', enabled: true,
    });
  });

  it('extends an existing domain rule', () => {
    const rules: GroupRule[] = [dom({})];
    expect(upsertDomainRule(rules, 'www.b.com', 'Dev', undefined)).toEqual({ result: 'extended', changed: true });
    expect(rules[0].patterns).toEqual(['a.com', 'b.com']);
  });

  it('ignores contains rules when looking for the target', () => {
    const rules: GroupRule[] = [rule({ patterns: ['a.com'], matchMode: 'contains' })];
    expect(upsertDomainRule(rules, 'a.com', 'Dev', undefined, () => 'z').result).toBe('created');
  });

  it('moves the target above an earlier enabled rule that matches the host', () => {
    const rules: GroupRule[] = [
      rule({ id: 'x', groupName: 'Work', patterns: ['github'] }),
      rule({ id: 'y', groupName: 'Misc', patterns: ['nomatch'] }),
      dom({ id: 't', groupName: 'Dev', patterns: ['a.com'] }),
    ];
    const out = upsertDomainRule(rules, 'github.com', 'Dev', undefined);
    expect(out).toEqual({ result: 'extended', changed: true, movedAbove: 'Work' });
    expect(rules.map((r) => r.id)).toEqual(['t', 'x', 'y']);
  });

  it('does not move when earlier rules do not match', () => {
    const rules: GroupRule[] = [rule({ id: 'x', groupName: 'Work', patterns: ['nomatch'] }), dom({ id: 't', groupName: 'Dev' })];
    const out = upsertDomainRule(rules, 'b.com', 'Dev', undefined);
    expect(out.movedAbove).toBeUndefined();
    expect(rules.map((r) => r.id)).toEqual(['x', 't']);
  });

  it('does not move above a disabled matching rule', () => {
    const rules: GroupRule[] = [
      rule({ id: 'x', groupName: 'Work', patterns: ['a.com'], enabled: false }),
      dom({ id: 't', groupName: 'Dev' }),
    ];
    const out = upsertDomainRule(rules, 'a.com', 'Dev', undefined);
    expect(out).toEqual({ result: 'exists', changed: false });
    expect(rules.map((r) => r.id)).toEqual(['x', 't']);
  });

  it('re-enables a disabled target', () => {
    const rules: GroupRule[] = [dom({ id: 't', groupName: 'Dev', enabled: false })];
    expect(upsertDomainRule(rules, 'a.com', 'Dev', undefined)).toEqual({ result: 'exists', changed: true });
    expect(rules[0].enabled).toBe(true);
  });

  it('exists with the rule already first and enabled is unchanged', () => {
    const rules: GroupRule[] = [dom({ id: 't', groupName: 'Dev' }), rule({ id: 'x', patterns: ['a.com'], groupName: 'Work' })];
    expect(upsertDomainRule(rules, 'A.com', 'Dev', undefined)).toEqual({ result: 'exists', changed: false });
    expect(rules.map((r) => r.id)).toEqual(['t', 'x']);
  });

  it('keeps the relative order of other rules when moving', () => {
    const rules: GroupRule[] = [
      rule({ id: '1', groupName: 'A', patterns: ['q'] }),
      rule({ id: '2', groupName: 'B', patterns: ['a.com'] }),
      rule({ id: '3', groupName: 'C', patterns: ['a.com'] }),
      dom({ id: 't', groupName: 'Dev' }),
    ];
    upsertDomainRule(rules, 'a.com', 'Dev', undefined);
    expect(rules.map((r) => r.id)).toEqual(['1', 't', '2', '3']);
  });
});
