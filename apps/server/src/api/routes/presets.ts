import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PresetService, PresetInput, PresetSlotInput } from "../../presets/PresetService.js";
import type { EffectConfigurationService } from "../../effects/EffectConfigurationService.js";
import type { EffectConfiguration, NormalizedEvent } from "@obs-effect/shared-types";

const presetTestSchema = z.object({
  gift: z.object({
    platformGiftId: z.string().min(1),
    name: z.string().min(1),
    coinValue: z.number().nonnegative(),
    imageUrl: z.string().optional()
  })
});

const presetSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional()
});

const slotSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  effectDefinitionId: z.string().optional(),
  enabled: z.boolean().optional(),
  targetOverlayId: z.number().int().min(1).max(10).optional(),
  trigger: z
    .object({
      mode: z.enum(["all", "any"]),
      conditions: z.array(z.record(z.unknown())).min(1)
    })
    .optional(),
  visual: z
    .object({
      parameters: z.record(z.unknown()).optional(),
      position: z
        .object({
          mode: z.enum(["absolute", "normalized", "anchor"]),
          x: z.number(),
          y: z.number(),
          anchor: z.enum([
            "top-left",
            "top-center",
            "top-right",
            "center-left",
            "center",
            "center-right",
            "bottom-left",
            "bottom-center",
            "bottom-right"
          ])
        })
        .optional(),
      size: z
        .object({
          width: z.number().optional(),
          height: z.number().optional(),
          scale: z.number().optional(),
          unit: z.enum(["px", "percent"])
        })
        .optional(),
      opacity: z.number().optional(),
      zIndex: z.number().optional()
    })
    .optional(),
  media: z
    .object({
      imageAssetId: z.string().optional(),
      videoAssetId: z.string().optional(),
      audioAssetId: z.string().optional()
    })
    .optional(),
  playback: z
    .object({
      durationMs: z.number().optional(),
      startDelayMs: z.number().optional(),
      cooldownMs: z.number().optional(),
      maxConcurrent: z.number().optional(),
      overlapPolicy: z.enum(["allow", "ignore-new", "replace-old", "queue"]).optional(),
      queueLimit: z.number().optional(),
      stopPreviousSameEffect: z.boolean().optional()
    })
    .optional()
});

export async function registerPresetRoutes(
  app: FastifyInstance,
  service: PresetService,
  effectService: EffectConfigurationService,
  options?: { executeTest?: (configuration: EffectConfiguration, event: NormalizedEvent) => Promise<void> }
): Promise<void> {
  app.get("/api/v1/presets", async () => ({ presets: await service.list() }));

  app.post("/api/v1/presets", async (request, reply) => {
    const parsed = presetSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const preset = await service.create(parsed.data as PresetInput);
    return reply.code(201).send({ preset });
  });

  app.patch("/api/v1/presets/:presetId", async (request, reply) => {
    const parsed = presetSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const preset = await service.update((request.params as { presetId: string }).presetId, parsed.data as PresetInput);
    if (!preset) return reply.code(404).send({ error: "Preset not found" });
    return { preset };
  });

  app.delete("/api/v1/presets/:presetId", async (request, reply) => {
    const presetId = (request.params as { presetId: string }).presetId;
    const deleted = await service.delete(presetId);
    if (!deleted) return reply.code(404).send({ deleted: false, error: "Preset not found" });
    await effectService.removePresetConfigurations(presetId);
    return { deleted: true };
  });

  app.post("/api/v1/presets/:presetId/save", async (request, reply) => {
    const preset = await service.get((request.params as { presetId: string }).presetId);
    if (!preset) return reply.code(404).send({ error: "Preset not found" });
    try {
      const configurations = await effectService.applyPreset(preset);
      return { saved: true, configurationCount: configurations.length, configurations };
    } catch (error) {
      return reply.code(400).send({ saved: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/v1/presets/:presetId/test", async (request, reply) => {
    const preset = await service.get((request.params as { presetId: string }).presetId);
    if (!preset) return reply.code(404).send({ accepted: false, error: "Preset not found" });
    const parsed = presetTestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    if (!options?.executeTest) return reply.code(503).send({ accepted: false, error: "Preset testing is unavailable" });
    const event = createPresetGiftTestEvent(parsed.data.gift);
    const configurations = await effectService.configurationsForPresetTest(preset);
    for (const configuration of configurations) await options.executeTest(configuration, event);
    return { accepted: true, testedEffectCount: configurations.length };
  });

  app.post("/api/v1/presets/:presetId/select", async (request, reply) => {
    const preset = await service.moveToTop((request.params as { presetId: string }).presetId);
    if (!preset) return reply.code(404).send({ error: "Preset not found" });
    return { preset };
  });

  app.post("/api/v1/presets/:presetId/slots", async (request, reply) => {
    const slot = await service.addBlankSlot((request.params as { presetId: string }).presetId);
    if (!slot) return reply.code(404).send({ error: "Preset not found" });
    return reply.code(201).send({ slot });
  });

  app.patch("/api/v1/presets/:presetId/slots/:slotId", async (request, reply) => {
    const parsed = slotSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const params = request.params as { presetId: string; slotId: string };
    const slot = await service.updateSlot(params.presetId, params.slotId, parsed.data as PresetSlotInput);
    if (!slot) return reply.code(404).send({ error: "Preset slot not found" });
    return { slot };
  });

  app.delete("/api/v1/presets/:presetId/slots/:slotId", async (request, reply) => {
    const params = request.params as { presetId: string; slotId: string };
    const deleted = await service.deleteSlot(params.presetId, params.slotId);
    if (!deleted) return reply.code(404).send({ deleted: false, error: "Preset slot not found" });
    return { deleted: true };
  });
}

export function createPresetGiftTestEvent(gift: { platformGiftId: string; name: string; coinValue: number; imageUrl?: string }): NormalizedEvent {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    eventId: `preset-gift-test-${Date.now()}`,
    source: "test",
    platform: "tiktok",
    type: "gift",
    timestamp,
    receivedAt: timestamp,
    user: { id: "preset-test-user", displayName: "Preset Tester" },
    data: {
      giftId: gift.platformGiftId,
      platformGiftId: gift.platformGiftId,
      giftName: gift.name,
      repeatCount: 1,
      normalizedGiftQuantity: 1,
      coinValue: gift.coinValue,
      coinValueTotal: gift.coinValue,
      diamondValue: gift.coinValue,
      diamondValueTotal: gift.coinValue,
      giftImageUrls: gift.imageUrl ? [gift.imageUrl] : undefined,
      primaryGiftImageUrl: gift.imageUrl
    }
  };
}
