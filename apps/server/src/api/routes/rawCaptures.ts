import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RawNormalizationStatus, TikTokRawEventCapture } from "@obs-effect/shared-types";
import type { TikTokRawCaptureService } from "../../tiktok/raw-capture/TikTokRawCaptureService.js";
import { anonymizeCapture } from "../../tiktok/raw-capture/anonymizeCapture.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  eventName: z.string().optional(),
  normalizationStatus: z.enum(["success", "warning", "failed", "not-normalized"]).optional(),
  search: z.string().optional()
});

const exportSchema = z.object({
  format: z.enum(["json", "jsonl"]).default("json"),
  anonymize: z.boolean().default(false),
  captureIds: z.array(z.string()).optional()
});

export async function registerRawCaptureRoutes(app: FastifyInstance, service: TikTokRawCaptureService): Promise<void> {
  app.get("/api/v1/tiktok/raw-captures", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return {
      captures: service.list({
        ...parsed.data,
        normalizationStatus: parsed.data.normalizationStatus as RawNormalizationStatus | undefined
      }),
      status: service.status()
    };
  });

  app.get("/api/v1/tiktok/raw-captures/status", async () => service.status());

  app.post("/api/v1/tiktok/raw-captures/enable", async () => service.enable());
  app.post("/api/v1/tiktok/raw-captures/disable", async () => service.disable());

  app.delete("/api/v1/tiktok/raw-captures", async () => {
    const status = service.clear();
    return { cleared: true, status };
  });

  app.get("/api/v1/tiktok/raw-captures/:captureId", async (request, reply) => {
    const capture = service.find((request.params as { captureId?: string }).captureId ?? "");
    if (!capture) return reply.code(404).send({ error: "Capture not found" });
    return { capture };
  });

  app.post("/api/v1/tiktok/raw-captures/export", async (request, reply) => {
    const parsed = exportSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const captures = selectCaptures(service, parsed.data.captureIds).map((capture) =>
      parsed.data.anonymize ? anonymizeCapture(capture) : capture
    );
    const body = parsed.data.format === "jsonl" ? captures.map((capture) => JSON.stringify(capture)).join("\n") : JSON.stringify(captures, null, 2);
    return reply
      .header("content-disposition", `attachment; filename="tiktok-raw-captures.${parsed.data.format === "jsonl" ? "jsonl" : "json"}"`)
      .type(parsed.data.format === "jsonl" ? "application/x-ndjson" : "application/json")
      .send(body);
  });
}

function selectCaptures(service: TikTokRawCaptureService, captureIds?: string[]): TikTokRawEventCapture[] {
  if (captureIds && captureIds.length > 0) {
    return captureIds.map((id) => service.find(id)).filter((capture): capture is TikTokRawEventCapture => Boolean(capture));
  }
  return service
    .list({ limit: 1000 })
    .map((summary) => service.find(summary.captureId))
    .filter((capture): capture is TikTokRawEventCapture => Boolean(capture));
}
