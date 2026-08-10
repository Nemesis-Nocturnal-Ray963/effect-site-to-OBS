import type { RawCaptureStatus, TikTokRawEventCapture, TikTokRawEventCaptureSummary } from "@obs-effect/shared-types";

export class TikTokRawEventStore {
  private readonly maxCount: number;
  private captures: TikTokRawEventCapture[] = [];

  constructor(maxCount = 1000) {
    this.maxCount = maxCount;
  }

  add(capture: TikTokRawEventCapture): TikTokRawEventCapture {
    this.captures = [capture, ...this.captures].slice(0, this.maxCount);
    return capture;
  }

  update(captureId: string, update: Partial<TikTokRawEventCapture>): TikTokRawEventCapture | null {
    const index = this.captures.findIndex((capture) => capture.captureId === captureId);
    if (index < 0) return null;
    const current = this.captures[index];
    if (!current) return null;
    const updated: TikTokRawEventCapture = { ...current, ...update };
    this.captures[index] = updated;
    return updated;
  }

  list(): TikTokRawEventCapture[] {
    return [...this.captures];
  }

  find(captureId: string): TikTokRawEventCapture | null {
    return this.captures.find((capture) => capture.captureId === captureId) ?? null;
  }

  clear(): void {
    this.captures = [];
  }

  status(enabled: boolean): RawCaptureStatus {
    return {
      enabled,
      count: this.captures.length,
      maxCount: this.maxCount,
      estimatedBytes: this.captures.reduce((total, capture) => total + capture.rawEventSizeBytes, 0),
      truncatedCount: this.captures.filter((capture) => capture.metadata.truncated).length,
      failedNormalizationCount: this.captures.filter((capture) => capture.normalization.status === "failed").length
    };
  }

  summary(capture: TikTokRawEventCapture): TikTokRawEventCaptureSummary {
    const raw = capture.rawEvent as Record<string, unknown>;
    const user = typeof raw.user === "object" && raw.user ? (raw.user as Record<string, unknown>) : raw;
    const userSummary =
      typeof user.nickname === "string"
        ? user.nickname
        : typeof user.uniqueId === "string"
          ? user.uniqueId
          : typeof user.userId === "string"
            ? user.userId
            : undefined;

    return {
      captureId: capture.captureId,
      capturedAt: capture.capturedAt,
      rawEventName: capture.rawEventName,
      rawEventSizeBytes: capture.rawEventSizeBytes,
      normalizationStatus: capture.normalization.status,
      truncated: capture.metadata.truncated,
      warningCount: capture.normalization.warnings.length,
      errorCount: capture.normalization.errors.length,
      userSummary
    };
  }
}
