import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { effectDefinitions } from "../../effects/effectDefinitions.js";
import { effectMessageFromConfiguration, type EffectConfigurationInput, type EffectConfigurationService } from "../../effects/EffectConfigurationService.js";
import type { OverlayConnectionManager } from "../../overlays/overlayConnectionManager.js";
import type { EffectConfiguration, NormalizedEvent, ResolvedEffectMedia, RuntimeEffectObject } from "@obs-effect/shared-types";

const effectTestSchema = z.object({
  pitchingScenario: z.enum(["manual", "same-listener-gifts", "multiple-listener-gifts", "new-listener-gift"]).optional()
});

const configurationSchema = z.object({
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

export async function registerEffectRoutes(
  app: FastifyInstance,
  service: EffectConfigurationService,
  overlayManager: OverlayConnectionManager,
  now: () => string,
  options?: {
    executeFallingImage?: (configuration: EffectConfiguration) => Promise<{ spawnedObjects: RuntimeEffectObject[]; skipped: boolean; reason?: string }>;
    executePitchingMachineBall?: (configuration: EffectConfiguration, event?: NormalizedEvent) => Promise<{ spawnedObjects: RuntimeEffectObject[]; skipped: boolean; reason?: string }>;
    executeGiftComboText?: (configuration: EffectConfiguration, event?: NormalizedEvent) => Promise<{ spawnedObjects: RuntimeEffectObject[]; skipped: boolean; reason?: string }>;
    resolveMedia?: (configuration: EffectConfiguration) => Promise<ResolvedEffectMedia>;
  }
): Promise<void> {
  app.get("/api/v1/effect-definitions", async () => ({ definitions: effectDefinitions }));

  app.get("/api/v1/effect-definitions/:id", async (request, reply) => {
    const id = (request.params as { id?: string }).id;
    const definition = effectDefinitions.find((item) => item.id === id);
    if (!definition) return reply.code(404).send({ error: "Effect definition not found" });
    return { definition };
  });

  app.get("/api/v1/effect-configurations", async () => ({ configurations: await service.list() }));

  app.get("/api/v1/effect-configurations/:id", async (request, reply) => {
    const configuration = await service.get((request.params as { id: string }).id);
    if (!configuration) return reply.code(404).send({ error: "Effect configuration not found" });
    return { configuration };
  });

  app.post("/api/v1/effect-configurations", async (request, reply) => {
    const parsed = configurationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const configuration = await service.create(parsed.data as EffectConfigurationInput);
      return reply.code(201).send({ configuration });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/v1/effect-configurations/:id", async (request, reply) => {
    const parsed = configurationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const configuration = await service.update((request.params as { id: string }).id, parsed.data as EffectConfigurationInput);
      if (!configuration) return reply.code(404).send({ error: "Effect configuration not found" });
      return { configuration };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/v1/effect-configurations/:id", async (request, reply) => {
    const deleted = await service.delete((request.params as { id: string }).id);
    if (!deleted) return reply.code(404).send({ deleted: false, error: "Effect configuration not found" });
    return { deleted: true };
  });

  app.post("/api/v1/effect-configurations/:id/duplicate", async (request, reply) => {
    const configuration = await service.duplicate((request.params as { id: string }).id);
    if (!configuration) return reply.code(404).send({ error: "Effect configuration not found" });
    return reply.code(201).send({ configuration });
  });

  app.post("/api/v1/effect-configurations/:id/enable", async (request, reply) => {
    const configuration = await service.setEnabled((request.params as { id: string }).id, true);
    if (!configuration) return reply.code(404).send({ error: "Effect configuration not found" });
    return { configuration };
  });

  app.post("/api/v1/effect-configurations/:id/disable", async (request, reply) => {
    const configuration = await service.setEnabled((request.params as { id: string }).id, false);
    if (!configuration) return reply.code(404).send({ error: "Effect configuration not found" });
    return { configuration };
  });

  app.post("/api/v1/effect-configurations/:id/test", async (request, reply) => {
    const configuration = await service.get((request.params as { id: string }).id);
    if (!configuration) return reply.code(404).send({ accepted: false, error: "Effect configuration not found" });
    const parsedTest = effectTestSchema.safeParse(request.body ?? {});
    if (!parsedTest.success) return reply.code(400).send({ accepted: false, error: parsedTest.error.flatten() });
    if (configuration.effectDefinitionId === "falling-image" && options?.executeFallingImage) {
      const result = await options.executeFallingImage(configuration);
      if (result.skipped) {
        return reply.code(400).send({ accepted: false, error: result.reason ?? "Falling image effect could not be spawned" });
      }
      return {
        accepted: true,
        triggeredEffects: ["falling-image"],
        targetOverlayId: configuration.targetOverlayId,
        spawnedObjectCount: result.spawnedObjects.length
      };
    }
    if (configuration.effectDefinitionId === "pitching-machine-ball" && options?.executePitchingMachineBall) {
      const events = pitchingTestEvents(parsedTest.data.pitchingScenario ?? "manual");
      const results = events.length > 0
        ? await Promise.all(events.map((event) => options.executePitchingMachineBall!(configuration, event)))
        : [await options.executePitchingMachineBall(configuration)];
      const skipped = results.find((result) => result.skipped);
      if (skipped) {
        return reply.code(400).send({ accepted: false, error: skipped.reason ?? "Pitching machine ball effect could not be spawned" });
      }
      const spawnedObjectCount = results.reduce((total, result) => total + result.spawnedObjects.length, 0);
      return {
        accepted: true,
        triggeredEffects: ["pitching-machine-ball"],
        targetOverlayId: configuration.targetOverlayId,
        spawnedObjectCount,
        testEventCount: events.length,
        pitchingScenario: parsedTest.data.pitchingScenario ?? "manual"
      };
    }
    if (configuration.effectDefinitionId === "gift-combo-text" && options?.executeGiftComboText) {
      const result = await options.executeGiftComboText(configuration, createComboGiftTestEvent());
      if (result.skipped) {
        return reply.code(400).send({ accepted: false, error: result.reason ?? "Gift combo effect could not be spawned" });
      }
      return {
        accepted: true,
        triggeredEffects: ["gift-combo-text"],
        targetOverlayId: configuration.targetOverlayId,
        spawnedObjectCount: result.spawnedObjects.length
      };
    }
    const message = effectMessageFromConfiguration(configuration, {
      instanceId: `effect-config-test-${configuration.id}-${Date.now()}`,
      createdAt: now(),
      media: options?.resolveMedia ? await options.resolveMedia(configuration) : undefined
    });
    overlayManager.broadcastToOverlay(configuration.targetOverlayId, message);
    return {
      accepted: true,
      triggeredEffects: [message.effectId],
      targetOverlayId: configuration.targetOverlayId,
      instanceId: message.instanceId
    };
  });
}

function createComboGiftTestEvent(): NormalizedEvent {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    eventId: `gift-combo-test-${Date.now()}`,
    source: "test",
    platform: "tiktok",
    type: "gift",
    timestamp,
    receivedAt: timestamp,
    user: { id: "combo-test-user", displayName: "Combo Tester" },
    data: {
      giftId: "combo-test-gift",
      giftName: "Combo Test Gift",
      repeatCount: 10,
      normalizedGiftQuantity: 10,
      diamondValue: 1,
      diamondValueTotal: 10
    }
  };
}

function pitchingTestEvents(scenario: "manual" | "same-listener-gifts" | "multiple-listener-gifts" | "new-listener-gift"): NormalizedEvent[] {
  if (scenario === "manual") return [];
  if (scenario === "new-listener-gift") {
    const suffix = Date.now();
    return [createPitchingGiftTestEvent(`pitching-new-${suffix}`, `listener-new-${suffix}`, "New Listener", 10)];
  }
  if (scenario === "same-listener-gifts") {
    return [
      createPitchingGiftTestEvent("pitching-same-a", "listener-same", "Same Listener", 10),
      createPitchingGiftTestEvent("pitching-same-b", "listener-same", "Same Listener", 10)
    ];
  }
  return [
    createPitchingGiftTestEvent("pitching-multi-a", "listener-a", "Listener A", 10),
    createPitchingGiftTestEvent("pitching-multi-b", "listener-b", "Listener B", 10),
    createPitchingGiftTestEvent("pitching-multi-c", "listener-c", "Listener C", 10)
  ];
}

function createPitchingGiftTestEvent(eventId: string, userId: string, displayName: string, repeatCount: number): NormalizedEvent {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    eventId: `${eventId}-${Date.now()}`,
    source: "test",
    platform: "tiktok",
    type: "gift",
    timestamp,
    receivedAt: timestamp,
    user: {
      id: userId,
      uniqueId: userId,
      displayName
    },
    data: {
      giftId: "pitching-test-gift",
      giftName: "Pitching Test Gift",
      repeatCount,
      diamondValue: 1,
      diamondValueTotal: repeatCount
    }
  };
}
