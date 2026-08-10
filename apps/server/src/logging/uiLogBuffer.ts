import type { UiLogEntry } from "@obs-effect/shared-types";

interface UiLogBufferOptions {
  maxEntries: number;
}

export class UiLogBuffer {
  private readonly maxEntries: number;
  private entries: UiLogEntry[] = [];

  constructor(options: UiLogBufferOptions) {
    this.maxEntries = options.maxEntries;
  }

  add(entry: Omit<UiLogEntry, "id" | "timestamp"> & { timestamp?: string }): UiLogEntry {
    const logEntry: UiLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      level: entry.level,
      source: entry.source,
      message: entry.message,
      detail: entry.detail
    };

    this.entries = [logEntry, ...this.entries].slice(0, this.maxEntries);
    return logEntry;
  }

  list(): UiLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
