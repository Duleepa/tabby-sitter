import { generateId } from '../utils/id';

export type GroupColor = `${chrome.tabGroups.Color}`;

export type MatchMode = 'contains' | 'regex' | 'domain';

export interface GroupRule {
  id: string;
  patterns: string[];
  groupName: string;
  description?: string;
  color?: GroupColor;
  matchMode: MatchMode;
  enabled?: boolean;
}

export interface RuleStorage {
  rules: GroupRule[];
}

let cachedRules: GroupRule[] | null = null;

function invalidateCache(): void {
  cachedRules = null;
}

export function parseRawRules(raw: any[]): GroupRule[] {
  return raw.map((r) => ({
    id: r.id || '',
    patterns: r.patterns || (r.pattern ? [r.pattern] : []),
    groupName: r.groupName || '',
    description: r.description,
    color: r.color,
    matchMode: r.matchMode || 'contains',
    enabled: typeof r.enabled === 'boolean' ? r.enabled : undefined,
  }));
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

  const result = await chrome.storage.local.get<{ rules?: any[] }>('rules');
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

/** Hostname equals the domain or is a subdomain of it. A leading `www.` in the pattern is ignored. */
function hostMatchesDomain(hostname: string, pattern: string): boolean {
  const domain = pattern.trim().toLowerCase().replace(/^www\./, '');
  if (!domain) return false;
  return hostname === domain || hostname.endsWith('.' + domain);
}

export type DomainRuleResult = 'created' | 'extended' | 'exists';

export interface DomainRuleOutcome {
  result: DomainRuleResult;
  /** True if `rules` was modified and needs saving. */
  changed: boolean;
  /** Group name of the rule the target was moved above so it takes priority. */
  movedAbove?: string;
}

/**
 * Pure helper for "Always group this site here": append the host to an existing
 * domain rule for the group, or add a new domain rule. The rule is enabled and,
 * if an earlier enabled rule also matches the host, moved just before it so it
 * actually wins. Mutates `rules`.
 */
export function upsertDomainRule(
  rules: GroupRule[],
  host: string,
  groupName: string,
  color: GroupColor | undefined,
  newId: () => string = generateId
): DomainRuleOutcome {
  const h = host.toLowerCase().replace(/^www\./, '');
  let target = rules.find((r) => r.groupName === groupName && r.matchMode === 'domain');
  let result: DomainRuleResult = 'exists';
  let changed = false;

  if (!target) {
    target = { id: newId(), patterns: [h], groupName, color, matchMode: 'domain', enabled: true };
    rules.push(target);
    result = 'created';
    changed = true;
  } else if (!target.patterns.some((p) => p.toLowerCase().replace(/^www\./, '') === h)) {
    target.patterns = [...target.patterns, h];
    result = 'extended';
    changed = true;
  }

  if (target.enabled === false) {
    target.enabled = true;
    changed = true;
  }

  const url = `https://${h}/`;
  const at = rules.indexOf(target);
  const blocker = rules.findIndex((r, i) => i < at && r.enabled !== false && matchesRule(url, r));
  if (blocker !== -1) {
    const movedAbove = rules[blocker].groupName;
    rules.splice(at, 1);
    rules.splice(blocker, 0, target);
    return { result, changed: true, movedAbove };
  }
  return { result, changed };
}

export async function addDomainRule(
  host: string,
  groupName: string,
  color: GroupColor | undefined
): Promise<DomainRuleOutcome> {
  const rules = (await getRules()).map((r) => ({ ...r }));
  const outcome = upsertDomainRule(rules, host, groupName, color);
  if (outcome.changed) await saveRules(rules);
  return outcome;
}

/**
 * Check whether a URL matches any of the patterns in a rule.
 * Uses the full URL (href) for both contains and regex modes.
 */
export function matchesRule(url: string, rule: GroupRule): boolean {
  try {
    const parsed = new URL(url);
    const href = parsed.href.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
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
      if (rule.matchMode === 'domain') return hostMatchesDomain(hostname, p);
      return href.includes(p.toLowerCase());
    });
  } catch {
    return false;
  }
}
