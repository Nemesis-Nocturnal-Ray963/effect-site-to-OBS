import WebSocket from "ws";
import type { TikTokConnectOptions, TikTokConnectionStatus } from "@obs-effect/shared-types";
import type { RawTikTokEventHandler, TikTokLiveConnector, TikTokStatusHandler } from "./TikTokLiveConnector.js";

const defaultEndpointUrl = "ws://localhost:21213/";

function createStatus(state: TikTokConnectionStatus["state"], overrides: Partial<TikTokConnectionStatus> = {}): TikTokConnectionStatus {
  return {
    enabled: true,
    state,
    receivedCount: 0,
    reconnectAttempt: 0,
    connector: {
      mode: "tikfinity",
      libraryName: "TikFinity Event API",
      note: "Receives TikTok LIVE events from the local TikFinity Desktop WebSocket endpoint."
    },
    ...overrides
  };
}

export class TikFinityConnector implements TikTokLiveConnector {
  private status = createStatus("idle");
  private socket: WebSocket | null = null;
  private options: TikTokConnectOptions | null = null;
  private readonly rawHandlers = new Set<RawTikTokEventHandler>();
  private readonly statusHandlers = new Set<TikTokStatusHandler>();
  private manuallyClosing = false;
  private suppressNextCloseStatus = false;

  async connect(options: TikTokConnectOptions): Promise<void> {
    this.options = options;
    this.manuallyClosing = false;
    const endpointUrl = options.tikfinity?.endpointUrl?.trim() || defaultEndpointUrl;
    this.setStatus(createStatus("connecting", { uniqueId: options.uniqueId, reconnectAttempt: this.status.reconnectAttempt }));

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(endpointUrl);
      let settled = false;
      this.socket = socket;

      socket.on("open", () => {
        settled = true;
        this.setStatus(
          createStatus("connected", {
            uniqueId: options.uniqueId,
            connectedAt: new Date().toISOString(),
            receivedCount: this.status.receivedCount,
            reconnectAttempt: 0
          })
        );
        resolve();
      });

      socket.on("message", (data) => this.forwardMessage(data));

      socket.on("close", () => {
        this.socket = null;
        if (this.suppressNextCloseStatus) {
          this.suppressNextCloseStatus = false;
          return;
        }
        this.setStatus({ ...this.status, state: "disconnected" });
      });

      socket.on("error", (error) => {
        const message = error instanceof Error ? error.message : "TikFinity WebSocket failed";
        this.setStatus({
          ...this.status,
          state: "error",
          uniqueId: options.uniqueId,
          errorCode: "TIKFINITY_CONNECT_FAILED",
          errorMessage: message,
          lastError: message
        });
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    this.manuallyClosing = true;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
        setTimeout(resolve, 500);
      });
    } else {
      socket?.terminate();
    }
    this.setStatus({ ...this.status, state: "disconnected" });
  }

  async reconnect(): Promise<void> {
    if (!this.options) return;
    const attempt = this.status.reconnectAttempt + 1;
    this.setStatus({ ...this.status, state: "reconnecting", reconnectAttempt: attempt });
    await this.closeSocketWithoutStatus();
    this.status = { ...this.status, reconnectAttempt: attempt };
    await this.connect(this.options);
  }

  getStatus(): TikTokConnectionStatus {
    return this.status;
  }

  onRawEvent(handler: RawTikTokEventHandler): () => void {
    this.rawHandlers.add(handler);
    return () => this.rawHandlers.delete(handler);
  }

  onStatus(handler: TikTokStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private forwardMessage(data: WebSocket.RawData): void {
    const text = data.toString("utf8");
    const raw = parseTikFinityMessage(text);
    if (!raw) return;
    this.setStatus({ ...this.status, receivedCount: this.status.receivedCount + 1, lastEventAt: new Date().toISOString() });
    for (const handler of this.rawHandlers) {
      handler(raw);
    }
  }

  private setStatus(status: TikTokConnectionStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }

  private async closeSocketWithoutStatus(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    this.suppressNextCloseStatus = true;
    if (socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
        setTimeout(resolve, 500);
      });
    } else {
      socket.terminate();
    }
  }
}

function parseTikFinityMessage(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const envelope = parsed as Record<string, unknown>;
    const eventType = typeof envelope.event === "string" ? envelope.event : undefined;
    const data = envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data) ? (envelope.data as Record<string, unknown>) : {};
    return {
      ...data,
      eventType: eventType ?? (typeof data.eventType === "string" ? data.eventType : "custom"),
      rawEventType: eventType,
      tikfinityEnvelope: envelope
    };
  } catch {
    return null;
  }
}
