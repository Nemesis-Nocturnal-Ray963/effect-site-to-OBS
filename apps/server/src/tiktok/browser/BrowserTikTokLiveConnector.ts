import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BrowserConnectorStatus, TikTokConnectOptions, TikTokConnectionStatus } from "@obs-effect/shared-types";
import type { RawTikTokEventHandler, TikTokLiveConnector, TikTokStatusHandler } from "../TikTokLiveConnector.js";
import { CdpClient } from "./CdpClient.js";
import { resolveBrowserExecutable } from "./BrowserExecutableResolver.js";
import { BrowserFrameStore } from "./BrowserFrameStore.js";
import { TikTokWebcastBrowserFrameDecoder } from "./BrowserFrameDecoder.js";

interface BrowserTikTokLiveConnectorOptions {
  rootDir: string;
  frameStore: BrowserFrameStore;
  onBrowserStatus: (status: BrowserConnectorStatus) => void;
  onFrame: (captureId: string) => void;
}

interface TargetInfo {
  webSocketDebuggerUrl?: string;
  title?: string;
  url?: string;
}

interface FrameParams {
  requestId?: string;
  response?: {
    opcode?: number;
    payloadData?: string;
  };
}

interface SocketCreatedParams {
  requestId?: string;
  url?: string;
}

export class BrowserTikTokLiveConnector implements TikTokLiveConnector {
  private readonly options: BrowserTikTokLiveConnectorOptions;
  private readonly rawHandlers = new Set<RawTikTokEventHandler>();
  private readonly statusHandlers = new Set<TikTokStatusHandler>();
  private readonly frameDecoder = new TikTokWebcastBrowserFrameDecoder();
  private readonly expectedProcessExits = new WeakSet<ChildProcessWithoutNullStreams>();
  private readonly expectedCdpCloses = new WeakSet<CdpClient>();
  private process: ChildProcessWithoutNullStreams | null = null;
  private cdp: CdpClient | null = null;
  private connectOptions: TikTokConnectOptions | null = null;
  private sockets = new Map<string, string>();
  private browserVersion: string | undefined;
  private pageUrl = "";
  private pageTitle: string | undefined;
  private browserStatus: BrowserConnectorStatus;
  private status: TikTokConnectionStatus = {
    enabled: true,
    state: "idle",
    receivedCount: 0,
    reconnectAttempt: 0,
    connector: {
      mode: "browser",
      libraryName: "browser-connector",
      libraryVersion: "0.1.0",
      license: "local",
      note: "Free browser connector using Chrome/Edge and Chrome DevTools Protocol. Decoder is currently raw-frame first."
    }
  };

  constructor(options: BrowserTikTokLiveConnectorOptions) {
    this.options = options;
    this.browserStatus = this.createBrowserStatus("idle", 9222, "data/browser-profile/tiktok");
  }

  async connect(connectOptions: TikTokConnectOptions): Promise<void> {
    const uniqueId = connectOptions.uniqueId ?? "";
    this.connectOptions = connectOptions;
    this.sockets.clear();
    if (connectOptions.browser?.captureFrames === false) {
      this.options.frameStore.disable();
    } else {
      this.options.frameStore.enable();
    }
    const port = connectOptions.browser?.debuggingPort ?? 9222;
    const profileDir = path.join(this.options.rootDir, "data/browser-profile/tiktok");
    mkdirSync(profileDir, { recursive: true });
    const executable = resolveBrowserExecutable(connectOptions.browser?.browserType, connectOptions.browser?.executablePath);
    if (!executable) {
      this.setBrowserStatus(this.createBrowserStatus("browser-not-found", port, profileDir, { errorCode: "BROWSER_NOT_FOUND" }));
      this.setStatus("error", { errorCode: "BROWSER_NOT_FOUND", errorMessage: "Chrome or Edge was not found." });
      return;
    }

    this.pageUrl = `https://www.tiktok.com/@${uniqueId.replace(/^@/, "")}/live`;
    this.setBrowserStatus(
      this.createBrowserStatus("browser-launching", port, profileDir, { browserType: executable.type, executablePath: executable.path })
    );
    this.setStatus("connecting");
    this.launchBrowser(executable.path, port, profileDir, this.pageUrl, connectOptions.browser?.headless ?? false);
    this.setBrowserStatus(
      this.createBrowserStatus("browser-running", port, profileDir, { browserType: executable.type, executablePath: executable.path })
    );

    try {
      const target = await this.waitForTarget(port);
      if (!target.webSocketDebuggerUrl) throw new Error("CDP target WebSocket URL not found");
      this.pageTitle = target.title;
      this.pageUrl = target.url ?? this.pageUrl;
      this.cdp = new CdpClient();
      this.setBrowserStatus(
        this.createBrowserStatus("cdp-connecting", port, profileDir, { browserType: executable.type, executablePath: executable.path })
      );
      await this.cdp.connect(target.webSocketDebuggerUrl);
      this.installCdpListeners(executable.type, port);
      await this.cdp.send("Network.enable");
      await this.cdp.send("Page.enable");
      await this.cdp.send("Runtime.enable");
      this.setBrowserStatus(
        this.createBrowserStatus("capturing", port, profileDir, { browserType: executable.type, executablePath: executable.path })
      );
      this.setStatus("connected", { roomId: undefined, connectedAt: new Date().toISOString() });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "CDP connection failed";
      this.setBrowserStatus(
        this.createBrowserStatus("error", port, profileDir, {
          browserType: executable.type,
          executablePath: executable.path,
          errorCode: "CDP_CONNECTION_FAILED",
          errorMessage: message
        })
      );
      this.setStatus("error", { errorCode: "CDP_CONNECTION_FAILED", errorMessage: message, lastError: message });
    }
  }

  async disconnect(): Promise<void> {
    await this.disconnectBrowser(true);
  }

  async reconnect(): Promise<void> {
    if (!this.connectOptions) return;
    const reconnectAttempt = this.status.reconnectAttempt + 1;
    this.setStatus("reconnecting", { reconnectAttempt });
    await this.disconnectBrowser(false);
    this.status = { ...this.status, reconnectAttempt };
    await this.connect(this.connectOptions);
  }

  getStatus(): TikTokConnectionStatus {
    return this.status;
  }

  getBrowserStatus(): BrowserConnectorStatus {
    return this.browserStatus;
  }

  onRawEvent(handler: RawTikTokEventHandler): () => void {
    this.rawHandlers.add(handler);
    return () => this.rawHandlers.delete(handler);
  }

  onStatus(handler: TikTokStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private launchBrowser(executablePath: string, port: number, profileDir: string, url: string, headless: boolean): void {
    if (this.process && !this.process.killed) return;
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      ...(headless ? ["--headless=new"] : []),
      url
    ];
    const childProcess = spawn(executablePath, args, { windowsHide: false });
    this.process = childProcess;
    childProcess.on("exit", () => {
      if (this.expectedProcessExits.has(childProcess)) {
        return;
      }
      this.setBrowserStatus({ ...this.browserStatus, state: "idle" });
      if (this.status.state !== "disconnected") this.setStatus("disconnected");
    });
  }

  private async waitForTarget(port: number): Promise<TargetInfo> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json())) as { Browser?: string };
        this.browserVersion = version.Browser;
        const targets = (await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())) as TargetInfo[];
        const target = targets.find((item) => item.url?.includes("tiktok.com")) ?? targets.find((item) => item.webSocketDebuggerUrl);
        if (target?.webSocketDebuggerUrl) return target;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error("Timed out waiting for browser CDP target");
  }

  private installCdpListeners(browserType: "chrome" | "edge", port: number): void {
    const cdp = this.cdp;
    cdp?.on("Network.webSocketCreated", (params: SocketCreatedParams) => {
      if (params.requestId && params.url) this.sockets.set(params.requestId, params.url);
      this.emitBrowserStatus();
    });
    cdp?.on("Network.webSocketFrameReceived", (params: FrameParams) => {
      this.captureFrame(browserType, port, params, "received");
    });
    cdp?.on("Network.webSocketFrameSent", (params: FrameParams) => {
      this.captureFrame(browserType, port, params, "sent");
    });
    cdp?.on("Page.loadEventFired", () => {
      this.setBrowserStatus({ ...this.browserStatus, state: "live-page-ready" });
      this.setBrowserStatus({ ...this.browserStatus, state: "capturing" });
    });
    cdp?.on("close", () => {
      if (cdp && this.expectedCdpCloses.has(cdp)) {
        return;
      }
      this.setBrowserStatus({ ...this.browserStatus, state: "error", errorCode: "BROWSER_CLOSED", errorMessage: "Browser CDP socket closed" });
    });
  }

  private captureFrame(browserType: "chrome" | "edge", port: number, params: FrameParams, direction: "received" | "sent"): void {
    const requestId = params.requestId;
    const payloadData = params.response?.payloadData;
    if (!requestId || typeof payloadData !== "string") return;
    const frame = this.options.frameStore.add({
      browser: { type: browserType, version: this.browserVersion, debuggingPort: port },
      page: { url: this.pageUrl, title: this.pageTitle, uniqueId: this.connectOptions?.uniqueId },
      requestId,
      socketUrl: this.sockets.get(requestId),
      direction,
      opcode: params.response?.opcode ?? 0,
      payloadData
    });
    if (!frame) return;

    this.status = {
      ...this.status,
      receivedCount: this.status.receivedCount + (direction === "received" ? 1 : 0),
      lastEventAt: new Date().toISOString()
    };
    this.emitStatus();
    this.emitBrowserStatus();
    this.options.onFrame(frame.captureId);
    if (frame.decode.status === "json" && frame.decode.json) {
      for (const handler of this.rawHandlers) handler({ ...asRecord(frame.decode.json), eventType: "browser-json-frame" });
    }
    void this.emitDecodedRawEvents(frame);
  }

  private async emitDecodedRawEvents(frame: ReturnType<BrowserFrameStore["add"]>): Promise<void> {
    if (!frame) return;
    const rawEvents = await this.frameDecoder.decode(frame);
    for (const rawEvent of rawEvents) {
      this.status = { ...this.status, lastEventAt: new Date().toISOString() };
      this.emitStatus();
      for (const handler of this.rawHandlers) handler(rawEvent);
    }
  }

  private createBrowserStatus(
    state: BrowserConnectorStatus["state"],
    debuggingPort: number,
    profileDir: string,
    overrides: Partial<BrowserConnectorStatus> = {}
  ): BrowserConnectorStatus {
    const frameStatus = this.options.frameStore.status();
    return {
      enabled: true,
      state,
      debuggingPort,
      profileDir,
      pageUrl: this.pageUrl,
      pageTitle: this.pageTitle,
      uniqueId: this.connectOptions?.uniqueId,
      connectedAt: this.status.connectedAt,
      lastFrameAt: this.status.lastEventAt,
      socketCount: this.sockets.size,
      receivedFrameCount: frameStatus.receivedFrameCount,
      sentFrameCount: frameStatus.sentFrameCount,
      binaryFrameCount: frameStatus.binaryFrameCount,
      textFrameCount: frameStatus.textFrameCount,
      ...overrides
    };
  }

  private setBrowserStatus(status: BrowserConnectorStatus): void {
    this.browserStatus = status;
    this.options.onBrowserStatus(status);
  }

  private emitBrowserStatus(): void {
    this.setBrowserStatus(
      this.createBrowserStatus(this.browserStatus.state, this.browserStatus.debuggingPort, this.browserStatus.profileDir, {
        browserType: this.browserStatus.browserType,
        executablePath: this.browserStatus.executablePath,
        errorCode: this.browserStatus.errorCode,
        errorMessage: this.browserStatus.errorMessage
      })
    );
  }

  private setStatus(state: TikTokConnectionStatus["state"], overrides: Partial<TikTokConnectionStatus> = {}): void {
    this.status = {
      ...this.status,
      state,
      uniqueId: this.connectOptions?.uniqueId,
      connector: {
        mode: "browser",
        libraryName: "browser-connector",
        libraryVersion: "0.1.0",
        license: "local",
        note: "Free browser connector using Chrome/Edge and Chrome DevTools Protocol. Raw frame capture is available first; decoding is experimental."
      },
      ...overrides
    };
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const handler of this.statusHandlers) handler(this.status);
  }

  private async disconnectBrowser(emitDisconnectedStatus: boolean): Promise<void> {
    const cdp = this.cdp;
    if (cdp) {
      this.expectedCdpCloses.add(cdp);
      cdp.close();
    }
    this.cdp = null;
    if (this.process) {
      this.expectedProcessExits.add(this.process);
      this.process.kill();
    }
    this.process = null;
    if (emitDisconnectedStatus) {
      this.setStatus("disconnected");
      this.setBrowserStatus({ ...this.browserStatus, state: "idle" });
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
