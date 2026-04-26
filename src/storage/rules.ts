export interface GroupRule {
  id: string;
  pattern: string;
  groupName: string;
  description?: string;
  color?: chrome.tabGroups.ColorEnum;
}

export interface RuleStorage {
  rules: GroupRule[];
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function getRules(): Promise<GroupRule[]> {
  const result = (await chrome.storage.local.get('rules')) as RuleStorage;
  return result.rules || [];
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

export function matchesPattern(url: string, pattern: string): boolean {
  try {
    return new URL(url).hostname.includes(pattern);
  } catch {
    return false;
  }
}
