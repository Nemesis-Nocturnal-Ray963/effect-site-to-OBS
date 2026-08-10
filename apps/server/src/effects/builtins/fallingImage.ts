import type { AssetCatalogItem, EffectConfiguration, NormalizedEvent, RuntimeEffectObject } from "@obs-effect/shared-types";
import { loadCatalog } from "../../api/routes/assets.js";
import type { EffectDefinition } from "@obs-effect/shared-types";
import type { RuntimeInteractionService } from "../../runtime/RuntimeInteractionService.js";

export const fallingImageEffectDefinition: EffectDefinition = {
  id: "falling-image",
  kind: "falling-image",
  name: "Falling Image",
  description: "Spawn image assets that fall across the target overlay and can be clicked or deleted.",
  version: "1.0.0",
  supportsImage: true,
  supportsVideo: false,
  supportsAudio: true,
  supportsText: false,
  defaultDurationMs: 5000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      {
        key: "spawnCountMode",
        label: "Spawn count mode",
        type: "select",
        defaultValue: "fixed",
        options: [
          { value: "fixed", label: "Fixed" },
          { value: "event-value", label: "Event value" },
          { value: "multiplied", label: "Multiplied" }
        ]
      },
      { key: "fixedCount", label: "Fixed count", type: "number", defaultValue: 8, min: 1, max: 100, step: 1 },
      { key: "multiplier", label: "Multiplier", type: "number", defaultValue: 1, min: 0.1, max: 20, step: 0.1 },
      { key: "minimumCount", label: "Minimum count", type: "number", defaultValue: 1, min: 1, max: 100, step: 1 },
      { key: "maximumCount", label: "Maximum count", type: "number", defaultValue: 40, min: 1, max: 200, step: 1 },
      { key: "triggerDelayMs", label: "Trigger delay", type: "number", defaultValue: 0, min: 0, max: 60000, step: 50 },
      { key: "intervalBetweenObjectsMs", label: "Object interval", type: "number", defaultValue: 80, min: 0, max: 5000, step: 10 },
      {
        key: "spawnPattern",
        label: "Spawn pattern",
        type: "select",
        defaultValue: "stagger",
        options: [
          { value: "burst", label: "Burst" },
          { value: "stagger", label: "Stagger" }
        ]
      },
      { key: "startXMinPercent", label: "Start X min", type: "number", defaultValue: 5, min: 0, max: 100, step: 1 },
      { key: "startXMaxPercent", label: "Start X max", type: "number", defaultValue: 95, min: 0, max: 100, step: 1 },
      { key: "startYPercent", label: "Start Y", type: "number", defaultValue: -10, min: -100, max: 100, step: 1 },
      { key: "gravity", label: "Gravity", type: "number", defaultValue: 3, min: 0, max: 12, step: 0.1 },
      {
        key: "floorBehavior",
        label: "Floor behavior",
        type: "select",
        defaultValue: "bounce",
        options: [
          { value: "bounce", label: "Bounce on floor" },
          { value: "pass-through", label: "Pass through floor" }
        ]
      },
      { key: "objectCollisionEnabled", label: "Object collision", type: "boolean", defaultValue: true },
      { key: "bounceRestitution", label: "Bounce power", type: "number", defaultValue: 0.58, min: 0, max: 1, step: 0.01 },
      { key: "floorFriction", label: "Floor friction", type: "number", defaultValue: 0.82, min: 0, max: 1, step: 0.01 },
      { key: "velocityXMin", label: "Velocity X min", type: "number", defaultValue: -0.08, min: -1, max: 1, step: 0.01 },
      { key: "velocityXMax", label: "Velocity X max", type: "number", defaultValue: 0.08, min: -1, max: 1, step: 0.01 },
      { key: "velocityYMin", label: "Velocity Y min", type: "number", defaultValue: 0.08, min: -1, max: 1, step: 0.01 },
      { key: "velocityYMax", label: "Velocity Y max", type: "number", defaultValue: 0.16, min: -1, max: 1, step: 0.01 },
      { key: "rotationSpeedMin", label: "Rotation speed min", type: "number", defaultValue: -80, min: -720, max: 720, step: 1 },
      { key: "rotationSpeedMax", label: "Rotation speed max", type: "number", defaultValue: 80, min: -720, max: 720, step: 1 },
      { key: "scaleMin", label: "Scale min", type: "number", defaultValue: 0.65, min: 0.1, max: 5, step: 0.05 },
      { key: "scaleMax", label: "Scale max", type: "number", defaultValue: 1.15, min: 0.1, max: 5, step: 0.05 },
      { key: "lifetimeMs", label: "Lifetime", type: "number", defaultValue: 7000, min: 100, max: 120000, step: 100 },
      {
        key: "despawnMode",
        label: "Despawn mode",
        type: "select",
        defaultValue: "time-or-click",
        options: [
          { value: "time", label: "Time" },
          { value: "click", label: "Click" },
          { value: "time-or-click", label: "Time or click" },
          { value: "manual", label: "Manual" },
          { value: "out-of-bounds", label: "Out of bounds" }
        ]
      },
      { key: "interactionEnabled", label: "Interaction enabled", type: "boolean", defaultValue: true },
      { key: "maxHitPoints", label: "Hit points", type: "number", defaultValue: 1, min: 1, max: 100, step: 1 },
      { key: "clickDamage", label: "Click damage", type: "number", defaultValue: 1, min: 1, max: 100, step: 1 },
      {
        key: "audioPlayMode",
        label: "Audio play mode",
        type: "select",
        defaultValue: "disabled",
        options: [
          { value: "disabled", label: "Disabled" },
          { value: "once-per-trigger", label: "Once per trigger" },
          { value: "once-per-object", label: "Once per object" }
        ]
      },
      { key: "audioVolume", label: "Audio volume", type: "number", defaultValue: 0.8, min: 0, max: 1, step: 0.05 }
    ]
  }
};

export interface FallingImageExecutionResult {
  spawnedObjects: RuntimeEffectObject[];
  skipped: boolean;
  reason?: string;
}

interface FallingImageSettings {
  spawnCountMode: "fixed" | "event-value" | "multiplied";
  fixedCount: number;
  multiplier: number;
  minimumCount: number;
  maximumCount: number;
  triggerDelayMs: number;
  intervalBetweenObjectsMs: number;
  spawnPattern: "burst" | "stagger";
  startXMinPercent: number;
  startXMaxPercent: number;
  startYPercent: number;
  gravity: number;
  floorBehavior: "bounce" | "pass-through";
  objectCollisionEnabled: boolean;
  bounceRestitution: number;
  floorFriction: number;
  velocityXMin: number;
  velocityXMax: number;
  velocityYMin: number;
  velocityYMax: number;
  rotationSpeedMin: number;
  rotationSpeedMax: number;
  scaleMin: number;
  scaleMax: number;
  lifetimeMs: number;
  interactionEnabled: boolean;
  maxHitPoints: number;
  clickDamage: number;
}

export class FallingImageEffectService {
  constructor(
    private readonly rootDir: string,
    private readonly runtimeInteractionService: RuntimeInteractionService
  ) {}

  async execute(configuration: EffectConfiguration, event?: NormalizedEvent): Promise<FallingImageExecutionResult> {
    const imageAsset = await this.resolveImageAsset(configuration.media.imageAssetId);
    if (!imageAsset) {
      return { spawnedObjects: [], skipped: true, reason: "image asset is required" };
    }

    const settings = normalizeSettings(configuration.visual.parameters);
    const count = calculateFallingImageSpawnCount(settings, event);
    const spawnedObjects: RuntimeEffectObject[] = [];
    const executionId = `falling-image-${configuration.id}-${Date.now()}`;

    for (let index = 0; index < count; index += 1) {
      const delayMs =
        settings.triggerDelayMs + (settings.spawnPattern === "stagger" ? settings.intervalBetweenObjectsMs * index : 0);
      const create = () => {
        const object = this.runtimeInteractionService.createObject({
          overlayId: configuration.targetOverlayId,
          executionId,
          effectConfigId: configuration.id,
          objectType: "falling-image",
          interactive: settings.interactionEnabled,
          maxHitPoints: settings.maxHitPoints,
          normalizedX: randomPercent(settings.startXMinPercent, settings.startXMaxPercent),
          normalizedY: settings.startYPercent / 100,
          velocityX: randomBetween(settings.velocityXMin, settings.velocityXMax),
          velocityY: randomBetween(settings.velocityYMin, settings.velocityYMax),
          rotation: Math.round(Math.random() * 360),
          rotationSpeed: randomBetween(settings.rotationSpeedMin, settings.rotationSpeedMax),
          scale: randomBetween(settings.scaleMin, settings.scaleMax),
          assetId: imageAsset.id,
          contentUrl: imageAsset.contentUrl,
          expiresAt: new Date(Date.now() + delayMs + settings.lifetimeMs).toISOString(),
          metadata: {
            index,
            count,
            lifetimeMs: settings.lifetimeMs,
            delayMs,
            gravity: settings.gravity,
            floorBehavior: settings.floorBehavior,
            objectCollisionEnabled: settings.objectCollisionEnabled,
            bounceRestitution: settings.bounceRestitution,
            floorFriction: settings.floorFriction,
            clickDamage: settings.clickDamage,
            eventId: event?.eventId,
            eventType: event?.type
          }
        });
        spawnedObjects.push(object);
      };

      if (delayMs > 0) {
        setTimeout(create, delayMs);
      } else {
        create();
      }
    }

    return { spawnedObjects, skipped: false };
  }

  private async resolveImageAsset(assetId: string | undefined): Promise<AssetCatalogItem | null> {
    if (!assetId) return null;
    const assets = await loadCatalog(this.rootDir);
    const asset = assets.find((item) => item.id === assetId && item.kind === "image");
    return asset ?? null;
  }
}

export function calculateFallingImageSpawnCount(settings: Pick<FallingImageSettings, "spawnCountMode" | "fixedCount" | "multiplier" | "minimumCount" | "maximumCount">, event?: NormalizedEvent): number {
  const eventValue = eventValueForSpawn(event);
  const raw =
    settings.spawnCountMode === "fixed"
      ? settings.fixedCount
      : settings.spawnCountMode === "event-value"
        ? eventValue
        : eventValue * settings.multiplier;
  return Math.round(clamp(raw, settings.minimumCount, settings.maximumCount));
}

function normalizeSettings(parameters: Record<string, unknown>): FallingImageSettings {
  const minX = numberParam(parameters.startXMinPercent, 5);
  const maxX = numberParam(parameters.startXMaxPercent, 95);
  const minScale = numberParam(parameters.scaleMin, 0.65);
  const maxScale = numberParam(parameters.scaleMax, 1.15);
  const minimumCount = integerParam(parameters.minimumCount, 1);
  const maximumCount = integerParam(parameters.maximumCount, 40);
  return {
    spawnCountMode: enumParam(parameters.spawnCountMode, ["fixed", "event-value", "multiplied"], "fixed"),
    fixedCount: integerParam(parameters.fixedCount, 8),
    multiplier: numberParam(parameters.multiplier, 1),
    minimumCount: Math.min(minimumCount, maximumCount),
    maximumCount: Math.max(minimumCount, maximumCount),
    triggerDelayMs: integerParam(parameters.triggerDelayMs, 0),
    intervalBetweenObjectsMs: integerParam(parameters.intervalBetweenObjectsMs, 80),
    spawnPattern: enumParam(parameters.spawnPattern, ["burst", "stagger"], "stagger"),
    startXMinPercent: Math.min(minX, maxX),
    startXMaxPercent: Math.max(minX, maxX),
    startYPercent: numberParam(parameters.startYPercent, -10),
    gravity: numberParam(parameters.gravity, 3),
    floorBehavior: enumParam(parameters.floorBehavior, ["bounce", "pass-through"], "bounce"),
    objectCollisionEnabled: booleanParam(parameters.objectCollisionEnabled, true),
    bounceRestitution: clamp(numberParam(parameters.bounceRestitution, 0.58), 0, 1),
    floorFriction: clamp(numberParam(parameters.floorFriction, 0.82), 0, 1),
    velocityXMin: numberParam(parameters.velocityXMin, -0.08),
    velocityXMax: numberParam(parameters.velocityXMax, 0.08),
    velocityYMin: numberParam(parameters.velocityYMin, 0.08),
    velocityYMax: numberParam(parameters.velocityYMax, 0.16),
    rotationSpeedMin: numberParam(parameters.rotationSpeedMin, -80),
    rotationSpeedMax: numberParam(parameters.rotationSpeedMax, 80),
    scaleMin: Math.min(minScale, maxScale),
    scaleMax: Math.max(minScale, maxScale),
    lifetimeMs: integerParam(parameters.lifetimeMs, 7000),
    interactionEnabled: booleanParam(parameters.interactionEnabled, true),
    maxHitPoints: integerParam(parameters.maxHitPoints, 1),
    clickDamage: integerParam(parameters.clickDamage, 1)
  };
}

function eventValueForSpawn(event?: NormalizedEvent): number {
  if (!event) return 1;
  if (event.type === "gift" || event.type === "gift-streak-start" || event.type === "gift-streak-update" || event.type === "gift-streak-end") {
    return Math.max(numeric(event.data.repeatCount), numeric(event.data.coinValueTotal), numeric(event.data.diamondValueTotal), numeric(event.data.coinValue), numeric(event.data.diamondValue), 1);
  }
  if (event.type === "like" || event.type === "like-batch") {
    return Math.max(numeric(event.data.likeCount), numeric(event.data.count), 1);
  }
  return 1;
}

function randomPercent(min: number, max: number): number {
  return randomBetween(min, max) / 100;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function enumParam<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function booleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integerParam(value: unknown, fallback: number): number {
  return Math.round(numberParam(value, fallback));
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
