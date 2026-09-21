import React from "react";
import { createRoot } from "react-dom/client";
import type { EffectPlayMessage, RuntimeEffectObject, RuntimeOverlaySnapshot, ServerMessage } from "@obs-effect/shared-types";
import {
  activePairRenderCells,
  advanceActivePuyoFall,
  advanceActivePuyoVisuals,
  advanceBoardPuyoFalls,
  advancePuyoResolution,
  advancePuyoSpawnDelay,
  chooseCpuPuyoMove,
  createPuyoGame,
  dropTestOjamaPuyo,
  movePuyoPair,
  popPuyoAttack,
  queueOjamaPuyo,
  rotatePuyoPair,
  settlePuyoPair,
  type PuyoGameState,
  type PuyoPair
} from "./puyoEngine";
import { GiftPileLayer, type GiftPileHandle } from "./GiftPileLayer";
import defaultBallRevealUrl from "./assets/ball-reveal-default.png";
import "./styles.css";

const CURRENT_BUILD_VERSION = ((import.meta as ImportMeta & { env?: { VITE_BUILD_VERSION?: string } }).env?.VITE_BUILD_VERSION) ?? "dev";
const RELOAD_STORAGE_KEY = "obs-effect-overlay-reload-state";
const MAX_RELOADS_PER_MINUTE = 3;

interface Flash {
  id: string;
  color: string;
  durationMs: number;
}

interface SimpleMediaPlayback {
  id: string;
  message: EffectPlayMessage;
  durationMs: number;
}

interface BallRevealMedia {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
}

interface BallRevealPlayback {
  id: string;
  message: EffectPlayMessage;
}

interface FallingImageBody {
  object: RuntimeEffectObject;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  scale: number;
  rotation: number;
  rotationSpeed: number;
  readyAt: number;
  expiresAt: number | null;
  hidden: boolean;
}

interface OverlayFontInfo {
  family: string;
  source: "system" | "asset";
  contentUrl?: string;
}

function makeWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function getOverlayId(): number {
  const match = window.location.pathname.match(/^\/overlay\/(\d+)$/);
  const parsed = match ? Number(match[1]) : 1;
  return parsed >= 1 && parsed <= 10 ? parsed : 1;
}

function sendOverlayHello(socket: WebSocket | null, overlayId: number): void {
  sendSocketMessage(socket, {
    type: "overlay:hello",
    overlayId,
    currentBuildVersion: CURRENT_BUILD_VERSION,
    createdAt: new Date().toISOString()
  });
}

function sendSnapshotRequest(socket: WebSocket | null, overlayId: number): void {
  sendSocketMessage(socket, {
    type: "runtime:snapshot-request",
    overlayId,
    createdAt: new Date().toISOString()
  });
}

function sendSocketMessage(socket: WebSocket | null, message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function scheduleOverlayReload(newBuildVersion: string, reloadDelayMs: number, reason: string): void {
  if (!newBuildVersion || newBuildVersion === CURRENT_BUILD_VERSION) return;
  const state = readReloadState();
  const now = Date.now();
  const recent = state.reloadTimestamps.filter((timestamp) => now - timestamp < 60_000);
  if (state.lastReloadedBuildVersion === newBuildVersion || recent.length >= MAX_RELOADS_PER_MINUTE) {
    writeReloadState({ ...state, reloadTimestamps: recent, reloadFailureCount: state.reloadFailureCount + 1 });
    return;
  }
  writeReloadState({
    lastReloadedBuildVersion: newBuildVersion,
    lastReloadReason: reason,
    reloadTimestamps: [...recent, now],
    reloadFailureCount: state.reloadFailureCount
  });
  window.setTimeout(() => window.location.reload(), Math.max(0, reloadDelayMs));
}

function readReloadState(): {
  lastReloadedBuildVersion?: string;
  lastReloadReason?: string;
  reloadTimestamps: number[];
  reloadFailureCount: number;
} {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(RELOAD_STORAGE_KEY) ?? "{}") as {
      lastReloadedBuildVersion?: string;
      lastReloadReason?: string;
      reloadTimestamps?: number[];
      reloadFailureCount?: number;
    };
    return {
      lastReloadedBuildVersion: parsed.lastReloadedBuildVersion,
      lastReloadReason: parsed.lastReloadReason,
      reloadTimestamps: Array.isArray(parsed.reloadTimestamps) ? parsed.reloadTimestamps.filter((value) => typeof value === "number") : [],
      reloadFailureCount: typeof parsed.reloadFailureCount === "number" ? parsed.reloadFailureCount : 0
    };
  } catch {
    return { reloadTimestamps: [], reloadFailureCount: 0 };
  }
}

function writeReloadState(state: ReturnType<typeof readReloadState>): void {
  window.sessionStorage.setItem(RELOAD_STORAGE_KEY, JSON.stringify(state));
}

function RootApp(): React.ReactElement {
  if (window.location.pathname === "/game" || window.location.pathname === "/game/") {
    return <GameIndexPage />;
  }
  if (window.location.pathname === "/game/puyopuyo" || window.location.pathname === "/game/puyopuyo/") {
    return <PuyoPuyoGamePage />;
  }
  return <OverlayApp />;
}

type GamePresetRuleDraft = {
  id: string;
  triggerKind: string;
  eventType: string;
  giftName: string;
  fireCount: number;
  delayMs: number;
  actionType: string;
  target: string;
  amount: number;
};
type GamePresetDraft = {
  id: string;
  name: string;
  gameId: string;
  enabled: boolean;
  rules: GamePresetRuleDraft[];
  createdAt?: string;
  updatedAt?: string;
};
type TikfinityConnectionStatus = {
  source: "tikfinity";
  status: string;
  endpointUrl: string;
  lastEvent: {
    eventType: string;
    userName: string;
    giftName: string;
    giftCount: number;
    comment: string;
    receivedAt: string;
  } | null;
};
type GameIntegrationAction = {
  id: string;
  gameId: string;
  actionType: string;
  target: "player" | "cpu" | "both" | string;
  amount: number;
  source: string;
  presetId: string;
  ruleId: string;
  createdAt: string;
};
type GiftCatalogOption = {
  id: string;
  platformGiftId?: string;
  name: string;
  aliases?: string[];
  diamondValue?: number | null;
  coinValue?: number | null;
  image?: {
    primaryUrl?: string;
  };
};

function labelForGameRule(rule: GamePresetRuleDraft): string {
  if (rule.triggerKind === "gift_name") return rule.giftName ? `Gift: ${rule.giftName}` : "Selected Gift";
  if (rule.triggerKind === "follow") return "Follow";
  return "Any Gift";
}

function createDefaultGameRule(): GamePresetRuleDraft {
  return {
    id: `rule-${Date.now()}`,
    triggerKind: "any_gift",
    eventType: "gift",
    giftName: "",
    fireCount: 1,
    delayMs: 0,
    actionType: "drop_ojama",
    target: "player",
    amount: 6
  };
}

function GameGiftImage({ gift }: { gift: GiftCatalogOption }): React.ReactElement {
  return (
    <span className="game-gift-image">
      {gift.image?.primaryUrl ? <img src={gift.image.primaryUrl} alt="" loading="lazy" /> : <span>No image</span>}
    </span>
  );
}

function gameGiftCoinText(gift: GiftCatalogOption): string {
  const value = gift.coinValue ?? gift.diamondValue;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function GameIndexPage(): React.ReactElement {
  const [presetName, setPresetName] = React.useState("Puyo Gift Battle");
  const [selectedGameId, setSelectedGameId] = React.useState("puyopuyo");
  const [triggerKind, setTriggerKind] = React.useState("any_gift");
  const [giftName, setGiftName] = React.useState("");
  const [fireCount, setFireCount] = React.useState(1);
  const [delayMs, setDelayMs] = React.useState(0);
  const [actionType, setActionType] = React.useState("drop_ojama");
  const [target, setTarget] = React.useState("player");
  const [amount, setAmount] = React.useState(6);
  const [draftRules, setDraftRules] = React.useState<GamePresetRuleDraft[]>([]);
  const [presetDrafts, setPresetDrafts] = React.useState<GamePresetDraft[]>([]);
  const [giftOptions, setGiftOptions] = React.useState<GiftCatalogOption[]>([]);
  const [giftPickerOpen, setGiftPickerOpen] = React.useState(false);
  const [giftSearch, setGiftSearch] = React.useState("");
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);
  const [tikfinityStatus, setTikfinityStatus] = React.useState<TikfinityConnectionStatus | null>(null);
  const [message, setMessage] = React.useState("");
  const games = [
    {
      id: "puyopuyo",
      name: "Puyo Puyo",
      path: "/game/puyopuyo",
      status: "Playable prototype",
      description: "Canvas falling-puzzle game for OBS and browser test play."
    }
  ];
  const webhookUrl = tikfinityStatus?.endpointUrl ?? `${window.location.origin}/api/v1/game-integrations/tikfinity/webhook`;
  const selectedGift = giftName ? giftOptions.find((gift) => gift.name === giftName) ?? null : null;
  const filteredGifts = React.useMemo(() => {
    const query = giftSearch.trim().toLowerCase();
    return giftOptions.filter((gift) => {
      if (!query) return true;
      return [gift.name, gift.platformGiftId ?? "", ...(gift.aliases ?? [])].some((value) => value.toLowerCase().includes(query));
    });
  }, [giftOptions, giftSearch]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadTikfinityStatus(): Promise<void> {
      try {
        const response = await fetch("/api/v1/game-integrations/tikfinity");
        if (!response.ok) return;
        const data = (await response.json()) as TikfinityConnectionStatus;
        if (!cancelled) setTikfinityStatus(data);
      } catch {
        if (!cancelled) setTikfinityStatus(null);
      }
    }
    async function loadGamePresets(): Promise<void> {
      try {
        const response = await fetch("/api/v1/game-presets");
        if (!response.ok) return;
        const data = (await response.json()) as { presets?: GamePresetDraft[] };
        if (!cancelled) setPresetDrafts(Array.isArray(data.presets) ? data.presets : []);
      } catch {
        if (!cancelled) setPresetDrafts([]);
      }
    }
    async function loadGiftCatalog(): Promise<void> {
      try {
        const response = await fetch("/api/v1/gifts?sort=name&order=asc&limit=200");
        if (!response.ok) return;
        const data = (await response.json()) as { gifts?: GiftCatalogOption[] };
        if (!cancelled) setGiftOptions(Array.isArray(data.gifts) ? data.gifts : []);
      } catch {
        if (!cancelled) setGiftOptions([]);
      }
    }
    void loadTikfinityStatus();
    void loadGamePresets();
    void loadGiftCatalog();
    const interval = window.setInterval(() => void loadTikfinityStatus(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  function addDefaultRule(): void {
    const nextRule = createDefaultGameRule();
    setDraftRules((current) => [...current, nextRule]);
    setEditingRuleId(null);
    resetRuleForm();
    setMessage("Rule added");
  }

  function updateRule(): void {
    const nextTriggerKind = triggerKind;
    if (nextTriggerKind === "gift_name" && !giftName) {
      setMessage("Select a gift first");
      return;
    }
    const nextRule = {
      id: editingRuleId ?? `rule-${Date.now()}`,
      triggerKind: nextTriggerKind,
      eventType: nextTriggerKind === "follow" ? "follow" : "gift",
      giftName: nextTriggerKind === "gift_name" ? giftName : "",
      fireCount: Math.max(1, Math.round(fireCount || 1)),
      delayMs: Math.max(0, Math.round(delayMs || 0)),
      actionType,
      target,
      amount: Math.max(1, Math.round(amount || 1))
    };
    setDraftRules((current) => (editingRuleId ? current.map((rule) => (rule.id === editingRuleId ? nextRule : rule)) : [...current, nextRule]));
    setMessage("Rule updated");
  }

  function editRule(rule: GamePresetRuleDraft): void {
    setEditingRuleId(rule.id);
    setTriggerKind(rule.triggerKind);
    setGiftName(rule.giftName);
    setFireCount(rule.fireCount);
    setDelayMs(rule.delayMs);
    setActionType(rule.actionType);
    setTarget(rule.target);
    setAmount(rule.amount);
    setMessage("Editing rule");
  }

  function openNewPresetEditor(): void {
    setEditingPresetId(null);
    setPresetName("Puyo Gift Battle");
    setSelectedGameId("puyopuyo");
    setDraftRules([]);
    resetRuleForm();
    setEditorOpen(true);
  }

  function openPresetEditor(preset: GamePresetDraft): void {
    setEditingPresetId(preset.id);
    setPresetName(preset.name);
    setSelectedGameId(preset.gameId);
    setDraftRules(preset.rules);
    resetRuleForm();
    setEditorOpen(true);
  }

  function closePresetEditor(): void {
    setEditorOpen(false);
    setEditingPresetId(null);
  }

  function resetRuleForm(): void {
    setEditingRuleId(null);
    setTriggerKind("any_gift");
    setGiftName("");
    setFireCount(1);
    setDelayMs(0);
    setActionType("drop_ojama");
    setTarget("player");
    setAmount(6);
  }

  async function createPresetDraft(): Promise<void> {
    const nextPreset = {
      id: editingPresetId ?? `game-preset-${Date.now()}`,
      name: presetName.trim() || "Untitled Game Preset",
      gameId: selectedGameId,
      enabled: true,
      rules: draftRules
    };
    const response = await fetch("/api/v1/game-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPreset)
    });
    if (!response.ok) {
      setMessage("Preset save failed");
      return;
    }
    const data = (await response.json()) as { preset?: GamePresetDraft };
    setPresetDrafts((current) => [data.preset ?? nextPreset, ...current.filter((preset) => preset.id !== nextPreset.id)]);
    setEditingPresetId(data.preset?.id ?? nextPreset.id);
    setMessage("Preset saved");
    setEditorOpen(false);
    setEditingRuleId(null);
  }

  async function sendTikfinityTest(): Promise<void> {
    const response = await fetch("/api/v1/game-integrations/tikfinity/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (!response.ok) {
      setMessage("TikFinity test failed");
      return;
    }
    const data = (await response.json()) as { event?: TikfinityConnectionStatus["lastEvent"] };
    setTikfinityStatus((current) => ({
      source: "tikfinity",
      status: "event-received",
      endpointUrl: webhookUrl,
      lastEvent: data.event ?? current?.lastEvent ?? null
    }));
    setMessage("TikFinity test event received");
  }

  return (
    <main className="game-hub">
      <header className="game-hub-header">
        <p>Games</p>
        <h1>Game Control Center</h1>
      </header>
      <div className="game-dashboard-grid">
        <section className="game-panel">
          <div className="game-panel-title">
            <p>TikFinity</p>
            <h2>Connection</h2>
          </div>
          <label>
            <span>Webhook URL</span>
            <input readOnly value={webhookUrl} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="game-status-row">
            <strong>{tikfinityStatus?.status === "event-received" ? "Event received" : "Waiting"}</strong>
            <button type="button" onClick={() => void sendTikfinityTest()}>
              Send Test Event
            </button>
          </div>
          <div className="game-last-event">
            <span>Last Event</span>
            {tikfinityStatus?.lastEvent ? (
              <code>{`${tikfinityStatus.lastEvent.eventType} / ${tikfinityStatus.lastEvent.userName || "-"} / ${tikfinityStatus.lastEvent.giftName || "-"}`}</code>
            ) : (
              <code>No event yet</code>
            )}
          </div>
        </section>

        <section className="game-panel">
          <div className="game-panel-title">
            <p>Library</p>
            <h2>Games</h2>
          </div>
          <div className="game-list">
            {games.map((game) => (
              <article className="game-list-item" key={game.id}>
                <div>
                  <p>{game.status}</p>
                  <h3>{game.name}</h3>
                  <span>{game.description}</span>
                </div>
                <a href={game.path} target="_blank" rel="noreferrer">
                  Open
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="game-panel game-panel-wide">
          <div className="game-panel-title">
            <p>Presets</p>
            <h2>Game Presets</h2>
          </div>
          <button type="button" onClick={openNewPresetEditor}>
            Create Preset
          </button>
          <div className="game-preset-list">
            {presetDrafts.length === 0 ? <p>No presets</p> : null}
            {presetDrafts.map((preset) => (
              <article key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>{`${preset.gameId} / ${preset.rules.length} rules`}</span>
                </div>
                <button type="button" onClick={() => openPresetEditor(preset)}>
                  Edit
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
      {editorOpen ? (
        <div className="game-editor-backdrop">
          <section className="game-editor-window">
            <header className="game-editor-header">
              <div>
                <p>Preset</p>
                <h2>{editingPresetId ? "Edit Preset" : "Create Preset"}</h2>
              </div>
              <button type="button" onClick={closePresetEditor}>
                Close
              </button>
            </header>
            <div className="game-editor-body">
              <section className="game-editor-section">
                <div className="game-panel-title">
                  <p>Basic</p>
                  <h3>Preset Settings</h3>
                </div>
                <label>
                  <span>Preset Name</span>
                  <input value={presetName} onChange={(event) => setPresetName(event.target.value)} />
                </label>
                <label>
                  <span>Game</span>
                  <select value={selectedGameId} onChange={(event) => setSelectedGameId(event.target.value)}>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="game-editor-section">
                <div className="game-panel-title">
                  <p>Rules</p>
                  <h3>Event Action Rules</h3>
                </div>
                <button type="button" onClick={addDefaultRule}>
                  Add Rule
                </button>
                <div className="game-rule-list">
                  {draftRules.length === 0 ? <p>No draft rules</p> : null}
                  {draftRules.map((rule) => (
                    <article key={rule.id} className={editingRuleId === rule.id ? "editing" : ""}>
                      <div>
                        <strong>{labelForGameRule(rule)}</strong>
                        <span>{`${rule.actionType} -> ${rule.target} x${rule.amount} / ${rule.fireCount} times / ${rule.delayMs}ms`}</span>
                      </div>
                      <button type="button" onClick={() => editRule(rule)}>
                        Edit
                      </button>
                    </article>
                  ))}
                </div>
                {editingRuleId ? (
                  <div className="game-rule-detail">
                    <div className="game-panel-title">
                      <p>Rule Detail</p>
                      <h3>{labelForGameRule(draftRules.find((rule) => rule.id === editingRuleId) ?? createDefaultGameRule())}</h3>
                    </div>
                    <div className="game-rule-grid">
                      <label>
                        <span>Trigger</span>
                        <select value={triggerKind} onChange={(event) => setTriggerKind(event.target.value)}>
                          <option value="any_gift">Any Gift</option>
                          <option value="gift_name">Selected Gift</option>
                          <option value="follow">Follow</option>
                        </select>
                      </label>
                      <label>
                        <span>Gift</span>
                        <div className={`game-selected-gift ${triggerKind !== "gift_name" ? "disabled" : ""}`}>
                          {selectedGift ? (
                            <>
                              <GameGiftImage gift={selectedGift} />
                              <span>
                                <strong>{selectedGift.name}</strong>
                                <small>{`ID ${selectedGift.platformGiftId ?? "-"} / Coin ${gameGiftCoinText(selectedGift)}`}</small>
                              </span>
                            </>
                          ) : (
                            <span>
                              <strong>{giftName || "No gift selected"}</strong>
                              <small>Choose a recorded gift from the catalog.</small>
                            </span>
                          )}
                        </div>
                        <button type="button" disabled={triggerKind !== "gift_name"} onClick={() => setGiftPickerOpen(true)}>
                          Choose Gift
                        </button>
                      </label>
                      <label>
                        <span>Fire Count</span>
                        <input type="number" min={1} max={30} value={fireCount} onChange={(event) => setFireCount(Number(event.target.value))} />
                      </label>
                      <label>
                        <span>Delay Ms</span>
                        <input type="number" min={0} max={60000} step={100} value={delayMs} onChange={(event) => setDelayMs(Number(event.target.value))} />
                      </label>
                      <label>
                        <span>Action</span>
                        <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
                          <option value="drop_ojama">Drop Ojama</option>
                          <option value="send_ojama">Send Ojama</option>
                          <option value="speed_up">Speed Up</option>
                          <option value="clear_random">Clear Random</option>
                          <option value="spawn_bonus">Spawn Bonus</option>
                        </select>
                      </label>
                      <label>
                        <span>Target</span>
                        <select value={target} onChange={(event) => setTarget(event.target.value)}>
                          <option value="player">Player</option>
                          <option value="cpu">CPU</option>
                          <option value="both">Both</option>
                        </select>
                      </label>
                      <label>
                        <span>Amount</span>
                        <input type="number" min={1} max={99} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
                      </label>
                    </div>
                    <button type="button" onClick={updateRule}>
                      Update Rule
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
            {giftPickerOpen ? (
              <div className="game-gift-picker-backdrop" role="dialog" aria-modal="true" aria-label="Choose Gift">
                <section className="game-gift-picker">
                  <header className="game-editor-header">
                    <div>
                      <p>Gift Catalog</p>
                      <h2>Choose Gift</h2>
                    </div>
                    <button type="button" onClick={() => setGiftPickerOpen(false)}>
                      Close
                    </button>
                  </header>
                  <div className="game-gift-picker-toolbar">
                    <label>
                      <span>Search</span>
                      <input value={giftSearch} placeholder="name or gift id" onChange={(event) => setGiftSearch(event.target.value)} />
                    </label>
                    <span>{`${filteredGifts.length} gifts`}</span>
                  </div>
                  {filteredGifts.length === 0 ? (
                    <p className="game-empty-text">No gifts recorded yet.</p>
                  ) : (
                    <div className="game-gift-tile-grid">
                      {filteredGifts.map((gift) => (
                        <button
                          key={gift.id}
                          type="button"
                          className={`game-gift-tile ${gift.name === giftName ? "selected" : ""}`}
                          onClick={() => {
                            setGiftName(gift.name);
                            setGiftPickerOpen(false);
                          }}
                        >
                          <GameGiftImage gift={gift} />
                          <strong>{gift.name}</strong>
                          <span>{`Coin ${gameGiftCoinText(gift)}`}</span>
                          <small>{`ID ${gift.platformGiftId ?? "-"}`}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
            <footer className="game-editor-footer">
              <button type="button" onClick={() => void createPresetDraft()}>
                Save Preset
              </button>
              {message ? <p className="game-inline-message">{message}</p> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PuyoPuyoGamePage(): React.ReactElement {
  const object = React.useMemo<RuntimeEffectObject>(() => createStandalonePuyoObject(), []);
  const [mode, setMode] = React.useState<PuyoGameMode | null>(null);
  const [resetVersion, setResetVersion] = React.useState(0);
  return (
    <main className="game-page">
      <aside className="game-controls-panel">
        <p>Controls</p>
        <h1>Puyo Puyo</h1>
        {mode ? (
          <dl>
            <dt>Mode</dt>
            <dd>{mode === "cpu" ? "Vs CPU" : "Solo"}</dd>
            <dt>Move</dt>
            <dd>Left / Right arrows</dd>
            <dt>Drop</dt>
            <dd>Down arrow</dd>
            <dt>Rotate</dt>
            <dd>Up / Space / Z</dd>
            <dt>Reset</dt>
            <dd>R</dd>
            <dt>Pause</dt>
            <dd>Esc</dd>
          </dl>
        ) : (
          <div className="game-mode-select">
            <button type="button" onClick={() => setMode("solo")}>
              Solo
            </button>
            <button type="button" onClick={() => setMode("cpu")}>
              Vs CPU
            </button>
          </div>
        )}
      </aside>
      {mode ? (
        <PuyoGameCanvas
          key={`${mode}-${resetVersion}`}
          mode={mode}
          object={object}
          onRetry={() => setResetVersion((current) => current + 1)}
          onReturnToMenu={() => setMode(null)}
        />
      ) : null}
    </main>
  );
}

function createStandalonePuyoObject(): RuntimeEffectObject {
  const now = new Date().toISOString();
  return {
    objectId: `standalone-puyo-${Date.now()}`,
    overlayId: 1,
    executionId: "standalone-puyo-game",
    effectConfigId: "standalone-puyo-game",
    objectType: "puyo-game",
    state: "active",
    interactive: false,
    hitPoints: 1,
    maxHitPoints: 1,
    spawn: {
      normalizedX: 0.6,
      normalizedY: 0.5,
      scale: 1
    },
    createdAt: now,
    metadata: {
      boardColumns: 6,
      boardRows: 12,
      cellSizePx: 56,
      gravityMs: 650,
      chainTarget: 4,
      seedFillRows: 1,
      showDebugGrid: true,
      opacity: 1,
      zIndex: 30
    }
  };
}

function OverlayApp(): React.ReactElement {
  const giftPileRef = React.useRef<GiftPileHandle>(null);
  const [flashes, setFlashes] = React.useState<Flash[]>([]);
  const [simpleMedia, setSimpleMedia] = React.useState<SimpleMediaPlayback[]>([]);
  const [ballRevealQueue, setBallRevealQueue] = React.useState<BallRevealPlayback[]>([]);
  const shuffleDecksRef = React.useRef(new Map<string, { signature: string; deck: string[]; lastId?: string }>());
  const [snapshot, setSnapshot] = React.useState<RuntimeOverlaySnapshot | null>(null);
  const [connected, setConnected] = React.useState(false);
  const overlayId = React.useMemo(() => getOverlayId(), []);
  const debug = new URLSearchParams(window.location.search).get("debug") === "1";
  useUploadedFonts();
  const chooseQueuedBallRevealMedia = React.useCallback(
    (message: EffectPlayMessage, excludedIds: Set<string>) => chooseBallRevealMedia(message, excludedIds, shuffleDecksRef.current),
    []
  );
  const completeBallReveal = React.useCallback(() => setBallRevealQueue((current) => current.slice(1)), []);

  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer = 0;
    let closedByCleanup = false;

    function connect(): void {
      ws = new WebSocket(makeWsUrl(`/ws/overlay/${overlayId}`));
      ws.addEventListener("open", () => {
        setConnected(true);
        sendOverlayHello(ws, overlayId);
        sendSnapshotRequest(ws, overlayId);
      });
      ws.addEventListener("close", () => {
        setConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 1000);
        }
      });
      ws.addEventListener("message", handleMessage);
    }

    function handleMessage(event: MessageEvent): void {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "effect:play" && message.effectId === "gift-pile") {
        giftPileRef.current?.receive(message);
      } else if (message.type === "effect:play" && message.effectId === "flash") {
        const play = message as EffectPlayMessage;
        const color = typeof play.parameters?.color === "string" ? play.parameters.color : "#ffffff";
        const durationMs =
          typeof play.parameters?.durationMs === "number" ? play.parameters.durationMs : 650;
        const flash: Flash = { id: play.instanceId, color, durationMs };
        setFlashes((current) => [...current, flash]);
        window.setTimeout(() => {
          setFlashes((current) => current.filter((item) => item.id !== flash.id));
        }, durationMs);
      } else if (message.type === "effect:play" && message.effectId === "simple-media") {
        const play = message as EffectPlayMessage;
        const durationMs = play.playback?.durationMs ?? 3000;
        const item: SimpleMediaPlayback = { id: play.instanceId, message: play, durationMs };
        setSimpleMedia((current) => [...current, item]);
        window.setTimeout(() => {
          setSimpleMedia((current) => current.filter((active) => active.id !== item.id));
        }, durationMs);
      } else if (message.type === "effect:play" && message.effectId === "ball-reveal") {
        const play = message as EffectPlayMessage;
        const item: BallRevealPlayback = { id: play.instanceId, message: play };
        const queueLimit = Math.max(1, Math.round(numberParam(play.parameters?.queueLimit, 20)));
        setBallRevealQueue((current) => current.length >= queueLimit ? current : [...current, item]);
      } else if (message.type === "runtime:snapshot" && message.snapshot.overlayId === overlayId) {
        setSnapshot(message.snapshot);
      } else if (message.type === "runtime:object-created" && message.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, message.object));
      } else if (message.type === "runtime:object-updated" && message.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, message.object));
      } else if (message.type === "runtime:object-destroyed" && message.object.overlayId === overlayId) {
        setSnapshot((current) => removeObject(current, message.object.objectId));
      } else if (message.type === "runtime:overlay-cleared" && message.overlayId === overlayId) {
        if (message.scope === "all") giftPileRef.current?.clear();
        setSnapshot((current) => (current ? { ...current, objects: [] } : current));
      } else if (message.type === "overlay:reload-required" && message.overlayId === overlayId) {
        scheduleOverlayReload(message.newBuildVersion, message.reloadDelayMs, message.reason);
      } else if (message.type === "overlay:version" && message.overlayId === overlayId && message.buildVersion !== CURRENT_BUILD_VERSION) {
        scheduleOverlayReload(message.buildVersion, 500, "build-version-changed");
      }
    }

    connect();
    return () => {
      closedByCleanup = true;
      window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [overlayId]);

  return (
    <div className="overlay-stage" aria-hidden="true">
      {debug ? (
        <div className="debug-panel">
          <strong>Overlay {overlayId}</strong>
          <span>1920 x 1080</span>
          <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        </div>
      ) : null}
      {flashes.map((flash) => (
        <div
          className="flash"
          key={flash.id}
          style={{
            backgroundColor: flash.color,
            animationDuration: `${flash.durationMs}ms`
          }}
        />
      ))}
      {simpleMedia.map((item) => (
        <SimpleMediaView key={item.id} item={item} />
      ))}
      {ballRevealQueue[0] ? (
        <BallRevealView
          key={ballRevealQueue[0].id}
          item={ballRevealQueue[0]}
          waitingCount={Math.max(0, ballRevealQueue.length - 1)}
          chooseMedia={chooseQueuedBallRevealMedia}
          onComplete={completeBallReveal}
        />
      ) : null}
      <GiftPileLayer ref={giftPileRef} />
      <FallingImagePhysicsLayer objects={(snapshot?.objects ?? []).filter(isRenderableFallingImage)} />
      <PitchingMachineLayer objects={(snapshot?.objects ?? []).filter(isRenderablePitchingObject)} />
      <PuyoGameLayer objects={(snapshot?.objects ?? []).filter(isRenderablePuyoGame)} />
      {(snapshot?.objects ?? []).filter((object) => object.objectType === "gift-combo-text").map((object) => (
        <GiftComboTextObject key={object.objectId} object={object} />
      ))}
      {(snapshot?.objects ?? []).filter((object) => object.objectType !== "falling-image" && object.objectType !== "gift-combo-text" && object.objectType !== "puyo-game" && !isRenderablePitchingObject(object)).map((object) => (
        <RuntimeObjectView key={object.objectId} object={object} />
      ))}
    </div>
  );
}

function FallingImagePhysicsLayer({ objects }: { objects: RuntimeEffectObject[] }): React.ReactElement {
  const [bodies, setBodies] = React.useState<FallingImageBody[]>([]);
  const bodiesRef = React.useRef<FallingImageBody[]>([]);
  const frameRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const width = window.innerWidth || 1920;
    const height = window.innerHeight || 1080;
    const current = new Map(bodiesRef.current.map((body) => [body.object.objectId, body]));
    const next = objects.map((object) => {
      const existing = current.get(object.objectId);
      if (existing && sameSpawnPosition(existing.object, object)) return { ...existing, object };
      const scale = object.spawn.scale ?? 1;
      const radius = 48 * scale;
      const expiresAt = object.expiresAt ? Date.parse(object.expiresAt) : Number.NaN;
      return {
        object,
        x: object.spawn.normalizedX * width,
        y: object.spawn.normalizedY * height,
        vx: (object.spawn.velocityX ?? 0) * width * 1.6,
        vy: (object.spawn.velocityY ?? 0) * height * 0.9,
        radius,
        scale,
        rotation: object.spawn.rotation ?? 0,
        rotationSpeed: object.spawn.rotationSpeed ?? 0,
        readyAt: performance.now(),
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        hidden: false
      };
    });
    bodiesRef.current = next;
    setBodies(next);
  }, [objects]);

  React.useEffect(() => {
    function tick(time: number): void {
      const previous = lastTimeRef.current ?? time;
      lastTimeRef.current = time;
      const dt = Math.min((time - previous) / 1000, 0.033);
      const width = window.innerWidth || 1920;
      const height = window.innerHeight || 1080;
      const next = simulateFallingBodies(bodiesRef.current, dt, width, height, time);
      bodiesRef.current = next;
      setBodies(next);
      frameRef.current = window.requestAnimationFrame(tick);
    }

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <>
      {bodies.filter((body) => !body.hidden).map((body) => (
        <div
          className="runtime-object falling-image-object"
          key={body.object.objectId}
          style={{
            left: 0,
            top: 0,
            width: `${96 * body.scale}px`,
            height: `${96 * body.scale}px`,
            transform: `translate(${body.x - body.radius}px, ${body.y - body.radius}px) rotate(${body.rotation}deg)`
          }}
          data-runtime-state={body.object.state}
        >
          <img alt="" src={body.object.asset?.contentUrl} />
          {body.object.interactive ? (
            <span className="runtime-object-hp">
              {body.object.hitPoints ?? "-"} / {body.object.maxHitPoints ?? "-"}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function simulateFallingBodies(bodies: FallingImageBody[], dt: number, width: number, height: number, time: number): FallingImageBody[] {
  const next = bodies.map((body) => {
    const gravity = numberParam(body.object.metadata?.gravity, 3) * 1750;
    const floorBehavior = stringParam(body.object.metadata?.floorBehavior, "bounce");
    const restitution = numberParam(body.object.metadata?.bounceRestitution, 0.58);
    const floorFriction = numberParam(body.object.metadata?.floorFriction, 0.82);
    if (time < body.readyAt) return body;
    if (body.expiresAt !== null && Date.now() > body.expiresAt) return { ...body, hidden: true };

    let x = body.x + body.vx * dt;
    let y = body.y + body.vy * dt;
    let vx = body.vx;
    let vy = body.vy + gravity * dt;
    let hidden = body.hidden;

    if (x < body.radius) {
      x = body.radius;
      vx = Math.abs(vx) * restitution;
    } else if (x > width - body.radius) {
      x = width - body.radius;
      vx = -Math.abs(vx) * restitution;
    }

    if (floorBehavior === "bounce") {
      const floor = height - body.radius;
      if (y > floor) {
        y = floor;
        vy = -Math.abs(vy) * restitution;
        vx *= floorFriction;
        if (Math.abs(vy) < 42) vy = 0;
      }
    } else if (y > height + body.radius * 2) {
      hidden = true;
    }

    return {
      ...body,
      x,
      y,
      vx,
      vy,
      rotation: body.rotation + body.rotationSpeed * dt,
      hidden
    };
  });

  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]!;
      const b = next[j]!;
      if (a.hidden || b.hidden) continue;
      if (!booleanParam(a.object.metadata?.objectCollisionEnabled, true) || !booleanParam(b.object.metadata?.objectCollisionEnabled, true)) continue;
      resolveCircleCollision(a, b);
    }
  }

  return next;
}

function resolveCircleCollision(a: FallingImageBody, b: FallingImageBody): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 0.0001;
  const minDistance = a.radius + b.radius;
  if (distance >= minDistance) return;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;

  const relativeVx = b.vx - a.vx;
  const relativeVy = b.vy - a.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;
  if (velocityAlongNormal > 0) return;

  const restitution = Math.min(numberParam(a.object.metadata?.bounceRestitution, 0.58), numberParam(b.object.metadata?.bounceRestitution, 0.58));
  const impulse = (-(1 + restitution) * velocityAlongNormal) / 2;
  const ix = impulse * nx;
  const iy = impulse * ny;
  a.vx -= ix;
  a.vy -= iy;
  b.vx += ix;
  b.vy += iy;
}

function isRenderableFallingImage(object: RuntimeEffectObject): boolean {
  return object.objectType === "falling-image" && Boolean(object.asset?.contentUrl) && object.state === "active";
}

function isRenderablePitchingObject(object: RuntimeEffectObject): boolean {
  return (
    (object.objectType === "pitching-machine" || object.objectType === "pitching-ball" || object.objectType === "pitching-impact") &&
    object.state === "active"
  );
}

function isRenderablePuyoGame(object: RuntimeEffectObject): boolean {
  return object.objectType === "puyo-game" && object.state === "active";
}

function sameSpawnPosition(left: RuntimeEffectObject, right: RuntimeEffectObject): boolean {
  return left.spawn.normalizedX === right.spawn.normalizedX && left.spawn.normalizedY === right.spawn.normalizedY;
}

function PuyoGameLayer({ objects }: { objects: RuntimeEffectObject[] }): React.ReactElement {
  return (
    <>
      {objects.map((object) => (
        <PuyoGameCanvas key={object.objectId} mode="solo" object={object} />
      ))}
    </>
  );
}

type PuyoGameMode = "solo" | "cpu";
type CpuPlan = {
  signature: string;
  targetColumn: number;
  targetRotation: PuyoPair["rotation"];
};
type PuyoInputState = {
  left: boolean;
  right: boolean;
  down: boolean;
  horizontalRepeatAt: number;
};
type PuyoFrameEvent = {
  landed: boolean;
  settledCells: Array<{ column: number; row: number }>;
};
type PuyoBurstParticle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  createdAt: number;
  durationMs: number;
};
type PuyoScorePopup = {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  durationMs: number;
};
type PuyoVisualEffects = {
  particles: PuyoBurstParticle[];
  popups: PuyoScorePopup[];
  landedCells: Map<string, number>;
  landingAt: number;
  lastScore: number;
  lastPendingAttack: number;
  clearSignature: string;
  nextId: number;
};

function PuyoGameCanvas({
  object,
  mode,
  onRetry,
  onReturnToMenu
}: {
  object: RuntimeEffectObject;
  mode: PuyoGameMode;
  onRetry?: () => void;
  onReturnToMenu?: () => void;
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const gameRef = React.useRef<PuyoGameState | null>(null);
  const cpuGameRef = React.useRef<PuyoGameState | null>(null);
  const playerEffectsRef = React.useRef<PuyoVisualEffects>(createPuyoVisualEffects());
  const cpuEffectsRef = React.useRef<PuyoVisualEffects>(createPuyoVisualEffects());
  const integrationActionsRef = React.useRef<GameIntegrationAction[]>([]);
  const gameOverStateRef = React.useRef(false);
  const [paused, setPaused] = React.useState(false);
  const [gameOver, setGameOver] = React.useState(false);
  const columns = integerParam(object.metadata?.boardColumns, 6);
  const rows = integerParam(object.metadata?.boardRows, 12);
  const cellSize = numberParam(object.metadata?.cellSizePx, 56) * (object.spawn.scale ?? 1);
  const boardWidth = columns * cellSize;
  const boardHeight = rows * cellSize;
  const nextPanelWidth = cellSize * 2.3;
  const viewWidth = boardWidth + nextPanelWidth;
  const duelGap = mode === "cpu" ? cellSize * 1.2 : 0;
  const width = mode === "cpu" ? viewWidth * 2 + duelGap : viewWidth;
  const height = boardHeight;
  const zIndex = integerParam(object.metadata?.zIndex, 15);
  const opacity = numberParam(object.metadata?.opacity, 1);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const targetCanvas = canvas;
    const targetContext = context;

    let frame = 0;
    const seed = hashString(object.objectId);
    const colors = ["#45d483", "#ff5c77", "#ffd23f", "#54b5ff", "#b06dff"];
    const gravityMs = numberParam(object.metadata?.gravityMs, 650);
    const showGrid = booleanParam(object.metadata?.showDebugGrid, true);
    const chainTarget = integerParam(object.metadata?.chainTarget, 4);
    const clearDurationMs = 520;
    const gravityResolveDelayMs = 220;
    const boardFallMsPerRow = 105;
    const spawnDelayMs = 460;
    const lockDelayMs = 640;
    const horizontalInitialDelayMs = 145;
    const horizontalRepeatMs = 72;
    let lastTime = performance.now();
    let cpuCommandAccumulator = 0;
    let cpuPlan: CpuPlan | null = null;
    let attackSeed = seed;
    let actionPollTimer = 0;
    const inputState: PuyoInputState = {
      left: false,
      right: false,
      down: false,
      horizontalRepeatAt: 0
    };

    gameRef.current = createPuyoGame(columns, rows, integerParam(object.metadata?.seedFillRows, 3), seed, colors);
    cpuGameRef.current = mode === "cpu" ? createPuyoGame(columns, rows, integerParam(object.metadata?.seedFillRows, 3), seed + 101, colors) : null;
    playerEffectsRef.current = createPuyoVisualEffects(gameRef.current.score);
    cpuEffectsRef.current = createPuyoVisualEffects(cpuGameRef.current?.score ?? 0);

    function handleKeyDown(event: KeyboardEvent): void {
      const game = gameRef.current;
      if (!game) return;
      if (event.key === "Escape") {
        game.paused = !game.paused;
        if (cpuGameRef.current) cpuGameRef.current.paused = game.paused;
        setPaused(game.paused);
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        gameRef.current = createPuyoGame(columns, rows, integerParam(object.metadata?.seedFillRows, 3), seed + Date.now(), colors);
        cpuGameRef.current = mode === "cpu" ? createPuyoGame(columns, rows, integerParam(object.metadata?.seedFillRows, 3), seed + Date.now() + 101, colors) : null;
        playerEffectsRef.current = createPuyoVisualEffects(gameRef.current.score);
        cpuEffectsRef.current = createPuyoVisualEffects(cpuGameRef.current?.score ?? 0);
        gameOverStateRef.current = false;
        setPaused(false);
        setGameOver(false);
        cpuPlan = null;
        inputState.left = false;
        inputState.right = false;
        inputState.down = false;
        inputState.horizontalRepeatAt = 0;
        event.preventDefault();
        return;
      }
      if (game.paused || game.resolving || game.gameOver) return;
      if (event.key === "ArrowLeft") {
        if (!inputState.left) {
          movePuyoPair(game, columns, rows, -1, 0);
          inputState.horizontalRepeatAt = performance.now() + horizontalInitialDelayMs;
        }
        inputState.left = true;
      } else if (event.key === "ArrowRight") {
        if (!inputState.right) {
          movePuyoPair(game, columns, rows, 1, 0);
          inputState.horizontalRepeatAt = performance.now() + horizontalInitialDelayMs;
        }
        inputState.right = true;
      } else if (event.key === "ArrowDown") {
        inputState.down = true;
      } else if (event.key === "ArrowUp" || event.key === " " || event.key.toLowerCase() === "z") {
        if (!event.repeat) rotatePuyoPair(game, columns, rows, event.shiftKey ? -1 : 1);
      } else {
        return;
      }
      event.preventDefault();
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") {
        inputState.left = false;
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        inputState.right = false;
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        inputState.down = false;
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    actionPollTimer = window.setInterval(() => {
      void fetch("/api/v1/game-integrations/actions?gameId=puyopuyo")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { actions?: GameIntegrationAction[] } | null) => {
          if (Array.isArray(data?.actions) && data.actions.length > 0) {
            integrationActionsRef.current.push(...data.actions);
          }
        })
        .catch(() => undefined);
    }, 450);

    function draw(time: number): void {
      const displayWidth = Math.max(1, Math.round(width));
      const displayHeight = Math.max(1, Math.round(height));
      if (targetCanvas.width !== displayWidth || targetCanvas.height !== displayHeight) {
        targetCanvas.width = displayWidth;
        targetCanvas.height = displayHeight;
      }
      const game = gameRef.current;
      if (!game) return;
      if (gameOverStateRef.current !== game.gameOver) {
        gameOverStateRef.current = game.gameOver;
        setGameOver(game.gameOver);
      }
      const dt = Math.max(0, time - lastTime);
      lastTime = time;
      if (!game.paused) {
        applyGameIntegrationActions(integrationActionsRef.current.splice(0), game, cpuGameRef.current, columns, rows);
        applyHeldPlayerInput(game, columns, rows, time, inputState, horizontalRepeatMs);
        const cpuGame = cpuGameRef.current;
        if (cpuGame) {
          attackSeed = transferPuyoAttacks(game, cpuGame, attackSeed, playerEffectsRef.current, cpuEffectsRef.current, time, columns, cellSize, 0, viewWidth + duelGap);
        }
        const playerFrame = advancePuyoGameFrame(game, columns, rows, chainTarget, colors, time, dt, gravityMs, clearDurationMs, gravityResolveDelayMs, boardFallMsPerRow, spawnDelayMs, lockDelayMs, inputState.down ? 7.5 : 1);
        updatePuyoVisualEffects(playerEffectsRef.current, game, columns, cellSize, time, dt, playerFrame, 0, 0);
        if (cpuGame) {
          const cpuFrame = advancePuyoGameFrame(cpuGame, columns, rows, chainTarget, colors, time, dt, gravityMs * 1.18, clearDurationMs, gravityResolveDelayMs, boardFallMsPerRow, spawnDelayMs, lockDelayMs * 0.8, 1);
          updatePuyoVisualEffects(cpuEffectsRef.current, cpuGame, columns, cellSize, time, dt, cpuFrame, viewWidth + duelGap, 0);
          cpuCommandAccumulator += dt;
          if (!cpuGame.resolving && !cpuGame.gameOver && cpuGame.pair && cpuCommandAccumulator >= 145) {
            cpuCommandAccumulator = 0;
            cpuPlan = applyCpuPuyoInput(cpuGame, columns, rows, cpuPlan);
          }
          attackSeed = transferPuyoAttacks(game, cpuGame, attackSeed, playerEffectsRef.current, cpuEffectsRef.current, time, columns, cellSize, 0, viewWidth + duelGap);
        }
      } else {
        updatePuyoVisualEffects(playerEffectsRef.current, game, columns, cellSize, time, 0, { landed: false, settledCells: [] }, 0, 0);
        if (cpuGameRef.current) {
          updatePuyoVisualEffects(cpuEffectsRef.current, cpuGameRef.current, columns, cellSize, time, 0, { landed: false, settledCells: [] }, viewWidth + duelGap, 0);
        }
      }

      targetContext.clearRect(0, 0, displayWidth, displayHeight);
      drawPuyoGameView(targetContext, game, columns, rows, cellSize, nextPanelWidth, showGrid, time, clearDurationMs, mode === "cpu" ? "YOU" : "", playerEffectsRef.current);
      drawPuyoFloatingEffects(targetContext, playerEffectsRef.current, time);
      if (cpuGameRef.current) {
        targetContext.save();
        targetContext.translate(viewWidth + duelGap, 0);
        drawPuyoGameView(targetContext, cpuGameRef.current, columns, rows, cellSize, nextPanelWidth, showGrid, time, clearDurationMs, "CPU", cpuEffectsRef.current);
        targetContext.restore();
        drawPuyoFloatingEffects(targetContext, cpuEffectsRef.current, time);
      }

      frame = window.requestAnimationFrame(draw);
    }

    targetCanvas.focus();
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.clearInterval(actionPollTimer);
      window.cancelAnimationFrame(frame);
    };
  }, [cellSize, columns, height, mode, object, rows, viewWidth, width]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="puyo-game-canvas"
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.focus()}
        style={{
          left: `${object.spawn.normalizedX * 100}%`,
          top: `${object.spawn.normalizedY * 100}%`,
          width: `${width}px`,
          height: `${height}px`,
          opacity,
          zIndex
        }}
      />
      {paused && onReturnToMenu ? (
        <div className="game-pause-actions">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
          <button type="button" onClick={onReturnToMenu}>
            Mode Select
          </button>
        </div>
      ) : null}
      {gameOver ? (
        <div className="game-over-actions">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="game-test-actions">
        <button type="button" onClick={() => gameRef.current && dropTestOjamaPuyo(gameRef.current, columns, rows, columns)}>
          Drop Ojama
        </button>
      </div>
    </>
  );
}

function advancePuyoGameFrame(
  game: PuyoGameState,
  columns: number,
  rows: number,
  chainTarget: number,
  colors: string[],
  time: number,
  dt: number,
  gravityMs: number,
  clearDurationMs: number,
  gravityResolveDelayMs: number,
  boardFallMsPerRow: number,
  spawnDelayMs: number,
  lockDelayMs: number,
  fallMultiplier: number
): PuyoFrameEvent {
  const frameEvent: PuyoFrameEvent = { landed: false, settledCells: [] };
  advancePuyoSpawnDelay(game, columns, rows, colors, time);
  advanceActivePuyoVisuals(game, dt, 58);
  advanceBoardPuyoFalls(game, dt, boardFallMsPerRow);
  if (game.resolving) {
    advancePuyoResolution(game, columns, rows, chainTarget, colors, time, clearDurationMs, gravityResolveDelayMs, boardFallMsPerRow, spawnDelayMs);
  }
  if (!game.gameOver && !game.resolving && game.pair) {
    const falling = advanceActivePuyoFall(game, columns, rows, (dt / Math.max(1, gravityMs)) * fallMultiplier);
    if (falling) {
      game.lockStartedAt = 0;
    } else {
      if (game.lockStartedAt === 0) frameEvent.landed = true;
      if (fallMultiplier > 1) {
        frameEvent.settledCells = game.pair ? activePuyoPairGridCells(game.pair) : [];
        settlePuyoPair(game, columns, rows, chainTarget, colors, time, clearDurationMs, gravityResolveDelayMs, boardFallMsPerRow, spawnDelayMs);
      } else {
        if (game.lockStartedAt === 0) game.lockStartedAt = time;
        if (time - game.lockStartedAt >= lockDelayMs) {
          frameEvent.settledCells = game.pair ? activePuyoPairGridCells(game.pair) : [];
          settlePuyoPair(game, columns, rows, chainTarget, colors, time, clearDurationMs, gravityResolveDelayMs, boardFallMsPerRow, spawnDelayMs);
        }
      }
    }
  }
  return frameEvent;
}

function createPuyoVisualEffects(initialScore = 0): PuyoVisualEffects {
  return {
    particles: [],
    popups: [],
    landedCells: new Map(),
    landingAt: -1000,
    lastScore: initialScore,
    lastPendingAttack: 0,
    clearSignature: "",
    nextId: 1
  };
}

function updatePuyoVisualEffects(
  effects: PuyoVisualEffects,
  game: PuyoGameState,
  columns: number,
  cellSize: number,
  time: number,
  dt: number,
  frameEvent: PuyoFrameEvent,
  offsetX: number,
  offsetY: number
): void {
  if (frameEvent.landed) effects.landingAt = time;
  for (const cell of frameEvent.settledCells) {
    effects.landedCells.set(`${cell.row}:${cell.column}`, time);
  }
  const clearSignature = [...game.clearingCells].sort().join("|");
  if (clearSignature && clearSignature !== effects.clearSignature) {
    emitPuyoClearParticles(effects, game, cellSize, time, offsetX, offsetY);
  }
  effects.clearSignature = clearSignature;

  if (game.score > effects.lastScore) {
    effects.popups.push({
      id: effects.nextId++,
      text: `+${game.score - effects.lastScore}`,
      x: offsetX + columns * cellSize * 0.5,
      y: offsetY + cellSize * 1.35,
      color: "#fef08a",
      createdAt: time,
      durationMs: 920
    });
  }
  effects.lastScore = game.score;
  effects.lastPendingAttack = game.pendingAttack;

  const dtSeconds = Math.min(0.05, Math.max(0, dt / 1000));
  effects.particles = effects.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * dtSeconds,
      y: particle.y + particle.vy * dtSeconds,
      vy: particle.vy + 620 * dtSeconds
    }))
    .filter((particle) => time - particle.createdAt < particle.durationMs);
  effects.popups = effects.popups.filter((popup) => time - popup.createdAt < popup.durationMs);
  for (const [key, landedAt] of [...effects.landedCells]) {
    if (time - landedAt > 260) effects.landedCells.delete(key);
  }
}

function emitPuyoClearParticles(effects: PuyoVisualEffects, game: PuyoGameState, cellSize: number, time: number, offsetX: number, offsetY: number): void {
  for (const key of game.clearingCells) {
    const [rowText, columnText] = key.split(":");
    const row = Number(rowText);
    const column = Number(columnText);
    const color = game.board[row]?.[column];
    if (!color) continue;
    const centerX = offsetX + column * cellSize + cellSize / 2;
    const centerY = offsetY + (game.fallingCells.get(key) ?? row) * cellSize + cellSize / 2;
    for (let index = 0; index < 7; index += 1) {
      const angle = ((index / 7) * Math.PI * 2) + ((row + column) % 3) * 0.35;
      const speed = cellSize * (2.2 + (index % 3) * 0.55);
      effects.particles.push({
        id: effects.nextId++,
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - cellSize * 1.2,
        radius: cellSize * (0.055 + (index % 2) * 0.025),
        color,
        createdAt: time,
        durationMs: 680
      });
    }
  }
}

function drawPuyoFloatingEffects(context: CanvasRenderingContext2D, effects: PuyoVisualEffects, time: number): void {
  context.save();
  for (const particle of effects.particles) {
    const progress = clampNumber((time - particle.createdAt) / particle.durationMs, 0, 1);
    context.globalAlpha = 1 - progress;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.radius * (1 - progress * 0.25), 0, Math.PI * 2);
    context.fill();
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const popup of effects.popups) {
    const progress = clampNumber((time - popup.createdAt) / popup.durationMs, 0, 1);
    const y = popup.y - progress * 46;
    const scale = 1 + Math.sin(Math.min(1, progress * 2) * Math.PI) * 0.18;
    context.save();
    context.globalAlpha = 1 - Math.max(0, progress - 0.72) / 0.28;
    context.translate(popup.x, y);
    context.scale(scale, scale);
    context.font = "900 22px system-ui, sans-serif";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(7, 12, 24, 0.82)";
    context.strokeText(popup.text, 0, 0);
    context.fillStyle = popup.color;
    context.fillText(popup.text, 0, 0);
    context.restore();
  }
  context.restore();
}

function transferPuyoAttacks(
  playerGame: PuyoGameState,
  cpuGame: PuyoGameState,
  seed: number,
  playerEffects: PuyoVisualEffects,
  cpuEffects: PuyoVisualEffects,
  time: number,
  columns: number,
  cellSize: number,
  playerOffsetX: number,
  cpuOffsetX: number
): number {
  let nextSeed = seed;
  const playerAttack = popPuyoAttack(playerGame);
  if (playerAttack > 0) {
    nextSeed += playerAttack * 17 + 1;
    pushPuyoAttackPopup(playerEffects, playerAttack, time, playerOffsetX + columns * cellSize * 0.5, cellSize * 2);
    queueOjamaPuyo(cpuGame, playerAttack);
  }
  const cpuAttack = popPuyoAttack(cpuGame);
  if (cpuAttack > 0) {
    nextSeed += cpuAttack * 31 + 3;
    pushPuyoAttackPopup(cpuEffects, cpuAttack, time, cpuOffsetX + columns * cellSize * 0.5, cellSize * 2);
    queueOjamaPuyo(playerGame, cpuAttack);
  }
  return nextSeed;
}

function pushPuyoAttackPopup(effects: PuyoVisualEffects, attack: number, time: number, x: number, y: number): void {
  effects.popups.push({
    id: effects.nextId++,
    text: `OJAMA +${attack}`,
    x,
    y,
    color: "#fb7185",
    createdAt: time,
    durationMs: 1050
  });
  effects.lastPendingAttack = 0;
}

function applyGameIntegrationActions(actions: GameIntegrationAction[], playerGame: PuyoGameState, cpuGame: PuyoGameState | null, columns: number, rows: number): void {
  for (const action of actions) {
    const amount = Math.max(1, Math.round(action.amount));
    const targets = targetPuyoGames(action.target, playerGame, cpuGame);
    for (const targetGame of targets) {
      if (action.actionType === "drop_ojama") {
        dropTestOjamaPuyo(targetGame, columns, rows, amount);
      } else if (action.actionType === "send_ojama") {
        queueOjamaPuyo(targetGame, amount);
        if (!targetGame.pair && !targetGame.resolving && targetGame.spawnReadyAt <= 0) {
          targetGame.spawnReadyAt = 1;
        }
      }
    }
  }
}

function targetPuyoGames(target: string, playerGame: PuyoGameState, cpuGame: PuyoGameState | null): PuyoGameState[] {
  if (target === "both") return cpuGame ? [playerGame, cpuGame] : [playerGame];
  if (target === "cpu") return cpuGame ? [cpuGame] : [playerGame];
  return [playerGame];
}

function applyHeldPlayerInput(game: PuyoGameState, columns: number, rows: number, time: number, inputState: PuyoInputState, horizontalRepeatMs: number): void {
  if (!game.pair || game.resolving || game.gameOver) return;
  const direction = inputState.left === inputState.right ? 0 : inputState.left ? -1 : 1;
  if (direction === 0) return;
  if (time < inputState.horizontalRepeatAt) return;
  movePuyoPair(game, columns, rows, direction, 0);
  inputState.horizontalRepeatAt = time + horizontalRepeatMs;
}

function applyCpuPuyoInput(game: PuyoGameState, columns: number, rows: number, currentPlan: CpuPlan | null): CpuPlan | null {
  if (!game.pair) return null;
  const signature = cpuPairSignature(game);
  const plan =
    currentPlan?.signature === signature
      ? currentPlan
      : createCpuPlan(game, columns, rows, signature);

  if (game.pair.rotation !== plan.targetRotation) {
    rotatePuyoPair(game, columns, rows, 1);
  } else if (game.pair.axisColumn < plan.targetColumn) {
    movePuyoPair(game, columns, rows, 1, 0);
  } else if (game.pair.axisColumn > plan.targetColumn) {
    movePuyoPair(game, columns, rows, -1, 0);
  } else if (!advanceActivePuyoFall(game, columns, rows, 0.45)) {
    return null;
  }

  return plan;
}

function createCpuPlan(game: PuyoGameState, columns: number, rows: number, signature: string): CpuPlan {
  const move = chooseCpuPuyoMove(game, columns, rows, 4);
  return {
    signature,
    targetColumn: move?.targetColumn ?? Math.floor(columns / 2),
    targetRotation: move?.targetRotation ?? 0
  };
}

function cpuPairSignature(game: PuyoGameState): string {
  const pair = game.pair;
  if (!pair) return "none";
  return `${game.score}:${pair.axisColor}:${pair.childColor}:${game.nextPair.axisColor}:${game.nextPair.childColor}`;
}

function activePuyoPairGridCells(pair: PuyoPair): Array<{ column: number; row: number }> {
  const child = puyoChildOffset(pair.rotation);
  return [
    { column: pair.axisColumn, row: pair.axisRow },
    { column: pair.axisColumn + child.column, row: pair.axisRow + child.row }
  ];
}

function puyoChildOffset(rotation: PuyoPair["rotation"]): { column: number; row: number } {
  if (rotation === 0) return { column: 0, row: -1 };
  if (rotation === 1) return { column: 1, row: 0 };
  if (rotation === 2) return { column: 0, row: 1 };
  return { column: -1, row: 0 };
}

function drawPuyoGameView(
  context: CanvasRenderingContext2D,
  game: PuyoGameState,
  columns: number,
  rows: number,
  cellSize: number,
  nextPanelWidth: number,
  showGrid: boolean,
  time: number,
  clearDurationMs: number,
  label: string,
  effects: PuyoVisualEffects
): void {
  drawPuyoBoard(context, columns, rows, cellSize, showGrid);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const color = game.board[row]?.[column];
      if (color) {
        const clearKey = `${row}:${column}`;
        const clearing = game.clearingCells.has(clearKey);
        if (clearing) {
          const clearProgress = clampNumber((time - game.clearStartedAt) / clearDurationMs, 0, 1);
          const visualRow = game.fallingCells.get(clearKey) ?? row;
          drawPuyoAt(
            context,
            column * cellSize + cellSize / 2,
            visualRow * cellSize + cellSize / 2,
            cellSize * (0.42 + clearProgress * 0.18),
            color,
            1 - clearProgress * 0.85
          );
        } else {
          const landedAt = effects.landedCells.get(clearKey) ?? -1000;
          const landedProgress = clampNumber((time - landedAt) / 240, 0, 1);
          const landedWave = landedProgress < 1 ? Math.sin((1 - landedProgress) * Math.PI) : 0;
          drawPuyo(context, column, game.fallingCells.get(clearKey) ?? row, cellSize, color, 1, 1 + landedWave * 0.18, 1 - landedWave * 0.2);
        }
      }
    }
  }

  if (game.pair) {
    const landingProgress = clampNumber((time - effects.landingAt) / 240, 0, 1);
    const landingWave = landingProgress < 1 ? Math.sin((1 - landingProgress) * Math.PI) : 0;
    for (const part of activePairRenderCells(game.pair)) {
      drawPuyo(context, part.column, part.row, cellSize, part.color, part.alpha, 1 + landingWave * 0.16, 1 - landingWave * 0.18);
    }
  }
  drawPuyoHud(context, columns, rows, cellSize, nextPanelWidth, game.score, game.chain, game.incomingOjama, game.nextPair, game.gameOver, game.paused, label);
}

function drawPuyoBoard(context: CanvasRenderingContext2D, columns: number, rows: number, cellSize: number, showGrid: boolean): void {
  const width = columns * cellSize;
  const height = rows * cellSize;
  context.save();
  context.fillStyle = "rgba(7, 12, 24, 0.42)";
  roundedRect(context, 0, 0, width, height, Math.min(18, cellSize * 0.28));
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.78)";
  context.lineWidth = Math.max(2, cellSize * 0.04);
  context.stroke();
  const rightCenter = Math.max(0, Math.min(columns - 1, Math.floor(columns / 2)));
  const leftCenter = Math.max(0, rightCenter - 1);
  context.fillStyle = "rgba(248, 113, 113, 0.26)";
  context.fillRect(leftCenter * cellSize, 0, cellSize, cellSize);
  context.fillRect(rightCenter * cellSize, 0, cellSize, cellSize);
  context.strokeStyle = "rgba(248, 113, 113, 0.62)";
  context.lineWidth = Math.max(1, cellSize * 0.025);
  context.strokeRect(leftCenter * cellSize + 1, 1, cellSize - 2, cellSize - 2);
  context.strokeRect(rightCenter * cellSize + 1, 1, cellSize - 2, cellSize - 2);
  if (showGrid) {
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.lineWidth = 1;
    for (let column = 1; column < columns; column += 1) {
      context.beginPath();
      context.moveTo(column * cellSize, 0);
      context.lineTo(column * cellSize, height);
      context.stroke();
    }
    for (let row = 1; row < rows; row += 1) {
      context.beginPath();
      context.moveTo(0, row * cellSize);
      context.lineTo(width, row * cellSize);
      context.stroke();
    }
  }
  context.restore();
}

function drawPuyo(context: CanvasRenderingContext2D, column: number, row: number, cellSize: number, color: string, alpha: number, scaleX: number, scaleY: number): void {
  const x = column * cellSize + cellSize / 2;
  const y = row * cellSize + cellSize / 2;
  const radius = cellSize * 0.42;
  drawPuyoAt(context, x, y, radius, color, alpha, scaleX, scaleY);
}

function drawPuyoCore(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number, scaleX: number, scaleY: number): void {
  context.save();
  context.translate(x, y);
  context.scale(scaleX, scaleY);
  context.globalAlpha = alpha;
  const gradient = context.createRadialGradient(-radius * 0.35, -radius * 0.42, radius * 0.1, 0, 0, radius);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.24, color);
  gradient.addColorStop(1, shadeColor(color, -42));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.7)";
  context.beginPath();
  context.ellipse(-radius * 0.24, -radius * 0.26, radius * 0.22, radius * 0.13, -0.35, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPuyoHud(
  context: CanvasRenderingContext2D,
  columns: number,
  rows: number,
  cellSize: number,
  nextPanelWidth: number,
  score: number,
  chain: number,
  incomingOjama: number,
  nextPair: Pick<PuyoPair, "axisColor" | "childColor">,
  gameOver: boolean,
  paused: boolean,
  label: string
): void {
  context.save();
  if (label) {
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.font = `900 ${Math.max(13, cellSize * 0.22)}px system-ui, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, cellSize * 0.18, cellSize * 0.45);
  }
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.font = `700 ${Math.max(14, cellSize * 0.26)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`SCORE ${score}`, (columns * cellSize) / 2, cellSize * 0.45);
  if (incomingOjama > 0) {
    context.fillStyle = "#f8fafc";
    context.font = `800 ${Math.max(12, cellSize * 0.2)}px system-ui, sans-serif`;
    context.fillText(`OJAMA ${incomingOjama}`, (columns * cellSize) / 2, cellSize * 0.82);
  }
  if (incomingOjama > 0) {
    drawOjamaPreview(context, incomingOjama, rows, cellSize);
  }
  const boardRight = columns * cellSize;
  const nextCenterX = boardRight + nextPanelWidth / 2;
  context.fillStyle = "rgba(7, 12, 24, 0.48)";
  roundedRect(context, boardRight + cellSize * 0.22, cellSize * 0.15, nextPanelWidth - cellSize * 0.32, cellSize * 2.2, cellSize * 0.18);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.38)";
  context.lineWidth = Math.max(1, cellSize * 0.025);
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.font = `800 ${Math.max(12, cellSize * 0.2)}px system-ui, sans-serif`;
  context.fillText("NEXT", nextCenterX, cellSize * 0.48);
  drawPuyoAt(context, nextCenterX, cellSize * 1.1, cellSize * 0.34, nextPair.axisColor, 0.92);
  drawPuyoAt(context, nextCenterX, cellSize * 1.78, cellSize * 0.34, nextPair.childColor, 0.92);
  if (chain > 0) {
    const comboX = (columns * cellSize) / 2;
    const comboY = rows * cellSize - cellSize * 1.05;
    context.fillStyle = "rgba(7, 12, 24, 0.62)";
    roundedRect(context, cellSize * 0.85, comboY - cellSize * 0.58, (columns - 1.7) * cellSize, cellSize * 1.12, cellSize * 0.2);
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.42)";
    context.lineWidth = Math.max(2, cellSize * 0.035);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = `900 ${Math.max(28, cellSize * 0.55)}px system-ui, sans-serif`;
    context.fillText(`${chain} COMBO`, comboX, comboY - cellSize * 0.06);
    context.fillStyle = "#67e8f9";
    context.font = `800 ${Math.max(12, cellSize * 0.2)}px system-ui, sans-serif`;
    context.fillText("CHAIN CLEAR", comboX, comboY + cellSize * 0.38);
  }
  if (paused || gameOver) {
    context.fillStyle = "rgba(7, 12, 24, 0.72)";
    roundedRect(context, cellSize * 0.6, rows * cellSize * 0.42, (columns - 1.2) * cellSize, cellSize * 1.35, cellSize * 0.18);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = `900 ${Math.max(24, cellSize * 0.44)}px system-ui, sans-serif`;
    context.fillText(paused ? "PAUSED" : "GAME OVER", (columns * cellSize) / 2, rows * cellSize * 0.5);
    if (paused) {
      context.fillStyle = "#67e8f9";
      context.font = `800 ${Math.max(12, cellSize * 0.2)}px system-ui, sans-serif`;
      context.fillText("ESC TO RESUME", (columns * cellSize) / 2, rows * cellSize * 0.5 + cellSize * 0.38);
    }
  }
  context.restore();
}

function drawOjamaPreview(context: CanvasRenderingContext2D, incomingOjama: number, rows: number, cellSize: number): void {
  const previewCount = Math.min(12, incomingOjama);
  const x = -cellSize * 0.58;
  const startY = Math.max(cellSize * 1.45, rows * cellSize * 0.5 - previewCount * cellSize * 0.16);
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(7, 12, 24, 0.58)";
  roundedRect(context, x - cellSize * 0.35, startY - cellSize * 0.54, cellSize * 0.7, previewCount * cellSize * 0.32 + cellSize * 0.78, cellSize * 0.14);
  context.fill();
  context.strokeStyle = "rgba(251, 113, 133, 0.68)";
  context.lineWidth = Math.max(1, cellSize * 0.02);
  context.stroke();
  context.fillStyle = "#fb7185";
  context.font = `900 ${Math.max(10, cellSize * 0.17)}px system-ui, sans-serif`;
  context.fillText("!", x, startY - cellSize * 0.28);
  for (let index = 0; index < previewCount; index += 1) {
    drawPuyoAt(context, x, startY + index * cellSize * 0.32, cellSize * 0.14, "#cbd5e1", 0.9);
  }
  if (incomingOjama > previewCount) {
    context.fillStyle = "#f8fafc";
    context.font = `900 ${Math.max(10, cellSize * 0.16)}px system-ui, sans-serif`;
    context.fillText(`+${incomingOjama - previewCount}`, x, startY + previewCount * cellSize * 0.32 + cellSize * 0.18);
  }
  context.restore();
}

function drawPuyoAt(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number, scaleX = 1, scaleY = 1): void {
  drawPuyoCore(context, x, y, radius, color, alpha, scaleX, scaleY);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}

function shadeColor(color: string, amount: number): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#54b5ff";
  const red = clampColor(Number.parseInt(normalized.slice(1, 3), 16) + amount);
  const green = clampColor(Number.parseInt(normalized.slice(3, 5), 16) + amount);
  const blue = clampColor(Number.parseInt(normalized.slice(5, 7), 16) + amount);
  return `rgb(${red}, ${green}, ${blue})`;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function integerParam(value: unknown, fallback: number): number {
  return Math.round(numberParam(value, fallback));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function PitchingMachineLayer({ objects }: { objects: RuntimeEffectObject[] }): React.ReactElement {
  const [time, setTime] = React.useState(() => Date.now());
  const machineObjects = React.useMemo(() => objects.filter((object) => object.objectType === "pitching-machine"), [objects]);
  const animatedObjects = React.useMemo(() => objects.filter((object) => object.objectType !== "pitching-machine"), [objects]);

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      setTime(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {animatedObjects.map((object) => {
        if (object.objectType === "pitching-ball") return <PitchingBallObject key={object.objectId} object={object} time={time} />;
        return <PitchingImpactObject key={object.objectId} object={object} time={time} />;
      })}
      {machineObjects.map((object) => (
        <PitchingMachineObject key={object.objectId} object={object} />
      ))}
    </>
  );
}

function PitchingMachineObject({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  const exitAt = numberParam(object.metadata?.exitAt, Number.MAX_SAFE_INTEGER);
  const [exiting, setExiting] = React.useState(() => Date.now() >= exitAt);
  const [aiming, setAiming] = React.useState(false);
  const [recoiling, setRecoiling] = React.useState(false);
  const edge = stringParam(object.metadata?.edge, "left");
  const listenerName = stringParam(object.metadata?.listenerName, "");
  const enterDurationMs = numberParam(object.metadata?.enterDurationMs, 420);
  const exitDurationMs = numberParam(object.metadata?.exitDurationMs, 520);
  const horizontalEdgeOffsetPx = numberParam(object.metadata?.horizontalEdgeOffsetPx, 0);
  const launchAt = numberParam(object.metadata?.launchAt, Date.parse(object.createdAt));
  const recoilAt = numberParam(object.metadata?.recoilAt, 0);
  const recoilIndex = numberParam(object.metadata?.recoilIndex, -1);
  const width = window.innerWidth || 1920;
  const height = window.innerHeight || 1080;
  const machineX = pitchingBallStartX(edge, object.spawn.normalizedX, width, horizontalEdgeOffsetPx);
  const machineY = object.spawn.normalizedY * height;
  const targetX = numberParam(object.metadata?.targetX, object.spawn.normalizedX) * width;
  const targetY = numberParam(object.metadata?.targetY, object.spawn.normalizedY) * height;
  const aimAngle = Math.atan2(targetY - machineY, targetX - machineX) * (180 / Math.PI);

  React.useEffect(() => {
    const delayMs = exitAt - Date.now();
    if (delayMs <= 0) {
      setExiting(true);
      return;
    }
    setExiting(false);
    const timer = window.setTimeout(() => setExiting(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [exitAt]);

  React.useEffect(() => {
    const aimDurationMs = 180;
    const delayMs = Math.max(0, Math.min(enterDurationMs, launchAt - Date.now() - aimDurationMs));
    setAiming(false);
    const timer = window.setTimeout(() => setAiming(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [enterDurationMs, launchAt]);

  React.useEffect(() => {
    if (!recoilAt) return;
    const delayMs = Math.max(0, recoilAt - Date.now());
    const startTimer = window.setTimeout(() => {
      setRecoiling(false);
      window.requestAnimationFrame(() => setRecoiling(true));
    }, delayMs);
    const endTimer = window.setTimeout(() => setRecoiling(false), delayMs + 240);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
    };
  }, [recoilAt, recoilIndex]);

  return (
    <div
      className={`pitching-machine-object edge-${edge} ${exiting ? "exiting" : ""}`}
      style={{
        left: pitchingMachineLeft(edge, object.spawn.normalizedX, horizontalEdgeOffsetPx),
        top: `${object.spawn.normalizedY * 100}%`,
        "--machine-scale": String(object.spawn.scale ?? 1),
        "--machine-rotate": `${object.spawn.rotation ?? 0}deg`,
        "--machine-enter-ms": `${enterDurationMs}ms`,
        "--machine-exit-ms": `${exitDurationMs}ms`
      } as React.CSSProperties}
    >
      {listenerName ? <div className="pitching-listener-name">{listenerName}</div> : null}
      <div className="pitching-machine-visual" style={{ transform: aiming ? pitchingMachineAimTransform(edge, aimAngle) : pitchingMachineVisualTransform(edge) }}>
        <div className={`pitching-machine-media ${recoiling ? "recoiling" : ""}`}>
          {object.asset?.contentUrl ? <img alt="" src={object.asset.contentUrl} /> : <span>PM</span>}
        </div>
      </div>
    </div>
  );
}

function PitchingBallObject({ object, time }: { object: RuntimeEffectObject; time: number }): React.ReactElement {
  const launchPlayedRef = React.useRef(false);
  const impactPlayedRef = React.useRef(false);
  const width = window.innerWidth || 1920;
  const height = window.innerHeight || 1080;
  const launchAt = numberParam(object.metadata?.launchAt, Date.parse(object.createdAt));
  const impactAt = numberParam(object.metadata?.impactAt, launchAt + numberParam(object.metadata?.travelDurationMs, 750));
  const travelDurationMs = Math.max(1, impactAt - launchAt);
  const startEdge = stringParam(object.metadata?.startEdge, "");
  const horizontalEdgeOffsetPx = numberParam(object.metadata?.horizontalEdgeOffsetPx, 0);
  const startX = pitchingBallStartX(startEdge, numberParam(object.metadata?.startX, object.spawn.normalizedX), width, horizontalEdgeOffsetPx);
  const startY = numberParam(object.metadata?.startY, object.spawn.normalizedY) * height;
  const targetX = numberParam(object.metadata?.targetX, object.spawn.normalizedX) * width;
  const targetY = numberParam(object.metadata?.targetY, object.spawn.normalizedY) * height;
  const trajectoryMode = stringParam(object.metadata?.trajectoryMode, "direct");
  const scale = object.spawn.scale ?? 1;
  let x = startX;
  let y = startY;

  React.useEffect(() => {
    if (!launchPlayedRef.current && time >= launchAt) {
      launchPlayedRef.current = true;
      playAudio(stringParam(object.metadata?.launchAudioUrl, ""), numberParam(object.metadata?.audioVolume, 0.8));
    }
    if (!impactPlayedRef.current && time >= impactAt) {
      impactPlayedRef.current = true;
      playAudio(stringParam(object.metadata?.impactAudioUrl, ""), numberParam(object.metadata?.audioVolume, 0.8));
    }
  }, [impactAt, launchAt, object.metadata, time]);

  if (time < launchAt) {
    x = startX;
    y = startY;
  } else if (time < impactAt) {
    const progress = easeInCubic((time - launchAt) / travelDurationMs);
    if (trajectoryMode === "arc") {
      const controlX = (startX + targetX) / 2;
      const controlY = (startY + targetY) / 2 - numberParam(object.metadata?.arcHeightPx, 220);
      x = quadratic(startX, controlX, targetX, progress);
      y = quadratic(startY, controlY, targetY, progress);
    } else {
      x = startX + (targetX - startX) * progress;
      y = startY + (targetY - startY) * progress;
    }
  } else {
    const dt = (time - impactAt) / 1000;
    const vx = numberParam(object.metadata?.postVelocityX, 0.28) * width;
    const initialVy = numberParam(object.metadata?.postVelocityY, -0.42) * height;
    const gravity = numberParam(object.metadata?.gravity, 3.2) * 500;
    x = targetX + vx * dt;
    y = targetY + initialVy * dt + (gravity * dt * dt) / 2;
    if (stringParam(object.metadata?.groundCollisionMode, "bounce") === "bounce") {
      const floor = height - 48 * scale;
      if (y > floor) {
        const restitution = numberParam(object.metadata?.restitution, 0.58);
        y = floor - Math.abs(Math.sin(dt * 5)) * 140 * restitution;
      }
    }
  }

  return (
    <div
      className="pitching-ball-object"
      style={{
        left: 0,
        top: 0,
        width: `${82 * scale}px`,
        height: `${82 * scale}px`,
        transform: `translate(${x - 41 * scale}px, ${y - 41 * scale}px) rotate(${(object.spawn.rotation ?? 0) + (time - launchAt) * 0.32}deg)`
      }}
    >
      {object.asset?.contentUrl ? <img alt="" src={object.asset.contentUrl} /> : <span />}
    </div>
  );
}

function playAudio(url: string, volume: number): void {
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  void audio.play().catch(() => undefined);
}

function pitchingMachineLeft(edge: string, normalizedX: number, horizontalEdgeOffsetPx: number): string {
  if (edge === "left") return `${-horizontalEdgeOffsetPx}px`;
  if (edge === "right") return `calc(100% + ${horizontalEdgeOffsetPx}px)`;
  return `${normalizedX * 100}%`;
}

function pitchingMachineVisualTransform(edge: string): string {
  if (edge === "right") return "scaleX(-1)";
  if (edge === "top") return "rotate(90deg)";
  if (edge === "bottom") return "rotate(270deg)";
  return "none";
}

function pitchingMachineAimTransform(edge: string, angleDeg: number): string {
  if (edge === "right") return `rotate(${angleDeg - 180}deg) scaleX(-1)`;
  if (edge === "top") return `rotate(${angleDeg - 90}deg)`;
  if (edge === "bottom") return `rotate(${angleDeg - 270}deg)`;
  return `rotate(${angleDeg}deg)`;
}

function pitchingBallStartX(edge: string, normalizedX: number, width: number, horizontalEdgeOffsetPx: number): number {
  if (edge === "left") return -horizontalEdgeOffsetPx;
  if (edge === "right") return width + horizontalEdgeOffsetPx;
  return normalizedX * width;
}

function PitchingImpactObject({ object, time }: { object: RuntimeEffectObject; time: number }): React.ReactElement {
  const created = Date.parse(object.createdAt);
  const duration = numberParam(object.metadata?.durationMs, 420);
  const progress = Math.min(1, Math.max(0, (time - created) / duration));
  const radius = numberParam(object.metadata?.targetRadiusPx, 72) * (1 + progress * 0.9);
  return (
    <div
      className="pitching-impact-object"
      style={{
        left: `${object.spawn.normalizedX * 100}%`,
        top: `${object.spawn.normalizedY * 100}%`,
        width: `${radius * 2}px`,
        height: `${radius * 2}px`,
        opacity: 1 - progress,
        transform: "translate(-50%, -50%)"
      }}
    />
  );
}

function quadratic(a: number, b: number, c: number, t: number): number {
  return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
}

function easeInCubic(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t;
}

function SimpleMediaView({ item }: { item: SimpleMediaPlayback }): React.ReactElement {
  const parameters = item.message.parameters ?? {};
  const visual = item.message.visual;
  const imageEnabled = booleanParam(parameters.imageEnabled, true);
  const videoEnabled = booleanParam(parameters.videoEnabled, false);
  const audioEnabled = booleanParam(parameters.audioEnabled, false);
  const textEnabled = booleanParam(parameters.textEnabled, false);
  const backgroundEnabled = booleanParam(parameters.backgroundEnabled, false);
  const padding = numberParam(parameters.backgroundPadding, 24);
  const borderRadius = numberParam(parameters.backgroundBorderRadius, 18);
  const scale = visual?.size.scale ?? 1;
  const x = visual?.position.mode === "normalized" ? visual.position.x * 100 : 50;
  const y = visual?.position.mode === "normalized" ? visual.position.y * 100 : 50;
  const width = visual?.size.width ? `${visual.size.width}${visual.size.unit === "px" ? "px" : "%"}` : "auto";
  const height = visual?.size.height ? `${visual.size.height}${visual.size.unit === "px" ? "px" : "%"}` : "auto";
  const enterTransition = stringParam(parameters.enterTransition, "fade");
  const exitTransition = stringParam(parameters.exitTransition, "fade");

  return (
    <div
      className={`simple-media simple-enter-${enterTransition} simple-exit-${exitTransition}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width,
        height,
        opacity: visual?.opacity ?? 1,
        zIndex: visual?.zIndex ?? 10,
        "--simple-scale": String(scale),
        "--simple-duration": `${item.durationMs}ms`,
        "--simple-enter-ms": `${numberParam(parameters.enterDurationMs, 250)}ms`,
        "--simple-exit-ms": `${numberParam(parameters.exitDurationMs, 250)}ms`,
        padding: backgroundEnabled ? `${padding}px` : 0,
        borderRadius: backgroundEnabled ? `${borderRadius}px` : 0,
        backgroundColor: backgroundEnabled
          ? colorWithOpacity(stringParam(parameters.backgroundColor, "#000000"), numberParam(parameters.backgroundOpacity, 0.4))
          : "transparent"
      } as React.CSSProperties}
    >
      {imageEnabled && item.message.media?.imageUrl ? (
        <img
          alt=""
          className="simple-media-image"
          src={item.message.media.imageUrl}
          style={{ objectFit: fitParam(parameters.imageFit), opacity: numberParam(parameters.imageOpacity, 1) }}
        />
      ) : null}
      {videoEnabled && item.message.media?.videoUrl ? (
        <video
          className="simple-media-video"
          src={item.message.media.videoUrl}
          autoPlay
          playsInline
          loop={booleanParam(parameters.videoLoop, false)}
          muted={booleanParam(parameters.videoMuted, false)}
          style={{ objectFit: fitParam(parameters.videoFit) }}
        />
      ) : null}
      {audioEnabled && item.message.media?.audioUrl ? (
        <audio
          src={item.message.media.audioUrl}
          autoPlay
          style={{ display: "none" }}
        />
      ) : null}
      {textEnabled ? (
        <div
          className="simple-media-text"
          style={{
            color: stringParam(parameters.textColor, "#ffffff"),
            fontFamily: comboFontFamily(stringParam(parameters.fontFamily, "system-ui, sans-serif")),
            fontSize: `${numberParam(parameters.fontSize, 48)}px`,
            fontWeight: numberParam(parameters.fontWeight, 800)
          }}
        >
          {stringParam(parameters.fixedText, "New Effect")}
        </div>
      ) : null}
    </div>
  );
}

function BallRevealView(props: {
  item: BallRevealPlayback;
  waitingCount: number;
  chooseMedia: (message: EffectPlayMessage, excludedIds: Set<string>) => BallRevealMedia | null;
  onComplete: () => void;
}): React.ReactElement {
  const { item, waitingCount, chooseMedia, onComplete } = props;
  const parameters = item.message.parameters ?? {};
  const [failedIds, setFailedIds] = React.useState<Set<string>>(() => new Set());
  const [media, setMedia] = React.useState<BallRevealMedia | null>(() => chooseMedia(item.message, new Set()));
  const [phase, setPhase] = React.useState<"flight" | "reveal" | "fading">("flight");
  const [attempt, setAttempt] = React.useState(0);
  const [videoDurationMs, setVideoDurationMs] = React.useState(0);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const revealStartedAtRef = React.useRef(0);
  const travelDurationMs = numberParam(parameters.travelDurationMs, 900);
  const revealDurationMs = numberParam(parameters.revealDurationMs, 520);
  const imageDurationMs = Math.max(250, numberParam(parameters.imageDisplayDurationMs, 4000));
  const imageFadeStartMs = Math.max(0, Math.min(imageDurationMs, numberParam(parameters.imageFadeStartMs, 3000)));
  const videoFadeLeadMs = Math.max(0, numberParam(parameters.videoFadeLeadMs, 1000));
  const videoVolume = Math.max(0, Math.min(1, numberParam(parameters.videoVolume, 1)));
  const videoPlaybackRate = Math.max(0.25, Math.min(4, numberParam(parameters.videoPlaybackRate, 1)));

  const retryWithAnotherMedia = React.useCallback(() => {
    if (!media) {
      onComplete();
      return;
    }
    const nextFailed = new Set(failedIds);
    nextFailed.add(media.id);
    const next = chooseMedia(item.message, nextFailed);
    if (!next) {
      onComplete();
      return;
    }
    setFailedIds(nextFailed);
    setMedia(next);
    setVideoDurationMs(0);
    revealStartedAtRef.current = 0;
    setPhase("flight");
    setAttempt((value) => value + 1);
  }, [chooseMedia, failedIds, item.message, media, onComplete]);

  React.useEffect(() => {
    if (!media) {
      onComplete();
      return;
    }
    const timer = window.setTimeout(() => {
      revealStartedAtRef.current = performance.now();
      setPhase("reveal");
    }, Math.max(0, travelDurationMs));
    return () => window.clearTimeout(timer);
  }, [attempt, media, onComplete, travelDurationMs]);

  React.useEffect(() => {
    if (phase !== "reveal" || !media) return;
    const fadeAt = media.kind === "image" ? imageFadeStartMs : Math.max(0, videoDurationMs - videoFadeLeadMs);
    if (media.kind === "video" && videoDurationMs <= 0) return;
    const elapsed = Math.max(0, performance.now() - revealStartedAtRef.current);
    const fadeTimer = window.setTimeout(() => setPhase("fading"), Math.max(0, fadeAt - elapsed));
    return () => window.clearTimeout(fadeTimer);
  }, [imageFadeStartMs, media, phase, videoDurationMs, videoFadeLeadMs]);

  React.useEffect(() => {
    if (phase === "flight" || !media) return;
    const totalDuration = media.kind === "image" ? imageDurationMs : videoDurationMs;
    if (totalDuration <= 0) return;
    const elapsed = Math.max(0, performance.now() - revealStartedAtRef.current);
    const doneTimer = window.setTimeout(onComplete, Math.max(0, totalDuration - elapsed) + 100);
    return () => window.clearTimeout(doneTimer);
  }, [imageDurationMs, media, onComplete, phase, videoDurationMs]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !media || media.kind !== "video") return;
    video.playbackRate = videoPlaybackRate;
    video.volume = videoVolume;
    if (phase === "reveal" || phase === "fading") void video.play().catch(retryWithAnotherMedia);
  }, [media, phase, retryWithAnotherMedia, videoPlaybackRate, videoVolume]);

  React.useEffect(() => {
    if (phase !== "fading" || !videoRef.current || !media || media.kind !== "video") return;
    const video = videoRef.current;
    const startedAt = performance.now();
    const duration = Math.max(1, Math.min(videoFadeLeadMs, videoDurationMs));
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      video.volume = videoVolume * (1 - progress);
      if (progress >= 1) window.clearInterval(timer);
    }, 30);
    return () => window.clearInterval(timer);
  }, [media, phase, videoDurationMs, videoFadeLeadMs, videoVolume]);

  if (!media) return <></>;
  const targetX = numberParam(parameters.targetXPercent, 50);
  const targetY = numberParam(parameters.targetYPercent, 50);
  const sparkleCount = Math.max(0, Math.min(80, Math.round(numberParam(parameters.sparkleCount, 18))));
  const senderName = stringParam(item.message.runtimeData?.senderName, "Viewer");
  const ballUrl = stringParam(item.message.runtimeData?.ballUrl, defaultBallRevealUrl);
  const mediaFadeMs = media.kind === "image" ? Math.max(1, imageDurationMs - imageFadeStartMs) : Math.max(1, Math.min(videoFadeLeadMs, videoDurationMs || videoFadeLeadMs));

  return (
    <div
      className={`ball-reveal-stage phase-${phase}`}
      style={{
        "--br-x": `${targetX}%`,
        "--br-y": `${targetY}%`,
        "--br-start-dy": `${numberParam(parameters.startYPercent, 72) - targetY}vh`,
        "--br-arc": `${numberParam(parameters.arcHeightPercent, 38)}vh`,
        "--br-travel-ms": `${travelDurationMs}ms`,
        "--br-ball-size": `${numberParam(parameters.ballSizePx, 180)}px`,
        "--br-rotation": `${numberParam(parameters.ballRotationDeg, 900)}deg`,
        "--br-ball-fade-ms": `${numberParam(parameters.ballFadeDurationMs, 450)}ms`,
        "--br-glow-color": stringParam(parameters.glowColor, "#fff7b0"),
        "--br-glow-size": `${numberParam(parameters.glowSizePx, 360)}px`,
        "--br-glow-ms": `${numberParam(parameters.glowDurationMs, 650)}ms`,
        "--br-reveal-ms": `${revealDurationMs}ms`,
        "--br-media-width": `${numberParam(parameters.mediaWidthPx, 760)}px`,
        "--br-media-height": `${numberParam(parameters.mediaHeightPx, 760)}px`,
        "--br-media-fade-ms": `${mediaFadeMs}ms`,
        "--br-name-size": `${numberParam(parameters.senderNameFontSizePx, 42)}px`,
        "--br-name-color": stringParam(parameters.senderNameColor, "#ffffff"),
        zIndex: item.message.visual?.zIndex ?? 30
      } as React.CSSProperties}
    >
      <img
        key={`ball-${attempt}`}
        className={`ball-reveal-ball ${phase !== "flight" ? "arrived" : ""}`}
        src={ballUrl}
        alt=""
        onError={(event) => {
          if (event.currentTarget.src !== new URL(defaultBallRevealUrl, window.location.href).href) event.currentTarget.src = defaultBallRevealUrl;
        }}
      />
      {phase !== "flight" ? (
        <div className="ball-reveal-burst" aria-hidden="true">
          <span className="ball-reveal-glow" />
          {Array.from({ length: sparkleCount }, (_, index) => (
            <i
              key={index}
              style={{
                "--spark-angle": `${(360 / Math.max(1, sparkleCount)) * index}deg`,
                "--spark-distance": `${70 + (index % 5) * 24}px`,
                "--spark-delay": `${(index % 4) * 22}ms`
              } as React.CSSProperties}
            />
          ))}
        </div>
      ) : null}
      <div className="ball-reveal-media-wrap">
        {media.kind === "image" ? (
          <img key={`${media.id}-${attempt}`} className="ball-reveal-media" src={media.url} alt="" onError={retryWithAnotherMedia} style={{ objectFit: fitParam(parameters.mediaFit) }} />
        ) : (
          <video
            key={`${media.id}-${attempt}`}
            ref={videoRef}
            className="ball-reveal-media"
            src={media.url}
            playsInline
            preload="auto"
            onError={retryWithAnotherMedia}
            onEnded={onComplete}
            onLoadedMetadata={(event) => {
              const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 / videoPlaybackRate : 0;
              setVideoDurationMs(duration);
              event.currentTarget.volume = videoVolume;
            }}
            style={{ objectFit: fitParam(parameters.mediaFit) }}
          />
        )}
      </div>
      {booleanParam(parameters.senderNameEnabled, true) ? (
        <div className="ball-reveal-sender">
          <strong>{senderName}</strong>
          {waitingCount > 0 ? <small>待機 {waitingCount}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function chooseBallRevealMedia(
  message: EffectPlayMessage,
  excludedIds: Set<string>,
  decks: Map<string, { signature: string; deck: string[]; lastId?: string }>
): BallRevealMedia | null {
  const pool = ballRevealMediaPool(message).filter((item) => !excludedIds.has(item.id));
  if (pool.length === 0) return null;
  const key = message.effectConfigId ?? "ball-reveal";
  const signature = pool.map((item) => item.id).sort().join("|");
  let state = decks.get(key);
  if (!state || state.signature !== signature || state.deck.every((id) => !pool.some((item) => item.id === id))) {
    const deck = shuffle(pool.map((item) => item.id));
    if (deck.length > 1 && deck[0] === state?.lastId) [deck[0], deck[1]] = [deck[1]!, deck[0]!];
    state = { signature, deck, lastId: state?.lastId };
    decks.set(key, state);
  }
  while (state.deck.length > 0) {
    const id = state.deck.shift()!;
    const selected = pool.find((item) => item.id === id);
    if (selected) {
      state.lastId = id;
      return selected;
    }
  }
  decks.delete(key);
  return chooseBallRevealMedia(message, excludedIds, decks);
}

function ballRevealMediaPool(message: EffectPlayMessage): BallRevealMedia[] {
  const value = message.runtimeData?.mediaPool;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BallRevealMedia => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return typeof record.id === "string" && (record.kind === "image" || record.kind === "video") && typeof record.url === "string";
  });
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
  }
  return next;
}

function GiftComboTextObject({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  const [displayedCombo, setDisplayedCombo] = React.useState(0);
  const [clockNow, setClockNow] = React.useState(Date.now());
  const displayedRef = React.useRef(0);
  const accumulatorRef = React.useRef(0);
  const lastFrameRef = React.useRef(Date.now());
  const comboTextRef = React.useRef<HTMLSpanElement | null>(null);
  const targetCombo = Math.max(0, Math.round(numberParam(object.metadata?.targetCombo, 0)));
  const status = stringParam(object.metadata?.status, "counting");
  const finishAt = numberParam(object.metadata?.finishAt, Number.MAX_SAFE_INTEGER);
  const finishDurationMs = numberParam(object.metadata?.finishDurationMs, 520);
  const acceptanceDeadlineAt = numberParam(object.metadata?.acceptanceDeadlineAt, Number.MAX_SAFE_INTEGER);
  const blinkWarningMs = numberParam(object.metadata?.blinkWarningMs, 900);
  const fontFamily = stringParam(object.metadata?.fontFamily, "Impact");
  const fontUrl = stringParam(object.metadata?.fontUrl, "");

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = Date.now();
      const dt = Math.max(0, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const current = displayedRef.current;
      if (current < targetCombo) {
        const speed = comboAddsPerSecond(object, current, targetCombo);
        accumulatorRef.current += speed * dt;
        const frameStep = accumulatorRef.current >= 1 ? 1 : 0;
        if (frameStep > 0) {
          accumulatorRef.current -= frameStep;
          const next = Math.min(targetCombo, current + frameStep);
          displayedRef.current = next;
          setDisplayedCombo(next);
          comboTextRef.current?.animate(
            [
              { opacity: 0.85, transform: "translateY(22px) scale(0.72)" },
              { opacity: 1, transform: "translateY(-5px) scale(1.16)", offset: 0.58 },
              { opacity: 1, transform: "translateY(0) scale(1)" }
            ],
            { duration: 220, easing: "cubic-bezier(0.15, 1.35, 0.28, 1)" }
          );
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [object, targetCombo]);

  React.useEffect(() => {
    if (fontUrl) registerFontFace(fontFamily, fontUrl);
  }, [fontFamily, fontUrl]);

  React.useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  const text = stringParam(object.metadata?.displayLanguage, "english") === "japanese" ? `${displayedCombo}コンボ` : `${displayedCombo} combo`;
  const exiting = status === "finishing" || clockNow >= finishAt;
  const warning = !exiting && blinkWarningMs > 0 && acceptanceDeadlineAt - clockNow <= blinkWarningMs;

  return (
    <div
      className={`gift-combo-text-object ${exiting ? "finishing" : ""} ${warning ? "deadline-warning" : ""}`}
      style={{
        left: `${numberParam(object.metadata?.xPercent, 0) + 50}%`,
        top: `${numberParam(object.metadata?.yPercent, 0) + 50}%`,
        opacity: numberParam(object.metadata?.opacity, 1),
        zIndex: numberParam(object.metadata?.zIndex, 20),
        "--combo-opacity": String(numberParam(object.metadata?.opacity, 1)),
        "--combo-scale": String(object.spawn.scale ?? 1),
        "--combo-font-family": comboFontFamily(fontFamily),
        "--combo-font-size": `${numberParam(object.metadata?.fontSizePx, 96)}px`,
        "--combo-font-weight": String(numberParam(object.metadata?.fontWeight, 900)),
        "--combo-letter-spacing": `${numberParam(object.metadata?.letterSpacingPx, 0)}px`,
        "--combo-solid-color": stringParam(object.metadata?.solidColor, "#ffffff"),
        "--combo-cyan": stringParam(object.metadata?.cyan, "#00E5FF"),
        "--combo-magenta": stringParam(object.metadata?.magenta, "#FF2BD6"),
        "--combo-yellow": stringParam(object.metadata?.yellow, "#FFE600"),
        "--combo-white": stringParam(object.metadata?.rainbowWhite, "#FFFFFF"),
        "--combo-green": stringParam(object.metadata?.rainbowGreen, "#7CFF4F"),
        "--combo-rainbow-ms": `${numberParam(object.metadata?.rainbowDurationMs, 2000)}ms`,
        "--combo-stroke-color": colorWithOpacity(stringParam(object.metadata?.strokeColor, "#000000"), numberParam(object.metadata?.strokeOpacity, 1)),
        "--combo-stroke-width": `${booleanParam(object.metadata?.strokeEnabled, true) ? numberParam(object.metadata?.strokeWidthPx, 6) : 0}px`,
        "--combo-appear-ms": `${numberParam(object.metadata?.appearDurationMs, 260)}ms`,
        "--combo-finish-ms": `${finishDurationMs}ms`
      } as React.CSSProperties}
    >
      <span ref={comboTextRef} className={stringParam(object.metadata?.colorMode, "solid") === "cmy-rainbow-loop" ? "rainbow" : ""}>
        {text}
      </span>
    </div>
  );
}

function comboAddsPerSecond(object: RuntimeEffectObject, displayedCombo: number, targetCombo: number): number {
  if (stringParam(object.metadata?.countSpeedMode, "accelerating") === "constant") {
    return Math.max(1, numberParam(object.metadata?.constantAddsPerSecond, 20));
  }
  const base = Math.max(1, numberParam(object.metadata?.acceleratingBaseAddsPerSecond, 16));
  const max = Math.max(base, numberParam(object.metadata?.acceleratingMaxAddsPerSecond, 420));
  const strength = Math.max(0.0001, numberParam(object.metadata?.accelerationStrength, 0.01));
  const normalized = 1 - Math.exp(-strength * Math.max(displayedCombo, targetCombo));
  return base + (max - base) * normalized;
}

function comboFontFamily(family: string): string {
  const families = family
    .split(",")
    .map((item) => item.replace(/"/gu, "").trim())
    .filter(Boolean);
  const quotedFamilies = (families.length ? families : ["Impact"]).map((item) => genericFontFamilies.has(item.toLowerCase()) ? item : `"${item}"`);
  return [...quotedFamilies, "\"Noto Sans JP\"", "\"Yu Gothic\"", "\"Meiryo\"", "sans-serif"].join(", ");
}

const genericFontFamilies = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

const registeredFontFaces = new Set<string>();

function useUploadedFonts(): void {
  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/system/fonts")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { fonts?: OverlayFontInfo[] } | null) => {
        if (cancelled || !Array.isArray(data?.fonts)) return;
        for (const font of data.fonts) {
          if (font.source === "asset" && font.contentUrl) {
            registerFontFace(font.family, font.contentUrl);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
}

function registerFontFace(family: string, url: string): void {
  const normalizedFamily = family.trim();
  if (!normalizedFamily || !url) return;
  const key = `${normalizedFamily}\n${url}`;
  if (registeredFontFaces.has(key)) return;
  registeredFontFaces.add(key);
  const style = document.createElement("style");
  style.dataset.uploadedFont = normalizedFamily;
  style.textContent = `@font-face{font-family:"${cssString(normalizedFamily)}";src:url("${cssUrl(url)}");font-display:swap;}`;
  document.head.appendChild(style);
}

function cssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function cssUrl(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\)/gu, "\\)");
}

function RuntimeObjectView({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  return (
    <div
      className="runtime-object"
      style={{
        left: `${object.spawn.normalizedX * 100}%`,
        top: `${object.spawn.normalizedY * 100}%`,
        "--object-rotate": `${object.spawn.rotation ?? 0}deg`,
        "--object-scale": `${object.spawn.scale ?? 1}`
      } as React.CSSProperties}
      data-runtime-state={object.state}
    >
      <span>
        {object.hitPoints ?? "-"} / {object.maxHitPoints ?? "-"}
      </span>
    </div>
  );
}
function upsertObject(snapshot: RuntimeOverlaySnapshot | null, object: RuntimeEffectObject): RuntimeOverlaySnapshot {
  const base = snapshot ?? { overlayId: object.overlayId, objects: [], generatedAt: new Date().toISOString() };
  const existingIndex = base.objects.findIndex((item) => item.objectId === object.objectId);
  if (existingIndex === -1) return { ...base, objects: [object, ...base.objects] };
  return {
    ...base,
    objects: base.objects.map((item) => (item.objectId === object.objectId ? object : item))
  };
}

function removeObject(snapshot: RuntimeOverlaySnapshot | null, objectId: string): RuntimeOverlaySnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, objects: snapshot.objects.filter((object) => object.objectId !== objectId) };
}

function booleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function fitParam(value: unknown): React.CSSProperties["objectFit"] {
  if (value === "cover" || value === "fill" || value === "none") return value;
  return "contain";
}

function colorWithOpacity(color: string, opacity: number): string {
  const normalized = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(0, 0, 0, ${Math.max(0, Math.min(1, opacity))})`;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, opacity))})`;
}

createRoot(document.getElementById("root")!).render(<RootApp />);
