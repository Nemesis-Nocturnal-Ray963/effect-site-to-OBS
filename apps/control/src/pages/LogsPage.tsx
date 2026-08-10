import React from "react";
import type { UiLogEntry } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { clearLogs, fetchLogs } from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";

const levels: Array<"all" | UiLogEntry["level"]> = ["all", "info", "warn", "error"];
const sources: Array<"all" | UiLogEntry["source"]> = ["all", "http", "event", "effect", "server"];

export function LogsPage(): React.ReactElement {
  const { t } = useI18n();
  const logs = useConnectionStore((state) => state.logs);
  const hydrateLogs = useConnectionStore((state) => state.hydrateLogs);
  const clearLogsView = useConnectionStore((state) => state.clearLogsView);
  const [level, setLevel] = React.useState<(typeof levels)[number]>("all");
  const [source, setSource] = React.useState<(typeof sources)[number]>("all");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<UiLogEntry | null>(null);

  React.useEffect(() => {
    void fetchLogs()
      .then(hydrateLogs)
      .catch(() => hydrateLogs([]));
  }, [hydrateLogs]);

  const filteredLogs = React.useMemo(
    () =>
      logs.filter((entry) => {
        if (level !== "all" && entry.level !== level) return false;
        if (source !== "all" && entry.source !== source) return false;
        if (!query.trim()) return true;
        return `${entry.message} ${JSON.stringify(entry.detail ?? {})}`.toLowerCase().includes(query.trim().toLowerCase());
      }),
    [logs, level, source, query]
  );

  async function handleClear(): Promise<void> {
    clearLogsView();
    setSelected(null);
    await clearLogs();
  }

  async function copyLog(entry: UiLogEntry): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("System")}</p>
        <h2>{t("Logs")}</h2>
      </div>

      <div className="panel monitor-toolbar compact">
        <label>
          {t("Level")}
          <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
            {levels.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Source")}
          <select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
            {sources.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Search")}
          <input value={query} placeholder={t("message text")} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void handleClear()}>
            {t("Clear")}
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>{t("Time")}</th>
              <th>{t("Level")}</th>
              <th>{t("Source")}</th>
              <th>{t("Message")}</th>
              <th>{t("Copy")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5}>{t("No logs in the current view.")}</td>
              </tr>
            ) : (
              filteredLogs.map((entry) => (
                <tr key={entry.id} onClick={() => setSelected(entry)}>
                  <td>{new Date(entry.timestamp).toLocaleTimeString()}</td>
                  <td>
                    <span className={`level-pill ${entry.level}`}>{entry.level}</span>
                  </td>
                  <td>{entry.source}</td>
                  <td>{entry.message}</td>
                  <td>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyLog(entry);
                      }}
                    >
                      {t("Copy")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <aside className="detail-drawer" aria-label="Log detail">
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{selected.level}</p>
              <h3>{selected.source}</h3>
            </div>
          <button type="button" onClick={() => setSelected(null)}>
              {t("Close")}
            </button>
          </div>
          <p>{selected.message}</p>
          <pre className="json-block">{JSON.stringify(selected, null, 2)}</pre>
        </aside>
      ) : null}
    </section>
  );
}
