import React from "react";
import { Link } from "react-router-dom";
import type { OverlayId, OverlayStatus } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { createOverlay, fetchOverlays, fetchSystemVersion, reloadAllOverlays, reloadOverlay, testOverlayFlash, updateOverlayConfig, type SystemVersionInfo } from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";

function overlayOptionLabel(overlay: OverlayStatus): string {
  return `Overlay ${overlay.overlayId} - ${overlay.isInUse ? "in use" : "unused"}`;
}

export function OverlaysPage(): React.ReactElement {
  const { t } = useI18n();
  const overlays = useConnectionStore((state) => state.overlays);
  const hydrateOverlays = useConnectionStore((state) => state.hydrateOverlays);
  const [message, setMessage] = React.useState("");
  const [version, setVersion] = React.useState<SystemVersionInfo | null>(null);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    void Promise.all([fetchOverlays(), fetchSystemVersion()])
      .then(([nextOverlays, nextVersion]) => {
        hydrateOverlays(nextOverlays);
        setVersion(nextVersion);
      })
      .catch(() => setMessage(t("Could not load overlays")));
  }, [hydrateOverlays, t]);

  async function copyUrl(url: string): Promise<void> {
    await navigator.clipboard.writeText(url);
    setMessage(t("URL copied"));
  }

  async function testFlash(overlayId: OverlayId): Promise<void> {
    await testOverlayFlash(overlayId, { color: "#ffffff", durationMs: 650 });
    setMessage(`${t("Flash sent to")} ${t("Overlay")} ${overlayId}`);
  }

  async function requestReload(overlayId: OverlayId): Promise<void> {
    await reloadOverlay(overlayId);
    setMessage(`${t("Reload requested")} ${t("Overlay")} ${overlayId}`);
  }

  async function requestReloadAll(): Promise<void> {
    await reloadAllOverlays();
    setMessage(t("Reload requested for all overlays"));
  }

  async function addOverlay(): Promise<void> {
    setAdding(true);
    try {
      const created = await createOverlay();
      hydrateOverlays(await fetchOverlays());
      setMessage(`${t("Overlay added")}: ${t("Overlay")} ${created.overlayId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not add overlay"));
    } finally {
      setAdding(false);
    }
  }

  async function saveOverlay(
    overlay: OverlayStatus,
    patch: Partial<Pick<OverlayStatus, "name" | "width" | "height" | "fps">>
  ): Promise<void> {
    await updateOverlayConfig(overlay.overlayId, patch);
    const next = await fetchOverlays();
    hydrateOverlays(next);
    setMessage(`${t("Overlay")} ${overlay.overlayId} ${t("Saved")}`);
  }

  return (
    <section className="page-stack">
      <div className="page-heading overlay-page-heading">
        <div>
          <p className="eyebrow">{t("Effects")}</p>
          <h2>{t("Overlay Management")}</h2>
          {version ? (
            <p className="empty-text">
              Build {version.buildVersion} / Server {new Date(version.serverStartedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="overlay-heading-actions">
          <button type="button" className="primary-button" disabled={adding || overlays.length >= 64} onClick={() => void addOverlay()}>
            {adding ? t("Adding...") : t("+ Add overlay")}
          </button>
          <button type="button" onClick={() => void requestReloadAll()}>{t("Reload all overlays")}</button>
        </div>
      </div>

      <section className="overlay-summary-grid">
        <div className="overlay-summary-card"><span>{t("Registered")}</span><strong>{overlays.length}</strong></div>
        <div className="overlay-summary-card active"><span>{t("In use")}</span><strong>{overlays.filter((overlay) => overlay.isInUse).length}</strong></div>
        <div className="overlay-summary-card"><span>{t("Connected clients")}</span><strong>{overlays.reduce((sum, overlay) => sum + overlay.connectedClients, 0)}</strong></div>
      </section>

      <aside className="overlay-performance-note">
        <strong>{t("Performance note")}</strong>
        <p>{t("Adding an overlay setting has almost no performance cost. CPU, GPU, and memory usage increase when the overlay is actually opened in OBS or a browser, especially at high resolution, high FPS, or with many simultaneous effects.")}</p>
      </aside>

      <div className="table-meta overlay-page-meta">
        <span>{t("Up to 64 overlays can be registered.")}</span>
        <span role="status">{message}</span>
      </div>

      <section className="overlay-grid">
        {overlays.map((overlay) => (
          <article className="panel overlay-card" key={overlay.overlayId}>
            <div className="overlay-card-header">
              <div>
                <p className="eyebrow">
                  {t("Overlay")} {overlay.overlayId}
                </p>
                <h3>{overlay.name}</h3>
              </div>
              <span className={`overlay-status ${overlay.isInUse ? "active" : ""}`}>
                {overlay.isInUse ? t("in use") : t("unused")}
              </span>
            </div>

            <div className="overlay-facts">
              <span><strong>{overlay.connectedClients}</strong>{t("clients")}</span>
              <span><strong>{overlay.width} × {overlay.height}</strong>{t("resolution")}</span>
              <span><strong>{overlay.fps}</strong>FPS</span>
            </div>

            <div className="overlay-url-row">
              <code title={overlay.url}>{overlay.url}</code>
              <button type="button" onClick={() => void copyUrl(overlay.url)}>{t("Copy URL")}</button>
            </div>

            <div className="button-row">
              <button type="button" onClick={() => void saveOverlay(overlay, { width: 1920, height: 1080, fps: 60 })}>
                16:9
              </button>
              <button type="button" onClick={() => void saveOverlay(overlay, { width: 1080, height: 1920, fps: 60 })}>
                9:16
              </button>
              <button type="button" onClick={() => void testFlash(overlay.overlayId)}>
                {t("Test Flash")}
              </button>
              <button type="button" onClick={() => void requestReload(overlay.overlayId)}>
                {t("Reload overlay")}
              </button>
              <Link className="text-link inline" to={`/overlays/${overlay.overlayId}/interact`}>
                {t("Interact")}
              </Link>
            </div>
            <details className="overlay-settings">
              <summary>{t("Display settings")}</summary>
              <div className="overlay-config-form">
              <label>
                {t("Name")}
                <input defaultValue={overlay.name} onBlur={(event) => void saveOverlay(overlay, { name: event.target.value })} />
              </label>
              <label>
                {t("Width")}
                <input
                  type="number"
                  min="320"
                  max="7680"
                  defaultValue={overlay.width}
                  onBlur={(event) => void saveOverlay(overlay, { width: Number(event.target.value) })}
                />
              </label>
              <label>
                {t("Height")}
                <input
                  type="number"
                  min="240"
                  max="4320"
                  defaultValue={overlay.height}
                  onBlur={(event) => void saveOverlay(overlay, { height: Number(event.target.value) })}
                />
              </label>
              <label>
                FPS
                <input
                  type="number"
                  min="1"
                  max="120"
                  defaultValue={overlay.fps}
                  onBlur={(event) => void saveOverlay(overlay, { fps: Number(event.target.value) })}
                />
              </label>
              </div>
              <p className="empty-text">{t("OBS browser source note")} {overlay.width} x {overlay.height}, FPS {overlay.fps}.</p>
              <p className="overlay-connection-history">
                {t("last connected")}: {overlay.lastConnectedAt ? new Date(overlay.lastConnectedAt).toLocaleTimeString() : "-"}
                <span> / </span>
                {t("last disconnected")}: {overlay.lastDisconnectedAt ? new Date(overlay.lastDisconnectedAt).toLocaleTimeString() : "-"}
              </p>
            </details>
          </article>
        ))}
      </section>

      {overlays.length === 0 ? <p className="empty-text">{t("No overlay status has been received yet.")}</p> : null}
    </section>
  );
}

export function overlaySelectOptions(overlays: OverlayStatus[]): Array<{ value: OverlayId; label: string }> {
  return overlays.map((overlay) => ({ value: overlay.overlayId, label: overlayOptionLabel(overlay) }));
}
