import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GiftCatalogService } from "../../gifts/GiftCatalogService.js";
import type { GiftCatalogQuery } from "../../gifts/giftTypes.js";

const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const querySchema = z.object({
  search: z.string().optional(),
  sort: z.enum(["name", "lastSeenAt", "firstSeenAt", "seenCount", "diamondValue", "coinValue"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  hasImage: queryBoolean.optional(),
  hasDiamondValue: queryBoolean.optional(),
  hasCoinValue: queryBoolean.optional(),
  cacheStatus: z.enum(["not-requested", "pending", "cached", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  diamondValue: z.number().int().nonnegative().nullable().optional(),
  coinValue: z.number().int().nonnegative().nullable().optional(),
  primaryImageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional()
});

export async function registerGiftRoutes(app: FastifyInstance, service: GiftCatalogService): Promise<void> {
  app.get("/api/v1/gifts", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", issues: parsed.error.issues });
    }
    const gifts = await service.list(parsed.data as GiftCatalogQuery);
    return { gifts };
  });

  app.get("/api/v1/gifts/stats", async () => ({ stats: await service.stats() }));

  app.get("/api/v1/gifts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gift = await service.get(id);
    if (!gift) return reply.code(404).send({ error: "Gift not found" });
    return { gift };
  });

  app.patch("/api/v1/gifts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid patch", issues: parsed.error.issues });
    }
    try {
      return { gift: await service.update(id, parsed.data) };
    } catch {
      return reply.code(404).send({ error: "Gift not found" });
    }
  });

  app.post("/api/v1/gifts/:id/refresh-image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gift = await service.get(id);
    if (!gift) return reply.code(404).send({ error: "Gift not found" });
    return { accepted: true, gift };
  });

  app.delete("/api/v1/gifts/:id", async (request) => {
    const { id } = request.params as { id: string };
    await service.delete(id);
    return { deleted: true };
  });
}
