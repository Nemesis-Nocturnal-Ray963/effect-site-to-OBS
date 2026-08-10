import type { AppAudioComboMessage } from "@obs-effect/shared-types";

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
  if (state?.frameId !== null) window.cancelAnimationFrame(state.frameId);
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
