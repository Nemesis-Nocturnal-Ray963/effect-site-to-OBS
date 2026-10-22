import React from "react";
import QRCode from "qrcode";
import type { AssetCatalogItem, OverlayId, SoundboardBoard, SoundboardPad } from "@obs-effect/shared-types";
import { SoundboardPadGrid } from "../components/SoundboardPadGrid";
import {
  fetchAssets,
  fetchSoundboard,
  playSoundboardPad,
  saveSoundboard,
  stopSoundboard
} from "../services/httpApi";

export function SoundboardPage(): React.ReactElement {
  const [board, setBoard] = React.useState<SoundboardBoard | null>(null);
  const [assets, setAssets] = React.useState<AssetCatalogItem[]>([]);
  const [token, setToken] = React.useState("");
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [selectedPadId, setSelectedPadId] = React.useState<string | null>(null);
  const [activePadId, setActivePadId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("読み込み中...");
  const [saving, setSaving] = React.useState(false);
  const [qrCodeUrl, setQrCodeUrl] = React.useState("");
  const savedBoardSignature = React.useRef("");

  const boardSignature = React.useMemo(() => board ? JSON.stringify({
    id: board.id,
    name: board.name,
    columns: board.columns,
    pads: board.pads
  }) : "", [board]);

  React.useEffect(() => {
    void Promise.all([fetchSoundboard(), fetchAssets()])
      .then(([config, nextAssets]) => {
        savedBoardSignature.current = JSON.stringify({
          id: config.board.id,
          name: config.board.name,
          columns: config.board.columns,
          pads: config.board.pads
        });
        setBoard(config.board);
        setToken(config.accessToken);
        setRemoteUrl(config.remoteUrl);
        setSelectedPadId(config.board.pads[0]?.id ?? null);
        setAssets(nextAssets);
        setMessage("");
      })
      .catch(() => setMessage("ポン出し設定を読み込めませんでした。"));
  }, []);

  React.useEffect(() => {
    if (!remoteUrl) return;
    void QRCode.toDataURL(remoteUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: { dark: "#111827", light: "#ffffff" }
    }).then(setQrCodeUrl).catch(() => setQrCodeUrl(""));
  }, [remoteUrl]);

  React.useEffect(() => {
    if (!board || !boardSignature || boardSignature === savedBoardSignature.current) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      setMessage("自動保存中...");
      void saveSoundboard(board)
        .then((saved) => {
          savedBoardSignature.current = JSON.stringify({ id: saved.id, name: saved.name, columns: saved.columns, pads: saved.pads });
          setBoard(saved);
          setMessage("自動保存しました。スマホ画面にも反映されます。");
        })
        .catch(() => setMessage("自動保存に失敗しました。"))
        .finally(() => setSaving(false));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [board, boardSignature]);

  const selectedPad = board?.pads.find((pad) => pad.id === selectedPadId) ?? null;
  const visualAssets = assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
  const audioAssets = assets.filter((asset) => asset.kind === "audio");

  function updateBoard(patch: Partial<SoundboardBoard>): void {
    setBoard((current) => current ? { ...current, ...patch } : current);
  }

  function updatePad(patch: Partial<SoundboardPad>): void {
    if (!selectedPadId) return;
    setBoard((current) => current ? {
      ...current,
      pads: current.pads.map((pad) => pad.id === selectedPadId ? { ...pad, ...patch } : pad)
    } : current);
  }

  function addPad(): void {
    if (!board) return;
    const pad: SoundboardPad = {
      id: globalThis.crypto?.randomUUID?.() ?? `pad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      label: `ボタン ${board.pads.length + 1}`,
      color: "#2563eb",
      enabled: true,
      targetOverlayId: 1,
      durationMs: 5000,
      audioVolume: 0.8,
      retriggerMode: "restart"
    };
    updateBoard({ pads: [...board.pads, pad] });
    setSelectedPadId(pad.id);
  }

  function deletePad(): void {
    if (!board || !selectedPadId) return;
    const pads = board.pads.filter((pad) => pad.id !== selectedPadId);
    updateBoard({ pads });
    setSelectedPadId(pads[0]?.id ?? null);
  }

  async function save(): Promise<void> {
    if (!board) return;
    setSaving(true);
    setMessage("保存中...");
    try {
      const saved = await saveSoundboard(board);
      savedBoardSignature.current = JSON.stringify({ id: saved.id, name: saved.name, columns: saved.columns, pads: saved.pads });
      setBoard(saved);
      setMessage("保存しました。スマホ画面にも反映されます。");
    } catch {
      setMessage("保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function play(pad: SoundboardPad): Promise<void> {
    setActivePadId(pad.id);
    try {
      let padToPlay = pad;
      if (board && boardSignature !== savedBoardSignature.current) {
        const saved = await saveSoundboard(board);
        savedBoardSignature.current = JSON.stringify({ id: saved.id, name: saved.name, columns: saved.columns, pads: saved.pads });
        setBoard(saved);
        padToPlay = saved.pads.find((item) => item.id === pad.id) ?? pad;
      }
      const result = await playSoundboardPad(padToPlay.id, token);
      const outputs = [result.visual ? "映像" : "", result.audio ? "音声" : ""].filter(Boolean).join("・");
      if (!padToPlay.audioAssetId) {
        setMessage(`「${padToPlay.label}」を実行しました（音声は未設定です）。`);
      } else if (!result.audio) {
        setMessage(`「${padToPlay.label}」の音声アセットが見つかりません。再選択してください。`);
      } else {
        setMessage(`「${padToPlay.label}」を実行しました${outputs ? `（${outputs}）` : ""}。`);
      }
    } catch {
      setMessage("実行または保存に失敗しました。");
    } finally {
      window.setTimeout(() => setActivePadId(null), 220);
    }
  }

  async function stopAll(): Promise<void> {
    await stopSoundboard(token);
    setMessage("すべて停止しました。");
  }

  if (!board) return <section className="page-stack"><p>{message}</p></section>;

  return (
    <section className="page-stack">
      <div className="page-heading soundboard-heading">
        <div>
          <p className="eyebrow">Effects</p>
          <h2>ポン出し</h2>
          <p className="empty-text">スマホの1ボタンから、Overlay映像とPC音声を同時に実行します。</p>
        </div>
        <div className="button-row soundboard-heading-actions">
          <button type="button" onClick={() => void stopAll()}>すべて停止</button>
          <button type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>

      <div className="soundboard-layout">
        <section className="panel soundboard-board-editor">
          <div className="soundboard-section-header">
            <label>
              ボード名
              <input value={board.name} onChange={(event) => updateBoard({ name: event.target.value })} />
            </label>
            <label>
              列数
              <select value={board.columns} onChange={(event) => updateBoard({ columns: Number(event.target.value) })}>
                {[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}列</option>)}
              </select>
            </label>
          </div>

          <SoundboardPadGrid
            activePadId={activePadId}
            board={board}
            onPress={(pad) => {
              setSelectedPadId(pad.id);
              void play(pad);
            }}
            selectedPadId={selectedPadId}
          />
          <button type="button" onClick={addPad}>ボタンを追加</button>
        </section>

        <aside className="panel soundboard-pad-editor">
          {selectedPad ? (
            <>
              <div className="soundboard-section-header">
                <h3>ボタン設定</h3>
                <button type="button" onClick={deletePad}>削除</button>
              </div>
              <label>表示名<input value={selectedPad.label} onChange={(event) => updatePad({ label: event.target.value })} /></label>
              <label>色<input type="color" value={selectedPad.color} onChange={(event) => updatePad({ color: event.target.value })} /></label>
              <label className="checkbox-row"><input type="checkbox" checked={selectedPad.enabled} onChange={(event) => updatePad({ enabled: event.target.checked })} />有効</label>
              <label>
                映像・画像
                <select value={selectedPad.visualAssetId ?? ""} onChange={(event) => updatePad({ visualAssetId: event.target.value || undefined })}>
                  <option value="">なし</option>
                  {visualAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.kind})</option>)}
                </select>
              </label>
              <label>
                音声
                <select value={selectedPad.audioAssetId ?? ""} onChange={(event) => updatePad({ audioAssetId: event.target.value || undefined })}>
                  <option value="">なし</option>
                  {audioAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
              </label>
              <label>
                対象Overlay
                <select value={selectedPad.targetOverlayId} onChange={(event) => updatePad({ targetOverlayId: Number(event.target.value) as OverlayId })}>
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Overlay {value}</option>)}
                </select>
              </label>
              <label>表示時間（秒）<input type="number" min="0.1" max="3600" step="0.1" value={selectedPad.durationMs / 1000} onChange={(event) => updatePad({ durationMs: Math.max(100, Number(event.target.value) * 1000) })} /></label>
              <label>音量 {Math.round(selectedPad.audioVolume * 100)}%<input type="range" min="0" max="1" step="0.01" value={selectedPad.audioVolume} onChange={(event) => updatePad({ audioVolume: Number(event.target.value) })} /></label>
              <label>
                再実行
                <select value={selectedPad.retriggerMode} onChange={(event) => updatePad({ retriggerMode: event.target.value as SoundboardPad["retriggerMode"] })}>
                  <option value="restart">最初から再生</option>
                  <option value="overlap">重ねて再生</option>
                </select>
              </label>
            </>
          ) : <p className="empty-text">設定するボタンを選択してください。</p>}
        </aside>
      </div>

      <section className="panel soundboard-remote-panel">
        <div className="soundboard-remote-intro">
          <div>
            <p className="eyebrow">Smartphone</p>
            <h3>スマホ操作画面</h3>
            <p className="empty-text">PCと同じWi-Fiに接続し、スマホのカメラでQRコードを読み取ります。</p>
          </div>
          {qrCodeUrl ? (
            <div className="soundboard-qr-card">
              <img src={qrCodeUrl} alt="スマホ用ポン出し画面のQRコード" />
              <strong>スマホで読み取る</strong>
            </div>
          ) : null}
        </div>
        <div className="soundboard-url-row">
          <input readOnly value={remoteUrl} />
          <button type="button" onClick={() => void navigator.clipboard.writeText(remoteUrl).then(() => setMessage("スマホ用URLをコピーしました。"))}>URLをコピー</button>
          <button type="button" onClick={() => window.open(remoteUrl, "_blank", "noopener,noreferrer")}>プレビューを開く</button>
        </div>
        <div className="soundboard-phone-preview">
          <div className="soundboard-phone-screen">
            <h4>{board.name}</h4>
            <SoundboardPadGrid activePadId={activePadId} board={board} onPress={(pad) => void play(pad)} />
          </div>
        </div>
      </section>
      {message ? <p className="success-text">{message}</p> : null}
    </section>
  );
}
