import { randomUUID } from "node:crypto";
import type { OverlayId, RuntimeEffectObject, RuntimeOverlaySnapshot } from "@obs-effect/shared-types";

export interface CreateRuntimeObjectInput {
  overlayId: OverlayId;
  executionId?: string;
  effectConfigId?: string;
  objectType?: RuntimeEffectObject["objectType"];
  interactive?: boolean;
  maxHitPoints?: number;
  normalizedX?: number;
  normalizedY?: number;
  velocityX?: number;
  velocityY?: number;
  rotation?: number;
  rotationSpeed?: number;
  scale?: number;
  assetId?: string;
  contentUrl?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export class RuntimeEffectObjectStore {
  private readonly objects = new Map<string, RuntimeEffectObject>();
  private readonly versions = new Map<OverlayId, number>();

  create(input: CreateRuntimeObjectInput, now: string): RuntimeEffectObject {
    const maxHitPoints = Math.max(1, Math.round(input.maxHitPoints ?? 5));
    const object: RuntimeEffectObject = {
      objectId: randomUUID(),
      overlayId: input.overlayId,
      executionId: input.executionId ?? `runtime-${Date.now()}`,
      effectConfigId: input.effectConfigId ?? "mock-interactive",
      objectType: input.objectType ?? "falling-image",
      state: "active",
      interactive: input.interactive ?? true,
      hitPoints: maxHitPoints,
      maxHitPoints,
      spawn: {
        normalizedX: clamp(input.normalizedX ?? Math.random(), 0, 1),
        normalizedY: clamp(input.normalizedY ?? Math.random(), -1, 1.2),
        velocityX: input.velocityX,
        velocityY: input.velocityY ?? 0.06,
        rotation: input.rotation ?? Math.round(Math.random() * 360),
        rotationSpeed: input.rotationSpeed ?? 24,
        scale: input.scale ?? 1,
        randomSeed: randomUUID()
      },
      asset: input.assetId || input.contentUrl ? { assetId: input.assetId, contentUrl: input.contentUrl } : undefined,
      createdAt: now,
      expiresAt: input.expiresAt,
      metadata: input.metadata
    };
    this.objects.set(object.objectId, object);
    this.bumpVersion(object.overlayId);
    return object;
  }

  get(overlayId: OverlayId, objectId: string): RuntimeEffectObject | null {
    const object = this.objects.get(objectId);
    return object && object.overlayId === overlayId ? object : null;
  }

  list(overlayId: OverlayId): RuntimeEffectObject[] {
    this.expire(new Date().toISOString());
    return [...this.objects.values()].filter((object) => object.overlayId === overlayId && object.state !== "destroyed");
  }

  snapshot(overlayId: OverlayId, generatedAt: string): RuntimeOverlaySnapshot {
    return { overlayId, objects: this.list(overlayId), generatedAt };
  }

  hit(overlayId: OverlayId, objectId: string, damage: number, now: string): RuntimeEffectObject | null {
    const object = this.get(overlayId, objectId);
    if (!object || object.state !== "active" || !object.interactive) return null;
    const nextHp = Math.max(0, (object.hitPoints ?? 1) - Math.max(1, Math.round(damage)));
    const updated: RuntimeEffectObject = {
      ...object,
      hitPoints: nextHp,
      state: nextHp <= 0 ? "destroyed" : object.state,
      destroyedAt: nextHp <= 0 ? now : object.destroyedAt
    };
    this.objects.set(objectId, updated);
    this.bumpVersion(overlayId);
    return updated;
  }

  destroy(overlayId: OverlayId, objectId: string, now: string): RuntimeEffectObject | null {
    const object = this.get(overlayId, objectId);
    if (!object || object.state === "destroyed") return null;
    const updated: RuntimeEffectObject = { ...object, state: "destroyed", hitPoints: 0, destroyedAt: now };
    this.objects.set(objectId, updated);
    this.bumpVersion(overlayId);
    return updated;
  }

  move(overlayId: OverlayId, objectId: string, normalizedX: number, normalizedY: number, now: string): RuntimeEffectObject | null {
    const object = this.get(overlayId, objectId);
    if (!object || object.state !== "active" || !object.interactive) return null;
    const updated: RuntimeEffectObject = {
      ...object,
      spawn: {
        ...object.spawn,
        normalizedX: clamp(normalizedX, 0, 1),
        normalizedY: clamp(normalizedY, 0, 1),
        velocityX: 0,
        velocityY: 0
      },
      metadata: {
        ...object.metadata,
        manuallyMovedAt: now
      }
    };
    this.objects.set(objectId, updated);
    this.bumpVersion(overlayId);
    return updated;
  }

  update(
    overlayId: OverlayId,
    objectId: string,
    patch: { expiresAt?: string; metadata?: Record<string, unknown> },
    now: string
  ): RuntimeEffectObject | null {
    const object = this.get(overlayId, objectId);
    if (!object || object.state === "destroyed") return null;
    const updated: RuntimeEffectObject = {
      ...object,
      expiresAt: patch.expiresAt ?? object.expiresAt,
      metadata: patch.metadata ? { ...object.metadata, ...patch.metadata, updatedAt: now } : object.metadata
    };
    this.objects.set(objectId, updated);
    this.bumpVersion(overlayId);
    return updated;
  }

  clear(overlayId: OverlayId, scope: "interactive" | "all", now: string): RuntimeEffectObject[] {
    const destroyed: RuntimeEffectObject[] = [];
    for (const object of this.objects.values()) {
      if (object.overlayId !== overlayId || object.state === "destroyed") continue;
      if (scope === "interactive" && !object.interactive) continue;
      const updated: RuntimeEffectObject = { ...object, state: "destroyed", hitPoints: 0, destroyedAt: now };
      this.objects.set(object.objectId, updated);
      this.bumpVersion(overlayId);
      destroyed.push(updated);
    }
    return destroyed;
  }

  stateVersion(overlayId: OverlayId): number {
    return this.versions.get(overlayId) ?? 0;
  }

  private expire(now: string): void {
    const nowMs = Date.parse(now);
    for (const object of this.objects.values()) {
      if (object.expiresAt && Date.parse(object.expiresAt) <= nowMs && object.state !== "destroyed") {
        this.objects.set(object.objectId, { ...object, state: "destroyed", destroyedAt: now });
        this.bumpVersion(object.overlayId);
      }
    }
  }

  private bumpVersion(overlayId: OverlayId): void {
    this.versions.set(overlayId, (this.versions.get(overlayId) ?? 0) + 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
