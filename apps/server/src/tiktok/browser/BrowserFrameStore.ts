import { randomUUID } from "node:crypto";
import type {
  BrowserFrameStoreStatus,
  BrowserWebSocketFrameCapture,
  BrowserWebSocketFrameCaptureSummary
} from "@obs-effect/shared-types";
import { redactBrowserUrl } from "./BrowserFrameRedactor.js";

interface AddFrameInput {
  browser: BrowserWebSocketFrameCapture["browser"];
  page: BrowserWebSocketFrameCapture["page"];
  requestId: string;
  socketUrl?: string;
  direction: "received" | "sent";
  opcode: number;
  payloadData: string;
}

const maxFrameBytes = 1024 * 1024;

export class BrowserFrameStore {
  private enabled = true;
  private readonly maxCount: number;
  private frames: BrowserWebSocketFrameCapture[] = [];

  constructor(maxCount = 1000) {
    this.maxCount = maxCount;
  }

  enable(): BrowserFrameStoreStatus {
    this.enabled = true;
    return this.status();
  }

  disable(): BrowserFrameStoreStatus {
    this.enabled = false;
    return this.status();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  add(input: AddFrameInput): BrowserWebSocketFrameCapture | null {
    if (!this.enabled) return null;
    const redactedUrl = redactBrowserUrl(input.socketUrl);
    const payload = truncatePayload(input.payloadData);
    const encoding = input.opcode === 1 ? "text" : input.opcode === 2 ? "base64" : "unknown";
    const decoded = decodePayload(payload.value, input.opcode);
    const frame: BrowserWebSocketFrameCapture = {
      captureId: randomUUID(),
      capturedAt: new Date().toISOString(),
      browser: input.browser,
      page: input.page,
      socket: {
        requestId: input.requestId,
        url: redactedUrl.value,
        direction: input.direction,
        opcode: input.opcode
      },
      direction: input.direction,
      opcode: input.opcode,
      socketUrl: redactedUrl.value,
      payloadSizeBytes: Buffer.byteLength(input.payloadData, "utf8"),
      payloadEncoding: encoding,
      decodeStatus: decoded.status,
      eventCount: decoded.eventCount,
      truncated: payload.truncated,
      frame: {
        payloadEncoding: encoding,
        payloadData: payload.value,
        payloadSizeBytes: Buffer.byteLength(input.payloadData, "utf8"),
        textPreview: input.opcode === 1 ? payload.value.slice(0, 2048) : undefined,
        hexPreview: Buffer.from(payload.value).subarray(0, 128).toString("hex")
      },
      decode: decoded,
      metadata: {
        truncated: payload.truncated,
        redactedFields: redactedUrl.redactedFields
      }
    };
    this.frames = [frame, ...this.frames].slice(0, this.maxCount);
    return frame;
  }

  list(params: { limit?: number; offset?: number; direction?: "received" | "sent"; search?: string } = {}): BrowserWebSocketFrameCaptureSummary[] {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const offset = Math.max(params.offset ?? 0, 0);
    const search = params.search?.trim().toLowerCase();
    return this.frames
      .filter((frame) => (params.direction ? frame.direction === params.direction : true))
      .filter((frame) => {
        if (!search) return true;
        return JSON.stringify(this.summary(frame)).toLowerCase().includes(search);
      })
      .slice(offset, offset + limit)
      .map((frame) => this.summary(frame));
  }

  find(captureId: string): BrowserWebSocketFrameCapture | null {
    return this.frames.find((frame) => frame.captureId === captureId) ?? null;
  }

  all(): BrowserWebSocketFrameCapture[] {
    return [...this.frames];
  }

  clear(): BrowserFrameStoreStatus {
    this.frames = [];
    return this.status();
  }

  status(): BrowserFrameStoreStatus {
    return {
      enabled: this.enabled,
      count: this.frames.length,
      maxCount: this.maxCount,
      estimatedBytes: this.frames.reduce((total, frame) => total + frame.payloadSizeBytes, 0),
      receivedFrameCount: this.frames.filter((frame) => frame.direction === "received").length,
      sentFrameCount: this.frames.filter((frame) => frame.direction === "sent").length,
      binaryFrameCount: this.frames.filter((frame) => frame.opcode === 2).length,
      textFrameCount: this.frames.filter((frame) => frame.opcode === 1).length
    };
  }

  summary(frame: BrowserWebSocketFrameCapture): BrowserWebSocketFrameCaptureSummary {
    return {
      captureId: frame.captureId,
      capturedAt: frame.capturedAt,
      direction: frame.direction,
      opcode: frame.opcode,
      socketUrl: frame.socketUrl,
      payloadSizeBytes: frame.payloadSizeBytes,
      payloadEncoding: frame.payloadEncoding,
      decodeStatus: frame.decodeStatus,
      eventCount: frame.eventCount,
      truncated: frame.truncated
    };
  }
}

function truncatePayload(payloadData: string): { value: string; truncated: boolean } {
  if (Buffer.byteLength(payloadData, "utf8") <= maxFrameBytes) return { value: payloadData, truncated: false };
  return { value: payloadData.slice(0, maxFrameBytes), truncated: true };
}

function decodePayload(payloadData: string, opcode: number): BrowserWebSocketFrameCapture["decode"] {
  if (opcode === 2) return { status: "binary", eventCount: 0 };
  if (opcode !== 1) return { status: "unsupported", eventCount: 0 };
  try {
    const json = JSON.parse(payloadData) as unknown;
    return { status: "json", json, eventCount: Array.isArray(json) ? json.length : 1 };
  } catch (caught) {
    return { status: "text", error: caught instanceof Error ? caught.message : "JSON parse failed", eventCount: 0 };
  }
}
