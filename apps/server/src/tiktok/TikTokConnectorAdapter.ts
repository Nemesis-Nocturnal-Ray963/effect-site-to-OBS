import type { TikTokConnectOptions, TikTokConnectionStatus } from "@obs-effect/shared-types";
import type { RawTikTokEventHandler, TikTokLiveConnector, TikTokStatusHandler } from "./TikTokLiveConnector.js";
import { tiktokConnectorLibrary } from "./TikTokLiveConnector.js";

type LibraryConnection = {
  connect: () => Promise<{ roomId?: string }>;
  disconnect: () => Promise<void> | void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

function createStatus(
  state: TikTokConnectionStatus["state"],
  overrides: Partial<TikTokConnectionStatus> = {}
): TikTokConnectionStatus {
  return {
    enabled: true,
    state,
    receivedCount: 0,
    reconnectAttempt: 0,
    connector: {
      mode: "unavailable",
      libraryName: tiktokConnectorLibrary.name,
      libraryVersion: tiktokConnectorLibrary.version,
      license: tiktokConnectorLibrary.license,
      note: tiktokConnectorLibrary.note
    },
    ...overrides
  };
}

export class MockTikTokLiveConnector implements TikTokLiveConnector {
  private status = createStatus("idle", {
    connector: {
      mode: "mock",
      libraryName: tiktokConnectorLibrary.name,
      libraryVersion: tiktokConnectorLibrary.version,
      license: tiktokConnectorLibrary.license,
      note: "Mock connector for development and tests; no TikTok network connection is opened."
    }
  });
  private readonly rawHandlers = new Set<RawTikTokEventHandler>();
  private readonly statusHandlers = new Set<TikTokStatusHandler>();

  async connect(options: TikTokConnectOptions): Promise<void> {
    this.setStatus({
      ...this.status,
      state: "connected",
      uniqueId: options.uniqueId,
      roomId: `mock-room-${options.uniqueId}`,
      connectedAt: new Date().toISOString(),
      errorCode: undefined,
      errorMessage: undefined
    });
  }

  async disconnect(): Promise<void> {
    this.setStatus({ ...this.status, state: "disconnected" });
  }

  async reconnect(): Promise<void> {
    this.setStatus({ ...this.status, state: "reconnecting", reconnectAttempt: this.status.reconnectAttempt + 1 });
    await this.connect({ uniqueId: this.status.uniqueId ?? "mock_user", useMockConnector: true });
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

  emitRawEvent(event: unknown): void {
    this.setStatus({ ...this.status, receivedCount: this.status.receivedCount + 1, lastEventAt: new Date().toISOString() });
    for (const handler of this.rawHandlers) {
      handler(event);
    }
  }

  private setStatus(status: TikTokConnectionStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}

export class TikTokConnectorAdapter implements TikTokLiveConnector {
  private status = createStatus("idle");
  private connection: LibraryConnection | null = null;
  private readonly rawHandlers = new Set<RawTikTokEventHandler>();
  private readonly statusHandlers = new Set<TikTokStatusHandler>();
  private options: TikTokConnectOptions | null = null;

  async connect(options: TikTokConnectOptions): Promise<void> {
    this.options = options;
    this.setStatus(createStatus("connecting", { uniqueId: options.uniqueId, reconnectAttempt: this.status.reconnectAttempt }));

    try {
      const imported = (await import("tiktok-live-connector")) as {
        TikTokLiveConnection: new (uniqueId: string, options?: Record<string, unknown>) => LibraryConnection;
        WebcastEvent?: Record<string, string>;
      };

      this.connection = new imported.TikTokLiveConnection(options.uniqueId, {
        session: options.sessionId ? { cookie: `sessionid=${options.sessionId}` } : undefined,
        enableExtendedGiftInfo: options.enableExtendedGiftInfo,
        fetchRoomInfoOnConnect: options.fetchRoomInfoOnConnect
      });

      const eventNames = eventNamesFromLibrary(imported.WebcastEvent);
      for (const name of eventNames) {
        this.connection.on(name, (payload) => this.forwardRaw({ ...asRecord(payload), eventType: name }));
      }

      const state = await this.connection.connect();
      this.setStatus(
        createStatus("connected", {
          uniqueId: options.uniqueId,
          roomId: state.roomId,
          connectedAt: new Date().toISOString(),
          receivedCount: this.status.receivedCount,
          reconnectAttempt: 0,
          connector: {
            mode: "library",
            libraryName: tiktokConnectorLibrary.name,
            libraryVersion: tiktokConnectorLibrary.version,
            license: tiktokConnectorLibrary.license,
            note: tiktokConnectorLibrary.note
          }
        })
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "TikTok connector failed";
      this.setStatus(
        createStatus("error", {
          uniqueId: options.uniqueId,
          receivedCount: this.status.receivedCount,
          reconnectAttempt: this.status.reconnectAttempt,
          errorCode: message.includes("Cannot find package") ? "CONNECTOR_NOT_INSTALLED" : "CONNECT_FAILED",
          errorMessage: message,
          lastError: message
        })
      );
    }
  }

  async disconnect(): Promise<void> {
    await this.connection?.disconnect();
    this.connection = null;
    this.setStatus({ ...this.status, state: "disconnected" });
  }

  async reconnect(): Promise<void> {
    if (!this.options) return;
    const attempt = this.status.reconnectAttempt + 1;
    this.setStatus({ ...this.status, state: "reconnecting", reconnectAttempt: attempt });
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

  private forwardRaw(event: unknown): void {
    this.setStatus({ ...this.status, receivedCount: this.status.receivedCount + 1, lastEventAt: new Date().toISOString() });
    for (const handler of this.rawHandlers) {
      handler(event);
    }
  }

  private setStatus(status: TikTokConnectionStatus): void {
    this.status = status;
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function eventNamesFromLibrary(webcastEvent: Record<string, string> | undefined): string[] {
  const defaults = ["chat", "gift", "like", "follow", "share", "member", "roomUser", "streamEnd", "disconnected"];
  const discovered = Object.values(webcastEvent ?? {}).filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set([...defaults, ...discovered])];
}
