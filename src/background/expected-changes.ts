/**
 * Remembers tabs whose group membership the extension is about to change, so
 * the resulting tabs.onUpdated groupId event is not mistaken for a manual move.
 * Pure: the clock is injectable.
 */
export class ExpectedGroupChanges {
  private readonly expiry = new Map<number, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 3000
  ) {}

  expect(tabIds: number | number[]): void {
    const until = this.now() + this.ttlMs;
    for (const id of Array.isArray(tabIds) ? tabIds : [tabIds]) this.expiry.set(id, until);
  }

  /**
   * True while a change for this tab is expected. Not single-use: one extension action can produce
   * several groupId events (a move then a group, a cross-window move, a rule re-run after a redirect),
   * and every one of them inside the TTL is the extension's own doing.
   */
  consume(tabId: number): boolean {
    const until = this.expiry.get(tabId);
    if (until === undefined) return false;
    if (this.now() <= until) return true;
    this.expiry.delete(tabId);
    return false;
  }

  forget(tabId: number): void {
    this.expiry.delete(tabId);
  }
}
