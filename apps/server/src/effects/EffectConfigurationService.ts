import { randomUUID } from "node:crypto";
import type {
  EffectConfiguration,
  EffectDefinition,
  EffectPlaybackSettings,
  EffectPreset,
  EffectPresetSlot,
  EffectPosition,
  EffectSize,
  EffectTriggerCondition,
  EffectTriggerGroup,
  NormalizedEvent,
  OverlayId
} from "@obs-effect/shared-types";
import type { ResolvedEffectMedia } from "@obs-effect/shared-types";
import { defaultOverlayId } from "../overlays/overlayTypes.js";
import { samePlatformGiftId } from "../gifts/giftAliases.js";
import type { EffectConfigurationJsonRepository } from "./EffectConfigurationJsonRepository.js";
import { findEffectDefinition } from "./effectDefinitions.js";

export type EffectConfigurationInput = Partial<
  Omit<EffectConfiguration, "id" | "createdAt" | "updatedAt" | "visual" | "playback" | "trigger" | "targetOverlayId">
> & {
  targetOverlayId?: number;
  trigger?: EffectTriggerGroup;
  visual?: Partial<EffectConfiguration["visual"]>;
  playback?: Partial<EffectPlaybackSettings>;
};

const defaultPosition: EffectPosition = { mode: "anchor", x: 0, y: 0, anchor: "center" };
const defaultSize: EffectSize = { scale: 1, unit: "percent" };
const defaultPlayback: EffectPlaybackSettings = {
  durationMs: 650,
  startDelayMs: 0,
  cooldownMs: 0,
  maxConcurrent: 1,
  overlapPolicy: "allow",
  queueLimit: 10,
  stopPreviousSameEffect: false
};
const giftComboSoundParameterKeys = new Set([
  "soundEnabled",
  "soundAssetId",
  "soundVolume",
  "minimumSoundIntervalMs",
  "pitchEnabled",
  "basePlaybackRate",
  "maxPlaybackRate",
  "pitchCurveStrength"
]);

export class EffectConfigurationService {
  private readonly followedUserTriggers = new Set<string>();

  constructor(
    private readonly repository: EffectConfigurationJsonRepository,
    private readonly now: () => string
  ) {}

  async list(): Promise<EffectConfiguration[]> {
    return await this.repository.list();
  }

  async get(id: string): Promise<EffectConfiguration | null> {
    return (await this.list()).find((configuration) => configuration.id === id) ?? null;
  }

  async create(input: EffectConfigurationInput): Promise<EffectConfiguration> {
    const definition = this.resolveDefinition(input.effectDefinitionId);
    const timestamp = this.now();
    const configuration: EffectConfiguration = {
      id: randomUUID(),
      presetId: input.presetId,
      presetSlotId: input.presetSlotId,
      name: input.name?.trim() || `${definition.name} Effect`,
      description: input.description?.trim() || undefined,
      effectDefinitionId: definition.id,
      enabled: input.enabled ?? true,
      targetOverlayId: defaultOverlayId(input.targetOverlayId ?? definition.defaultOverlayId),
      trigger: normalizeTrigger(input.trigger),
      visual: normalizeVisual(input.visual, definition),
      media: input.media ?? {},
      playback: normalizePlayback(input.playback, definition),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const configurations = await this.list();
    const nextConfigurations = isLibraryConfiguration(configuration) ? configurations.map((item) => syncPresetConfigurationWithLibrary(item, configuration)) : configurations;
    await this.repository.saveAll([configuration, ...nextConfigurations]);
    return configuration;
  }

  async update(id: string, patch: EffectConfigurationInput): Promise<EffectConfiguration | null> {
    const configurations = await this.list();
    const index = configurations.findIndex((configuration) => configuration.id === id);
    if (index < 0) return null;

    const current = configurations[index]!;
    const definition = this.resolveDefinition(patch.effectDefinitionId ?? current.effectDefinitionId);
    const visualPatch = patch.visual
      ? {
          ...current.visual,
          ...patch.visual,
          parameters: patch.visual.parameters ? { ...current.visual.parameters, ...patch.visual.parameters } : current.visual.parameters
        }
      : undefined;
    const updated: EffectConfiguration = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      presetId: patch.presetId !== undefined ? patch.presetId : current.presetId,
      presetSlotId: patch.presetSlotId !== undefined ? patch.presetSlotId : current.presetSlotId,
      description: patch.description !== undefined ? patch.description?.trim() || undefined : current.description,
      effectDefinitionId: definition.id,
      enabled: patch.enabled ?? current.enabled,
      targetOverlayId: patch.targetOverlayId !== undefined ? defaultOverlayId(patch.targetOverlayId) : current.targetOverlayId,
      trigger: patch.trigger ? normalizeTrigger(patch.trigger) : current.trigger,
      visual: visualPatch ? normalizeVisual(visualPatch, definition) : current.visual,
      media: patch.media ?? current.media,
      playback: patch.playback ? normalizePlayback({ ...current.playback, ...patch.playback }, definition) : current.playback,
      updatedAt: this.now()
    };
    configurations[index] = updated;
    const nextConfigurations = isLibraryConfiguration(updated)
      ? configurations.map((configuration, configurationIndex) =>
          configurationIndex === index ? updated : syncPresetConfigurationWithLibrary(configuration, updated)
        )
      : configurations;
    await this.repository.saveAll(nextConfigurations);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const configurations = await this.list();
    const next = configurations.filter((configuration) => configuration.id !== id);
    if (next.length === configurations.length) return false;
    await this.repository.saveAll(next);
    return true;
  }

  async duplicate(id: string): Promise<EffectConfiguration | null> {
    const configuration = await this.get(id);
    if (!configuration) return null;
    return await this.create({
      ...configuration,
      name: `${configuration.name} Copy`,
      enabled: false
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<EffectConfiguration | null> {
    return await this.update(id, { enabled });
  }

  async applyPreset(preset: EffectPreset): Promise<EffectConfiguration[]> {
    const configurations = await this.list();
    const presetConfigurations = configurations.filter((configuration) => configuration.presetId === preset.id);
    const otherConfigurations = configurations.filter((configuration) => configuration.presetId !== preset.id);
    const activeSlots = preset.enabled ? preset.slots.filter((slot) => slot.enabled && slot.effectDefinitionId) : [];
    const timestamp = this.now();
    const nextPresetConfigurations = activeSlots.map((slot) => {
      const existing = presetConfigurations.find((configuration) => configuration.presetSlotId === slot.id);
      const libraryConfiguration = configurations.find(
        (configuration) => !configuration.presetId && !configuration.presetSlotId && configuration.effectDefinitionId === slot.effectDefinitionId
      );
      return this.configurationFromPresetSlot(preset, slot, existing, timestamp, libraryConfiguration);
    });

    await this.repository.saveAll([...nextPresetConfigurations, ...otherConfigurations]);
    return nextPresetConfigurations;
  }

  async removePresetConfigurations(presetId: string): Promise<void> {
    await this.repository.saveAll((await this.list()).filter((configuration) => configuration.presetId !== presetId));
  }

  async match(event: NormalizedEvent): Promise<EffectConfiguration[]> {
    const configurations = await this.list();
    return configurations.filter((configuration) =>
      configuration.enabled && configuration.presetId && matchesTrigger(configuration.trigger,
        configuration.effectDefinitionId === "gift-pile" && (event.type === "gift-streak-start" || event.type === "gift-streak-update")
          ? { ...event, type: "gift" } : event,
        configuration.id, this.followedUserTriggers)
    );
  }

  private resolveDefinition(effectDefinitionId: string | undefined): EffectDefinition {
    const definition = findEffectDefinition(effectDefinitionId ?? "flash");
    if (!definition) {
      throw new Error(`Unknown effect definition: ${effectDefinitionId}`);
    }
    return definition;
  }

  private configurationFromPresetSlot(
    preset: EffectPreset,
    slot: EffectPresetSlot,
    existing: EffectConfiguration | undefined,
    timestamp: string,
    libraryConfiguration: EffectConfiguration | undefined
  ): EffectConfiguration {
    const definition = this.resolveDefinition(slot.effectDefinitionId);
    const syncedSlot = syncPresetSlotWithLibrary(definition.id, slot, libraryConfiguration);
    return {
      id: existing?.id ?? randomUUID(),
      presetId: preset.id,
      presetSlotId: slot.id,
      name: `${preset.name} / ${slot.name}`,
      description: slot.description ?? preset.description,
      effectDefinitionId: definition.id,
      enabled: preset.enabled && slot.enabled,
      targetOverlayId: defaultOverlayId(syncedSlot.targetOverlayId),
      trigger: normalizeTrigger(presetRuntimeTrigger(definition.id, syncedSlot.trigger)),
      visual: normalizeVisual(syncedSlot.visual, definition),
      media: syncedSlot.media,
      playback: normalizePlayback(syncedSlot.playback, definition),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }
}

function syncPresetSlotWithLibrary(
  effectDefinitionId: string,
  slot: EffectPresetSlot,
  libraryConfiguration: EffectConfiguration | undefined
): EffectPresetSlot {
  if (effectDefinitionId !== "gift-combo-text" || !libraryConfiguration) return slot;
  const parameters = syncGiftComboSoundParameters(slot.visual.parameters, libraryConfiguration);
  return {
    ...slot,
    visual: {
      ...slot.visual,
      parameters
    }
  };
}

function syncPresetConfigurationWithLibrary(configuration: EffectConfiguration, libraryConfiguration: EffectConfiguration): EffectConfiguration {
  if (!configuration.presetId || configuration.effectDefinitionId !== libraryConfiguration.effectDefinitionId) return configuration;
  if (configuration.effectDefinitionId !== "gift-combo-text") return configuration;
  const parameters = syncGiftComboSoundParameters(configuration.visual.parameters, libraryConfiguration);
  return {
    ...configuration,
    visual: {
      ...configuration.visual,
      parameters
    },
    updatedAt: libraryConfiguration.updatedAt
  };
}

function isLibraryConfiguration(configuration: EffectConfiguration): boolean {
  return !configuration.presetId && !configuration.presetSlotId;
}

function syncGiftComboSoundParameters(
  parameters: Record<string, unknown>,
  libraryConfiguration: EffectConfiguration
): Record<string, unknown> {
  const next = { ...parameters };
  const libraryParameters = libraryConfiguration.visual.parameters;
  for (const key of giftComboSoundParameterKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key) && Object.prototype.hasOwnProperty.call(libraryParameters, key)) {
      next[key] = libraryParameters[key];
    }
  }
  if (!next.soundAssetId && libraryConfiguration.media.audioAssetId) {
    next.soundAssetId = libraryConfiguration.media.audioAssetId;
  }
  return next;
}

function normalizeVisual(input: Partial<EffectConfiguration["visual"]> | undefined, definition: EffectDefinition): EffectConfiguration["visual"] {
  return {
    parameters: input?.parameters ?? defaultParameters(definition),
    position: input?.position ?? defaultPosition,
    size: input?.size ?? defaultSize,
    opacity: clampNumber(input?.opacity ?? 1, 0, 1),
    zIndex: Math.round(clampNumber(input?.zIndex ?? 10, 0, 9999))
  };
}

function defaultParameters(definition: EffectDefinition): Record<string, unknown> {
  return Object.fromEntries(definition.parameterSchema.fields.map((field) => [field.key, field.defaultValue]));
}

function normalizePlayback(input: Partial<EffectPlaybackSettings> | undefined, definition: EffectDefinition): EffectPlaybackSettings {
  return {
    ...defaultPlayback,
    ...input,
    durationMs: Math.round(clampNumber(input?.durationMs ?? definition.defaultDurationMs, 50, 600000)),
    startDelayMs: Math.round(clampNumber(input?.startDelayMs ?? 0, 0, 600000)),
    cooldownMs: Math.round(clampNumber(input?.cooldownMs ?? 0, 0, 600000)),
    maxConcurrent: Math.round(clampNumber(input?.maxConcurrent ?? 1, 1, 100)),
    queueLimit: Math.round(clampNumber(input?.queueLimit ?? 10, 0, 1000))
  };
}

function normalizeTrigger(input: EffectTriggerGroup | undefined): EffectTriggerGroup {
  if (!input || input.conditions.length === 0) {
    return { mode: "any", conditions: [{ type: "manual" }] };
  }
  return { mode: input.mode === "all" ? "all" : "any", conditions: input.conditions.slice(0, 20) };
}

function presetRuntimeTrigger(effectDefinitionId: string, trigger: EffectTriggerGroup): EffectTriggerGroup {
  if (!usesTikTokGiftTrigger(effectDefinitionId)) return trigger;
  const hasTikTokGiftCondition = trigger.conditions.some((condition) =>
    condition.type === "gift-any" || condition.type === "gift-specific" || condition.type === "gift-value"
  );
  return hasTikTokGiftCondition ? trigger : defaultTikTokGiftTrigger(effectDefinitionId);
}

function usesTikTokGiftTrigger(effectDefinitionId: string): boolean {
  return ["flash", "simple-media", "ball-reveal", "gift-combo-text", "pitching-machine-ball", "falling-image", "puyo-game", "gift-pile"].includes(effectDefinitionId);
}

function defaultTikTokGiftTrigger(effectDefinitionId: string): EffectTriggerGroup {
  return {
    mode: "any",
    conditions: [{ type: "gift-any", triggerOn: ["gift-combo-text", "gift-pile"].includes(effectDefinitionId ?? "") ? "gift" : "streak-end" }]
  };
}

function matchesTrigger(trigger: EffectTriggerGroup, event: NormalizedEvent, configurationId: string, followedUserTriggers: Set<string>): boolean {
  const results = trigger.conditions.map((condition) => matchesCondition(condition, event, configurationId, followedUserTriggers));
  const matched = trigger.mode === "all" ? results.every(Boolean) : results.some(Boolean);
  if (matched) {
    for (const condition of trigger.conditions) {
      const key = condition.type === "follow" && condition.oncePerUserPerStream ? followOnceKey(event, configurationId) : null;
      if (key) followedUserTriggers.add(key);
    }
  }
  return matched;
}

function matchesCondition(condition: EffectTriggerCondition, event: NormalizedEvent, configurationId: string, followedUserTriggers: Set<string>): boolean {
  if (condition.type === "manual") return false;
  if (condition.type === "comment") {
    if (event.type !== "comment") return false;
    const keyword = condition.keyword?.trim().toLowerCase();
    if (!keyword || condition.matchMode === "any") return true;
    const comment = String(event.data.comment ?? "").toLowerCase();
    return condition.matchMode === "equals" ? comment === keyword : comment.includes(keyword);
  }
  if (condition.type === "follow") return matchesFollowCondition(condition, event, configurationId, followedUserTriggers);
  if (condition.type === "share") return event.type === "share";
  if (condition.type === "member-join") return event.type === "member-join";
  if (condition.type === "like-batch") return event.type === "like-batch" && numeric(event.data.likeCount) >= condition.minimumCount;
  if (condition.type === "external-event") return event.type === "custom" && event.data.eventType === condition.eventType;
  if (condition.type === "gift-any") return matchesGiftTiming(event.type, condition.triggerOn);
  if (condition.type === "gift-specific") {
    return (
      matchesGiftTiming(event.type, condition.triggerOn) &&
      event.platform === condition.platform &&
      samePlatformGiftId(event.platform, String(event.data.giftId ?? event.data.platformGiftId ?? ""), condition.platformGiftId) &&
      numeric(event.data.repeatCount) >= (condition.minimumRepeatCount ?? 1)
    );
  }
  if (condition.type === "gift-value") {
    return matchesGiftTiming(event.type, condition.triggerOn) && giftCoinValue(event) >= condition.minimumCoinValue;
  }
  return false;
}

function matchesFollowCondition(
  condition: Extract<EffectTriggerCondition, { type: "follow" }>,
  event: NormalizedEvent,
  configurationId: string,
  followedUserTriggers: Set<string>
): boolean {
  if (event.type !== "follow") return false;
  if (!condition.oncePerUserPerStream) return true;
  const key = followOnceKey(event, configurationId);
  return !key || !followedUserTriggers.has(key);
}

function followOnceKey(event: NormalizedEvent, configurationId: string): string | null {
  const userKey = event.user?.id ?? event.user?.uniqueId ?? event.user?.displayName;
  if (!userKey) return null;
  const streamKey = event.room?.id ?? event.room?.uniqueId ?? "global";
  return `${configurationId}:${streamKey}:${userKey}`;
}

function matchesGiftTiming(eventType: NormalizedEvent["type"], triggerOn: "gift" | "streak-start" | "streak-end"): boolean {
  if (triggerOn === "gift" || triggerOn === "streak-end") return eventType === "gift" || eventType === "gift-streak-end";
  if (triggerOn === "streak-start") return eventType === "gift-streak-start";
  return false;
}

function giftCoinValue(event: NormalizedEvent): number {
  return Math.max(numeric(event.data.coinValueTotal), numeric(event.data.diamondValueTotal), numeric(event.data.coinValue), numeric(event.data.diamondValue));
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function effectMessageFromConfiguration(
  configuration: EffectConfiguration,
  options: { instanceId: string; createdAt: string; event?: NormalizedEvent; triggerType?: string; media?: ResolvedEffectMedia }
) {
  return {
    type: "effect:play" as const,
    effectId: findEffectDefinition(configuration.effectDefinitionId)?.kind ?? "flash",
    effectConfigId: configuration.id,
    targetOverlayId: configuration.targetOverlayId as OverlayId,
    instanceId: options.instanceId,
    parameters: configuration.visual.parameters,
    visual: configuration.visual,
    media: options.media ?? {},
    playback: configuration.playback,
    runtimeData: {
      eventId: options.event?.eventId,
      eventType: options.event?.type,
      triggerType: options.triggerType ?? "manual"
    },
    createdAt: options.createdAt
  };
}
