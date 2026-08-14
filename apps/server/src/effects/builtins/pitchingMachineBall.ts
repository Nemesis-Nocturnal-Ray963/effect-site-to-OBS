import type { AssetCatalogItem, EffectConfiguration, RuntimeEffectObject } from "@obs-effect/shared-types";
import { loadCatalog } from "../../api/routes/assets.js";
import type { NormalizedEvent } from "@obs-effect/shared-types";
import type { EffectDefinition } from "@obs-effect/shared-types";
import type { RuntimeInteractionService } from "../../runtime/RuntimeInteractionService.js";

export const pitchingMachineBallEffectDefinition: EffectDefinition = {
  id: "pitching-machine-ball",
  kind: "pitching-machine-ball",
  name: "Pitching Machine Ball",
  description: "Launch a ball from a screen edge toward a target, then bounce it away after impact.",
  version: "0.1.0",
  supportsImage: true,
  supportsVideo: false,
  supportsAudio: true,
  supportsText: false,
  defaultDurationMs: 6000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "ballAssetId", label: "Ball asset", type: "string", defaultValue: "" },
      { key: "launchAudioAssetId", label: "Launch sound", type: "string", defaultValue: "" },
      { key: "impactAudioAssetId", label: "Impact sound", type: "string", defaultValue: "" },
      { key: "audioVolume", label: "Audio volume", type: "number", defaultValue: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "targetXPercent", label: "Target X %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "targetYPercent", label: "Target Y %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "targetRadiusPx", label: "Target radius px", type: "number", defaultValue: 72, min: 1, max: 400, step: 1 },
      { key: "horizontalEdgeOffsetPx", label: "Horizontal edge offset px", type: "number", defaultValue: 0, min: -4000, max: 4000, step: 10 },
      { key: "machineScale", label: "Machine scale", type: "number", defaultValue: 1, min: 0.1, max: 5, step: 0.05 },
      { key: "ballScale", label: "Ball scale", type: "number", defaultValue: 0.7, min: 0.1, max: 5, step: 0.05 },
      { key: "machineEnterDurationMs", label: "Machine enter duration ms", type: "number", defaultValue: 420, min: 0, max: 3000, step: 50 },
      { key: "machineExitDurationMs", label: "Machine exit duration ms", type: "number", defaultValue: 520, min: 0, max: 3000, step: 50 },
      { key: "giftQueueGraceMs", label: "Gift queue grace ms", type: "number", defaultValue: 1800, min: 0, max: 30000, step: 100 },
      { key: "listenerNameEnabled", label: "Show listener name", type: "boolean", defaultValue: true },
      { key: "delayBeforeLaunchMs", label: "Delay before launch ms", type: "number", defaultValue: 450, min: 0, max: 10000, step: 50 },
      {
        key: "trajectoryMode",
        label: "Trajectory mode",
        type: "select",
        defaultValue: "direct",
        options: [
          { value: "direct", label: "Direct" },
          { value: "arc", label: "Arc" }
        ]
      },
      { key: "travelDurationMs", label: "Travel duration ms", type: "number", defaultValue: 750, min: 50, max: 10000, step: 50 },
      { key: "arcHeightPx", label: "Arc height px", type: "number", defaultValue: 220, min: -2000, max: 2000, step: 10 },
      { key: "ballsPerTrigger", label: "Balls per trigger", type: "number", defaultValue: 1, min: 1, max: 50, step: 1 },
      { key: "intervalBetweenBallsMs", label: "Ball interval ms", type: "number", defaultValue: 120, min: 0, max: 5000, step: 10 },
      { key: "targetVariationRadiusPx", label: "Target variation radius px", type: "number", defaultValue: 24, min: 0, max: 1000, step: 1 },
      { key: "impactEnabled", label: "Impact enabled", type: "boolean", defaultValue: true },
      { key: "impactDurationMs", label: "Impact duration ms", type: "number", defaultValue: 420, min: 50, max: 5000, step: 50 },
      { key: "gravity", label: "Gravity", type: "number", defaultValue: 3.2, min: 0, max: 20, step: 0.1 },
      { key: "restitution", label: "Bounce power", type: "number", defaultValue: 0.58, min: 0, max: 1.5, step: 0.01 },
      {
        key: "groundCollisionMode",
        label: "Ground collision",
        type: "select",
        defaultValue: "bounce",
        options: [
          { value: "bounce", label: "Bounce" },
          { value: "pass-through", label: "Pass through" }
        ]
      },
      { key: "ballLifetimeMs", label: "Ball lifetime ms", type: "number", defaultValue: 4500, min: 100, max: 60000, step: 100 }
    ]
  }
};

type Edge = "top" | "right" | "bottom" | "left";

interface PitchingExecutionResult {
  spawnedObjects: RuntimeEffectObject[];
  skipped: boolean;
  reason?: string;
}

interface PitchingQueue {
  key: string;
  executionId: string;
  configuration: EffectConfiguration;
  settings: ReturnType<typeof normalizeSettings>;
  ballAsset: AssetCatalogItem;
  launchAudioAsset: AssetCatalogItem | null;
  impactAudioAsset: AssetCatalogItem | null;
  target: { x: number; y: number };
  edge: Edge;
  machine: { x: number; y: number };
  listenerName: string;
  pendingShots: number;
  firedShots: number;
  firing: boolean;
  machineDestroyTimer: NodeJS.Timeout | null;
  machineObject: RuntimeEffectObject;
  spawnedObjects: RuntimeEffectObject[];
}

export class PitchingMachineBallEffectService {
  private readonly queues = new Map<string, PitchingQueue>();

  constructor(
    private readonly rootDir: string,
    private readonly runtimeInteractionService: RuntimeInteractionService
  ) {}

  async execute(configuration: EffectConfiguration, event?: NormalizedEvent): Promise<PitchingExecutionResult> {
    const assets = await loadCatalog(this.rootDir);
    const settings = normalizeSettings(configuration.visual.parameters);
    const machineAsset = findImageAsset(assets, configuration.media.imageAssetId) ?? findImageAsset(assets, settings.ballAssetId) ?? firstImageAsset(assets);
    if (!machineAsset) return { spawnedObjects: [], skipped: true, reason: "machine image asset is required" };

    const ballAsset = findImageAsset(assets, settings.ballAssetId) ?? machineAsset;
    const launchAudioAsset = findAudioAsset(assets, settings.launchAudioAssetId) ?? findAudioAsset(assets, configuration.media.audioAssetId);
    const impactAudioAsset = findAudioAsset(assets, settings.impactAudioAssetId);
    const listener = listenerContext(event);
    const queueKey = `${configuration.id}:${configuration.targetOverlayId}:${listener.key}`;
    const shots = event ? giftShotCount(event) : settings.ballsPerTrigger;
    const existing = this.queues.get(queueKey);
    if (existing) {
      existing.pendingShots += shots;
      existing.configuration = configuration;
      existing.settings = settings;
      existing.ballAsset = ballAsset;
      existing.launchAudioAsset = launchAudioAsset;
      existing.impactAudioAsset = impactAudioAsset;
      existing.listenerName = listener.name;
      if (existing.machineDestroyTimer) {
        clearTimeout(existing.machineDestroyTimer);
        existing.machineDestroyTimer = null;
      }
      this.updateMachineLifecycle(existing, Date.now() + 10 * 60 * 1000);
      if (!existing.firing) this.scheduleNextShot(existing, 0);
      return { spawnedObjects: [], skipped: false };
    }

    const executionId = `pitching-machine-ball-${configuration.id}-${listener.key}-${Date.now()}`;
    const target = { x: settings.targetXPercent / 100, y: settings.targetYPercent / 100 };
    const edge = chooseEdge(target, settings);
    const machine = machinePosition(edge, target, settings);
    const spawnedObjects: RuntimeEffectObject[] = [];
    const nowMs = Date.now();
    const totalDurationMs = 10 * 60 * 1000;

    const machineObject = this.runtimeInteractionService.createObject({
      overlayId: configuration.targetOverlayId,
      executionId,
      effectConfigId: configuration.id,
      objectType: "pitching-machine",
      interactive: false,
      maxHitPoints: 1,
      normalizedX: machine.x,
      normalizedY: machine.y,
      rotation: 0,
      scale: settings.machineScale,
      assetId: machineAsset.id,
      contentUrl: machineAsset.contentUrl,
      expiresAt: new Date(nowMs + totalDurationMs).toISOString(),
      metadata: {
        edge,
        phase: "machine",
        horizontalEdgeOffsetPx: settings.horizontalEdgeOffsetPx,
        targetX: target.x,
        targetY: target.y,
        listenerName: settings.listenerNameEnabled ? listener.name : "",
        listenerKey: listener.key,
        enterDurationMs: settings.machineEnterDurationMs,
        exitDurationMs: settings.machineExitDurationMs,
        launchAt: nowMs + settings.delayBeforeLaunchMs,
        exitAt: nowMs + totalDurationMs
      }
    });
    spawnedObjects.push(machineObject);

    const queue: PitchingQueue = {
      key: queueKey,
      executionId,
      configuration,
      settings,
      ballAsset,
      launchAudioAsset,
      impactAudioAsset,
      target,
      edge,
      machine,
      listenerName: listener.name,
      pendingShots: shots,
      firedShots: 0,
      firing: false,
      machineDestroyTimer: null,
      machineObject,
      spawnedObjects
    };
    this.queues.set(queueKey, queue);
    this.scheduleNextShot(queue, settings.delayBeforeLaunchMs);

    return { spawnedObjects, skipped: false };
  }

  private scheduleNextShot(queue: PitchingQueue, delayMs: number): void {
    if (queue.pendingShots <= 0) {
      this.startGrace(queue);
      return;
    }

    queue.firing = true;
    setTimeout(() => {
      if (!this.queues.has(queue.key)) return;
      this.createBall(queue);
      queue.pendingShots -= 1;
      queue.firedShots += 1;
      this.updateMachineLifecycle(queue, Date.now() + 10 * 60 * 1000);
      if (queue.pendingShots > 0) this.scheduleNextShot(queue, queue.settings.intervalBetweenBallsMs);
      else this.startGrace(queue);
    }, Math.max(0, delayMs));
  }

  private createBall(queue: PitchingQueue): void {
    const nowMs = Date.now();
    const variedTarget = varyTarget(queue.target, queue.settings.targetVariationRadiusPx);
    const impactAt = nowMs + queue.settings.travelDurationMs;
    const ballObject = this.runtimeInteractionService.createObject({
      overlayId: queue.configuration.targetOverlayId,
      executionId: queue.executionId,
      effectConfigId: queue.configuration.id,
      objectType: "pitching-ball",
      interactive: false,
      maxHitPoints: 1,
      normalizedX: queue.machine.x,
      normalizedY: queue.machine.y,
      rotation: Math.round(Math.random() * 360),
      rotationSpeed: randomBetween(-360, 360),
      scale: queue.settings.ballScale,
      assetId: queue.ballAsset.id,
      contentUrl: queue.ballAsset.contentUrl,
      expiresAt: new Date(impactAt + queue.settings.ballLifetimeMs).toISOString(),
      metadata: {
        index: queue.firedShots,
        count: queue.firedShots + queue.pendingShots,
        phase: "ball",
        listenerName: queue.settings.listenerNameEnabled ? queue.listenerName : "",
        startX: queue.machine.x,
        startY: queue.machine.y,
        startEdge: queue.edge,
        horizontalEdgeOffsetPx: queue.settings.horizontalEdgeOffsetPx,
        targetX: variedTarget.x,
        targetY: variedTarget.y,
        launchAt: nowMs,
        travelDurationMs: queue.settings.travelDurationMs,
        trajectoryMode: queue.settings.trajectoryMode,
        arcHeightPx: queue.settings.arcHeightPx,
        impactAt,
        targetRadiusPx: queue.settings.targetRadiusPx,
        gravity: queue.settings.gravity,
        restitution: queue.settings.restitution,
        groundCollisionMode: queue.settings.groundCollisionMode,
        ballLifetimeMs: queue.settings.ballLifetimeMs,
        postVelocityX: randomBetween(-0.45, 0.45) + (variedTarget.x >= queue.machine.x ? 0.22 : -0.22),
        postVelocityY: randomBetween(-0.62, -0.24),
        launchAudioUrl: queue.launchAudioAsset?.contentUrl,
        impactAudioUrl: queue.impactAudioAsset?.contentUrl,
        audioVolume: queue.settings.audioVolume
      }
    });
    queue.spawnedObjects.push(ballObject);
    this.updateMachineRecoil(queue, nowMs);
    setTimeout(() => {
      this.runtimeInteractionService.destroy(queue.configuration.targetOverlayId, ballObject.objectId);
    }, Math.max(0, queue.settings.travelDurationMs + queue.settings.ballLifetimeMs));

    if (queue.settings.impactEnabled) {
      setTimeout(() => {
        this.runtimeInteractionService.createObject({
          overlayId: queue.configuration.targetOverlayId,
          executionId: queue.executionId,
          effectConfigId: queue.configuration.id,
          objectType: "pitching-impact",
          interactive: false,
          maxHitPoints: 1,
          normalizedX: variedTarget.x,
          normalizedY: variedTarget.y,
          scale: 1,
          expiresAt: new Date(Date.now() + queue.settings.impactDurationMs + 120).toISOString(),
          metadata: {
            phase: "impact",
            durationMs: queue.settings.impactDurationMs,
            targetRadiusPx: queue.settings.targetRadiusPx
          }
        });
      }, queue.settings.travelDurationMs);
    }
  }

  private startGrace(queue: PitchingQueue): void {
    queue.firing = false;
    if (queue.machineDestroyTimer) clearTimeout(queue.machineDestroyTimer);
    const exitAt = Date.now() + queue.settings.giftQueueGraceMs;
    this.updateMachineLifecycle(queue, exitAt);
    const destroyDelayMs = queue.settings.giftQueueGraceMs + queue.settings.machineExitDurationMs + 80;
    queue.machineDestroyTimer = setTimeout(() => {
      this.runtimeInteractionService.destroy(queue.configuration.targetOverlayId, queue.machineObject.objectId);
      this.queues.delete(queue.key);
    }, Math.max(0, destroyDelayMs));
  }

  private updateMachineLifecycle(queue: PitchingQueue, exitAt: number): void {
    const updated = this.runtimeInteractionService.updateObject(queue.configuration.targetOverlayId, queue.machineObject.objectId, {
      expiresAt: new Date(exitAt + queue.settings.machineExitDurationMs + 120).toISOString(),
      metadata: {
        edge: queue.edge,
        listenerName: queue.settings.listenerNameEnabled ? queue.listenerName : "",
        pendingShots: queue.pendingShots,
        firedShots: queue.firedShots,
        exitDurationMs: queue.settings.machineExitDurationMs,
        exitAt
      }
    });
    if (updated) queue.machineObject = updated;
  }

  private updateMachineRecoil(queue: PitchingQueue, recoilAt: number): void {
    const updated = this.runtimeInteractionService.updateObject(queue.configuration.targetOverlayId, queue.machineObject.objectId, {
      metadata: {
        recoilAt,
        recoilIndex: queue.firedShots
      }
    });
    if (updated) queue.machineObject = updated;
  }
}

function findImageAsset(assets: AssetCatalogItem[], assetId: string | undefined): AssetCatalogItem | null {
  if (!assetId) return null;
  return assets.find((asset) => asset.id === assetId && asset.kind === "image") ?? null;
}

function findAudioAsset(assets: AssetCatalogItem[], assetId: string | undefined): AssetCatalogItem | null {
  if (!assetId) return null;
  return assets.find((asset) => asset.id === assetId && asset.kind === "audio") ?? null;
}

function firstImageAsset(assets: AssetCatalogItem[]): AssetCatalogItem | null {
  return assets.find((asset) => asset.kind === "image") ?? null;
}

function normalizeSettings(parameters: Record<string, unknown>) {
  return {
    ballAssetId: stringParam(parameters.ballAssetId, ""),
    launchAudioAssetId: stringParam(parameters.launchAudioAssetId, ""),
    impactAudioAssetId: stringParam(parameters.impactAudioAssetId, ""),
    audioVolume: clamp(numberParam(parameters.audioVolume, 0.8), 0, 1),
    targetXPercent: clamp(numberParam(parameters.targetXPercent, 50), 0, 100),
    targetYPercent: clamp(numberParam(parameters.targetYPercent, 50), 0, 100),
    targetRadiusPx: clamp(numberParam(parameters.targetRadiusPx, 72), 1, 400),
    horizontalEdgeOffsetPx: numberParam(parameters.horizontalEdgeOffsetPx, 0),
    machineScale: clamp(numberParam(parameters.machineScale, 1), 0.1, 5),
    ballScale: clamp(numberParam(parameters.ballScale, 0.7), 0.1, 5),
    machineEnterDurationMs: Math.max(0, integerParam(parameters.machineEnterDurationMs, 420)),
    machineExitDurationMs: Math.max(0, integerParam(parameters.machineExitDurationMs, 520)),
    giftQueueGraceMs: Math.max(0, integerParam(parameters.giftQueueGraceMs, 1800)),
    listenerNameEnabled: booleanParam(parameters.listenerNameEnabled, true),
    delayBeforeLaunchMs: Math.max(0, integerParam(parameters.delayBeforeLaunchMs, 450)),
    trajectoryMode: enumParam(parameters.trajectoryMode, ["direct", "arc"], "direct"),
    travelDurationMs: Math.max(50, integerParam(parameters.travelDurationMs, 750)),
    arcHeightPx: numberParam(parameters.arcHeightPx, 220),
    ballsPerTrigger: clamp(integerParam(parameters.ballsPerTrigger, 1), 1, 50),
    intervalBetweenBallsMs: Math.max(0, integerParam(parameters.intervalBetweenBallsMs, 120)),
    targetVariationRadiusPx: Math.max(0, numberParam(parameters.targetVariationRadiusPx, 24)),
    impactEnabled: booleanParam(parameters.impactEnabled, true),
    impactDurationMs: Math.max(50, integerParam(parameters.impactDurationMs, 420)),
    gravity: Math.max(0, numberParam(parameters.gravity, 3.2)),
    restitution: clamp(numberParam(parameters.restitution, 0.58), 0, 1.5),
    groundCollisionMode: enumParam(parameters.groundCollisionMode, ["bounce", "pass-through"], "bounce"),
    ballLifetimeMs: Math.max(100, integerParam(parameters.ballLifetimeMs, integerParam(parameters.postImpactLifetimeMs, 4500)))
  };
}

function chooseEdge(_target: { x: number; y: number }, _settings: ReturnType<typeof normalizeSettings>): Edge {
  const candidates: Edge[] = ["right", "left"];
  return candidates[Math.floor(Math.random() * candidates.length)] ?? "left";
}

function machinePosition(edge: Edge, _target: { x: number; y: number }, _settings: ReturnType<typeof normalizeSettings>): { x: number; y: number } {
  return randomEdgePosition(edge);
}

function randomEdgePosition(edge: Edge): { x: number; y: number } {
  const position = Math.random();
  if (edge === "right") return { x: 1, y: position };
  return { x: 0, y: position };
}

function varyTarget(target: { x: number; y: number }, radiusPx: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * radiusPx;
  return {
    x: clamp(target.x + (Math.cos(angle) * radius) / 1920, 0.02, 0.98),
    y: clamp(target.y + (Math.sin(angle) * radius) / 1080, 0.02, 0.98)
  };
}

function listenerContext(event: NormalizedEvent | undefined): { key: string; name: string } {
  if (!event) return { key: `manual-${Date.now()}-${Math.round(Math.random() * 100000)}`, name: "Manual" };
  const key = event.user?.id ?? event.user?.uniqueId ?? event.user?.displayName ?? event.eventId;
  const name = event.user?.displayName ?? event.user?.uniqueId ?? "Listener";
  return { key: sanitizeKey(key), name };
}

function giftShotCount(event: NormalizedEvent): number {
  if (event.type === "gift" || event.type === "gift-streak-start" || event.type === "gift-streak-update" || event.type === "gift-streak-end") {
    return clamp(integerParam(event.data.repeatCount, 1), 1, 500);
  }
  return 1;
}

function sanitizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "listener";
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

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
