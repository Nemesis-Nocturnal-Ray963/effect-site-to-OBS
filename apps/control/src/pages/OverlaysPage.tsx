import React from "react";
import { Link } from "react-router-dom";
import type { OverlayId, OverlayStatus } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { fetchOverlays, fetchSystemVersion, reloadAllOverlays, reloadOverlay, testOverlayFlash, updateOverlayConfig, type SystemVersionInfo } from "../services/httpApi";
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
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("Effects")}</p>
          <h2>{t("Overlay Management")}</h2>
          {version ? (
            <p className="empty-text">
              Build {version.buildVersion} / Server {new Date(version.serverStartedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => void requestReloadAll()}>
          {t("Reload all overlays")}
        </button>
      </div>

      <div className="table-meta">
        <span>
          {overlays.filter((overlay) => overlay.isInUse).length} / 10 {t("in use")}
        </span>
        <span>{message}</span>
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

            <dl className="detail-list">
              <dt>URL</dt>
              <dd>{overlay.url}</dd>
              <dt>{t("clients")}</dt>
              <dd>{overlay.connectedClients}</dd>
              <dt>{t("resolution")}</dt>
              <dd>
                {overlay.width} x {overlay.height}
              </dd>
              <dt>fps</dt>
              <dd>{overlay.fps}</dd>
              <dt>{t("last connected")}</dt>
              <dd>{overlay.lastConnectedAt ? new Date(overlay.lastConnectedAt).toLocaleTimeString() : "-"}</dd>
              <dt>{t("last disconnected")}</dt>
              <dd>{overlay.lastDisconnectedAt ? new Date(overlay.lastDisconnectedAt).toLocaleTimeString() : "-"}</dd>
            </dl>

            <div className="button-row">
              <button type="button" onClick={() => void saveOverlay(overlay, { width: 1920, height: 1080, fps: 60 })}>
                16:9
              </button>
              <button type="button" onClick={() => void saveOverlay(overlay, { width: 1080, height: 1920, fps: 60 })}>
                9:16
              </button>
              <button type="button" onClick={() => void copyUrl(overlay.url)}>
                {t("Copy URL")}
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
            <p className="empty-text">
              {t("OBS browser source note")} {overlay.width} x {overlay.height}, FPS {overlay.fps}.
            </p>
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
