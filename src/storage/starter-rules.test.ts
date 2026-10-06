import { describe, expect, it } from 'vitest';
import { matchesRule, type GroupRule } from './rules';
import { newStarterRules, STARTER_RULES } from './starter-rules';

let n = 0;
const id = () => `id${++n}`;

const rule = (groupName: string): GroupRule => ({ id: groupName, patterns: ['example.com'], groupName, matchMode: 'domain' });

describe('newStarterRules', () => {
  it('returns every starter rule for an empty setup, with fresh ids', () => {
    const added = newStarterRules([], id);
    expect(added.map((r) => r.groupName)).toEqual(STARTER_RULES.map((r) => r.groupName));
    expect(new Set(added.map((r) => r.id)).size).toBe(added.length);
  });

  it('skips groups the user already has (case-insensitive)', () => {
    const added = newStarterRules([rule('dev'), rule(' Social ')], id);
    expect(added.map((r) => r.groupName)).toEqual(['Docs', 'Mail', 'Media']);
  });

  it('returns nothing once all starter groups exist', () => {
    expect(newStarterRules(newStarterRules([], id), id)).toEqual([]);
  });

  it('does not share pattern arrays with the constant', () => {
    const [first] = newStarterRules([], id);
    first.patterns.push('gitlab.com');
    expect(STARTER_RULES[0].patterns).not.toContain('gitlab.com');
  });

  it('matches by domain, not substring', () => {
    const byName = (name: string): GroupRule => {
      const found = newStarterRules([], id).find((r) => r.groupName === name);
      if (!found) throw new Error(`no starter rule ${name}`);
      return found;
    };
    expect(matchesRule('https://x.com/home', byName('Social'))).toBe(true);
    expect(matchesRule('https://www.netflix.com/browse', byName('Social'))).toBe(false);
    expect(matchesRule('https://m.youtube.com/watch?v=1', byName('Media'))).toBe(true);
  });
});
