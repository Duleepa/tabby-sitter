import { describe, expect, it } from 'vitest';
import { ExpectedGroupChanges } from './expected-changes';

describe('ExpectedGroupChanges', () => {
  it('covers every change event for an expected tab within the ttl', () => {
    const t = new ExpectedGroupChanges(() => 0);
    t.expect([1, 2]);
    expect(t.consume(1)).toBe(true);
    expect(t.consume(1)).toBe(true); // e.g. move-induced change, then the group itself
    expect(t.consume(2)).toBe(true);
  });

  it('ignores tabs that were never expected', () => {
    expect(new ExpectedGroupChanges(() => 0).consume(9)).toBe(false);
  });

  it('expires after the ttl', () => {
    let now = 0;
    const t = new ExpectedGroupChanges(() => now, 3000);
    t.expect(1);
    now = 3001;
    expect(t.consume(1)).toBe(false);
    t.expect(2);
    now = 6000;
    expect(t.consume(2)).toBe(true);
  });

  it('accepts a single id and can forget', () => {
    const t = new ExpectedGroupChanges(() => 0);
    t.expect(5);
    t.forget(5);
    expect(t.consume(5)).toBe(false);
  });
});
