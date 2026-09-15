import { randomUUID } from "node:crypto";
import type {
  EffectPlaybackSettings,
  EffectPosition,
  EffectPreset,
  EffectPresetSlot,
  EffectSize,
  EffectTriggerGroup,
  OverlayId
} from "@obs-effect/shared-types";
import { defaultOverlayId } from "../overlays/overlayTypes.js";
import { findEffectDefinition } from "../effects/effectDefinitions.js";
import type { PresetJsonRepository } from "./PresetJsonRepository.js";

export type PresetInput = Partial<Omit<EffectPreset, "id" | "createdAt" | "updatedAt" | "slots">>;
export type PresetSlotInput = Partial<Omit<EffectPresetSlot, "id" | "createdAt" | "updatedAt">> & { targetOverlayId?: number };

const defaultPosition: EffectPosition = { mode: "anchor", x: 0, y: 0, anchor: "center" };
const defaultSize: EffectSize = { scale: 1, unit: "percent" };
const defaultPlayback: EffectPlaybackSettings = {
  durationMs: 1000,
  startDelayMs: 0,
  cooldownMs: 0,
  maxConcurrent: 1,
  overlapPolicy: "allow",
  queueLimit: 10,
  stopPreviousSameEffect: false
};
const defaultTrigger: EffectTriggerGroup = { mode: "any", conditions: [{ type: "manual" }] };

export class PresetService {
  constructor(
    private readonly repository: PresetJsonRepository,
    private readonly now: () => string
  ) {}

  async list(): Promise<EffectPreset[]> {
    return await this.repository.list();
  }

  async get(id: string): Promise<EffectPreset | null> {
    return (await this.list()).find((preset) => preset.id === id) ?? null;
  }

  async create(input: PresetInput): Promise<EffectPreset> {
    const timestamp = this.now();
    const preset: EffectPreset = {
      id: randomUUID(),
      name: input.name?.trim() || "New Preset",
      description: input.description?.trim() || undefined,
      enabled: input.enabled ?? true,
      slots: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.repository.saveAll([preset, ...(await this.list())]);
    return preset;
  }

  async update(id: string, patch: PresetInput): Promise<EffectPreset | null> {
    const presets = await this.list();
    const index = presets.findIndex((preset) => preset.id === id);
    if (index < 0) return null;
    const current = presets[index]!;
    const updated: EffectPreset = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      description: patch.description !== undefined ? patch.description?.trim() || undefined : current.description,
      enabled: patch.enabled ?? current.enabled,
      updatedAt: this.now()
    };
    presets[index] = updated;
    await this.repository.saveAll(presets);
    return updated;
  }

  async moveToTop(id: string): Promise<EffectPreset | null> {
    const presets = await this.list();
    const index = presets.findIndex((preset) => preset.id === id);
    if (index < 0) return null;
    const [preset] = presets.splice(index, 1);
    presets.unshift(preset!);
    await this.repository.saveAll(presets);
    return preset!;
  }

  async delete(id: string): Promise<boolean> {
    const presets = await this.list();
    const next = presets.filter((preset) => preset.id !== id);
    if (next.length === presets.length) return false;
    await this.repository.saveAll(next);
    return true;
  }

  async addBlankSlot(presetId: string): Promise<EffectPresetSlot | null> {
    const slot = this.createSlot({});
    return (await this.insertSlot(presetId, slot)) ? slot : null;
  }

  async updateSlot(presetId: string, slotId: string, patch: PresetSlotInput): Promise<EffectPresetSlot | null> {
    const presets = await this.list();
    const presetIndex = presets.findIndex((preset) => preset.id === presetId);
    if (presetIndex < 0) return null;
    const preset = presets[presetIndex]!;
    const slotIndex = preset.slots.findIndex((slot) => slot.id === slotId);
    if (slotIndex < 0) return null;
    const updated = this.mergeSlot(preset.slots[slotIndex]!, patch);
    preset.slots[slotIndex] = updated;
    preset.updatedAt = this.now();
    presets[presetIndex] = preset;
    await this.repository.saveAll(presets);
    return updated;
  }

  async deleteSlot(presetId: string, slotId: string): Promise<boolean> {
    const presets = await this.list();
    const presetIndex = presets.findIndex((preset) => preset.id === presetId);
    if (presetIndex < 0) return false;
    const preset = presets[presetIndex]!;
    const nextSlots = preset.slots.filter((slot) => slot.id !== slotId);
    if (nextSlots.length === preset.slots.length) return false;
    preset.slots = nextSlots;
    preset.updatedAt = this.now();
    presets[presetIndex] = preset;
    await this.repository.saveAll(presets);
    return true;
  }

  private async insertSlot(presetId: string, slot: EffectPresetSlot): Promise<boolean> {
    const presets = await this.list();
    const index = presets.findIndex((preset) => preset.id === presetId);
    if (index < 0) return false;
    presets[index] = { ...presets[index]!, slots: [...presets[index]!.slots, slot], updatedAt: this.now() };
    await this.repository.saveAll(presets);
    return true;
  }

  private createSlot(input: PresetSlotInput): EffectPresetSlot {
    const timestamp = this.now();
    return {
      id: randomUUID(),
      name: input.name?.trim() || "Blank Effect",
      description: input.description?.trim() || undefined,
      effectDefinitionId: input.effectDefinitionId,
      enabled: input.enabled ?? true,
      targetOverlayId: defaultOverlayId(input.targetOverlayId ?? 1),
      trigger: input.trigger ?? defaultTrigger,
      visual: {
        parameters: input.visual?.parameters ?? defaultParameters(input.effectDefinitionId),
        position: input.visual?.position ?? defaultPosition,
        size: input.visual?.size ?? defaultSize,
        opacity: input.visual?.opacity ?? 1,
        zIndex: input.visual?.zIndex ?? 10
      },
      media: input.media ?? {},
      playback: { ...defaultPlayback, ...input.playback },
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private mergeSlot(current: EffectPresetSlot, patch: PresetSlotInput): EffectPresetSlot {
    const nextEffectDefinitionId = patch.effectDefinitionId ?? current.effectDefinitionId;
    const effectChanged = patch.effectDefinitionId !== undefined && patch.effectDefinitionId !== current.effectDefinitionId;
    return {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      description: patch.description !== undefined ? patch.description?.trim() || undefined : current.description,
      effectDefinitionId: nextEffectDefinitionId || undefined,
      enabled: patch.enabled ?? current.enabled,
      targetOverlayId: patch.targetOverlayId !== undefined ? defaultOverlayId(patch.targetOverlayId) : current.targetOverlayId,
      trigger: normalizePresetSlotTrigger(nextEffectDefinitionId, patch.trigger ?? current.trigger, effectChanged),
      visual: patch.visual
        ? {
            ...current.visual,
            ...patch.visual,
            parameters:
              patch.visual.parameters ?? (effectChanged ? { ...defaultParameters(nextEffectDefinitionId), ...current.visual.parameters } : current.visual.parameters)
          }
        : effectChanged
          ? { ...current.visual, parameters: { ...defaultParameters(nextEffectDefinitionId), ...current.visual.parameters } }
          : current.visual,
      media: patch.media ?? current.media,
      playback: patch.playback ? { ...current.playback, ...patch.playback } : current.playback,
      updatedAt: this.now()
    };
  }
}

function defaultParameters(effectDefinitionId: string | undefined): Record<string, unknown> {
  const definition = effectDefinitionId ? findEffectDefinition(effectDefinitionId) : undefined;
  return Object.fromEntries(definition?.parameterSchema.fields.map((field) => [field.key, field.defaultValue]) ?? []);
}

function normalizePresetSlotTrigger(effectDefinitionId: string | undefined, trigger: EffectTriggerGroup, effectChanged: boolean): EffectTriggerGroup {
  if (!effectChanged || !usesTikTokGiftTrigger(effectDefinitionId)) return trigger;
  const hasTikTokGiftCondition = trigger.conditions.some((condition) =>
    condition.type === "gift-any" || condition.type === "gift-specific" || condition.type === "gift-value"
  );
  return hasTikTokGiftCondition ? trigger : defaultTikTokGiftTrigger(effectDefinitionId);
}

function usesTikTokGiftTrigger(effectDefinitionId: string | undefined): boolean {
  return !!effectDefinitionId && ["flash", "simple-media", "gift-combo-text", "pitching-machine-ball", "falling-image", "puyo-game"].includes(effectDefinitionId);
}

function defaultTikTokGiftTrigger(effectDefinitionId: string | undefined): EffectTriggerGroup {
  return {
    mode: "any",
    conditions: [{ type: "gift-any", triggerOn: effectDefinitionId === "gift-combo-text" ? "gift" : "streak-end" }]
  };
}
