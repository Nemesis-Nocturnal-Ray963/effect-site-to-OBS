import type { OverlayId } from "@obs-effect/shared-types";

export const overlayIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const satisfies readonly OverlayId[];

export function parseOverlayId(value: unknown): OverlayId | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return overlayIds.includes(parsed as OverlayId) ? (parsed as OverlayId) : null;
}

export function defaultOverlayId(value: unknown): OverlayId {
  return parseOverlayId(value) ?? 1;
}
