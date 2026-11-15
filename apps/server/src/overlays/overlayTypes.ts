import type { OverlayId } from "@obs-effect/shared-types";

export const INITIAL_OVERLAY_COUNT = 10;
export const MAX_OVERLAY_COUNT = 64;
export const overlayIds = Array.from({ length: INITIAL_OVERLAY_COUNT }, (_, index) => index + 1) as OverlayId[];

export function parseOverlayId(value: unknown): OverlayId | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_OVERLAY_COUNT
    ? (parsed as OverlayId)
    : null;
}

export function defaultOverlayId(value: unknown): OverlayId {
  return parseOverlayId(value) ?? 1;
}
