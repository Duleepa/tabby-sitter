import { describe, expect, it } from 'vitest';
import { decideTabAction, type DecideInput } from './decide';
import type { GroupRule } from '../storage/rules';

const dev: GroupRule = { id: 'a', patterns: ['github.com'], groupName: 'Dev', matchMode: 'contains' };
const docs: GroupRule = { id: 'b', patterns: ['docs.google.com'], groupName: 'Docs', matchMode: 'contains' };

function input(over: Partial<DecideInput>): DecideInput {
  return {
    url: 'https://github.com/x',
    rules: [dev, docs],
    currentGroupTitle: undefined,
    manual: false,
    keepWithOpener: false,
    ...over,
  };
}

describe('decideTabAction', () => {
  it('rule match, ungrouped: group', () => {
    expect(decideTabAction(input({}))).toEqual({ kind: 'group', rule: dev });
  });
  it('rule match while already in the right group: none', () => {
    expect(decideTabAction(input({ currentGroupTitle: 'Dev' }))).toEqual({ kind: 'none' });
  });
  it('rule match while in another group: group', () => {
    expect(decideTabAction(input({ currentGroupTitle: 'Docs' }))).toEqual({ kind: 'group', rule: dev });
    expect(decideTabAction(input({ currentGroupTitle: 'Mine' }))).toEqual({ kind: 'group', rule: dev });
  });
  it('no match in a rule-named group: ungroup', () => {
    expect(decideTabAction(input({ url: 'https://example.com', currentGroupTitle: 'Dev' }))).toEqual({ kind: 'ungroup' });
  });
  it('no match in a non-rule group: none', () => {
    expect(decideTabAction(input({ url: 'https://example.com', currentGroupTitle: 'Mine' }))).toEqual({ kind: 'none' });
  });
  it('no match, ungrouped: none', () => {
    expect(decideTabAction(input({ url: 'https://example.com' }))).toEqual({ kind: 'none' });
  });
  it('manual override: none in every case', () => {
    for (const currentGroupTitle of [undefined, 'Dev', 'Docs', 'Mine']) {
      for (const url of ['https://github.com/x', 'https://example.com']) {
        expect(decideTabAction(input({ manual: true, currentGroupTitle, url }))).toEqual({ kind: 'none' });
      }
    }
  });
  it('keep-with-opener prevents ungrouping', () => {
    const i = input({ url: 'https://example.com', currentGroupTitle: 'Dev', keepWithOpener: true });
    expect(decideTabAction(i)).toEqual({ kind: 'none' });
  });
  it('keep-with-opener does not stop a different rule from winning', () => {
    const i = input({ url: 'https://docs.google.com/d', currentGroupTitle: 'Dev', keepWithOpener: true });
    expect(decideTabAction(i)).toEqual({ kind: 'group', rule: docs });
  });
  it('keep-with-opener is irrelevant outside rule groups', () => {
    expect(decideTabAction(input({ url: 'https://example.com', keepWithOpener: true }))).toEqual({ kind: 'none' });
  });
  it('side-by-side tabs are never regrouped or ungrouped', () => {
    expect(decideTabAction(input({ paired: true }))).toEqual({ kind: 'none' });
    expect(decideTabAction(input({ paired: true, currentGroupTitle: 'Dev', url: 'https://example.com' }))).toEqual({ kind: 'none' });
  });
});
