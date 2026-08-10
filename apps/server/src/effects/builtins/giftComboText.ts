import type { AppAudioComboMessage, AssetCatalogItem, EffectConfiguration, EffectDefinition, NormalizedEvent, RuntimeEffectObject } from "@obs-effect/shared-types";
import { loadCatalog } from "../../api/routes/assets.js";
import { giftIdMatchesAny } from "../../gifts/giftAliases.js";
import type { RuntimeInteractionService } from "../../runtime/RuntimeInteractionService.js";

export const giftComboTextEffectDefinition: EffectDefinition = {
  id: "gift-combo-text",
  kind: "gift-combo-text",
  name: "Gift Combo Text",
  description: "Count gift quantities into a continuing combo text overlay.",
  version: "1.0.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: true,
  supportsText: true,
  defaultDurationMs: 3000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      {
        key: "targetMode",
        label: "Gift target mode",
        type: "select",
        defaultValue: "any-gift",
        options: [
          { value: "any-gift", label: "Any gift" },
          { value: "specific-gifts", label: "Specific gifts" }
        ]
      },
      { key: "giftIdsCsv", label: "Gift IDs", type: "string", defaultValue: "" },
      { key: "acceptanceDurationMs", label: "Acceptance duration ms", type: "number", defaultValue: 3000, min: 100, max: 60000, step: 100 },
      {
        key: "countSpeedMode",
        label: "Count speed mode",
        type: "select",
        defaultValue: "accelerating",
        options: [
          { value: "constant", label: "Constant" },
          { value: "accelerating", label: "Accelerating" }
        ]
      },
      { key: "constantAddsPerSecond", label: "Constant adds per second", type: "number", defaultValue: 20, min: 1, max: 10000, step: 1 },
      { key: "acceleratingBaseAddsPerSecond", label: "Base adds per second", type: "number", defaultValue: 16, min: 1, max: 10000, step: 1 },
      { key: "acceleratingMaxAddsPerSecond", label: "Max adds per second", type: "number", defaultValue: 420, min: 1, max: 20000, step: 1 },
      { key: "accelerationStrength", label: "Acceleration strength", type: "number", defaultValue: 0.01, min: 0.0001, max: 1, step: 0.001 },
      { key: "maxFrameStep", label: "Max frame step", type: "number", defaultValue: 100, min: 1, max: 10000, step: 1 },
      {
        key: "displayLanguage",
        label: "Display language",
        type: "select",
        defaultValue: "english",
        options: [
          { value: "english", label: "English" },
          { value: "japanese", label: "Japanese" }
        ]
      },
      { key: "fontFamily", label: "Font family", type: "string", defaultValue: "Impact" },
      { key: "fontSizePx", label: "Font size", type: "number", defaultValue: 96, min: 8, max: 360, step: 1 },
      { key: "fontWeight", label: "Font weight", type: "number", defaultValue: 900, min: 100, max: 900, step: 100 },
      { key: "letterSpacingPx", label: "Letter spacing px", type: "number", defaultValue: 0, min: -20, max: 80, step: 1 },
      {
        key: "colorMode",
        label: "Color mode",
        type: "select",
        defaultValue: "solid",
        options: [
          { value: "solid", label: "Solid" },
          { value: "cmy-rainbow-loop", label: "CMY rainbow loop" }
        ]
      },
      { key: "solidColor", label: "Text color", type: "color", defaultValue: "#ffffff" },
      { key: "cyan", label: "Cyan", type: "color", defaultValue: "#00E5FF" },
      { key: "magenta", label: "Magenta", type: "color", defaultValue: "#FF2BD6" },
      { key: "yellow", label: "Yellow", type: "color", defaultValue: "#FFE600" },
      { key: "rainbowWhite", label: "Rainbow white", type: "color", defaultValue: "#FFFFFF" },
      { key: "rainbowGreen", label: "Rainbow green", type: "color", defaultValue: "#7CFF4F" },
      { key: "rainbowDurationMs", label: "Rainbow duration ms", type: "number", defaultValue: 2000, min: 100, max: 60000, step: 100 },
      { key: "blinkWarningMs", label: "Blink warning ms", type: "number", defaultValue: 900, min: 0, max: 10000, step: 50 },
      { key: "strokeEnabled", label: "Stroke enabled", type: "boolean", defaultValue: true },
      { key: "strokeColor", label: "Stroke color", type: "color", defaultValue: "#000000" },
      { key: "strokeWidthPx", label: "Stroke width px", type: "number", defaultValue: 6, min: 0, max: 30, step: 1 },
      { key: "strokeOpacity", label: "Stroke opacity", type: "number", defaultValue: 1, min: 0, max: 1, step: 0.05 },
      { key: "soundEnabled", label: "Sound enabled", type: "boolean", defaultValue: false },
      { key: "soundAssetId", label: "Sound asset", type: "string", defaultValue: "" },
      { key: "soundVolume", label: "Sound volume", type: "number", defaultValue: 0.5, min: 0, max: 1, step: 0.05 },
      { key: "minimumSoundIntervalMs", label: "Sound interval ms", type: "number", defaultValue: 40, min: 0, max: 10000, step: 10 },
      { key: "pitchEnabled", label: "Pitch enabled", type: "boolean", defaultValue: true },
      { key: "basePlaybackRate", label: "Base pitch", type: "number", defaultValue: 1, min: 0.1, max: 4, step: 0.05 },
      { key: "maxPlaybackRate", label: "Max pitch", type: "number", defaultValue: 1.8, min: 0.1, max: 4, step: 0.05 },
      { key: "pitchCurveStrength", label: "Pitch curve strength", type: "number", defaultValue: 0.01, min: 0.0001, max: 1, step: 0.001 },
      { key: "appearDurationMs", label: "Appear duration ms", type: "number", defaultValue: 260, min: 0, max: 5000, step: 50 },
      { key: "finishDurationMs", label: "Finish duration ms", type: "number", defaultValue: 520, min: 0, max: 10000, step: 50 }
    ]
  }
};

interface ComboQueue {
  key: string;
  configuration: EffectConfiguration;
  settings: ReturnType<typeof normalizeSettings>;
  object: RuntimeEffectObject;
  targetCombo: number;
  timer: NodeJS.Timeout | null;
}

export class GiftComboTextEffectService {
  private readonly queues = new Map<string, ComboQueue>();

  constructor(
    private readonly rootDir: string,
    private readonly runtimeInteractionService: RuntimeInteractionService,
    private readonly broadcastAppAudio?: (message: AppAudioComboMessage) => void
  ) {}

  async execute(configuration: EffectConfiguration, event?: NormalizedEvent): Promise<{ spawnedObjects: RuntimeEffectObject[]; skipped: boolean; reason?: string }> {
    const settings = normalizeSettings(configuration.visual.parameters);
    const quantity = event ? giftComboQuantity(event, settings) : 1;
    if (quantity <= 0) return { spawnedObjects: [], skipped: true, reason: "Gift combo target did not match" };

    const assets = await loadCatalog(this.rootDir);
    const soundAsset = findAudioAsset(assets, settings.soundAssetId) ?? findAudioAsset(assets, configuration.media.audioAssetId);
    const fontAsset = findFontAsset(assets, settings.fontFamily);
    const key = `${configuration.targetOverlayId}:${configuration.id}`;
    const nowMs = Date.now();
    const deadlineAt = nowMs + settings.acceptanceDurationMs;
    const existing = this.queues.get(key);
    if (existing) {
      existing.configuration = configuration;
      existing.settings = settings;
      existing.targetCombo += quantity;
      this.updateObject(existing, deadlineAt, soundAsset, fontAsset);
      this.broadcastComboAudio(existing, soundAsset, "update");
      this.scheduleFinish(existing, deadlineAt);
      return { spawnedObjects: [], skipped: false };
    }

    const object = this.runtimeInteractionService.createObject({
      overlayId: configuration.targetOverlayId,
      executionId: `gift-combo-text-${configuration.id}-${Date.now()}`,
      effectConfigId: configuration.id,
      objectType: "gift-combo-text",
      interactive: false,
      maxHitPoints: 1,
      normalizedX: 0.5,
      normalizedY: 0.5,
      scale: configuration.visual.size.scale ?? 1,
      expiresAt: new Date(deadlineAt + settings.finishDurationMs + 200).toISOString(),
      metadata: comboMetadata(configuration, settings, quantity, deadlineAt, soundAsset, fontAsset, "appearing")
    });
    const queue: ComboQueue = { key, configuration, settings, object, targetCombo: quantity, timer: null };
    this.queues.set(key, queue);
    this.broadcastComboAudio(queue, soundAsset, "start");
    this.scheduleFinish(queue, deadlineAt);
    return { spawnedObjects: [object], skipped: false };
  }

  private updateObject(queue: ComboQueue, deadlineAt: number, soundAsset: AssetCatalogItem | null, fontAsset: AssetCatalogItem | null): void {
    const updated = this.runtimeInteractionService.updateObject(queue.configuration.targetOverlayId, queue.object.objectId, {
      expiresAt: new Date(deadlineAt + queue.settings.finishDurationMs + 200).toISOString(),
      metadata: comboMetadata(queue.configuration, queue.settings, queue.targetCombo, deadlineAt, soundAsset, fontAsset, "counting")
    });
    if (updated) queue.object = updated;
  }

  private scheduleFinish(queue: ComboQueue, deadlineAt: number): void {
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = setTimeout(() => {
      const finishAt = Date.now();
      const updated = this.runtimeInteractionService.updateObject(queue.configuration.targetOverlayId, queue.object.objectId, {
        expiresAt: new Date(finishAt + queue.settings.finishDurationMs + 200).toISOString(),
        metadata: {
          status: "finishing",
          finishAt,
          finishDurationMs: queue.settings.finishDurationMs
        }
      });
      if (updated) queue.object = updated;
      this.broadcastAppAudio?.({ type: "app-audio:combo", action: "stop", queueId: queue.key, createdAt: new Date().toISOString() });
      setTimeout(() => {
        this.runtimeInteractionService.destroy(queue.configuration.targetOverlayId, queue.object.objectId);
        this.queues.delete(queue.key);
      }, queue.settings.finishDurationMs + 220);
    }, Math.max(0, deadlineAt - Date.now()));
  }

  private broadcastComboAudio(queue: ComboQueue, soundAsset: AssetCatalogItem | null, action: "start" | "update"): void {
    if (!queue.settings.soundEnabled || !soundAsset?.contentUrl) return;
    this.broadcastAppAudio?.({
      type: "app-audio:combo",
      action,
      queueId: queue.key,
      soundUrl: soundAsset.contentUrl,
      targetCombo: queue.targetCombo,
      countSpeedMode: queue.settings.countSpeedMode,
      constantAddsPerSecond: queue.settings.constantAddsPerSecond,
      acceleratingBaseAddsPerSecond: queue.settings.acceleratingBaseAddsPerSecond,
      acceleratingMaxAddsPerSecond: queue.settings.acceleratingMaxAddsPerSecond,
      accelerationStrength: queue.settings.accelerationStrength,
      minimumSoundIntervalMs: queue.settings.minimumSoundIntervalMs,
      soundVolume: queue.settings.soundVolume,
      pitchEnabled: queue.settings.pitchEnabled,
      basePlaybackRate: queue.settings.basePlaybackRate,
      maxPlaybackRate: queue.settings.maxPlaybackRate,
      pitchCurveStrength: queue.settings.pitchCurveStrength,
      createdAt: new Date().toISOString()
    });
  }
}

function comboMetadata(
  configuration: EffectConfiguration,
  settings: ReturnType<typeof normalizeSettings>,
  targetCombo: number,
  deadlineAt: number,
  soundAsset: AssetCatalogItem | null,
  fontAsset: AssetCatalogItem | null,
  status: string
): Record<string, unknown> {
  return {
    status,
    targetCombo,
    acceptanceDeadlineAt: deadlineAt,
    xPercent: configuration.visual.position.x,
    yPercent: configuration.visual.position.y,
    anchor: configuration.visual.position.anchor,
    opacity: configuration.visual.opacity,
    zIndex: configuration.visual.zIndex,
    ...settings,
    soundUrl: soundAsset?.contentUrl ?? "",
    fontUrl: fontAsset?.contentUrl ?? ""
  };
}

function normalizeSettings(parameters: Record<string, unknown>) {
  const basePlaybackRate = clamp(numberParam(parameters.basePlaybackRate, 1), 0.1, 4);
  return {
    targetMode: stringParam(parameters.targetMode, "any-gift"),
    giftIds: csv(parameters.giftIdsCsv),
    acceptanceDurationMs: Math.max(1, integerParam(parameters.acceptanceDurationMs, 3000)),
    countSpeedMode: stringParam(parameters.countSpeedMode, "accelerating"),
    constantAddsPerSecond: Math.max(1, numberParam(parameters.constantAddsPerSecond, 20)),
    acceleratingBaseAddsPerSecond: Math.max(1, numberParam(parameters.acceleratingBaseAddsPerSecond, 16)),
    acceleratingMaxAddsPerSecond: Math.max(1, numberParam(parameters.acceleratingMaxAddsPerSecond, 420)),
    accelerationStrength: Math.max(0.0001, numberParam(parameters.accelerationStrength, 0.01)),
    maxFrameStep: Math.max(1, integerParam(parameters.maxFrameStep, 100)),
    displayLanguage: stringParam(parameters.displayLanguage, "english"),
    fontFamily: stringParam(parameters.fontFamily, "Impact"),
    fontSizePx: Math.max(1, numberParam(parameters.fontSizePx, 96)),
    fontWeight: clamp(integerParam(parameters.fontWeight, 900), 100, 900),
    letterSpacingPx: numberParam(parameters.letterSpacingPx, 0),
    colorMode: stringParam(parameters.colorMode, "solid"),
    solidColor: colorParam(parameters.solidColor, "#ffffff"),
    cyan: colorParam(parameters.cyan, "#00E5FF"),
    magenta: colorParam(parameters.magenta, "#FF2BD6"),
    yellow: colorParam(parameters.yellow, "#FFE600"),
    rainbowWhite: colorParam(parameters.rainbowWhite, "#FFFFFF"),
    rainbowGreen: colorParam(parameters.rainbowGreen, "#7CFF4F"),
    rainbowDurationMs: Math.max(1, integerParam(parameters.rainbowDurationMs, 2000)),
    blinkWarningMs: Math.max(0, integerParam(parameters.blinkWarningMs, 900)),
    strokeEnabled: booleanParam(parameters.strokeEnabled, true),
    strokeColor: colorParam(parameters.strokeColor, "#000000"),
    strokeWidthPx: clamp(numberParam(parameters.strokeWidthPx, 6), 0, 30),
    strokeOpacity: clamp(numberParam(parameters.strokeOpacity, 1), 0, 1),
    soundEnabled: booleanParam(parameters.soundEnabled, false),
    soundAssetId: stringParam(parameters.soundAssetId, ""),
    soundVolume: clamp(numberParam(parameters.soundVolume, 0.5), 0, 1),
    minimumSoundIntervalMs: Math.max(0, integerParam(parameters.minimumSoundIntervalMs, 40)),
    pitchEnabled: booleanParam(parameters.pitchEnabled, true),
    basePlaybackRate,
    maxPlaybackRate: Math.max(basePlaybackRate, numberParam(parameters.maxPlaybackRate, 1.8)),
    pitchCurveStrength: Math.max(0.0001, numberParam(parameters.pitchCurveStrength, 0.01)),
    appearDurationMs: Math.max(0, integerParam(parameters.appearDurationMs, 260)),
    finishDurationMs: Math.max(0, integerParam(parameters.finishDurationMs, 520))
  };
}

function giftComboQuantity(event: NormalizedEvent, settings: ReturnType<typeof normalizeSettings>): number {
  if (!["gift", "gift-streak-start", "gift-streak-end"].includes(event.type)) return 0;
  if (settings.targetMode === "specific-gifts") {
    const eventGiftId = String(event.data.giftId ?? event.data.platformGiftId ?? "");
    if (!giftIdMatchesAny(event.platform, settings.giftIds, eventGiftId)) return 0;
  }
  return clamp(integerParam(event.data.normalizedGiftQuantity, integerParam(event.data.repeatCount, 1)), 1, 100000);
}

function findAudioAsset(assets: AssetCatalogItem[], assetId: string | undefined): AssetCatalogItem | null {
  if (!assetId) return null;
  return assets.find((asset) => asset.id === assetId && asset.kind === "audio") ?? null;
}

function findFontAsset(assets: AssetCatalogItem[], family: string): AssetCatalogItem | null {
  const normalizedFamily = family.trim().toLocaleLowerCase("ja-JP");
  if (!normalizedFamily) return null;
  return assets.find((asset) => asset.kind === "font" && asset.name.trim().toLocaleLowerCase("ja-JP") === normalizedFamily) ?? null;
}

function csv(value: unknown): string[] {
  return stringParam(value, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integerParam(value: unknown, fallback: number): number {
  return Math.round(numberParam(value, fallback));
}

function booleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function colorParam(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
