import type WebSocket from "ws";
import type { OverlayId, OverlayStatus, ServerMessage } from "@obs-effect/shared-types";
import type { OverlayRegistry } from "./overlayRegistry.js";
import { overlayIds } from "./overlayTypes.js";

interface OverlayConnectionState {
  clients: Set<WebSocket>;
  connectedAt?: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
}

interface OverlayConnectionManagerOptions {
  registry: OverlayRegistry;
  publicBaseUrl: () => string;
  send: (client: WebSocket, message: ServerMessage) => void;
  onStatusChange: () => void;
}

export class OverlayConnectionManager {
  private readonly states = new Map<OverlayId, OverlayConnectionState>();
  private readonly options: OverlayConnectionManagerOptions;

  constructor(options: OverlayConnectionManagerOptions) {
    this.options = options;
    for (const overlayId of overlayIds) {
      this.states.set(overlayId, { clients: new Set<WebSocket>() });
    }
  }

  addClient(overlayId: OverlayId, client: WebSocket): void {
    const state = this.states.get(overlayId)!;
    const timestamp = new Date().toISOString();
    state.clients.add(client);
    state.connectedAt ??= timestamp;
    state.lastConnectedAt = timestamp;
    this.options.send(client, this.statusMessage());
    this.options.onStatusChange();

    client.on("close", () => {
      this.removeClient(overlayId, client);
    });
  }

  removeClient(overlayId: OverlayId, client: WebSocket): void {
    const state = this.states.get(overlayId)!;
    if (!state.clients.delete(client)) {
      return;
    }
    state.lastDisconnectedAt = new Date().toISOString();
    if (state.clients.size === 0) {
      state.connectedAt = undefined;
    }
    this.options.onStatusChange();
  }

  broadcastToOverlay(overlayId: OverlayId, message: ServerMessage): void {
    const state = this.states.get(overlayId)!;
    for (const client of state.clients) {
      this.options.send(client, message);
    }
  }

  broadcastToAll(message: ServerMessage): void {
    for (const overlayId of overlayIds) {
      this.broadcastToOverlay(overlayId, message);
    }
  }

  statusList(): OverlayStatus[] {
    return this.options.registry.list().map((definition) => {
      const state = this.states.get(definition.overlayId)!;
      const url = `${this.options.publicBaseUrl()}/overlay/${definition.overlayId}`;
      return {
        ...definition,
        url,
        connectedClients: state.clients.size,
        isInUse: state.clients.size > 0,
        connectedAt: state.connectedAt,
        lastConnectedAt: state.lastConnectedAt,
        lastDisconnectedAt: state.lastDisconnectedAt
      };
    });
  }

  statusMessage(): ServerMessage {
    return {
      type: "overlay:status",
      overlays: this.statusList(),
      createdAt: new Date().toISOString()
    };
  }

  totalClients(): number {
    return this.statusList().reduce((total, status) => total + status.connectedClients, 0);
  }
}
