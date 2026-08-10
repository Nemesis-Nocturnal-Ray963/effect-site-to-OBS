import React from "react";
import type { BrowserWebSocketFrameCapture, BrowserWebSocketFrameCaptureSummary } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import {
  clearBrowserFrames,
  exportBrowserFrames,
  fetchBrowserFrame,
  fetchBrowserFrames,
  fetchBrowserStatus,
  setBrowserFrameCaptureEnabled
} from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TikTokBrowserFramesPage(): React.ReactElement {
  const { t } = useI18n();
  const browserStatus = useConnectionStore((state) => state.browserStatus);
  const frameStatus = useConnectionStore((state) => state.browserFrameStatus);
  const frames = useConnectionStore((state) => state.browserFrames);
  const setBrowserStatus = useConnectionStore((state) => state.setBrowserStatus);
  const hydrateBrowserFrames = useConnectionStore((state) => state.hydrateBrowserFrames);
  const [direction, setDirection] = React.useState<"all" | "received" | "sent">("all");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<BrowserWebSocketFrameCapture | null>(null);
  const [tab, setTab] = React.useState("Summary");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    const status = await fetchBrowserStatus();
    const frameData = await fetchBrowserFrames({ direction, search, limit: 300 });
    setBrowserStatus(status.status, frameData.status);
    hydrateBrowserFrames(frameData.frames);
  }, [direction, search, hydrateBrowserFrames, setBrowserStatus]);

  React.useEffect(() => {
    void load().catch(() => setMessage(t("Could not load browser frames")));
  }, [load]);

  async function openFrame(frame: BrowserWebSocketFrameCaptureSummary): Promise<void> {
    setSelected(await fetchBrowserFrame(frame.captureId));
    setTab("Summary");
  }

  async function toggleCapture(): Promise<void> {
    const updated = await setBrowserFrameCaptureEnabled(!(frameStatus?.enabled ?? false));
    setBrowserStatus(browserStatus, updated);
  }

  async function clear(): Promise<void> {
    const updated = await clearBrowserFrames();
    setBrowserStatus(browserStatus, updated);
    hydrateBrowserFrames([]);
    setSelected(null);
  }

  async function exportFrames(format: "json" | "jsonl"): Promise<void> {
    const blob = await exportBrowserFrames(format);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tiktok-browser-frames.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${format.toUpperCase()}`);
  }

  async function copyJson(value: unknown): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setMessage(t("Copied"));
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">TikTok LIVE</p>
        <h2>{t("Browser Frame Inspector")}</h2>
      </div>

      <section className="metric-grid">
        <div className="panel metric-card">
          <span>{t("Browser")}</span>
          <strong>{browserStatus?.state ?? "idle"}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Capture")}</span>
          <strong>{frameStatus?.enabled ? "ON" : "OFF"}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Frames")}</span>
          <strong>{frameStatus?.count ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("WebSockets")}</span>
          <strong>{browserStatus?.socketCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Received")}</span>
          <strong>{frameStatus?.receivedFrameCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Binary")}</span>
          <strong>{frameStatus?.binaryFrameCount ?? 0}</strong>
        </div>
      </section>

      <div className="panel monitor-toolbar compact">
        <label>
          {t("Direction")}
          <select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}>
            <option>all</option>
            <option>received</option>
            <option>sent</option>
          </select>
        </label>
        <label>
          {t("Search")}
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void toggleCapture()}>
            {frameStatus?.enabled ? t("Disable") : t("Enable")}
          </button>
          <button type="button" onClick={() => void clear()}>
            Clear
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void exportFrames("json")}>
            {t("Export JSON")}
          </button>
          <button type="button" onClick={() => void exportFrames("jsonl")}>
            {t("Export JSONL")}
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-meta">
          <span>{frames.length} {t("shown")}</span>
          <span>{message}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t("Captured At")}</th>
              <th>{t("Direction")}</th>
              <th>{t("Opcode")}</th>
              <th>{t("Socket URL")}</th>
              <th>{t("Size")}</th>
              <th>{t("Encoding")}</th>
              <th>{t("Decode")}</th>
              <th>{t("Truncated")}</th>
            </tr>
          </thead>
          <tbody>
            {frames.length === 0 ? (
              <tr>
                <td colSpan={8}>{t("No browser frames in the current view.")}</td>
              </tr>
            ) : (
              frames.map((frame) => (
                <tr key={frame.captureId} onClick={() => void openFrame(frame)}>
                  <td>{new Date(frame.capturedAt).toLocaleTimeString()}</td>
                  <td>{frame.direction}</td>
                  <td>{frame.opcode}</td>
                  <td>{frame.socketUrl ?? "-"}</td>
                  <td>{formatBytes(frame.payloadSizeBytes)}</td>
                  <td>{frame.payloadEncoding}</td>
                  <td>{frame.decodeStatus}</td>
                  <td>{frame.truncated ? t("Yes") : t("No")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <aside className="detail-drawer" aria-label={t("Browser frame detail")}>
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{selected.direction}</p>
              <h3>{selected.captureId}</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="tab-row">
            {["Summary", "Payload", "Decode", "Metadata"].map((item) => (
              <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </div>
          {tab === "Summary" ? (
            <dl className="detail-list">
              <dt>page</dt>
              <dd>{selected.page.url}</dd>
              <dt>socket</dt>
              <dd>{selected.socket.url ?? "-"}</dd>
              <dt>browser</dt>
              <dd>{selected.browser.type}</dd>
              <dt>opcode</dt>
              <dd>{selected.opcode}</dd>
              <dt>size</dt>
              <dd>{formatBytes(selected.payloadSizeBytes)}</dd>
            </dl>
          ) : null}
          {tab === "Payload" ? (
            <>
              <button type="button" onClick={() => void copyJson(selected.frame.payloadData)}>
                {t("Copy Payload")}
              </button>
              <pre className="json-block">{selected.frame.payloadData}</pre>
            </>
          ) : null}
          {tab === "Decode" ? <pre className="json-block">{JSON.stringify(selected.decode, null, 2)}</pre> : null}
          {tab === "Metadata" ? <pre className="json-block">{JSON.stringify(selected.metadata, null, 2)}</pre> : null}
        </aside>
      ) : null}
    </section>
  );
}
