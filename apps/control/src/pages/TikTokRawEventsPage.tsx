import React from "react";
import type { RawNormalizationStatus, TikTokRawEventCapture, TikTokRawEventCaptureSummary } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import {
  clearRawCaptures,
  exportRawCaptures,
  fetchRawCapture,
  fetchRawCaptures,
  setRawCaptureEnabled
} from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";

const statuses: Array<"all" | RawNormalizationStatus> = ["all", "success", "warning", "failed", "not-normalized"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TikTokRawEventsPage(): React.ReactElement {
  const { t } = useI18n();
  const rawCaptureStatus = useConnectionStore((state) => state.rawCaptureStatus);
  const rawCaptures = useConnectionStore((state) => state.rawCaptures);
  const setRawCaptureStatus = useConnectionStore((state) => state.setRawCaptureStatus);
  const hydrateRawCaptures = useConnectionStore((state) => state.hydrateRawCaptures);
  const [eventName, setEventName] = React.useState("");
  const [normalizationStatus, setNormalizationStatus] = React.useState<"all" | RawNormalizationStatus>("all");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<TikTokRawEventCapture | null>(null);
  const [tab, setTab] = React.useState("Summary");
  const [anonymizeExport, setAnonymizeExport] = React.useState(true);
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    const data = await fetchRawCaptures({ eventName, normalizationStatus, search, limit: 300 });
    setRawCaptureStatus(data.status);
    hydrateRawCaptures(data.captures);
  }, [eventName, normalizationStatus, search, hydrateRawCaptures, setRawCaptureStatus]);

  React.useEffect(() => {
    void load().catch(() => setMessage(t("Could not load raw captures")));
  }, [load]);

  async function toggleCapture(): Promise<void> {
    const status = await setRawCaptureEnabled(!(rawCaptureStatus?.enabled ?? false));
    setRawCaptureStatus(status);
  }

  async function clear(): Promise<void> {
    setRawCaptureStatus(await clearRawCaptures());
    hydrateRawCaptures([]);
    setSelected(null);
  }

  async function openCapture(summary: TikTokRawEventCaptureSummary): Promise<void> {
    setSelected(await fetchRawCapture(summary.captureId));
    setTab("Summary");
  }

  async function copyJson(value: unknown): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setMessage(t("JSON copied"));
  }

  async function exportCaptures(format: "json" | "jsonl"): Promise<void> {
    const blob = await exportRawCaptures({ format, anonymize: anonymizeExport });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tiktok-raw-captures.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${format.toUpperCase()}`);
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">TikTok LIVE</p>
        <h2>{t("Raw Event")} Inspector</h2>
      </div>

      <section className="metric-grid">
        <div className="panel metric-card">
          <span>{t("Capture")}</span>
          <strong>{rawCaptureStatus?.enabled ? "ON" : "OFF"}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Captured")}</span>
          <strong>{rawCaptureStatus?.count ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Estimated memory")}</span>
          <strong>{formatBytes(rawCaptureStatus?.estimatedBytes ?? 0)}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Truncated")}</span>
          <strong>{rawCaptureStatus?.truncatedCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Failed normalization")}</span>
          <strong>{rawCaptureStatus?.failedNormalizationCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Limit")}</span>
          <strong>{rawCaptureStatus?.maxCount ?? 1000}</strong>
        </div>
      </section>

      <div className="panel monitor-toolbar compact">
        <label>
          {t("Raw Event")}
          <input value={eventName} placeholder="gift, chat, like" onChange={(event) => setEventName(event.target.value)} />
        </label>
        <label>
          {t("Normalization")}
          <select value={normalizationStatus} onChange={(event) => setNormalizationStatus(event.target.value as typeof normalizationStatus)}>
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void toggleCapture()}>
            {rawCaptureStatus?.enabled ? t("Disable") : t("Enable")}
          </button>
          <button type="button" onClick={() => void clear()}>
            Clear
          </button>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={anonymizeExport} onChange={(event) => setAnonymizeExport(event.target.checked)} />
          {t("Anonymize export")}
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void exportCaptures("json")}>
            {t("Export JSON")}
          </button>
          <button type="button" onClick={() => void exportCaptures("jsonl")}>
            {t("Export JSONL")}
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-meta">
          <span>{rawCaptures.length} {t("shown")}</span>
          <span>{message}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t("Captured At")}</th>
              <th>{t("Raw Event")}</th>
              <th>{t("User")}</th>
              <th>{t("Size")}</th>
              <th>{t("Normalization")}</th>
              <th>{t("Warnings")}</th>
              <th>{t("Errors")}</th>
              <th>{t("Truncated")}</th>
            </tr>
          </thead>
          <tbody>
            {rawCaptures.length === 0 ? (
              <tr>
                <td colSpan={8}>{t("No raw captures in the current view.")}</td>
              </tr>
            ) : (
              rawCaptures.map((capture) => (
                <tr key={capture.captureId} onClick={() => void openCapture(capture)}>
                  <td>{new Date(capture.capturedAt).toLocaleTimeString()}</td>
                  <td>{capture.rawEventName}</td>
                  <td>{capture.userSummary ?? "-"}</td>
                  <td>{formatBytes(capture.rawEventSizeBytes)}</td>
                  <td>{capture.normalizationStatus}</td>
                  <td>{capture.warningCount}</td>
                  <td>{capture.errorCount}</td>
                  <td>{capture.truncated ? t("Yes") : t("No")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <aside className="detail-drawer" aria-label={t("Raw capture detail")}>
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{selected.rawEventName}</p>
              <h3>{selected.captureId}</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="tab-row">
            {["Summary", "Raw JSON", "Normalized JSON", "Normalization Result", "Metadata"].map((item) => (
              <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </div>
          {tab === "Summary" ? (
            <dl className="detail-list">
              <dt>capturedAt</dt>
              <dd>{selected.capturedAt}</dd>
              <dt>connector</dt>
              <dd>{selected.connector.name}</dd>
              <dt>mode</dt>
              <dd>{selected.connector.mode}</dd>
              <dt>uniqueId</dt>
              <dd>{selected.connection.uniqueId ?? "-"}</dd>
              <dt>roomId</dt>
              <dd>{selected.connection.roomId ?? "-"}</dd>
              <dt>size</dt>
              <dd>{formatBytes(selected.rawEventSizeBytes)}</dd>
              <dt>redacted</dt>
              <dd>{selected.metadata.redactedFields.length}</dd>
            </dl>
          ) : null}
          {tab === "Raw JSON" ? (
            <>
              <button type="button" onClick={() => void copyJson(selected.rawEvent)}>
                Copy JSON
              </button>
              <pre className="json-block">{JSON.stringify(selected.rawEvent, null, 2)}</pre>
            </>
          ) : null}
          {tab === "Normalized JSON" ? <pre className="json-block">{JSON.stringify(selected.normalization.normalizedEvent ?? null, null, 2)}</pre> : null}
          {tab === "Normalization Result" ? <pre className="json-block">{JSON.stringify(selected.normalization, null, 2)}</pre> : null}
          {tab === "Metadata" ? <pre className="json-block">{JSON.stringify(selected.metadata, null, 2)}</pre> : null}
        </aside>
      ) : null}
    </section>
  );
}
