import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TikTokConnectionManager } from "../../tiktok/TikTokConnectionManager.js";
import type { BrowserFrameStore } from "../../tiktok/browser/BrowserFrameStore.js";

const frameQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  direction: z.enum(["received", "sent"]).optional(),
  search: z.string().optional()
});

const exportSchema = z.object({
  format: z.enum(["json", "jsonl"]).default("json"),
  captureIds: z.array(z.string()).optional()
});

const markerSchema = z.object({
  label: z.string().min(1).max(120),
  note: z.string().max(500).optional()
});

const browserConnectSchema = z.object({
  uniqueId: z.string().min(1).max(120),
  browserType: z.enum(["chrome", "edge", "auto"]).optional(),
  executablePath: z.string().optional(),
  debuggingPort: z.number().int().min(1024).max(65535).optional(),
  headless: z.boolean().optional(),
  captureFrames: z.boolean().optional()
});

export async function registerTikTokBrowserRoutes(
  app: FastifyInstance,
  manager: TikTokConnectionManager,
  frameStore: BrowserFrameStore,
  hooks: {
    onFrameCleared: () => void;
    onMarkerAdded: (marker: { markerId: string; createdAt: string; label: string; note?: string }) => void;
  }
): Promise<void> {
  const markers: Array<{ markerId: string; createdAt: string; label: string; note?: string }> = [];

  app.get("/api/v1/tiktok/browser/status", async () => ({
    status: manager.getBrowserStatus(),
    frameStatus: frameStore.status()
  }));

  app.post("/api/v1/tiktok/browser/launch", async (request, reply) => {
    const parsed = browserConnectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    await manager.connect({
      uniqueId: parsed.data.uniqueId,
      connectorMode: "browser",
      browser: {
        browserType: parsed.data.browserType,
        executablePath: parsed.data.executablePath,
        debuggingPort: parsed.data.debuggingPort,
        headless: parsed.data.headless,
        captureFrames: parsed.data.captureFrames
      }
    });
    return { accepted: true, status: manager.getStatus(), browserStatus: manager.getBrowserStatus(), frameStatus: frameStore.status() };
  });

  app.post("/api/v1/tiktok/browser/connect", async (request, reply) => {
    const parsed = browserConnectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    await manager.connect({
      uniqueId: parsed.data.uniqueId,
      connectorMode: "browser",
      browser: {
        browserType: parsed.data.browserType,
        executablePath: parsed.data.executablePath,
        debuggingPort: parsed.data.debuggingPort,
        headless: parsed.data.headless,
        captureFrames: parsed.data.captureFrames
      }
    });
    return { accepted: true, status: manager.getStatus(), browserStatus: manager.getBrowserStatus(), frameStatus: frameStore.status() };
  });

  app.post("/api/v1/tiktok/browser/disconnect", async () => {
    await manager.disconnect();
    return { accepted: true, status: manager.getStatus(), browserStatus: manager.getBrowserStatus(), frameStatus: frameStore.status() };
  });

  app.post("/api/v1/tiktok/browser/open-live-page", async (request, reply) => {
    const parsed = browserConnectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    await manager.connect({ uniqueId: parsed.data.uniqueId, connectorMode: "browser", browser: parsed.data });
    return { accepted: true, status: manager.getStatus(), browserStatus: manager.getBrowserStatus(), frameStatus: frameStore.status() };
  });

  app.post("/api/v1/tiktok/browser/capture/enable", async () => frameStore.enable());
  app.post("/api/v1/tiktok/browser/capture/disable", async () => frameStore.disable());

  app.get("/api/v1/tiktok/browser/frames", async (request, reply) => {
    const parsed = frameQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { frames: frameStore.list(parsed.data), status: frameStore.status() };
  });

  app.get("/api/v1/tiktok/browser/frames/:captureId", async (request, reply) => {
    const frame = frameStore.find((request.params as { captureId?: string }).captureId ?? "");
    if (!frame) return reply.code(404).send({ error: "Frame not found" });
    return { frame };
  });

  app.delete("/api/v1/tiktok/browser/frames", async () => {
    const status = frameStore.clear();
    hooks.onFrameCleared();
    return { cleared: true, status };
  });

  app.post("/api/v1/tiktok/browser/frames/export", async (request, reply) => {
    const parsed = exportSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const captures =
      parsed.data.captureIds && parsed.data.captureIds.length > 0
        ? parsed.data.captureIds.map((id) => frameStore.find(id)).filter(Boolean)
        : frameStore.all();
    const body =
      parsed.data.format === "jsonl" ? captures.map((capture) => JSON.stringify(capture)).join("\n") : JSON.stringify(captures, null, 2);
    return reply
      .header("content-disposition", `attachment; filename="tiktok-browser-frames.${parsed.data.format === "jsonl" ? "jsonl" : "json"}"`)
      .type(parsed.data.format === "jsonl" ? "application/x-ndjson" : "application/json")
      .send(body);
  });

  app.get("/api/v1/tiktok/browser/markers", async () => ({ markers }));

  app.post("/api/v1/tiktok/browser/markers", async (request, reply) => {
    const parsed = markerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const marker = { markerId: randomUUID(), createdAt: new Date().toISOString(), ...parsed.data };
    markers.unshift(marker);
    hooks.onMarkerAdded(marker);
    return { marker };
  });

  app.delete("/api/v1/tiktok/browser/markers", async () => {
    markers.splice(0, markers.length);
    return { cleared: true };
  });
}
