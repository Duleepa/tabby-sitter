import { matchesRule, type GroupRule } from '../storage/rules';

export type TabAction =
  | { kind: 'group'; rule: GroupRule }
  | { kind: 'ungroup' }
  | { kind: 'none' };

export interface DecideInput {
  url: string;
  /** Enabled rules, in priority order. */
  rules: GroupRule[];
  currentGroupTitle: string | undefined;
  /** The user placed this tab by hand. */
  manual: boolean;
  /** The tab's opener sits in the tab's current group and the setting is on. */
  keepWithOpener: boolean;
}

/** Pure decision: what should rules do with this tab? */
export function decideTabAction(input: DecideInput): TabAction {
  if (input.manual) return { kind: 'none' };

  const rule = input.rules.find((r) => matchesRule(input.url, r));
  if (rule) {
    return input.currentGroupTitle === rule.groupName ? { kind: 'none' } : { kind: 'group', rule };
  }

  const title = input.currentGroupTitle;
  if (title && input.rules.some((r) => r.groupName === title)) {
    return input.keepWithOpener ? { kind: 'none' } : { kind: 'ungroup' };
  }
  return { kind: 'none' };
}
