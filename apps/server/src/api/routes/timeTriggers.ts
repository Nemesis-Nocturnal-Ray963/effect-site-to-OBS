import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TimeTriggerService, TimeTriggerInput, TriggerActionInput } from "../../time-triggers/TimeTriggerService.js";

const triggerSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  memo: z.string().optional(),
  isEnabled: z.boolean().optional(),
  triggerMode: z.enum(["elapsed", "absolute_datetime", "daily_time", "interval"]).optional(),
  startBasis: z
    .enum(["manual", "app_start", "session_start", "scene_start", "event_received", "effect_started", "effect_completed"])
    .optional(),
  durationMs: z.number().int().min(1000).optional(),
  targetDateTime: z.string().optional(),
  dailyTime: z.string().optional(),
  intervalMs: z.number().int().min(1000).optional(),
  repeatCount: z.number().int().min(1).optional(),
  maxExecutions: z.number().int().min(1).optional(),
  resumeAfterRestart: z.boolean().optional()
});

const actionSchema = z.object({
  type: z.enum(["show_asset", "show_text", "play_scene", "run_program_effect", "play_audio", "send_http", "emit_event"]).optional(),
  name: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  order: z.number().int().optional(),
  delayMs: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional()
});

export async function registerTimeTriggerRoutes(app: FastifyInstance, service: TimeTriggerService): Promise<void> {
  app.get("/api/v1/time-triggers", async (request) => {
    const query = request.query as { search?: string; status?: string; enabled?: string };
    return {
      triggers: service.list({
        search: query.search,
        status: isStatus(query.status) ? query.status : "all",
        enabled: query.enabled === "enabled" || query.enabled === "disabled" ? query.enabled : "all"
      })
    };
  });

  app.get("/api/v1/time-triggers/logs", async (request) => {
    const query = request.query as { triggerId?: string };
    return { logs: service.logs(query.triggerId) };
  });

  app.get("/api/v1/time-triggers/:triggerId", async (request, reply) => {
    const trigger = service.get((request.params as { triggerId: string }).triggerId);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.post("/api/v1/time-triggers", async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.code(201).send({ trigger: service.create(parsed.data as TimeTriggerInput) });
  });

  app.patch("/api/v1/time-triggers/:triggerId", async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const trigger = service.update((request.params as { triggerId: string }).triggerId, parsed.data as TimeTriggerInput);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.delete("/api/v1/time-triggers/:triggerId", async (request, reply) => {
    const deleted = service.delete((request.params as { triggerId: string }).triggerId);
    if (!deleted) return reply.code(404).send({ deleted: false, error: "Time trigger not found" });
    return { deleted: true };
  });

  app.post("/api/v1/time-triggers/:triggerId/start", async (request, reply) => {
    const trigger = service.start((request.params as { triggerId: string }).triggerId);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.post("/api/v1/time-triggers/:triggerId/stop", async (request, reply) => {
    const trigger = service.stop((request.params as { triggerId: string }).triggerId);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.post("/api/v1/time-triggers/:triggerId/reset", async (request, reply) => {
    const trigger = service.reset((request.params as { triggerId: string }).triggerId);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.post("/api/v1/time-triggers/:triggerId/execute-now", async (request, reply) => {
    const trigger = await service.executeNow((request.params as { triggerId: string }).triggerId);
    if (!trigger) return reply.code(404).send({ error: "Time trigger not found" });
    return { trigger };
  });

  app.post("/api/v1/time-triggers/:triggerId/actions", async (request, reply) => {
    const parsed = actionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const action = service.addAction((request.params as { triggerId: string }).triggerId, parsed.data as TriggerActionInput);
    if (!action) return reply.code(404).send({ error: "Time trigger not found" });
    return reply.code(201).send({ action, trigger: service.get((request.params as { triggerId: string }).triggerId) });
  });

  app.patch("/api/v1/time-triggers/:triggerId/actions/:actionId", async (request, reply) => {
    const parsed = actionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const params = request.params as { triggerId: string; actionId: string };
    const action = service.updateAction(params.triggerId, params.actionId, parsed.data as TriggerActionInput);
    if (!action) return reply.code(404).send({ error: "Time trigger action not found" });
    return { action, trigger: service.get(params.triggerId) };
  });

  app.delete("/api/v1/time-triggers/:triggerId/actions/:actionId", async (request, reply) => {
    const params = request.params as { triggerId: string; actionId: string };
    const deleted = service.deleteAction(params.triggerId, params.actionId);
    if (!deleted) return reply.code(404).send({ deleted: false, error: "Time trigger action not found" });
    return { deleted: true, trigger: service.get(params.triggerId) };
  });
}

function isStatus(value: string | undefined): value is "idle" | "scheduled" | "running" | "paused" | "completed" | "cancelled" | "error" {
  return !!value && ["idle", "scheduled", "running", "paused", "completed", "cancelled", "error"].includes(value);
}
