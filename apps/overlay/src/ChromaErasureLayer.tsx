import React from "react";
import type { EffectPlayMessage } from "@obs-effect/shared-types";

export interface ChromaErasurePlayback {
  key: string;
  message: EffectPlayMessage;
  revision: number;
}

export function ChromaErasureLayer({ item }: { item: ChromaErasurePlayback }): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const progressRef = React.useRef(chromaProgressAfterTrigger(
    0,
    item.message.parameters,
    String(item.message.runtimeData?.triggerType ?? "gift")
  ));
  const lastFrameRef = React.useRef<number | null>(null);
  const initialRevisionRef = React.useRef(item.revision);
  const pulseUntilRef = React.useRef(0);
  const messageRef = React.useRef(item.message);
  messageRef.current = item.message;

  React.useEffect(() => {
    if (item.revision === initialRevisionRef.current) return;
    const triggerType = String(item.message.runtimeData?.triggerType ?? "gift");
    if (isResetTrigger(triggerType)) {
      progressRef.current = 0;
    } else {
      progressRef.current = chromaProgressAfterTrigger(progressRef.current, item.message.parameters, triggerType);
      if (item.message.parameters?.recoveryPulseEnabled !== false) pulseUntilRef.current = performance.now() + 650;
    }
  }, [item.message, item.revision]);

  React.useEffect(() => {
    let frame = 0;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const render = (time: number): void => {
      const message = messageRef.current;
      const previous = lastFrameRef.current ?? time;
      const dt = Math.min(50, Math.max(0, time - previous));
      lastFrameRef.current = time;
      const durationMs = Math.max(1000, numberValue(message.parameters?.countdownSeconds, 180) * 1000);
      progressRef.current = chromaProgressAfterTime(progressRef.current, message.parameters, dt, durationMs);

      const width = window.innerWidth || 1920;
      const height = window.innerHeight || 1080;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const context = canvas.getContext("2d");
      if (context) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        const pulse = Math.max(0, (pulseUntilRef.current - time) / 650);
        const inverted = message.parameters?.inverted === true;
        const pulseOffset = pulse * 0.035 * Math.sin((1 - pulse) * Math.PI) * (inverted ? 1 : -1);
        const progress = clamp(progressRef.current + pulseOffset, 0, 1);
        drawErasure(context, width, height, progress, message);
      }
      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="chroma-erasure-canvas"
      style={{
        opacity: item.message.visual?.opacity ?? 1,
        zIndex: item.message.visual?.zIndex ?? 900
      }}
    />
  );
}

export function chromaProgressAfterTrigger(
  current: number,
  parameters: Record<string, unknown> | undefined,
  triggerType: string
): number {
  if (isResetTrigger(triggerType)) return 0;
  if (parameters?.inverted === true) {
    return clamp(current + numberValue(parameters.giftErasePercent, 10) / 100, 0, 1);
  }
  const durationSeconds = Math.max(1, numberValue(parameters?.countdownSeconds, 180));
  return clamp(current - numberValue(parameters?.giftRecoverySeconds, 15) / durationSeconds, 0, 1);
}

function isResetTrigger(triggerType: string): boolean {
  return triggerType === "manual" || triggerType === "test" || triggerType === "preset-test" || triggerType === "time-trigger";
}

export function chromaProgressAfterTime(
  current: number,
  parameters: Record<string, unknown> | undefined,
  deltaMs: number,
  durationMs: number
): number {
  if (parameters?.inverted === true) return clamp(current, 0, 1);
  return clamp(current + Math.max(0, deltaMs) / Math.max(1000, durationMs), 0, 1);
}

function drawErasure(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  message: EffectPlayMessage
): void {
  const parameters = message.parameters ?? {};
  const color = stringValue(parameters.chromaColor, "#00ff00");
  if (progress >= 0.9999) {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    return;
  }

  const thickness = Math.max(2, numberValue(parameters.lineThicknessPx, 20));
  const gap = Math.max(0, numberValue(parameters.lineGapPx, 8));
  const jitter = Math.max(0, numberValue(parameters.lineJitterPx, 9));
  const floodFraction = clamp(numberValue(parameters.finalFloodPercent, 18) / 100, 0.05, 0.5);
  const scanEnd = 1 - floodFraction;
  const scanProgress = clamp(progress / scanEnd, 0, 1);
  const sealProgress = clamp((progress - scanEnd) / floodFraction, 0, 1);
  const pitch = Math.max(2, thickness + gap);
  const rowCount = Math.ceil(height / pitch) + 2;
  const direction = stringValue(parameters.direction, "alternating");

  context.strokeStyle = color;
  context.lineCap = "square";
  context.lineJoin = "round";
  context.lineWidth = thickness + gap * easeOutCubic(sealProgress) * 1.18;

  for (let row = -1; row < rowCount; row += 1) {
    const randomDelay = hash(row * 97 + 31);
    const local = clamp(scanProgress * 1.22 - randomDelay * 0.22, 0, 1);
    if (local <= 0) continue;
    const fromRight = direction === "right-to-left" || (direction === "alternating" && row % 2 !== 0);
    const length = width * easeOutCubic(local);
    const startX = fromRight ? width : 0;
    const endX = fromRight ? width - length : length;
    const baseY = row * pitch + pitch / 2;
    const segments = Math.max(2, Math.ceil(length / 90));
    context.beginPath();
    context.moveTo(startX, baseY);
    for (let segment = 1; segment <= segments; segment += 1) {
      const ratio = segment / segments;
      const x = startX + (endX - startX) * ratio;
      const edgeEnergy = 0.35 + ratio * 0.65;
      const yNoise = (hash(row * 701 + segment * 43) - 0.5) * 2 * jitter * edgeEnergy;
      context.lineTo(x, baseY + yNoise);
    }
    context.stroke();

    if (local > 0.18 && local < 0.98) {
      const shardLength = Math.min(46 + jitter * 3, length * 0.16);
      const shardY = baseY + (hash(row * 211) - 0.5) * pitch;
      context.lineWidth = Math.max(2, thickness * 0.24);
      context.beginPath();
      context.moveTo(endX, shardY);
      context.lineTo(endX + (fromRight ? 1 : -1) * shardLength, shardY + (hash(row * 313) - 0.5) * jitter * 2);
      context.stroke();
      context.lineWidth = thickness + gap * easeOutCubic(sealProgress) * 1.18;
    }
  }

  if (sealProgress > 0.72) {
    context.globalAlpha = clamp((sealProgress - 0.72) / 0.28, 0, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
  }
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
