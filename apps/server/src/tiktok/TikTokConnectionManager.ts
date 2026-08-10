import type { NormalizedEvent, TikTokConnectOptions, TikTokConnectionStatus } from "@obs-effect/shared-types";
import type { TikTokLiveConnector } from "./TikTokLiveConnector.js";
import { MockTikTokLiveConnector, TikTokConnectorAdapter } from "./TikTokConnectorAdapter.js";
import { TikTokEventNormalizer } from "./TikTokEventNormalizer.js";
import { BrowserTikTokLiveConnector } from "./browser/BrowserTikTokLiveConnector.js";
import type { BrowserConnectorStatus } from "@obs-effect/shared-types";
import type { BrowserFrameStore } from "./browser/BrowserFrameStore.js";

interface TikTokConnectionManagerOptions {
  onEvents: (events: NormalizedEvent[]) => void;
  onStatus: (status: TikTokConnectionStatus) => void;
  onError: (message: string, detail?: Record<string, unknown>) => void;
  onRawEvent?: (event: unknown, status: TikTokConnectionStatus) => string | null;
  onRawEventNormalized?: (captureId: string | null, events: NormalizedEvent[], errors?: string[]) => void;
  browser?: {
    rootDir: string;
    frameStore: BrowserFrameStore;
    onBrowserStatus: (status: BrowserConnectorStatus) => void;
    onFrame: (captureId: string) => void;
  };
}

export class TikTokConnectionManager {
  private readonly normalizer = new TikTokEventNormalizer();
  private readonly options: TikTokConnectionManagerOptions;
  private connector: TikTokLiveConnector | null = null;
  private currentOptions: TikTokConnectOptions | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manualDisconnect = false;

  constructor(options: TikTokConnectionManagerOptions) {
    this.options = options;
  }

  async connect(connectOptions: TikTokConnectOptions): Promise<void> {
    await this.disconnect(false);
    this.manualDisconnect = false;
    this.currentOptions = connectOptions;
    this.connector = this.createConnector(connectOptions);
    this.connector.onRawEvent((event) => this.handleRawEvent(event));
    this.connector.onStatus((status) => this.handleStatus(status));
    await this.connector.connect(connectOptions);
  }

  async disconnect(manual = true): Promise<void> {
    this.manualDisconnect = manual;
    this.clearReconnect();
    await this.connector?.disconnect();
    this.connector = null;
  }

  async reconnect(): Promise<void> {
    this.clearReconnect();
    if (this.connector) {
      await this.connector.reconnect();
      return;
    }
    if (this.currentOptions) {
      await this.connect(this.currentOptions);
    }
  }

  getStatus(): TikTokConnectionStatus {
    return (
      this.connector?.getStatus() ?? {
        enabled: true,
        state: "idle",
        receivedCount: 0,
        reconnectAttempt: 0,
        connector: {
          mode: "unavailable",
          libraryName: "tiktok-live-connector",
          libraryVersion: "2.4.0",
          license: "MIT",
          note: "Connector has not been started."
        }
      }
    );
  }

  injectMockEvent(rawEvent: unknown): boolean {
    if (this.connector instanceof MockTikTokLiveConnector) {
      this.connector.emitRawEvent(rawEvent);
      return true;
    }
    return false;
  }

  getBrowserStatus(): BrowserConnectorStatus | null {
    return this.connector instanceof BrowserTikTokLiveConnector ? this.connector.getBrowserStatus() : null;
  }

  private createConnector(connectOptions: TikTokConnectOptions): TikTokLiveConnector {
    const mode = connectOptions.connectorMode ?? (connectOptions.useMockConnector ? "mock" : "library");
    if (mode === "mock") return new MockTikTokLiveConnector();
    if (mode === "browser" && this.options.browser) {
      return new BrowserTikTokLiveConnector(this.options.browser);
    }
    return new TikTokConnectorAdapter();
  }

  private handleRawEvent(rawEvent: unknown): void {
    const captureId = this.options.onRawEvent?.(rawEvent, this.getStatus()) ?? null;
    try {
      const events = this.normalizer.normalize(rawEvent);
      this.options.onRawEventNormalized?.(captureId, events);
      if (events.length > 0) {
        this.options.onEvents(events);
      }
    } catch (caught) {
      this.options.onRawEventNormalized?.(captureId, [], [caught instanceof Error ? caught.message : "Normalizer failed"]);
    }
  }

  private handleStatus(status: TikTokConnectionStatus): void {
    this.options.onStatus(status);
    if (status.state === "error") {
      this.options.onError(status.errorMessage ?? "TikTok connector error", {
        errorCode: status.errorCode,
        uniqueId: status.uniqueId
      });
    }

    if (!this.manualDisconnect && this.currentOptions?.autoReconnect && (status.state === "error" || status.state === "disconnected")) {
      this.scheduleReconnect(status.reconnectAttempt);
    }
  }

  private scheduleReconnect(attempt: number): void {
    if (this.reconnectTimer) {
      return;
    }

    const seconds = Math.min(30, Math.max(1, 2 ** Math.min(attempt, 4)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, seconds * 1000);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
