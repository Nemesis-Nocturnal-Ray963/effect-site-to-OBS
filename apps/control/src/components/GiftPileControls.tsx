import React from "react";
import type { OverlayId } from "@obs-effect/shared-types";

export function GiftPileControls({ overlayId }: { overlayId: OverlayId }): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  async function clear(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/overlays/${overlayId}/gift-pile`, { method: "DELETE" });
      if (!response.ok) throw new Error("clear failed");
      setMessage(`Overlay ${overlayId} に全消去を送信しました`);
    } catch {
      setMessage("全消去に失敗しました。サーバー接続を確認してください。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gift-pile-controls">
      <p className="empty-text">
        ギフト1個につき1物体。初期44px・上限1,000個。上限では古い順に入れ替えます。残り15分以下の物体は、新しいギフト受信時に寿命が15分延びます。再読み込みで全消去します。
      </p>
      <button type="button" disabled={busy} onClick={() => void clear()}>
        蓄積ギフトを全消去（Overlay {overlayId}）
      </button>
      <span role="status">{message}</span>
    </div>
  );
}
