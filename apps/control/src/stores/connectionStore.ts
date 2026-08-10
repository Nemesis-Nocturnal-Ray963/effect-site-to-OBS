import { create } from "zustand";
import type {
  ConnectionStatusMessage,
  EffectPlayMessage,
  EventHistoryEntry,
  BrowserConnectorStatus,
  BrowserFrameStoreStatus,
  BrowserWebSocketFrameCaptureSummary,
  OverlayId,
  OverlayStatus,
  RawCaptureStatus,
  TikTokRawEventCaptureSummary,
  ServerMessage,
  TikTokConnectionStatus
} from "@obs-effect/shared-types";
import { createControlWebSocket, type ControlSocketState, type ControlWebSocketClient } from "../services/controlWebSocket";
import { handleAppAudioComboMessage } from "../services/appAudioPlayer";
import type { UiLogEntry } from "@obs-effect/shared-types";

export type SocketState = ControlSocketState;

interface ConnectionStore {
  socketState: SocketState;
  status: ConnectionStatusMessage | null;
  tiktokStatus: TikTokConnectionStatus | null;
  overlays: OverlayStatus[];
  rawCaptureStatus: RawCaptureStatus | null;
  rawCaptures: TikTokRawEventCaptureSummary[];
  browserStatus: BrowserConnectorStatus | null;
  browserFrameStatus: BrowserFrameStoreStatus | null;
  browserFrames: BrowserWebSocketFrameCaptureSummary[];
  receivedEvents: EventHistoryEntry[];
  logs: UiLogEntry[];
  paused: boolean;
  client: ControlWebSocketClient | null;
  connect: () => void;
  playFlash: (parameters?: Record<string, unknown>, targetOverlayId?: OverlayId) => void;
  setPaused: (paused: boolean) => void;
  clearEventsView: () => void;
  clearLogsView: () => void;
  hydrateEvents: (events: EventHistoryEntry[]) => void;
  hydrateLogs: (logs: UiLogEntry[]) => void;
  setTikTokStatus: (status: TikTokConnectionStatus) => void;
  hydrateOverlays: (overlays: OverlayStatus[]) => void;
  setRawCaptureStatus: (status: RawCaptureStatus) => void;
  hydrateRawCaptures: (captures: TikTokRawEventCaptureSummary[]) => void;
  setBrowserStatus: (status: BrowserConnectorStatus | null, frameStatus: BrowserFrameStoreStatus) => void;
  hydrateBrowserFrames: (frames: BrowserWebSocketFrameCaptureSummary[]) => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  socketState: "idle",
  status: null,
  tiktokStatus: null,
  overlays: [],
  rawCaptureStatus: null,
  rawCaptures: [],
  browserStatus: null,
  browserFrameStatus: null,
  browserFrames: [],
  receivedEvents: [],
  logs: [],
  paused: false,
  client: null,
  connect: () => {
    if (get().client) {
      return;
    }

    const client = createControlWebSocket({
      onStateChange: (socketState) => set({ socketState }),
      onMessage: (message: ServerMessage) => {
        if (message.type === "connection:status") {
          set({ status: message });
        } else if (message.type === "tiktok:status") {
          set({ tiktokStatus: message.status });
        } else if (message.type === "overlay:status") {
          set({ overlays: message.overlays });
        } else if (message.type === "raw-capture:status") {
          set({ rawCaptureStatus: message.status });
        } else if (message.type === "raw-capture:received" || message.type === "raw-capture:updated") {
          set((state) => ({
            rawCaptures: [message.capture, ...state.rawCaptures.filter((capture) => capture.captureId !== message.capture.captureId)].slice(
              0,
              1000
            )
          }));
        } else if (message.type === "raw-capture:cleared") {
          set({ rawCaptures: [] });
        } else if (message.type === "tiktok:browser-status") {
          set({ browserStatus: message.status, browserFrameStatus: message.frameStatus });
        } else if (message.type === "tiktok:browser-frame-received" || message.type === "tiktok:browser-frame-updated") {
          set((state) => ({
            browserFrameStatus: message.frameStatus,
            browserFrames: [message.frame, ...state.browserFrames.filter((frame) => frame.captureId !== message.frame.captureId)].slice(0, 1000)
          }));
        } else if (message.type === "tiktok:browser-frame-cleared") {
          set({ browserFrames: [], browserFrameStatus: message.frameStatus });
        } else if (message.type === "event:received") {
          if (!get().paused) {
            set((state) => ({
              receivedEvents: [
                {
                  event: message.event,
                  processing: message.processing,
                  result: message.result,
                  createdAt: message.createdAt
                },
                ...state.receivedEvents.filter((entry) => entry.event.eventId !== message.event.eventId)
              ].slice(0, 1000)
            }));
          }
        } else if (message.type === "event:replayed" || message.type === "event:updated") {
          if (!get().paused) {
            set((state) => ({
              receivedEvents: [
                message.event,
                ...state.receivedEvents.filter((entry) => entry.event.eventId !== message.event.event.eventId)
              ].slice(0, 1000)
            }));
          }
        } else if (message.type === "event:cleared") {
          set({ receivedEvents: [] });
        } else if (message.type === "log:updated") {
          set((state) => ({
            logs: [message.entry, ...state.logs.filter((entry) => entry.id !== message.entry.id)].slice(0, 1000)
          }));
        } else if (message.type === "log:cleared") {
          set({ logs: [] });
        } else if (message.type === "app-audio:combo") {
          handleAppAudioComboMessage(message);
        }
      }
    });

    set({ client });
    client.connect();
  },
  playFlash: (parameters = { color: "#ffffff", durationMs: 650 }, targetOverlayId = 1) => {
    const message: EffectPlayMessage = {
      type: "effect:play",
      effectId: "flash",
      targetOverlayId,
      instanceId: `control-flash-${Date.now()}`,
      parameters,
      createdAt: new Date().toISOString()
    };

    get().client?.sendEffect(message);
  },
  setPaused: (paused) => set({ paused }),
  clearEventsView: () => set({ receivedEvents: [] }),
  clearLogsView: () => set({ logs: [] }),
  hydrateEvents: (events) => set({ receivedEvents: events.slice(0, 1000) }),
  hydrateLogs: (logs) => set({ logs: logs.slice(0, 1000) }),
  setTikTokStatus: (status) => set({ tiktokStatus: status }),
  hydrateOverlays: (overlays) => set({ overlays }),
  setRawCaptureStatus: (status) => set({ rawCaptureStatus: status }),
  hydrateRawCaptures: (captures) => set({ rawCaptures: captures.slice(0, 1000) }),
  setBrowserStatus: (status, frameStatus) => set({ browserStatus: status, browserFrameStatus: frameStatus }),
  hydrateBrowserFrames: (frames) => set({ browserFrames: frames.slice(0, 1000) })
}));
