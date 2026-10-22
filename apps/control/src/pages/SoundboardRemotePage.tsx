import React from "react";
import type { SoundboardBoard, SoundboardPad } from "@obs-effect/shared-types";
import { SoundboardPadGrid } from "../components/SoundboardPadGrid";
import { fetchRemoteSoundboard, playSoundboardPad, stopSoundboard } from "../services/httpApi";

export function SoundboardRemotePage(): React.ReactElement {
  const token = React.useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const [board, setBoard] = React.useState<SoundboardBoard | null>(null);
  const [activePadId, setActivePadId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("接続中...");

  const refresh = React.useCallback(() => {
    if (!token) {
      setStatus("接続用トークンがありません。PCのポン出し画面からURLを開いてください。");
      return;
    }
    void fetchRemoteSoundboard(token)
      .then((next) => { setBoard(next); setStatus("接続済み"); })
      .catch(() => setStatus("接続できません。PCと同じWi-Fiか確認してください。"));
  }, [token]);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function play(pad: SoundboardPad): Promise<void> {
    setActivePadId(pad.id);
    try {
      const result = await playSoundboardPad(pad.id, token);
      if (!pad.audioAssetId) {
        setStatus(`実行：${pad.label}（音声未設定）`);
      } else if (!result.audio) {
        setStatus(`音声が見つかりません：${pad.label}`);
      } else {
        setStatus(`実行：${pad.label}`);
      }
    } catch {
      setStatus("実行に失敗しました。");
    } finally {
      window.setTimeout(() => setActivePadId(null), 220);
    }
  }

  return (
    <main className="soundboard-remote">
      <header>
        <div><small>ポン出し</small><h1>{board?.name ?? "演出コントローラー"}</h1></div>
        <span className={board ? "connected" : ""}>{status}</span>
      </header>
      {board ? <SoundboardPadGrid activePadId={activePadId} board={board} onPress={(pad) => void play(pad)} /> : <p>{status}</p>}
      <button className="soundboard-stop-all" type="button" disabled={!board} onClick={() => void stopSoundboard(token).then(() => setStatus("すべて停止しました"))}>
        すべて停止
      </button>
    </main>
  );
}
