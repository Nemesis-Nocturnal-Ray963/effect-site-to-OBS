import React from "react";
import type { EventCatalogItem, EventCatalogSourceType } from "@obs-effect/shared-types";
import { createManualEventCatalogItem, fetchEventCatalog, updateEventCatalogItem } from "../services/httpApi";
import { useI18n } from "../i18n/I18nProvider";

const sourceOptions: Array<EventCatalogSourceType | "all"> = ["all", "tiktok", "http", "websocket", "internal", "manual", "timer", "plugin", "unknown"];

export function EventCatalogPage(): React.ReactElement {
  const { t } = useI18n();
  const [events, setEvents] = React.useState<EventCatalogItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [sourceType, setSourceType] = React.useState<EventCatalogSourceType | "all">("all");
  const [eventType, setEventType] = React.useState("");
  const [enabled, setEnabled] = React.useState<"all" | "enabled" | "disabled">("all");
  const [favorite, setFavorite] = React.useState<"all" | "favorite">("all");
  const [sort, setSort] = React.useState<"displayName" | "firstReceivedAt" | "lastReceivedAt" | "receivedCount" | "updatedAt" | "triggerAssignmentCount">("lastReceivedAt");
  const [order, setOrder] = React.useState<"asc" | "desc">("desc");
  const [message, setMessage] = React.useState("");
  const [manualOpen, setManualOpen] = React.useState(false);

  const selected = events.find((event) => event.id === selectedId) ?? null;
  const eventTypes = React.useMemo(() => [...new Set(events.map((event) => event.eventType))].sort((left, right) => left.localeCompare(right, "ja-JP")), [events]);

  const reload = React.useCallback(async (): Promise<void> => {
    const next = await fetchEventCatalog({ search, sourceType, eventType, enabled, favorite, sort, order, limit: 500 });
    setEvents(next);
    setSelectedId((current) => (current && next.some((event) => event.id === current) ? current : next[0]?.id ?? null));
  }, [enabled, eventType, favorite, order, search, sort, sourceType]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch(() => setMessage(t("Could not load event catalog")));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [reload, t]);

  async function patchSelected(patch: Parameters<typeof updateEventCatalogItem>[1]): Promise<void> {
    if (!selected) return;
    const updated = await updateEventCatalogItem(selected.id, patch);
    setEvents((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setMessage(t("Saved"));
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("Events")}</p>
          <h2>{t("Event Catalog")}</h2>
          <p className="empty-text">{t("Recognized events are grouped here separately from event history.")}</p>
        </div>
        <button type="button" onClick={() => setManualOpen((current) => !current)}>
          {manualOpen ? t("Close") : t("Add manual event")}
        </button>
      </div>

      {manualOpen ? (
        <ManualEventPanel
          onCreated={(item) => {
            setEvents((current) => [item, ...current.filter((event) => event.id !== item.id)]);
            setSelectedId(item.id);
            setManualOpen(false);
            setMessage(t("Manual event saved"));
          }}
        />
      ) : null}

      <section className="event-catalog-toolbar">
        <label>
          {t("Search")}
          <input value={search} placeholder={t("Search event name, ID, memo, tags")} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          {t("Source")}
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as EventCatalogSourceType | "all")}>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? t("All") : option}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Event type")}
          <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
            <option value="">{t("All")}</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Status")}
          <select value={enabled} onChange={(event) => setEnabled(event.target.value as "all" | "enabled" | "disabled")}>
            <option value="all">{t("All")}</option>
            <option value="enabled">{t("enabled")}</option>
            <option value="disabled">{t("disabled")}</option>
          </select>
        </label>
        <label>
          {t("Favorite")}
          <select value={favorite} onChange={(event) => setFavorite(event.target.value as "all" | "favorite")}>
            <option value="all">{t("All")}</option>
            <option value="favorite">{t("Favorites only")}</option>
          </select>
        </label>
        <label>
          {t("Sort by")}
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="lastReceivedAt">{t("Last received")}</option>
            <option value="receivedCount">{t("Received count")}</option>
            <option value="displayName">{t("Event name")}</option>
            <option value="updatedAt">{t("Updated")}</option>
            <option value="firstReceivedAt">{t("First received")}</option>
            <option value="triggerAssignmentCount">{t("Trigger assignments")}</option>
          </select>
        </label>
        <label>
          {t("Order")}
          <select value={order} onChange={(event) => setOrder(event.target.value as "asc" | "desc")}>
            <option value="desc">{t("Descending")}</option>
            <option value="asc">{t("Ascending")}</option>
          </select>
        </label>
      </section>

      <div className="table-meta">
        <span>
          {events.length} {t("events")}
        </span>
        <span>{message}</span>
      </div>

      <section className="event-catalog-layout">
        <div className="event-catalog-table-wrap">
          <table className="event-catalog-table">
            <thead>
              <tr>
                <th>{t("Event")}</th>
                <th>{t("Source")}</th>
                <th>{t("Type")}</th>
                <th>{t("External ID")}</th>
                <th>{t("Memo")}</th>
                <th>{t("Count")}</th>
                <th>{t("Last received")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr className={event.id === selectedId ? "selected" : ""} key={event.id} onClick={() => setSelectedId(event.id)}>
                  <td>
                    <span className="event-catalog-name">
                      {event.iconUrl ? <img src={event.iconUrl} alt="" /> : <span className="event-catalog-icon">{event.eventType.slice(0, 1).toUpperCase()}</span>}
                      <strong>{event.displayName}</strong>
                    </span>
                  </td>
                  <td>{event.sourceType}</td>
                  <td>{event.eventType}</td>
                  <td>{event.externalEventId}</td>
                  <td className="event-catalog-memo">{event.memo ?? ""}</td>
                  <td>{event.receivedCount}</td>
                  <td>{formatDate(event.lastReceivedAt)}</td>
                  <td>{event.isEnabled ? t("enabled") : t("disabled")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 ? <p className="empty-text">{t("No events match the current filters.")}</p> : null}
        </div>

        {selected ? (
          <aside className="event-catalog-detail">
            <div>
              <p className="eyebrow">{selected.sourceType} / {selected.eventType}</p>
              <h3>{selected.displayName}</h3>
              <p className="empty-text">{selected.externalEventId}</p>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => void patchSelected({ isFavorite: !selected.isFavorite })}>
                {selected.isFavorite ? t("Favorite") : t("Mark favorite")}
              </button>
              <button type="button" onClick={() => void patchSelected({ isEnabled: !selected.isEnabled })}>
                {selected.isEnabled ? t("Disable") : t("Enable")}
              </button>
            </div>
            <label>
              {t("Display name")}
              <input value={selected.displayName} onChange={(event) => void patchSelected({ displayName: event.target.value })} />
            </label>
            <label>
              {t("Memo")}
              <textarea value={selected.memo ?? ""} rows={6} onChange={(event) => void patchSelected({ memo: event.target.value })} />
            </label>
            <label>
              {t("Category")}
              <input value={selected.category ?? ""} onChange={(event) => void patchSelected({ category: event.target.value })} />
            </label>
            <label>
              {t("Tags")}
              <input value={selected.tags.join(", ")} onChange={(event) => void patchSelected({ tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
            </label>
            <dl className="detail-list">
              <dt>{t("Internal ID")}</dt>
              <dd>{selected.id}</dd>
              <dt>{t("First received")}</dt>
              <dd>{formatDate(selected.firstReceivedAt)}</dd>
              <dt>{t("Last received")}</dt>
              <dd>{formatDate(selected.lastReceivedAt)}</dd>
              <dt>{t("Received count")}</dt>
              <dd>{selected.receivedCount}</dd>
              <dt>{t("Trigger assignments")}</dt>
              <dd>{selected.triggerAssignmentCount}</dd>
            </dl>
            <h4>{t("Normalized sample")}</h4>
            <pre className="json-block">{JSON.stringify(selected.normalizedSamplePayload ?? {}, null, 2)}</pre>
            <h4>{t("Raw sample")}</h4>
            <pre className="json-block">{JSON.stringify(selected.rawSamplePayload ?? {}, null, 2)}</pre>
          </aside>
        ) : null}
      </section>
    </section>
  );
}

function ManualEventPanel(props: { onCreated: (item: EventCatalogItem) => void }): React.ReactElement {
  const { t } = useI18n();
  const [sourceType, setSourceType] = React.useState<EventCatalogSourceType>("manual");
  const [eventType, setEventType] = React.useState("custom_event");
  const [externalEventId, setExternalEventId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [message, setMessage] = React.useState("");

  async function submit(): Promise<void> {
    if (!eventType.trim() || !externalEventId.trim() || !displayName.trim()) {
      setMessage(t("Please fill required fields."));
      return;
    }
    const item = await createManualEventCatalogItem({ sourceType, eventType, externalEventId, displayName, memo });
    props.onCreated(item);
  }

  return (
    <section className="action-panel manual-event-panel">
      <div>
        <h3>{t("Manual event")}</h3>
        <p className="empty-text">{t("Create an event before it is received from an external source.")}</p>
      </div>
      <div className="form-grid">
        <label>
          {t("Source")}
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as EventCatalogSourceType)}>
            {sourceOptions.filter((option) => option !== "all").map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Event type")}
          <input value={eventType} onChange={(event) => setEventType(event.target.value)} />
        </label>
        <label>
          {t("External ID")}
          <input value={externalEventId} onChange={(event) => setExternalEventId(event.target.value)} />
        </label>
        <label>
          {t("Display name")}
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="wide-field">
          {t("Memo")}
          <textarea value={memo} rows={3} onChange={(event) => setMemo(event.target.value)} />
        </label>
      </div>
      <div className="button-row">
        <span className="empty-text">{message}</span>
        <button type="button" onClick={() => void submit()}>
          {t("Save")}
        </button>
      </div>
    </section>
  );
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}
