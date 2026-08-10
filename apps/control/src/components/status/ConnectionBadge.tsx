import React from "react";
import type { TikTokConnectionState } from "@obs-effect/shared-types";
import type { SocketState } from "../../stores/connectionStore";

type BadgeState = SocketState | TikTokConnectionState | "connected" | "disconnected" | "error" | "planned";

interface ConnectionBadgeProps {
  label: string;
  state: BadgeState;
  detail?: string;
}

const labels: Record<BadgeState, string> = {
  idle: "idle",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
  disconnected: "disconnected",
  "stream-offline": "stream offline",
  "authentication-required": "auth required",
  "rate-limited": "rate limited",
  error: "error",
  planned: "planned"
};

export function ConnectionBadge({ label, state, detail }: ConnectionBadgeProps): React.ReactElement {
  return (
    <div className={`connection-badge ${state}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="badge-label">{label}</span>
      <strong>{detail ?? labels[state]}</strong>
    </div>
  );
}
