import { randomUUID } from "node:crypto";
import type {
  NormalizedEvent,
  RawCaptureStatus,
  RawNormalizationStatus,
  TikTokConnectionStatus,
  TikTokRawEventCapture,
  TikTokRawEventCaptureSummary
} from "@obs-effect/shared-types";
import { safeSerialize } from "./safeSerialize.js";
import { redactSecrets } from "./redactSecrets.js";
import { TikTokRawEventStore } from "./TikTokRawEventStore.js";

interface TikTokRawCaptureServiceOptions {
  store: TikTokRawEventStore;
  onStatus: (status: RawCaptureStatus) => void;
  onReceived: (summary: TikTokRawEventCaptureSummary, updated: boolean) => void;
  onCleared?: () => void;
}

export class TikTokRawCaptureService {
  private enabled = false;
  private readonly store: TikTokRawEventStore;
  private readonly options: TikTokRawCaptureServiceOptions;

  constructor(options: TikTokRawCaptureServiceOptions) {
    this.store = options.store;
    this.options = options;
  }

  enable(): RawCaptureStatus {
    this.enabled = true;
    return this.emitStatus();
  }

  disable(): RawCaptureStatus {
    this.enabled = false;
    return this.emitStatus();
  }

  status(): RawCaptureStatus {
    return this.store.status(this.enabled);
  }

  list(params: {
    limit?: number;
    offset?: number;
    eventName?: string;
    normalizationStatus?: RawNormalizationStatus;
    search?: string;
  }): TikTokRawEventCaptureSummary[] {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const offset = Math.max(params.offset ?? 0, 0);
    const search = params.search?.trim().toLowerCase();
    return this.store
      .list()
      .filter((capture) => (params.eventName ? capture.rawEventName === params.eventName : true))
      .filter((capture) => (params.normalizationStatus ? capture.normalization.status === params.normalizationStatus : true))
      .filter((capture) => {
        if (!search) return true;
        return JSON.stringify(this.store.summary(capture)).toLowerCase().includes(search);
      })
      .slice(offset, offset + limit)
      .map((capture) => this.store.summary(capture));
  }

  find(captureId: string): TikTokRawEventCapture | null {
    return this.store.find(captureId);
  }

  clear(): RawCaptureStatus {
    this.store.clear();
    this.options.onCleared?.();
    return this.emitStatus();
  }

  capture(rawEvent: unknown, status: TikTokConnectionStatus): string | null {
    if (!this.enabled) return null;

    try {
      const serialized = safeSerialize(rawEvent);
      const redacted = redactSecrets(serialized.value);
      const eventName = detectRawEventName(redacted.value);
      const capture: TikTokRawEventCapture = {
        captureId: randomUUID(),
        capturedAt: new Date().toISOString(),
        connector: {
          name: status.connector.libraryName,
          version: status.connector.libraryVersion,
          mode: status.connector.mode === "tikfinity" || status.connector.mode === "browser" || status.connector.mode === "library" ? status.connector.mode : "mock"
        },
        connection: {
          uniqueId: status.uniqueId,
          roomId: status.roomId,
          state: status.state
        },
        rawEventName: eventName,
        rawEventSizeBytes: serialized.sizeBytes,
        rawEvent: redacted.value,
        normalization: {
          status: "not-normalized",
          warnings: [],
          errors: []
        },
        metadata: {
          truncated: serialized.truncated || serialized.sizeBytes > 1024 * 1024,
          redactedFields: redacted.redactedFields,
          serializationWarnings: serialized.warnings
        }
      };
      this.store.add(capture);
      this.options.onReceived(this.store.summary(capture), false);
      this.emitStatus();
      return capture.captureId;
    } catch {
      return null;
    }
  }

  attachNormalization(captureId: string | null, events: NormalizedEvent[], errors: string[] = []): void {
    if (!captureId) return;
    const status: RawNormalizationStatus = errors.length > 0 ? "failed" : events.length > 0 ? "success" : "not-normalized";
    const warnings = events.length === 0 && errors.length === 0 ? ["No normalizer mapping produced a NormalizedEvent"] : [];
    const updated = this.store.update(captureId, {
      normalization: {
        status,
        normalizedEvent: events[0],
        warnings,
        errors
      }
    });
    if (updated) {
      this.options.onReceived(this.store.summary(updated), true);
      this.emitStatus();
    }
  }

  private emitStatus(): RawCaptureStatus {
    const status = this.status();
    this.options.onStatus(status);
    return status;
  }
}

function detectRawEventName(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";
  const record = value as Record<string, unknown>;
  for (const key of ["eventName", "eventType", "type", "name", "rawEventType"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return "unknown";
}
