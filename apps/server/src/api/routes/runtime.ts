import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseOverlayId } from "../../overlays/overlayTypes.js";
import type { RuntimeInteractionService } from "../../runtime/RuntimeInteractionService.js";

const clearScopeSchema = z.object({
  scope: z.enum(["interactive", "all"]).optional()
});

const moveObjectSchema = z.object({
  normalizedX: z.number().min(0).max(1),
  normalizedY: z.number().min(0).max(1)
});

export async function registerRuntimeRoutes(app: FastifyInstance, service: RuntimeInteractionService): Promise<void> {
  app.get("/api/v1/overlays/:overlayId/runtime", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    return { snapshot: service.snapshot(overlayId) };
  });

  app.post("/api/v1/overlays/:overlayId/interactions/session", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    const mode = ((request.body as { mode?: string } | undefined)?.mode === "interactive" ? "interactive" : "view") as "view" | "interactive";
    return { status: service.startSession(overlayId, mode), snapshot: service.snapshot(overlayId) };
  });

  app.delete("/api/v1/overlays/:overlayId/interactions/session", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    return { status: service.endSession(overlayId) };
  });

  app.post("/api/v1/overlays/:overlayId/runtime/mock-object", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    return reply.code(201).send({ object: service.createMockObject(overlayId), snapshot: service.snapshot(overlayId) });
  });

  app.post("/api/v1/overlays/:overlayId/objects/:objectId/hit", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ accepted: false, error: "Overlay not found" });
    const object = service.hit(overlayId, (request.params as { objectId: string }).objectId);
    if (!object) return reply.code(404).send({ accepted: false, error: "Object not found or not interactive" });
    return { accepted: true, object };
  });

  app.delete("/api/v1/overlays/:overlayId/objects/:objectId", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ deleted: false, error: "Overlay not found" });
    const object = service.destroy(overlayId, (request.params as { objectId: string }).objectId);
    if (!object) return reply.code(404).send({ deleted: false, error: "Object not found or not interactive" });
    return { deleted: true, object };
  });

  app.patch("/api/v1/overlays/:overlayId/objects/:objectId/position", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ updated: false, error: "Overlay not found" });
    const parsed = moveObjectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ updated: false, error: "Invalid object position" });
    const object = service.move(
      overlayId,
      (request.params as { objectId: string }).objectId,
      parsed.data.normalizedX,
      parsed.data.normalizedY
    );
    if (!object) return reply.code(404).send({ updated: false, error: "Object not found or not interactive" });
    return { updated: true, object };
  });

  app.delete("/api/v1/overlays/:overlayId/runtime", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ cleared: false, error: "Overlay not found" });
    const query = clearScopeSchema.safeParse(request.query ?? {});
    const scope = query.success ? (query.data.scope ?? "interactive") : "interactive";
    return { cleared: true, status: service.clear(overlayId, scope) };
  });
}
