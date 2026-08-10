import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import type { OverlayConnectionManager } from "../../overlays/overlayConnectionManager.js";
import { parseOverlayId } from "../../overlays/overlayTypes.js";
import type { OverlayRegistry } from "../../overlays/overlayRegistry.js";
import type { OverlayConfigurationJsonRepository } from "../../overlays/OverlayConfigurationJsonRepository.js";

const testSchema = z.object({
  color: z.string().optional(),
  durationMs: z.number().min(100).max(3000).optional()
});

export async function registerOverlayRoutes(
  app: FastifyInstance,
  manager: OverlayConnectionManager,
  registry: OverlayRegistry,
  configurationRepository: OverlayConfigurationJsonRepository,
  now: () => string
): Promise<void> {
  app.get("/api/v1/overlays", async () => ({ overlays: manager.statusList() }));

  app.get("/api/v1/overlays/:overlayId", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      return reply.code(404).send({ error: "Overlay not found" });
    }
    return { overlay: manager.statusList().find((item) => item.overlayId === overlayId) };
  });

  app.get("/api/v1/overlays/:overlayId/config", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      return reply.code(404).send({ error: "Overlay not found" });
    }
    return { config: await configurationRepository.get(overlayId) };
  });

  app.patch("/api/v1/overlays/:overlayId/config", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      return reply.code(404).send({ error: "Overlay not found" });
    }
    const parsed = overlayConfigPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const config = await configurationRepository.update(overlayId, parsed.data, now());
    registry.applyConfiguration(config);
    return { config, overlay: manager.statusList().find((item) => item.overlayId === overlayId) };
  });

  app.post("/api/v1/overlays/:overlayId/test", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      return reply.code(404).send({ accepted: false, error: "Overlay not found" });
    }

    const parsed = testSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    }

    const message: EffectPlayMessage = {
      type: "effect:play",
      effectId: "flash",
      targetOverlayId: overlayId,
      instanceId: `overlay-${overlayId}-test-flash-${Date.now()}`,
      parameters: {
        color: parsed.data.color ?? "#ffffff",
        durationMs: parsed.data.durationMs ?? 650
      },
      createdAt: now()
    };
    manager.broadcastToOverlay(overlayId, message);
    return { accepted: true, triggeredEffects: ["flash"], targetOverlayId: overlayId, instanceId: message.instanceId };
  });
}

const overlayConfigPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  width: z.number().int().min(320).max(7680).optional(),
  height: z.number().int().min(240).max(4320).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  purpose: z.string().max(200).optional(),
  scaleMode: z.enum(["fit", "stretch", "native"]).optional(),
  safeAreaEnabled: z.boolean().optional(),
  debugBackground: z.string().optional()
});
