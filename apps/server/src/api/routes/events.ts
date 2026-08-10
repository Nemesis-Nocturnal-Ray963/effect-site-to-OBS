import type { FastifyInstance } from "fastify";
import type { EventHistoryEntry, NormalizedEvent } from "@obs-effect/shared-types";
import { verifyApiKey } from "../middleware/apiKeyAuth.js";
import { normalizedEventSchema } from "../schemas/eventSchema.js";
import type { DeduplicationStore } from "../../deduplication/deduplicationStore.js";
import type { EventBus } from "../../events/eventBus.js";
import type { EventMetrics } from "../../metrics/eventMetrics.js";
import type { EventHistoryStore } from "../../events/eventHistoryStore.js";
import type { UiLogBuffer } from "../../logging/uiLogBuffer.js";

interface EventRoutesOptions {
  getApiKey: () => string;
  deduplicationStore: DeduplicationStore;
  eventBus: EventBus;
  metrics: EventMetrics;
  getMatchedActions: (event: NormalizedEvent) => Promise<string[]>;
  historyStore: EventHistoryStore;
  logBuffer: UiLogBuffer;
  onEventRecorded: (entry: EventHistoryEntry, kind: "received" | "replayed") => void;
  onEventsCleared: () => void;
  onLogRecorded: (entry: ReturnType<UiLogBuffer["add"]>) => void;
  onCatalogEvent?: (event: NormalizedEvent) => Promise<void>;
}

export async function registerEventRoutes(app: FastifyInstance, options: EventRoutesOptions): Promise<void> {
  function recordLog(entry: Parameters<UiLogBuffer["add"]>[0]): void {
    options.onLogRecorded(options.logBuffer.add(entry));
  }

  app.post("/api/v1/events", async (request, reply) => {
    const startedAt = Date.now();
    const receivedAt = new Date(startedAt).toISOString();

    if (!verifyApiKey(request, reply, options.getApiKey())) {
      recordLog({
        level: "warn",
        source: "http",
        message: "Rejected event request with invalid API key"
      });
      return reply;
    }

    const parsed = normalizedEventSchema.safeParse(request.body);

    if (!parsed.success) {
      options.metrics.markValidationError();
      recordLog({
        level: "error",
        source: "http",
        message: "Rejected invalid event payload",
        detail: { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }
      });
      return reply.code(400).send({
        accepted: false,
        error: "Validation failed",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      });
    }

    const event: NormalizedEvent = {
      ...parsed.data,
      receivedAt
    };

    options.metrics.markReceived(event.receivedAt);
    const normalizedAt = new Date().toISOString();

    if (options.deduplicationStore.isDuplicate(event.eventId)) {
      options.metrics.markDuplicate();
      const completedAt = new Date().toISOString();
      const entry = options.historyStore.add({
        event,
        processing: {
          receivedAt,
          normalizedAt,
          completedAt,
          latencyMs: Date.now() - startedAt
        },
        result: {
          duplicate: true,
          matchedActions: [],
          triggeredEffects: [],
          errors: []
        },
        createdAt: completedAt
      });
      options.onEventRecorded(entry, "received");
      recordLog({
        level: "warn",
        source: "event",
        message: `Duplicate event ignored: ${event.eventId}`,
        detail: { eventId: event.eventId, type: event.type }
      });
      return {
        accepted: true,
        duplicate: true,
        eventId: event.eventId,
        matchedActions: []
      };
    }

    await options.onCatalogEvent?.(event).catch((error) => {
      recordLog({
        level: "warn",
        source: "event",
        message: "Event catalog update failed",
        detail: { eventId: event.eventId, type: event.type, error: error instanceof Error ? error.message : String(error) }
      });
    });
    const matchedActions = await options.getMatchedActions(event);
    options.eventBus.publish(event);
    const completedAt = new Date().toISOString();
    const entry = options.historyStore.add({
      event,
      processing: {
        receivedAt,
        normalizedAt,
        completedAt,
        latencyMs: Date.now() - startedAt
      },
      result: {
        duplicate: false,
        matchedActions,
        triggeredEffects: matchedActions,
        errors: []
      },
      createdAt: completedAt
    });
    options.onEventRecorded(entry, "received");
    recordLog({
      level: matchedActions.length > 0 ? "info" : "info",
      source: matchedActions.length > 0 ? "effect" : "event",
      message:
        matchedActions.length > 0
          ? `Event ${event.eventId} triggered ${matchedActions.join(", ")}`
          : `Event ${event.eventId} received`,
      detail: { eventId: event.eventId, type: event.type, matchedActions }
    });

    return reply.code(202).send({
      accepted: true,
      duplicate: false,
      eventId: event.eventId,
      matchedActions
    });
  });

  app.get("/api/v1/events/history", async () => ({
    events: options.historyStore.list(),
    stats: options.historyStore.stats()
  }));

  app.delete("/api/v1/events/history", async () => {
    options.historyStore.clear();
    options.onEventsCleared();
    recordLog({
      level: "info",
      source: "event",
      message: "Event monitor view cleared"
    });
    return { cleared: true };
  });

  app.post("/api/v1/events/:eventId/replay", async (request, reply) => {
    const params = request.params as { eventId?: string };
    const original = params.eventId ? options.historyStore.find(params.eventId) : null;

    if (!original) {
      return reply.code(404).send({ accepted: false, error: "Event not found" });
    }

    const replayedAt = new Date().toISOString();
    const event: NormalizedEvent = {
      ...original.event,
      eventId: `replay-${Date.now()}-${original.event.eventId}`,
      timestamp: replayedAt,
      receivedAt: replayedAt,
      metadata: {
        ...original.event.metadata,
        replayedFromEventId: original.event.eventId,
        replayedAt,
        replayedBy: "control-ui"
      }
    };

    const matchedActions = await options.getMatchedActions(event);
    options.eventBus.publish(event);

    const entry = options.historyStore.add({
      event,
      processing: {
        receivedAt: replayedAt,
        normalizedAt: replayedAt,
        completedAt: new Date().toISOString(),
        latencyMs: 0
      },
      result: {
        duplicate: false,
        matchedActions,
        triggeredEffects: matchedActions,
        errors: []
      },
      createdAt: replayedAt
    });

    options.onEventRecorded(entry, "replayed");
    recordLog({
      level: "info",
      source: "event",
      message: `Replayed event ${original.event.eventId}`,
      detail: { originalEventId: original.event.eventId, replayedEventId: event.eventId }
    });

    return reply.code(202).send({
      accepted: true,
      eventId: event.eventId,
      replayedFromEventId: original.event.eventId,
      matchedActions
    });
  });
}
