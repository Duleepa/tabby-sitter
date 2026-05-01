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

let cachedRules: GroupRule[] | null = null;

function invalidateCache(): void {
  cachedRules = null;
}

function parseRawRules(raw: any[]): GroupRule[] {
  return raw.map((r) => ({
    id: r.id || '',
    patterns: r.patterns || (r.pattern ? [r.pattern] : []),
    groupName: r.groupName || '',
    description: r.description,
    color: r.color,
    matchMode: r.matchMode || 'contains',
  })) as GroupRule[];
}

export async function getRules(): Promise<GroupRule[]> {
  if (cachedRules !== null) return cachedRules;

  const result = (await chrome.storage.local.get('rules')) as { rules?: any[] };
  const raw = result.rules || [];
  cachedRules = parseRawRules(raw);
  return cachedRules;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rules) {
    invalidateCache();
  }
});

export async function saveRules(rules: GroupRule[]): Promise<void> {
  invalidateCache();
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

export async function updateRule(id: string, updates: Partial<GroupRule>): Promise<GroupRule | null> {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  rules[index] = { ...rules[index], ...updates };
  await saveRules(rules);
  return rules[index];
}

export async function updateRule(id: string, updates: Partial<GroupRule>): Promise<GroupRule | null> {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  rules[index] = { ...rules[index], ...updates };
  await saveRules(rules);
  return rules[index];
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
