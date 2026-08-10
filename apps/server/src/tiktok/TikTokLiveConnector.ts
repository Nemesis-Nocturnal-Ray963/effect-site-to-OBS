import type { TikTokConnectOptions, TikTokConnectionStatus } from "@obs-effect/shared-types";

export type RawTikTokEventHandler = (event: unknown) => void;
export type TikTokStatusHandler = (status: TikTokConnectionStatus) => void;

export interface TikTokLiveConnector {
  connect(options: TikTokConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  getStatus(): TikTokConnectionStatus;
  onRawEvent(handler: RawTikTokEventHandler): () => void;
  onStatus(handler: TikTokStatusHandler): () => void;
}

export const tiktokConnectorLibrary = {
  name: "tiktok-live-connector",
  version: "2.4.0",
  license: "MIT",
  note:
    "Unofficial reverse-engineered connector. Runtime use is isolated to the server adapter; HTTP API remains available as fallback."
};
