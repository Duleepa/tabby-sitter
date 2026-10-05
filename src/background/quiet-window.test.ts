import { describe, expect, it } from 'vitest';
import { isInQuietWindow, QuietWindows } from './quiet-window';

describe('isInQuietWindow', () => {
  it('is inclusive of start and end', () => {
    const spans = [{ start: 100, end: 200 }];
    expect(isInQuietWindow(spans, 99)).toBe(false);
    expect(isInQuietWindow(spans, 100)).toBe(true);
    expect(isInQuietWindow(spans, 200)).toBe(true);
    expect(isInQuietWindow(spans, 201)).toBe(false);
  });
  it('treats an open window as running until closed', () => {
    expect(isInQuietWindow([{ start: 100, end: null }], 99999)).toBe(true);
  });
});

describe('QuietWindows', () => {
  it('covers creations before the window closes plus its grace', () => {
    const q = new QuietWindows();
    const id = q.open(1000);
    expect(q.isQuiet(1500)).toBe(true);
    q.close(id, 3000 + 500);
    expect(q.isQuiet(3400)).toBe(true);
    expect(q.isQuiet(3600)).toBe(false);
    expect(q.isQuiet(999)).toBe(false);
  });
  it('supports overlapping windows and pruning', () => {
    const q = new QuietWindows();
    const a = q.open(0);
    const b = q.open(10);
    q.close(a, 20);
    expect(q.isQuiet(15)).toBe(true);
    q.close(b, 30);
    q.prune(100);
    expect(q.isQuiet(15)).toBe(false);
  });
});
