import { generateId } from '../utils/id';

export type MatchMode = 'contains' | 'regex';

export interface GroupRule {
  id: string;
  patterns: string[];
  groupName: string;
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
  matchMode: MatchMode;
}

export interface RuleStorage {
  rules: GroupRule[];
}

export async function getRules(): Promise<GroupRule[]> {
  const result = (await chrome.storage.local.get('rules')) as { rules?: any[] };
  const raw = result.rules || [];
  // Minimal runtime shim for old single-pattern storage (no migration writeback)
  return raw.map((r) => ({
    id: r.id || '',
    patterns: r.patterns || (r.pattern ? [r.pattern] : []),
    groupName: r.groupName || '',
    description: r.description,
    color: r.color,
    matchMode: r.matchMode || 'contains',
  })) as GroupRule[];
}

export async function saveRules(rules: GroupRule[]): Promise<void> {
  await chrome.storage.local.set({ rules });
}

export async function addRule(rule: Omit<GroupRule, 'id'>): Promise<GroupRule> {
  const rules = await getRules();
  const newRule: GroupRule = { ...rule, id: generateId() };
  rules.push(newRule);
  await saveRules(rules);
  return newRule;
}

export async function removeRule(id: string): Promise<void> {
  const rules = (await getRules()).filter((r) => r.id !== id);
  await saveRules(rules);
}

/**
 * Check whether a URL matches any of the patterns in a rule.
 * Uses the full URL (href) for both contains and regex modes.
 */
export function matchesRule(url: string, rule: GroupRule): boolean {
  try {
    const href = new URL(url).href.toLowerCase();
    return rule.patterns.some((p) => {
      if (!p) return false;
      if (rule.matchMode === 'regex') {
        // Prevent extremely long patterns that could cause catastrophic backtracking
        if (p.length > 5000) return false;
        try {
          return new RegExp(p, 'i').test(href);
        } catch {
          return false;
        }
      }
      return href.includes(p.toLowerCase());
    });
  } catch {
    return false;
  }
}

/** @deprecated Kept for any external callers; prefer matchesRule */
export function matchesPattern(_url: string, _pattern: string): boolean {
  throw new Error('matchesPattern is removed; use matchesRule instead');
}
