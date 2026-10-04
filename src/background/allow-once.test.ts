import { describe, expect, it } from 'vitest';
import { AllowOnce } from './allow-once';

describe('AllowOnce', () => {
  it('is consumed exactly once', () => {
    const a = new AllowOnce(() => 0);
    a.allow('u');
    expect(a.consume('u')).toBe(true);
    expect(a.consume('u')).toBe(false);
  });
  it('expires after 10 s', () => {
    let now = 0;
    const a = new AllowOnce(() => now);
    a.allow('u');
    now = 10001;
    expect(a.consume('u')).toBe(false);
  });
  it('ignores unknown keys', () => {
    expect(new AllowOnce(() => 0).consume('x')).toBe(false);
  });
});
