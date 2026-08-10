import { EventEmitter } from "node:events";
import WebSocket from "ws";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export class CdpClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();

  async connect(webSocketDebuggerUrl: string): Promise<void> {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.socket?.once("open", () => resolve());
      this.socket?.once("error", reject);
    });
    this.socket.on("message", (payload) => this.handleMessage(payload.toString()));
    this.socket.on("close", () => this.emit("close"));
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP socket is not connected");
    const id = this.nextId;
    this.nextId += 1;
    const message = JSON.stringify({ id, method, params });
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    });
    this.socket.send(message);
    return promise;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }

    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }

    if (message.method) {
      this.emit(message.method, message.params);
    }
  }
}
