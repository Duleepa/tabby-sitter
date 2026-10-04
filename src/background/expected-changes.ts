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

  /** True (once) if a change for this tab was expected and has not expired. */
  consume(tabId: number): boolean {
    const until = this.expiry.get(tabId);
    if (until === undefined) return false;
    this.expiry.delete(tabId);
    return this.now() <= until;
  }

  forget(tabId: number): void {
    this.expiry.delete(tabId);
  }
}
