import { generateId } from '../utils/id';

export type MatchMode = 'contains' | 'regex';

export interface GroupRule {
  id: string;
  patterns: string[];
  groupName: string;
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
  matchMode: MatchMode;
  enabled?: boolean;
}

export interface RuleStorage {
  rules: GroupRule[];
}

/** Shape of a rule as it may appear in storage or an imported config file
 *  before normalization — every field optional, plus the legacy single
 *  `pattern` string. */
export interface RawRule {
  id?: string;
  patterns?: string[];
  pattern?: string;
  groupName?: string;
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
  matchMode?: string;
  enabled?: boolean;
}

let cachedRules: GroupRule[] | null = null;

function invalidateCache(): void {
  cachedRules = null;
}

/** Coerce a loosely-typed raw rule into a well-formed GroupRule, shimming the
 *  legacy single-`pattern` schema and validating the match mode. */
export function normalizeRawRule(raw: RawRule): GroupRule {
  const patterns =
    Array.isArray(raw.patterns) && raw.patterns.length > 0
      ? raw.patterns
      : raw.pattern
        ? [raw.pattern]
        : [];
  const matchMode: MatchMode = raw.matchMode === 'regex' ? 'regex' : 'contains';
  return {
    id: raw.id ?? '',
    patterns,
    groupName: raw.groupName ?? '',
    description: raw.description,
    color: raw.color,
    matchMode,
    enabled: raw.enabled,
  };
}

function parseRawRules(raw: RawRule[]): GroupRule[] {
  return raw.map(normalizeRawRule);
}

function rulesAreDuplicate(a: GroupRule, b: Omit<GroupRule, 'id'>): boolean {
  if (a.groupName !== b.groupName) return false;
  if (a.matchMode !== b.matchMode) return false;
  if (a.patterns.length !== b.patterns.length) return false;
  const aSet = new Set(a.patterns.map((p) => p.toLowerCase()));
  return b.patterns.every((p) => aSet.has(p.toLowerCase()));
}

export async function getRules(): Promise<GroupRule[]> {
  if (cachedRules !== null) return cachedRules;

  const result = (await chrome.storage.local.get('rules')) as { rules?: RawRule[] };
  const raw = result.rules ?? [];
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

export async function addRule(rule: Omit<GroupRule, 'id'>): Promise<GroupRule | null> {
  const rules = await getRules();
  if (rules.some((r) => rulesAreDuplicate(r, rule))) return null;
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

export async function toggleRule(id: string): Promise<boolean | null> {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  rule.enabled = rule.enabled === false ? true : false;
  await saveRules(rules);
  return rule.enabled;
}

export function getActiveRules(rules: GroupRule[]): GroupRule[] {
  return rules.filter((r) => r.enabled !== false);
}

export async function reorderRule(id: string, direction: 'up' | 'down'): Promise<void> {
  const rules = await getRules();
  const index = rules.findIndex((r) => r.id === id);
  if (index === -1) return;

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if (newIndex < 0 || newIndex >= rules.length) return;

  [rules[index], rules[newIndex]] = [rules[newIndex], rules[index]];
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
