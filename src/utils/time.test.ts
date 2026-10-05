import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

describe('relativeTime', () => {
  const now = 1_000_000_000;
  it('formats ranges', () => {
    expect(relativeTime(now - 5000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3600000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 3 * 86400000, now)).toBe('3 days ago');
    expect(relativeTime(now - 60 * 86400000, now)).toBe('2 months ago');
    expect(relativeTime(now + 5000, now)).toBe('just now');
  });
});
