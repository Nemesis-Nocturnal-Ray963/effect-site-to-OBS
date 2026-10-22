import type { AppAudioComboMessage, SoundboardAudioMessage } from "@obs-effect/shared-types";

interface ComboAudioState {
  message: AppAudioComboMessage;
  displayedCombo: number;
  accumulator: number;
  lastFrameAt: number;
  lastSoundAt: number;
  frameId: number | null;
}

const comboStates = new Map<string, ComboAudioState>();
const activeAudio = new Set<HTMLAudioElement>();
const soundboardSourcesByPad = new Map<string, Set<AudioBufferSourceNode>>();
const soundboardMediaAudioByPad = new Map<string, Set<HTMLAudioElement>>();
const soundboardBufferCache = new Map<string, Promise<AudioBuffer>>();
const audioTabId = `audio-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const audioOwnerKey = "obs-effect-audio-owner";
let audioOutputInitialized = false;
let soundboardAudioContext: AudioContext | null = null;

export type AppAudioOutputStatus = "ready" | "needs-interaction" | "unsupported" | "error";

let appAudioOutputStatus: AppAudioOutputStatus = "needs-interaction";
const appAudioOutputListeners = new Set<() => void>();

export function getAppAudioOutputStatus(): AppAudioOutputStatus {
  return appAudioOutputStatus;
}

export function subscribeAppAudioOutputStatus(listener: () => void): () => void {
  appAudioOutputListeners.add(listener);
  return () => appAudioOutputListeners.delete(listener);
}

function setAppAudioOutputStatus(status: AppAudioOutputStatus): void {
  if (appAudioOutputStatus === status) return;
  appAudioOutputStatus = status;
  for (const listener of appAudioOutputListeners) listener();
}

export function initializeAppAudioOutput(): () => void {
  if (audioOutputInitialized) return () => undefined;
  audioOutputInitialized = true;
  claimAudioOutput();
  const heartbeat = window.setInterval(claimAudioOutput, 2000);
  const unlock = () => {
    claimAudioOutput(true);
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      setAppAudioOutputStatus("unsupported");
      return;
    }
    soundboardAudioContext ??= new AudioContextConstructor();
    void soundboardAudioContext.resume()
      .then(() => setAppAudioOutputStatus(soundboardAudioContext?.state === "running" ? "ready" : "needs-interaction"))
      .catch(() => setAppAudioOutputStatus("needs-interaction"));
  };
  unlock();
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
  window.addEventListener("focus", unlock);
  return () => {
    window.clearInterval(heartbeat);
    window.removeEventListener("focus", unlock);
    const owner = readAudioOwner();
    if (owner?.id === audioTabId) localStorage.removeItem(audioOwnerKey);
    audioOutputInitialized = false;
  };
}

export function handleSoundboardAudioMessage(message: SoundboardAudioMessage): void {
  if (!isAudioOutputOwner()) return;
  if (message.action === "stop-all") {
    stopAllAppAudio();
    return;
  }
  if ((!message.soundUrl && !message.mediaSoundUrl) || !message.padId) return;
  if (message.retriggerMode === "restart") stopPadAudio(message.padId);
  if (message.soundUrl) void playSoundboardAudio(message);
  if (message.mediaSoundUrl) void playSoundboardMediaAudio(message);
}

function stopPadAudio(padId: string): void {
  for (const source of soundboardSourcesByPad.get(padId) ?? []) {
    try { source.stop(); } catch { /* The source may already have ended. */ }
  }
  soundboardSourcesByPad.delete(padId);
  for (const audio of soundboardMediaAudioByPad.get(padId) ?? []) {
    audio.pause();
    audio.currentTime = 0;
    activeAudio.delete(audio);
  }
  soundboardMediaAudioByPad.delete(padId);
}

function stopAllAppAudio(): void {
  for (const audio of activeAudio) {
    audio.pause();
    audio.currentTime = 0;
  }
  activeAudio.clear();
  const padIds = new Set([...soundboardSourcesByPad.keys(), ...soundboardMediaAudioByPad.keys()]);
  for (const padId of padIds) stopPadAudio(padId);
}

async function playSoundboardAudio(message: SoundboardAudioMessage): Promise<void> {
  if (!message.soundUrl || !message.padId) return;
  const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    setAppAudioOutputStatus("unsupported");
    return;
  }
  soundboardAudioContext ??= new AudioContextConstructor();
  await soundboardAudioContext.resume().catch(() => undefined);
  if (soundboardAudioContext.state !== "running") {
    setAppAudioOutputStatus("needs-interaction");
    return;
  }
  setAppAudioOutputStatus("ready");
  const context = soundboardAudioContext;
  const cached = soundboardBufferCache.get(message.soundUrl) ?? fetch(message.soundUrl)
    .then((response) => {
      if (!response.ok) throw new Error("Audio asset could not be loaded");
      return response.arrayBuffer();
    })
    .then((buffer) => context.decodeAudioData(buffer));
  soundboardBufferCache.set(message.soundUrl, cached);
  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = await cached;
    gain.gain.value = Math.max(0, Math.min(1, message.volume ?? 0.8));
    source.connect(gain).connect(context.destination);
    const sources = soundboardSourcesByPad.get(message.padId) ?? new Set<AudioBufferSourceNode>();
    sources.add(source);
    soundboardSourcesByPad.set(message.padId, sources);
    source.addEventListener("ended", () => {
      sources.delete(source);
      if (sources.size === 0) soundboardSourcesByPad.delete(message.padId!);
    }, { once: true });
    source.start();
    setAppAudioOutputStatus("ready");
  } catch {
    soundboardBufferCache.delete(message.soundUrl);
    setAppAudioOutputStatus("error");
  }
}

async function playSoundboardMediaAudio(message: SoundboardAudioMessage): Promise<void> {
  if (!message.mediaSoundUrl || !message.padId) return;
  const audio = new Audio(message.mediaSoundUrl);
  audio.volume = Math.max(0, Math.min(1, message.volume ?? 0.8));
  const audios = soundboardMediaAudioByPad.get(message.padId) ?? new Set<HTMLAudioElement>();
  const cleanup = () => {
    audios.delete(audio);
    activeAudio.delete(audio);
    if (audios.size === 0) soundboardMediaAudioByPad.delete(message.padId!);
  };
  audios.add(audio);
  activeAudio.add(audio);
  soundboardMediaAudioByPad.set(message.padId, audios);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  try {
    await audio.play();
    setAppAudioOutputStatus("ready");
  } catch {
    cleanup();
    setAppAudioOutputStatus("needs-interaction");
  }
}

function claimAudioOutput(force = false): void {
  const owner = readAudioOwner();
  if (force || !owner || Date.now() - owner.updatedAt > 5000 || owner.id === audioTabId) {
    localStorage.setItem(audioOwnerKey, JSON.stringify({ id: audioTabId, updatedAt: Date.now() }));
  }
}

function isAudioOutputOwner(): boolean {
  claimAudioOutput();
  return readAudioOwner()?.id === audioTabId;
}

function readAudioOwner(): { id: string; updatedAt: number } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(audioOwnerKey) ?? "null") as { id?: unknown; updatedAt?: unknown } | null;
    return parsed && typeof parsed.id === "string" && typeof parsed.updatedAt === "number"
      ? { id: parsed.id, updatedAt: parsed.updatedAt }
      : null;
  } catch {
    return null;
  }
}

export function handleAppAudioComboMessage(message: AppAudioComboMessage): void {
  if (message.action === "stop") {
    stopComboAudio(message.queueId);
    return;
  }

  const current = comboStates.get(message.queueId);
  if (current) {
    current.message = message;
    current.lastFrameAt = performance.now();
    if (current.frameId === null) current.frameId = window.requestAnimationFrame(() => tickComboAudio(message.queueId));
    return;
  }

  const state: ComboAudioState = {
    message,
    displayedCombo: 0,
    accumulator: 0,
    lastFrameAt: performance.now(),
    lastSoundAt: 0,
    frameId: null
  };
  comboStates.set(message.queueId, state);
  state.frameId = window.requestAnimationFrame(() => tickComboAudio(message.queueId));
}

function tickComboAudio(queueId: string): void {
  const state = comboStates.get(queueId);
  if (!state) return;

  state.frameId = null;
  const targetCombo = Math.max(0, Math.round(numberParam(state.message.targetCombo, 0)));
  if (state.displayedCombo < targetCombo) {
    const now = performance.now();
    const dt = Math.max(0, (now - state.lastFrameAt) / 1000);
    state.lastFrameAt = now;
    state.accumulator += comboAddsPerSecond(state.message, state.displayedCombo, targetCombo) * dt;
    if (state.accumulator >= 1) {
      state.accumulator -= 1;
      state.displayedCombo += 1;
      playComboSound(state.message, state.displayedCombo, state);
    }
    state.frameId = window.requestAnimationFrame(() => tickComboAudio(queueId));
  }
}

function stopComboAudio(queueId: string): void {
  const state = comboStates.get(queueId);
  if (state?.frameId != null) window.cancelAnimationFrame(state.frameId);
  comboStates.delete(queueId);
}

function comboAddsPerSecond(message: AppAudioComboMessage, displayedCombo: number, targetCombo: number): number {
  if (message.countSpeedMode === "constant") {
    return Math.max(1, numberParam(message.constantAddsPerSecond, 20));
  }
  const base = Math.max(1, numberParam(message.acceleratingBaseAddsPerSecond, 16));
  const max = Math.max(base, numberParam(message.acceleratingMaxAddsPerSecond, 420));
  const strength = Math.max(0.0001, numberParam(message.accelerationStrength, 0.01));
  const normalized = 1 - Math.exp(-strength * Math.max(displayedCombo, targetCombo));
  return base + (max - base) * normalized;
}

function playComboSound(message: AppAudioComboMessage, combo: number, state: ComboAudioState): void {
  if (!message.soundUrl) return;
  const now = Date.now();
  const interval = Math.max(0, numberParam(message.minimumSoundIntervalMs, 40));
  if (now - state.lastSoundAt < interval) return;
  state.lastSoundAt = now;

  const audio = new Audio(message.soundUrl);
  activeAudio.add(audio);
  audio.addEventListener("ended", () => activeAudio.delete(audio), { once: true });
  audio.addEventListener("error", () => activeAudio.delete(audio), { once: true });
  audio.volume = Math.max(0, Math.min(1, numberParam(message.soundVolume, 0.5)));
  if (message.pitchEnabled ?? true) {
    const base = Math.max(0.1, numberParam(message.basePlaybackRate, 1));
    const max = Math.max(base, numberParam(message.maxPlaybackRate, 1.8));
    const strength = Math.max(0.0001, numberParam(message.pitchCurveStrength, 0.01));
    const progress = Math.max(0, Math.min(1, combo * strength));
    const curved = progress * progress * (3 - 2 * progress);
    audio.playbackRate = base + (max - base) * curved;
  }
  void audio.play().catch(() => activeAudio.delete(audio));
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
