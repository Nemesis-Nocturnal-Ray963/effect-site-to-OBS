import type { EventHistoryEntry, EventMonitorStats } from "@obs-effect/shared-types";

interface EventHistoryStoreOptions {
  maxEntries: number;
}

export class EventHistoryStore {
  private readonly maxEntries: number;
  private entries: EventHistoryEntry[] = [];

  constructor(options: EventHistoryStoreOptions) {
    this.maxEntries = options.maxEntries;
  }

  add(entry: EventHistoryEntry): EventHistoryEntry {
    this.entries = [entry, ...this.entries].slice(0, this.maxEntries);
    return entry;
  }

  list(): EventHistoryEntry[] {
    return [...this.entries];
  }

  find(eventId: string): EventHistoryEntry | null {
    return this.entries.find((entry) => entry.event.eventId === eventId) ?? null;
  }

  clear(): void {
    this.entries = [];
  }

  stats(): EventMonitorStats {
    const latencies = this.entries
      .map((entry) => entry.processing.latencyMs)
      .filter((latency): latency is number => typeof latency === "number");

    return {
      recentCount: this.entries.length,
      receivedCount: this.entries.length,
      duplicateCount: this.entries.filter((entry) => entry.result.duplicate).length,
      errorCount: this.entries.filter((entry) => entry.result.errors.length > 0).length,
      averageLatencyMs:
        latencies.length > 0 ? Math.round(latencies.reduce((total, latency) => total + latency, 0) / latencies.length) : null,
      lastReceivedAt: this.entries[0]?.processing.receivedAt ?? null
    };
  }
}
