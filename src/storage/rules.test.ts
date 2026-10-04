import { describe, expect, it } from 'vitest';
import { matchesRule, parseRawRules, type GroupRule } from './rules';

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
