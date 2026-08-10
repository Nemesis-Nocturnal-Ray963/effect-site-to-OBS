import React from "react";
import type { EventHistoryEntry, EventPlatform, EventSource, NormalizedEventType } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { clearEventHistory, fetchEventHistory, replayEvent } from "../services/httpApi";
import { summarizeEvent } from "../services/eventSummary";
import { useConnectionStore } from "../stores/connectionStore";

const sources: Array<"all" | EventSource> = ["all", "external-http", "control-ui", "test", "tiktok-direct", "unknown"];
const platforms: Array<"all" | EventPlatform> = ["all", "tiktok", "youtube", "twitch", "local", "external"];
const types: Array<"all" | NormalizedEventType> = [
  "all",
  "comment",
  "follow",
  "gift",
  "gift-streak-end",
  "like-batch",
  "member-join",
  "share",
  "custom"
];

const columns = ["Received", "Source", "Platform", "Type", "User", "Summary", "Duplicate", "Result", "Latency"];

interface Filters {
  source: "all" | EventSource;
  platform: "all" | EventPlatform;
  type: "all" | NormalizedEventType;
  duplicate: "all" | "yes" | "no";
  effect: "all" | "yes" | "no";
  errors: "all" | "yes" | "no";
  query: string;
}

const defaultFilters: Filters = {
  source: "all",
  platform: "all",
  type: "all",
  duplicate: "all",
  effect: "all",
  errors: "all",
  query: ""
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString();
}

function matchesFilter(entry: EventHistoryEntry, filters: Filters): boolean {
  const text = filters.query.trim().toLowerCase();
  const hasEffect = entry.result.triggeredEffects.length > 0;
  const hasErrors = entry.result.errors.length > 0;

  if (filters.source !== "all" && entry.event.source !== filters.source) return false;
  if (filters.platform !== "all" && entry.event.platform !== filters.platform) return false;
  if (filters.type !== "all" && entry.event.type !== filters.type) return false;
  if (filters.duplicate !== "all" && entry.result.duplicate !== (filters.duplicate === "yes")) return false;
  if (filters.effect !== "all" && hasEffect !== (filters.effect === "yes")) return false;
  if (filters.errors !== "all" && hasErrors !== (filters.errors === "yes")) return false;

  if (!text) return true;
  return [
    entry.event.eventId,
    entry.event.user?.displayName,
    entry.event.user?.uniqueId,
    summarizeEvent(entry.event),
    JSON.stringify(entry.event.data)
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(text));
}

function JsonBlock({ value }: { value: unknown }): React.ReactElement {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function EventMonitorPage(): React.ReactElement {
  const { t } = useI18n();
  const events = useConnectionStore((state) => state.receivedEvents);
  const paused = useConnectionStore((state) => state.paused);
  const setPaused = useConnectionStore((state) => state.setPaused);
  const clearEventsView = useConnectionStore((state) => state.clearEventsView);
  const hydrateEvents = useConnectionStore((state) => state.hydrateEvents);
  const [filters, setFilters] = React.useState<Filters>(defaultFilters);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState("Summary");
  const [status, setStatus] = React.useState<string>("");

  React.useEffect(() => {
    void fetchEventHistory()
      .then((data) => hydrateEvents(data.events))
      .catch(() => setStatus(t("Could not load event history")));
  }, [hydrateEvents, t]);

  const filteredEvents = React.useMemo(() => events.filter((entry) => matchesFilter(entry, filters)), [events, filters]);
  const selected = selectedId ? events.find((entry) => entry.event.eventId === selectedId) ?? null : null;

  async function handleClear(): Promise<void> {
    clearEventsView();
    setSelectedId(null);
    await clearEventHistory();
  }

  async function handleReplay(entry: EventHistoryEntry): Promise<void> {
    setStatus(t("Replaying event..."));
    try {
      await replayEvent(entry.event.eventId);
      setStatus(t("Replay accepted"));
    } catch {
      setStatus(t("Replay failed"));
    }
  }

  async function copyJson(value: unknown): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setStatus(t("JSON copied"));
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Events")}</p>
        <h2>{t("Event Monitor")}</h2>
      </div>

      <div className="panel monitor-toolbar">
        <label>
          {t("Source")}
          <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value as Filters["source"] })}>
            {sources.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Platform")}
          <select
            value={filters.platform}
            onChange={(event) => setFilters({ ...filters, platform: event.target.value as Filters["platform"] })}
          >
            {platforms.map((platform) => (
              <option key={platform}>{platform}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Type")}
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as Filters["type"] })}>
            {types.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Search")}
          <input
            value={filters.query}
            placeholder={t("user, eventId, content")}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <label>
          {t("Duplicate")}
          <select
            value={filters.duplicate}
            onChange={(event) => setFilters({ ...filters, duplicate: event.target.value as Filters["duplicate"] })}
          >
            <option value="all">all</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label>
          {t("Effect")}
          <select value={filters.effect} onChange={(event) => setFilters({ ...filters, effect: event.target.value as Filters["effect"] })}>
            <option value="all">all</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label>
          {t("Errors")}
          <select value={filters.errors} onChange={(event) => setFilters({ ...filters, errors: event.target.value as Filters["errors"] })}>
            <option value="all">all</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={() => setPaused(!paused)}>
            {paused ? t("Resume") : t("Pause")}
          </button>
          <button type="button" onClick={() => void handleClear()}>
            {t("Clear")}
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-meta">
          <span>{filteredEvents.length} {t("shown")}</span>
          <span>{status}</span>
        </div>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                    <th key={column}>{t(column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>{t("No events in the current view.")}</td>
              </tr>
            ) : (
              filteredEvents.map((entry) => (
                <tr key={`${entry.event.eventId}-${entry.createdAt}`} onClick={() => setSelectedId(entry.event.eventId)}>
                  <td>{formatTime(entry.processing.receivedAt)}</td>
                  <td>{entry.event.source}</td>
                  <td>{entry.event.platform}</td>
                  <td>{entry.event.type}</td>
                  <td>{entry.event.user?.displayName ?? "-"}</td>
                  <td>{summarizeEvent(entry.event)}</td>
                  <td>{entry.result.duplicate ? t("Yes") : t("No")}</td>
                  <td>{entry.result.triggeredEffects.length > 0 ? entry.result.triggeredEffects.join(", ") : "-"}</td>
                  <td>{entry.processing.latencyMs ?? "-"}ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <aside className="detail-drawer" aria-label={t("Event detail")}>
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{t("Event Detail")}</p>
              <h3>{selected.event.eventId}</h3>
            </div>
            <button type="button" onClick={() => setSelectedId(null)}>
              {t("Close")}
            </button>
          </div>
          <div className="tab-row">
            {["Summary", "Normalized JSON", "Raw Metadata", "Processing", "Actions", "Errors"].map((tab) => (
              <button key={tab} type="button" className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
                {t(tab)}
              </button>
            ))}
          </div>
          {activeTab === "Summary" ? (
            <dl className="detail-list">
              <dt>source</dt>
              <dd>{selected.event.source}</dd>
              <dt>platform</dt>
              <dd>{selected.event.platform}</dd>
              <dt>type</dt>
              <dd>{selected.event.type}</dd>
              <dt>timestamp</dt>
              <dd>{selected.event.timestamp}</dd>
              <dt>receivedAt</dt>
              <dd>{selected.event.receivedAt}</dd>
              <dt>user</dt>
              <dd>{selected.event.user?.displayName ?? "-"}</dd>
              <dt>room</dt>
              <dd>{selected.event.room?.uniqueId ?? selected.event.room?.id ?? "-"}</dd>
              <dt>summary</dt>
              <dd>{summarizeEvent(selected.event)}</dd>
            </dl>
          ) : null}
          {activeTab === "Normalized JSON" ? (
            <>
              <button type="button" onClick={() => void copyJson(selected.event)}>
                {t("Copy JSON")}
              </button>
              <JsonBlock value={selected.event} />
            </>
          ) : null}
          {activeTab === "Raw Metadata" ? <JsonBlock value={selected.event.metadata ?? {}} /> : null}
          {activeTab === "Processing" ? <JsonBlock value={selected.processing} /> : null}
          {activeTab === "Actions" ? (
            <div className="drawer-actions">
              <JsonBlock value={{ matchedActions: selected.result.matchedActions, triggeredEffects: selected.result.triggeredEffects }} />
              <button type="button" onClick={() => void handleReplay(selected)}>
                {t("Replay Event")}
              </button>
            </div>
          ) : null}
          {activeTab === "Errors" ? <JsonBlock value={selected.result.errors} /> : null}
        </aside>
      ) : null}
    </section>
  );
}
