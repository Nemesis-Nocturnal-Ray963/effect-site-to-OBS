import React from "react";
import { ConnectionBadge } from "../components/status/ConnectionBadge";
import { useI18n } from "../i18n/I18nProvider";
import { fetchHttpApiConfig, type HttpApiConfig } from "../services/httpApi";
import { summarizeEvent } from "../services/eventSummary";
import { useConnectionStore } from "../stores/connectionStore";

function averageLatency(events: ReturnType<typeof useConnectionStore.getState>["receivedEvents"]): string {
  const latencies = events
    .map((entry) => entry.processing.latencyMs)
    .filter((latency): latency is number => typeof latency === "number");
  return latencies.length > 0
    ? `${Math.round(latencies.reduce((total, latency) => total + latency, 0) / latencies.length)}ms`
    : "-";
}

export function DashboardPage(): React.ReactElement {
  const { t } = useI18n();
  const socketState = useConnectionStore((state) => state.socketState);
  const status = useConnectionStore((state) => state.status);
  const tiktokStatus = useConnectionStore((state) => state.tiktokStatus);
  const events = useConnectionStore((state) => state.receivedEvents);
  const overlays = useConnectionStore((state) => state.overlays);
  const [httpApi, setHttpApi] = React.useState<HttpApiConfig | null>(null);

  React.useEffect(() => {
    void fetchHttpApiConfig()
      .then(setHttpApi)
      .catch(() => setHttpApi(null));
  }, []);

  return (
    <div className="page-stack">
      <section className="page-heading">
        <p className="eyebrow">{t("Dashboard")}</p>
        <h2>{t("Dashboard")}</h2>
      </section>

      <section className="metric-grid">
        <ConnectionBadge label={t("Server")} state={socketState} detail={socketState} />
        <ConnectionBadge
          label={t("Overlay")}
          state={(status?.overlayClients ?? 0) > 0 ? "connected" : "disconnected"}
          detail={`${status?.overlayClients ?? 0} ${t("clients")}`}
        />
        <ConnectionBadge
          label={t("Control")}
          state={(status?.controlClients ?? 0) > 0 ? "connected" : "disconnected"}
          detail={`${status?.controlClients ?? 0} ${t("clients")}`}
        />
        <ConnectionBadge label={t("TikTok")} state={tiktokStatus?.state ?? "idle"} detail={tiktokStatus?.uniqueId ?? t("not connected")} />
        <ConnectionBadge label="OBS" state="planned" />
        <ConnectionBadge label="HTTP API" state={httpApi?.enabled ? "connected" : "planned"} />
      </section>

      <section className="metric-grid">
        <div className="panel metric-card">
          <span>{t("Overlays in use")}</span>
          <strong>{overlays.filter((overlay) => overlay.isInUse).length} / 10</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Overlay clients")}</span>
          <strong>{overlays.reduce((total, overlay) => total + overlay.connectedClients, 0)}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Recent events")}</span>
          <strong>{events.length}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("HTTP received")}</span>
          <strong>{httpApi?.metrics.receivedCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("TikTok events")}</span>
          <strong>{tiktokStatus?.receivedCount ?? 0}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Duplicates")}</span>
          <strong>{events.filter((entry) => entry.result.duplicate).length}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Errors")}</span>
          <strong>{events.filter((entry) => entry.result.errors.length > 0).length}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Average latency")}</span>
          <strong>{averageLatency(events)}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("Last received")}</span>
          <strong>{events[0] ? new Date(events[0].processing.receivedAt).toLocaleTimeString() : "-"}</strong>
        </div>
        <div className="panel metric-card">
          <span>{t("TikTok last event")}</span>
          <strong>{tiktokStatus?.lastEventAt ? new Date(tiktokStatus.lastEventAt).toLocaleTimeString() : "-"}</strong>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h3>{t("Recent events")}</h3>
          {events.length === 0 ? (
            <p className="empty-text">{t("No events received yet.")}</p>
          ) : (
            <ul className="event-list">
              {events.slice(0, 5).map((entry) => (
                <li key={`${entry.event.eventId}-${entry.createdAt}`}>
                  <span>{entry.event.type}</span>
                  <strong>{summarizeEvent(entry.event)}</strong>
                  <small>{new Date(entry.processing.receivedAt).toLocaleTimeString()}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h3>{t("Active effects")}</h3>
          <p className="empty-text">{t("Phase 1 currently supports the Flash effect.")}</p>
        </div>
      </section>
    </div>
  );
}
