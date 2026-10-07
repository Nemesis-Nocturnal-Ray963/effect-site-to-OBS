import React from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { useConnectionStore } from "../../stores/connectionStore";
import { ConnectionBadge } from "../status/ConnectionBadge";
import { useTimestampMonitoring } from "../../features/timestamps/TimestampMonitoringProvider";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps): React.ReactElement {
  const { t } = useI18n();
  const socketState = useConnectionStore((state) => state.socketState);
  const status = useConnectionStore((state) => state.status);
  const { detectMicrophones, isDetecting } = useTimestampMonitoring();

  return (
    <header className="app-header">
      <button className="icon-button menu-button" type="button" onClick={onMenuClick} aria-label="Menu">
        <span />
        <span />
        <span />
      </button>
      <div>
        <p className="eyebrow">{t("app.eyebrow")}</p>
        <h1>{t("app.title")}</h1>
      </div>
      <div className="header-status">
        <button className="header-microphone-button" type="button" onClick={() => void detectMicrophones()} disabled={isDetecting}>
          {isDetecting ? t("Detecting microphones...") : t("Detect microphones")}
        </button>
        <ConnectionBadge label={t("status.server")} state={socketState} detail={socketState} />
        <ConnectionBadge
          label={t("status.overlay")}
          state={(status?.overlayClients ?? 0) > 0 ? "connected" : "disconnected"}
          detail={`${status?.overlayClients ?? 0}`}
        />
        <ConnectionBadge
          label={t("status.control")}
          state={(status?.controlClients ?? 0) > 0 ? "connected" : "disconnected"}
          detail={`${status?.controlClients ?? 0}`}
        />
      </div>
    </header>
  );
}
