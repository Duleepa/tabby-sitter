import { getRules, saveRules, type GroupRule } from './rules';
import { generateId } from '../utils/id';

/** Example rules offered on first run. Domain mode, so `x.com` never catches `netflix.com`. */
export const STARTER_RULES: readonly Omit<GroupRule, 'id'>[] = [
  { patterns: ['github.com', 'stackoverflow.com'], groupName: 'Dev', description: 'GitHub and Stack Overflow', color: 'blue', matchMode: 'domain' },
  { patterns: ['docs.google.com'], groupName: 'Docs', description: 'Google Docs, Sheets and Slides', color: 'green', matchMode: 'domain' },
  { patterns: ['mail.google.com'], groupName: 'Mail', description: 'Gmail', color: 'red', matchMode: 'domain' },
  { patterns: ['youtube.com'], groupName: 'Media', description: 'YouTube', color: 'purple', matchMode: 'domain' },
  { patterns: ['x.com', 'twitter.com', 'instagram.com'], groupName: 'Social', description: 'Social media', color: 'cyan', matchMode: 'domain' },
];

/** Starter rules whose group name is not already used, so the user's own rules always win. Pure. */
export function newStarterRules(existing: readonly GroupRule[], makeId: () => string = generateId): GroupRule[] {
  const taken = new Set(existing.map((r) => r.groupName.trim().toLowerCase()));
  return STARTER_RULES.filter((r) => !taken.has(r.groupName.toLowerCase())).map((r) => ({
    ...r,
    patterns: [...r.patterns],
    id: makeId(),
  }));
}

/** Append the starter rules that are missing; returns the ones added (empty when all exist). */
export async function addStarterRules(): Promise<GroupRule[]> {
  const rules = await getRules();
  const added = newStarterRules(rules);
  if (added.length > 0) await saveRules([...rules, ...added]);
  return added;
}

/** Undo `addStarterRules`: remove those ids, leaving any other change alone. */
export async function removeRulesById(ids: readonly string[]): Promise<void> {
  const drop = new Set(ids);
  const rules = await getRules();
  await saveRules(rules.filter((r) => !drop.has(r.id)));
}
