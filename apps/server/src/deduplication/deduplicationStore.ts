export interface DeduplicationStoreOptions {
  ttlMs: number;
  maxEntries: number;
}

export class DeduplicationStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly options: DeduplicationStoreOptions) {}

  isDuplicate(eventId: string, now = Date.now()): boolean {
    this.prune(now);
    const expiresAt = this.seen.get(eventId);

    if (expiresAt && expiresAt > now) {
      return true;
    }

    this.seen.set(eventId, now + this.options.ttlMs);
    this.pruneOverflow();
    return false;
  }

  prune(now = Date.now()): void {
    for (const [eventId, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(eventId);
      }
    }
  }

  size(): number {
    return this.seen.size;
  }

  private pruneOverflow(): void {
    while (this.seen.size > this.options.maxEntries) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest) {
        return;
      }
      this.seen.delete(oldest);
    }
  }
}
