/**
 * "Quiet windows" mark periods during which tabs created by the extension
 * itself (restoring a saved group) must not trigger duplicate or rule logic.
 * Pure: time is passed in. A window is open (end = null) until closed.
 */
export interface QuietSpan {
  start: number;
  end: number | null;
}

export function isInQuietWindow(spans: QuietSpan[], time: number): boolean {
  return spans.some((s) => time >= s.start && (s.end === null || time <= s.end));
}

export class QuietWindows {
  private spans = new Map<number, QuietSpan>();
  private next = 1;

  open(now: number): number {
    const id = this.next++;
    this.spans.set(id, { start: now, end: null });
    return id;
  }

  /** Close the window at `end` (callers pass now + a small grace period). */
  close(id: number, end: number): void {
    const span = this.spans.get(id);
    if (span) span.end = end;
  }

  isQuiet(time: number): boolean {
    return isInQuietWindow([...this.spans.values()], time);
  }

  /** Forget windows that ended before `now`. */
  prune(now: number): void {
    for (const [id, s] of this.spans) if (s.end !== null && s.end < now) this.spans.delete(id);
  }
}
