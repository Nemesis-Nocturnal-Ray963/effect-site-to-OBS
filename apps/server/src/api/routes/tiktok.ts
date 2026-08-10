import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TikTokConnectionManager } from "../../tiktok/TikTokConnectionManager.js";

const connectSchema = z.object({
  uniqueId: z.string().min(1).max(120),
  sessionId: z.string().max(500).optional(),
  connectorMode: z.enum(["browser", "library", "mock"]).optional(),
  enableExtendedGiftInfo: z.boolean().optional(),
  fetchRoomInfoOnConnect: z.boolean().optional(),
  autoReconnect: z.boolean().optional(),
  useMockConnector: z.boolean().optional(),
  browser: z
    .object({
      browserType: z.enum(["chrome", "edge", "auto"]).optional(),
      executablePath: z.string().optional(),
      debuggingPort: z.number().int().min(1024).max(65535).optional(),
      headless: z.boolean().optional(),
      captureFrames: z.boolean().optional()
    })
    .optional()
});

export async function registerTikTokRoutes(app: FastifyInstance, manager: TikTokConnectionManager): Promise<void> {
  app.get("/api/v1/tiktok/status", async () => ({ status: manager.getStatus() }));

  app.post("/api/v1/tiktok/connect", async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    }

    await manager.connect(parsed.data);
    return reply.code(202).send({ accepted: true, status: manager.getStatus() });
  });

  app.post("/api/v1/tiktok/disconnect", async () => {
    await manager.disconnect();
    return { accepted: true, status: manager.getStatus() };
  });

  app.post("/api/v1/tiktok/reconnect", async () => {
    await manager.reconnect();
    return { accepted: true, status: manager.getStatus() };
  });

  app.post("/api/v1/tiktok/mock-event", async (request, reply) => {
    if (!manager.injectMockEvent(request.body ?? {})) {
      return reply.code(409).send({ accepted: false, error: "Mock connector is not active" });
    }
    return { accepted: true };
  });
}
