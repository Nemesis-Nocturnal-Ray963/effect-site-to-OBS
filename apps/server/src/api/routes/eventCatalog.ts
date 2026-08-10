import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventCatalogSourceType } from "@obs-effect/shared-types";
import type { EventCatalogService } from "../../events/EventCatalogService.js";

const sourceTypes = ["tiktok", "http", "websocket", "internal", "manual", "timer", "plugin", "unknown"] as const;

const listQuerySchema = z.object({
  search: z.string().optional(),
  sourceType: z.union([z.enum(sourceTypes), z.literal("all")]).optional(),
  eventType: z.string().optional(),
  enabled: z.enum(["all", "enabled", "disabled"]).optional(),
  favorite: z.enum(["all", "favorite"]).optional(),
  sort: z.enum(["displayName", "firstReceivedAt", "lastReceivedAt", "receivedCount", "updatedAt", "triggerAssignmentCount"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional()
});

const patchSchema = z.object({
  displayName: z.string().max(200).optional(),
  customDisplayName: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  memo: z.string().max(10000).optional(),
  category: z.string().max(120).optional(),
  tags: z.array(z.string().max(80)).max(50).optional(),
  isEnabled: z.boolean().optional(),
  isFavorite: z.boolean().optional()
});

const manualSchema = z.object({
  sourceType: z.enum(sourceTypes).default("manual"),
  eventType: z.string().min(1).max(120),
  externalEventId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  memo: z.string().max(10000).optional(),
  category: z.string().max(120).optional(),
  tags: z.array(z.string().max(80)).max(50).optional()
});

export async function registerEventCatalogRoutes(app: FastifyInstance, service: EventCatalogService): Promise<void> {
  app.get("/api/v1/event-catalog", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { events: service.list(parsed.data) };
  });

  app.get("/api/v1/event-catalog/:id", async (request, reply) => {
    const item = service.get((request.params as { id: string }).id);
    if (!item) return reply.code(404).send({ error: "Event catalog item not found" });
    return { event: item };
  });

  app.post("/api/v1/event-catalog", async (request, reply) => {
    const parsed = manualSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const item = service.createManual({ ...parsed.data, sourceType: parsed.data.sourceType as EventCatalogSourceType });
    return reply.code(201).send({ event: item });
  });

  app.patch("/api/v1/event-catalog/:id", async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const item = service.update((request.params as { id: string }).id, parsed.data);
    if (!item) return reply.code(404).send({ error: "Event catalog item not found" });
    return { event: item };
  });
}
