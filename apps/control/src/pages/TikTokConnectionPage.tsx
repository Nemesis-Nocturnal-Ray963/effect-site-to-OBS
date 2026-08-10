import React from "react";
import { Link } from "react-router-dom";
import type { TikTokConnectOptions } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import {
  connectTikTok,
  disconnectTikTok,
  fetchBrowserStatus,
  fetchTikTokStatus,
  reconnectTikTok,
  sendMockTikTokEvent
} from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";

const mockEvents = {
  comment: { eventType: "chat", roomId: "mock-room", user: { uniqueId: "viewer01", nickname: "viewer01" }, comment: "hello" },
  gift: {
    eventType: "gift",
    roomId: "mock-room",
    user: { userId: "u1", uniqueId: "viewer01", nickname: "viewer01" },
    giftId: "rose",
    giftName: "Rose",
    repeatCount: 1,
    diamondValueTotal: 1
  },
  "gift streak end": {
    eventType: "gift",
    roomId: "mock-room",
    user: { userId: "u1", uniqueId: "viewer01", nickname: "viewer01" },
    giftId: "rose",
    giftName: "Rose",
    repeatCount: 10,
    diamondValue: 1,
    repeatEnd: true
  },
  like: { eventType: "like", roomId: "mock-room", user: { userId: "u2", uniqueId: "viewer02" }, count: 25, totalLikeCount: 250 },
  follow: { eventType: "follow", roomId: "mock-room", user: { userId: "u3", uniqueId: "viewer03", nickname: "viewer03" } }
};

const uniqueIdHistoryStorageKey = "obs-effect.tiktok.uniqueIdHistory";
const maxUniqueIdHistory = 10;

function HelpTip({ text }: { text: string }): React.ReactElement {
  return (
    <span className="help-tip">
      <button type="button" aria-label={text}>
        ?
      </button>
      <span role="tooltip">{text}</span>
    </span>
  );
}

function readUniqueIdHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(uniqueIdHistoryStorageKey) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, maxUniqueIdHistory)
      : [];
  } catch {
    return [];
  }
}

function saveUniqueIdHistory(uniqueId: string): string[] {
  const normalized = uniqueId.trim().replace(/^@/u, "");
  if (!normalized) return readUniqueIdHistory();
  const next = [normalized, ...readUniqueIdHistory().filter((item) => item.toLocaleLowerCase("en-US") !== normalized.toLocaleLowerCase("en-US"))].slice(
    0,
    maxUniqueIdHistory
  );
  window.localStorage.setItem(uniqueIdHistoryStorageKey, JSON.stringify(next));
  return next;
}

export function TikTokConnectionPage(): React.ReactElement {
  const { t } = useI18n();
  const tiktokStatus = useConnectionStore((state) => state.tiktokStatus);
  const rawCaptureStatus = useConnectionStore((state) => state.rawCaptureStatus);
  const browserStatus = useConnectionStore((state) => state.browserStatus);
  const browserFrameStatus = useConnectionStore((state) => state.browserFrameStatus);
  const setTikTokStatus = useConnectionStore((state) => state.setTikTokStatus);
  const setBrowserStatus = useConnectionStore((state) => state.setBrowserStatus);
  const [form, setForm] = React.useState<TikTokConnectOptions>({
    uniqueId: "",
    connectorMode: "browser",
    autoReconnect: true,
    enableExtendedGiftInfo: true,
    fetchRoomInfoOnConnect: true,
    useMockConnector: false,
    browser: {
      browserType: "auto",
      debuggingPort: 9222,
      captureFrames: true
    }
  });
  const [message, setMessage] = React.useState("");
  const [uniqueIdHistory, setUniqueIdHistory] = React.useState<string[]>(() => readUniqueIdHistory());

  React.useEffect(() => {
    void fetchTikTokStatus()
      .then(setTikTokStatus)
      .catch(() => setMessage(t("Could not load TikTok status")));
    void fetchBrowserStatus()
      .then((data) => setBrowserStatus(data.status, data.frameStatus))
      .catch(() => undefined);
  }, [setTikTokStatus, setBrowserStatus]);

  async function connect(): Promise<void> {
    setMessage(t("Connecting..."));
    try {
      const payload: TikTokConnectOptions = {
        ...form,
        uniqueId: form.uniqueId.trim().replace(/^@/u, ""),
        useMockConnector: form.connectorMode === "mock"
      };
      const status = await connectTikTok(payload);
      setTikTokStatus(status);
      if (payload.uniqueId.trim()) {
        setUniqueIdHistory(saveUniqueIdHistory(payload.uniqueId));
      }
      setMessage(t("Connect request accepted"));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t("Connect failed"));
    }
  }

  async function disconnect(): Promise<void> {
    setTikTokStatus(await disconnectTikTok());
    setMessage(t("Disconnected"));
  }

  async function reconnect(): Promise<void> {
    setTikTokStatus(await reconnectTikTok());
    setMessage(t("Reconnect requested"));
  }

  async function sendMock(name: keyof typeof mockEvents): Promise<void> {
    try {
      await sendMockTikTokEvent(mockEvents[name]);
      setMessage(`Mock ${name} event sent`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : t("Mock event failed"));
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Connections")}</p>
        <h2>TikTok LIVE</h2>
      </div>

      <section className="content-grid">
        <div className="panel form-panel">
          <div className="form-grid">
            <label>
              <span className="field-label">
                {t("Connector Mode")}
                <HelpTip text={t("connectorModeHelp")} />
              </span>
              <select
                value={form.connectorMode ?? "library"}
                onChange={(event) =>
                  setForm({
                    ...form,
                    connectorMode: event.target.value as NonNullable<TikTokConnectOptions["connectorMode"]>,
                    useMockConnector: event.target.value === "mock"
                  })
                }
              >
                <option value="browser">{t("Browser Connector - free recommended")}</option>
                <option value="library">{t("Library Connector")}</option>
                <option value="mock">{t("Mock Connector")}</option>
              </select>
            </label>
            <label>
              <span className="field-label">
                uniqueId
                <HelpTip text={t("uniqueIdHelp")} />
              </span>
              <input
                value={form.uniqueId}
                placeholder="sample_user"
                list="tiktok-unique-id-history"
                onChange={(event) => setForm({ ...form, uniqueId: event.target.value })}
              />
              <datalist id="tiktok-unique-id-history">
                {uniqueIdHistory.map((uniqueId) => (
                  <option key={uniqueId} value={uniqueId} />
                ))}
              </datalist>
            </label>
            <label>
              <span className="field-label">
                sessionId
                <HelpTip text={t("sessionIdHelp")} />
              </span>
              <input
                value={form.sessionId ?? ""}
                placeholder="optional"
                type="password"
                onChange={(event) => setForm({ ...form, sessionId: event.target.value || undefined })}
              />
            </label>
            <label>
              {t("Browser")}
              <select
                value={form.browser?.browserType ?? "auto"}
                disabled={form.connectorMode !== "browser"}
                onChange={(event) =>
                  setForm({ ...form, browser: { ...form.browser, browserType: event.target.value as "auto" | "chrome" | "edge" } })
                }
              >
                <option value="auto">{t("Auto detect")}</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
              </select>
            </label>
            <label>
              {t("Debugging Port")}
              <input
                type="number"
                min={1024}
                max={65535}
                disabled={form.connectorMode !== "browser"}
                value={form.browser?.debuggingPort ?? 9222}
                onChange={(event) => setForm({ ...form, browser: { ...form.browser, debuggingPort: Number(event.target.value) } })}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.autoReconnect ?? false}
                onChange={(event) => setForm({ ...form, autoReconnect: event.target.checked })}
              />
              {t("Auto reconnect")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.enableExtendedGiftInfo ?? false}
                disabled={form.connectorMode !== "library"}
                onChange={(event) => setForm({ ...form, enableExtendedGiftInfo: event.target.checked })}
              />
              {t("Extended gift info")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.fetchRoomInfoOnConnect ?? false}
                disabled={form.connectorMode !== "library"}
                onChange={(event) => setForm({ ...form, fetchRoomInfoOnConnect: event.target.checked })}
              />
              {t("Fetch room info")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.browser?.captureFrames ?? true}
                disabled={form.connectorMode !== "browser"}
                onChange={(event) => setForm({ ...form, browser: { ...form.browser, captureFrames: event.target.checked } })}
              />
              {t("Raw frame capture")}
            </label>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => void connect()}>
              Connect
            </button>
            <button type="button" onClick={() => void disconnect()}>
              Disconnect
            </button>
            <button type="button" onClick={() => void reconnect()}>
              Reconnect
            </button>
          </div>
          <p className="empty-text">{message}</p>
        </div>

        <div className="panel">
          <h3>{t("Connection status")}</h3>
          <dl className="detail-list">
            <dt>state</dt>
            <dd>{tiktokStatus?.state ?? "idle"}</dd>
            <dt>mode</dt>
            <dd>{tiktokStatus?.connector.mode ?? "-"}</dd>
            <dt>uniqueId</dt>
            <dd>{tiktokStatus?.uniqueId ?? "-"}</dd>
            <dt>roomId</dt>
            <dd>{tiktokStatus?.roomId ?? "-"}</dd>
            <dt>lastEventAt</dt>
            <dd>{tiktokStatus?.lastEventAt ?? "-"}</dd>
            <dt>received</dt>
            <dd>{tiktokStatus?.receivedCount ?? 0}</dd>
            <dt>lastError</dt>
            <dd>{tiktokStatus?.lastError ?? tiktokStatus?.errorMessage ?? "-"}</dd>
          </dl>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h3>{t("Browser")} Connector</h3>
          <dl className="detail-list">
            <dt>state</dt>
            <dd>{browserStatus?.state ?? "idle"}</dd>
            <dt>browser</dt>
            <dd>{browserStatus?.browserType ?? "-"}</dd>
            <dt>port</dt>
            <dd>{browserStatus?.debuggingPort ?? 9222}</dd>
            <dt>sockets</dt>
            <dd>{browserStatus?.socketCount ?? 0}</dd>
            <dt>frames</dt>
            <dd>{browserFrameStatus?.count ?? 0}</dd>
            <dt>page</dt>
            <dd>{browserStatus?.pageUrl ?? "-"}</dd>
          </dl>
          <Link className="text-link" to="/connections/tiktok/browser-frames">
            {t("Open Browser Frame Inspector")}
          </Link>
        </div>
        <div className="panel">
          <h3>{t("Mock events")}</h3>
          <p className="empty-text">{t("Mock Connector mode only.")}</p>
          <div className="button-row">
            {(Object.keys(mockEvents) as Array<keyof typeof mockEvents>).map((name) => (
              <button key={name} type="button" onClick={() => void sendMock(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>{t("Raw Event Capture")}</h3>
          <dl className="detail-list">
            <dt>capture</dt>
            <dd>{rawCaptureStatus?.enabled ? "ON" : "OFF"}</dd>
            <dt>stored</dt>
            <dd>{rawCaptureStatus?.count ?? 0}</dd>
            <dt>failed normalization</dt>
            <dd>{rawCaptureStatus?.failedNormalizationCount ?? 0}</dd>
          </dl>
          <Link className="text-link" to="/connections/tiktok/raw-events">
            {t("Open Raw Event Inspector")}
          </Link>
        </div>
        <div className="panel">
          <h3>{t("Connector notes")}</h3>
          <p className="empty-text">
            {t("Browser")} Connector is the free recommended path. It opens Chrome/Edge with a dedicated profile and observes WebSocket frames through CDP.
          </p>
          <p className="empty-text">
            Library Connector remains available but may require an external signing provider. HTTP API input remains available as fallback.
          </p>
        </div>
      </section>
    </section>
  );
}
