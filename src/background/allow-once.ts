/** One-shot "do not treat this URL as a duplicate" allowances that expire (default 10 s). Pure: injectable clock. */
export class AllowOnce {
  private readonly expiry = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 10000
  ) {}

  allow(key: string): void {
    this.expiry.set(key, this.now() + this.ttlMs);
  }

  /** True (once) if the key was allowed and has not expired. */
  consume(key: string): boolean {
    const until = this.expiry.get(key);
    if (until === undefined) return false;
    this.expiry.delete(key);
    return this.now() <= until;
  }
}
