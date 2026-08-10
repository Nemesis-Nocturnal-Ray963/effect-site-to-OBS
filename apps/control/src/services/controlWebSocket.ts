import type { EffectPlayMessage, ServerMessage } from "@obs-effect/shared-types";

export type ControlSocketState = "idle" | "connecting" | "connected" | "disconnected" | "error";

interface ControlWebSocketHandlers {
  onStateChange: (state: ControlSocketState) => void;
  onMessage: (message: ServerMessage) => void;
}

export interface ControlWebSocketClient {
  connect: () => void;
  close: () => void;
  sendEffect: (message: EffectPlayMessage) => void;
}

function makeWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function createControlWebSocket(handlers: ControlWebSocketHandlers): ControlWebSocketClient {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let closedByClient = false;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    closedByClient = false;
    handlers.onStateChange("connecting");
    socket = new WebSocket(makeWsUrl("/ws/control"));

    socket.addEventListener("open", () => {
      clearReconnect();
      handlers.onStateChange("connected");
    });

    socket.addEventListener("message", (event) => {
      try {
        handlers.onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        handlers.onStateChange("error");
      }
    });

    socket.addEventListener("error", () => {
      handlers.onStateChange("error");
    });

    socket.addEventListener("close", () => {
      socket = null;
      handlers.onStateChange("disconnected");

      if (!closedByClient) {
        clearReconnect();
        reconnectTimer = window.setTimeout(connect, 1500);
      }
    });
  };

  return {
    connect,
    close: () => {
      closedByClient = true;
      clearReconnect();
      socket?.close();
      socket = null;
      handlers.onStateChange("disconnected");
    },
    sendEffect: (message) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }
  };
}
