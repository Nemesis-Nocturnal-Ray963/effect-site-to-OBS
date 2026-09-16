import path from "node:path";
import { createReadStream } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type {
  ClientInteractionMessage,
  EffectPlayMessage,
  EventHistoryEntry,
  NormalizedEvent,
  OverlayReloadRequiredMessage,
  OverlayId,
  ServerMessage,
  TimeTrigger,
  TriggerAction,
  UiLogEntry
} from "@obs-effect/shared-types";
import type WebSocket from "ws";
import { loadApiConfig, regenerateApiConfig } from "./config/apiConfig.js";
import { DeduplicationStore } from "./deduplication/deduplicationStore.js";
import { EventBus } from "./events/eventBus.js";
import { EventHistoryStore } from "./events/eventHistoryStore.js";
import { mapEventToEffects } from "./events/temporaryEventMapper.js";
import { EventCatalogService } from "./events/EventCatalogService.js";
import { EventMetrics } from "./metrics/eventMetrics.js";
import { registerEventRoutes } from "./api/routes/events.js";
import { registerEventCatalogRoutes } from "./api/routes/eventCatalog.js";
import { TimeTriggerService } from "./time-triggers/TimeTriggerService.js";
import { registerTimeTriggerRoutes } from "./api/routes/timeTriggers.js";
import { UiLogBuffer } from "./logging/uiLogBuffer.js";
import { TikTokConnectionManager } from "./tiktok/TikTokConnectionManager.js";
import { registerTikTokRoutes } from "./api/routes/tiktok.js";
import { OverlayRegistry } from "./overlays/overlayRegistry.js";
import { OverlayConnectionManager } from "./overlays/overlayConnectionManager.js";
import { defaultOverlayId, parseOverlayId } from "./overlays/overlayTypes.js";
import { registerOverlayRoutes } from "./api/routes/overlays.js";
import { OverlayConfigurationJsonRepository } from "./overlays/OverlayConfigurationJsonRepository.js";
import { EffectConfigurationJsonRepository } from "./effects/EffectConfigurationJsonRepository.js";
import { EffectConfigurationService, effectMessageFromConfiguration } from "./effects/EffectConfigurationService.js";
import { FallingImageEffectService } from "./effects/builtins/fallingImage.js";
import { GiftComboTextEffectService } from "./effects/builtins/giftComboText.js";
import { PitchingMachineBallEffectService } from "./effects/builtins/pitchingMachineBall.js";
import { GiftPileEffectService } from "./effects/builtins/giftPile.js";
import { PuyoGameEffectService } from "./effects/builtins/puyoGame.js";
import { registerEffectRoutes } from "./api/routes/effects.js";
import { TikTokRawEventStore } from "./tiktok/raw-capture/TikTokRawEventStore.js";
import { TikTokRawCaptureService } from "./tiktok/raw-capture/TikTokRawCaptureService.js";
import { registerRawCaptureRoutes } from "./api/routes/rawCaptures.js";
import { BrowserFrameStore } from "./tiktok/browser/BrowserFrameStore.js";
import { registerTikTokBrowserRoutes } from "./api/routes/tiktokBrowser.js";
import { GiftCatalogJsonRepository } from "./gifts/GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./gifts/GiftCatalogService.js";
import { registerGiftRoutes } from "./api/routes/gifts.js";
import { RuntimeEffectObjectStore } from "./runtime/RuntimeEffectObjectStore.js";
import { RuntimeInteractionService } from "./runtime/RuntimeInteractionService.js";
import { registerRuntimeRoutes } from "./api/routes/runtime.js";
import { loadCatalog, registerAssetRoutes } from "./api/routes/assets.js";
import { PresetJsonRepository } from "./presets/PresetJsonRepository.js";
import { PresetService } from "./presets/PresetService.js";
import { registerPresetRoutes } from "./api/routes/presets.js";
import { registerSystemFontRoutes } from "./api/routes/systemFonts.js";
import { registerGameIntegrationRoutes } from "./api/routes/gameIntegrations.js";
import { appVersion, buildVersion, overlayBundleVersion, serverInstanceId } from "./version/buildVersion.js";

interface CreateAppOptions {
  rootDir: string;
  bindAddress?: string;
  port?: number;
}

const playSchema = z.object({
  instanceId: z.string().optional(),
  targetOverlayId: z.number().int().min(1).max(10).optional(),
  parameters: z.record(z.unknown()).optional()
});

function parseInteractionMessage(payload: unknown): ClientInteractionMessage | null {
  const raw = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString() : String(payload);
  try {
    const parsed = JSON.parse(raw) as Partial<ClientInteractionMessage>;
    if (
      parsed.type === "interaction:session-start" ||
      parsed.type === "interaction:session-end" ||
      parsed.type === "interaction:object-hit" ||
      parsed.type === "interaction:object-delete" ||
      parsed.type === "interaction:clear-overlay" ||
      parsed.type === "runtime:snapshot-request" ||
      parsed.type === "overlay:hello"
    ) {
      return parsed as ClientInteractionMessage;
    }
  } catch {
    return null;
  }
  return null;
}

export async function createApp(options: CreateAppOptions) {
  const rootDir = options.rootDir;
  const bindAddress = options.bindAddress ?? "127.0.0.1";
  const port = options.port ?? 3190;
  const startedAt = Date.now();
  let apiConfig = loadApiConfig(rootDir);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.x-effect-app-key"]
    },
    bodyLimit: 128 * 1024
  });

  await app.register(websocket);

  const controlClients = new Set<WebSocket>();
  const now = () => new Date().toISOString();
  const overlayRegistry = new OverlayRegistry();
  const overlayConfigurationRepository = OverlayConfigurationJsonRepository.fromRoot(rootDir);
  overlayRegistry.applyConfigurations(await overlayConfigurationRepository.list());
  const effectConfigurationService = new EffectConfigurationService(EffectConfigurationJsonRepository.fromRoot(rootDir), () => now());
  const presetService = new PresetService(PresetJsonRepository.fromRoot(rootDir), () => now());
  const runtimeStore = new RuntimeEffectObjectStore();
  const eventBus = new EventBus();
  const eventHistoryStore = new EventHistoryStore({ maxEntries: 1000 });
  const eventCatalogService = new EventCatalogService(rootDir, () => now());
  let timeTriggerService: TimeTriggerService;
  const logBuffer = new UiLogBuffer({ maxEntries: 1000 });
  const rawCaptureStore = new TikTokRawEventStore(1000);
  const browserFrameStore = new BrowserFrameStore(1000);
  const giftCatalogService = new GiftCatalogService({
    repository: GiftCatalogJsonRepository.fromRoot(rootDir),
    onCreated: (gift) => {
      broadcastToControl({ type: "gift:catalog-created", gift, createdAt: now() });
      broadcastGiftStats();
    },
    onUpdated: (gift) => {
      broadcastToControl({ type: "gift:catalog-updated", gift, createdAt: now() });
      broadcastGiftStats();
    },
    onDeleted: (gift) => {
      broadcastToControl({ type: "gift:catalog-deleted", gift, createdAt: now() });
      broadcastGiftStats();
    }
  });
  function broadcastGiftStats(): void {
    void giftCatalogService.stats().then((stats) => broadcastToControl({ type: "gift:catalog-stats", stats, createdAt: now() }));
  }
  const deduplicationStore = new DeduplicationStore({ ttlMs: 10 * 60 * 1000, maxEntries: 10000 });
  const eventMetrics = new EventMetrics();
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  let fallingImageEffectService: FallingImageEffectService | null = null;
  let pitchingMachineBallEffectService: PitchingMachineBallEffectService | null = null;
  let giftComboTextEffectService: GiftComboTextEffectService | null = null;
  let giftPileEffectService: GiftPileEffectService | null = null;
  let puyoGameEffectService: PuyoGameEffectService | null = null;

  app.addHook("onClose", async () => {
    eventCatalogService.close();
    timeTriggerService.close();
  });

  function connectionStatus(): ServerMessage {
    return {
      type: "connection:status",
      overlayClients: overlayConnectionManager.totalClients(),
      controlClients: controlClients.size,
      createdAt: now()
    };
  }

  function send(client: WebSocket, message: ServerMessage): void {
    if (client.readyState === 1) {
      client.send(JSON.stringify(message));
    }
  }

  function broadcastToControl(message: ServerMessage): void {
    for (const client of controlClients) {
      send(client, message);
    }
  }

  function broadcastStatus(): void {
    const status = connectionStatus();
    for (const client of controlClients) {
      send(client, status);
    }
    broadcastToControl(overlayConnectionManager.statusMessage());
  }

  function broadcastRuntime(overlayId: OverlayId, message: ServerMessage): void {
    overlayConnectionManager.broadcastToOverlay(overlayId, message);
    broadcastToControl(message);
  }

  async function resolveEffectMedia(
    configuration: { effectDefinitionId?: string; visual?: { parameters?: Record<string, unknown> }; media?: { imageAssetId?: string; videoAssetId?: string; audioAssetId?: string } },
    event?: NormalizedEvent
  ) {
    const assets = await loadCatalog(rootDir);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const configuredImageUrl = configuration.media?.imageAssetId ? byId.get(configuration.media.imageAssetId)?.contentUrl : undefined;
    const eventImageUrl =
      configuration.effectDefinitionId === "simple-media" && !configuredImageUrl
        ? imageUrlFromEvent(configuration.visual?.parameters ?? {}, event)
        : undefined;
    return {
      imageUrl: configuredImageUrl ?? eventImageUrl,
      videoUrl: configuration.media?.videoAssetId ? byId.get(configuration.media.videoAssetId)?.contentUrl : undefined,
      audioUrl: configuration.media?.audioAssetId ? byId.get(configuration.media.audioAssetId)?.contentUrl : undefined
    };
  }

  async function matchedActionsFor(event: NormalizedEvent): Promise<string[]> {
    const configurations = await effectConfigurationService.match(event);
    return configurations.map((configuration) => configuration.effectDefinitionId);
  }

  eventBus.subscribe((event) => {
    const effects = mapEventToEffects(event);
    for (const effect of effects) {
      overlayConnectionManager.broadcastToOverlay(defaultOverlayId(effect.targetOverlayId), effect);
    }
  });

  eventBus.subscribe((event) => {
    void effectConfigurationService.match(event).then(async (configurations) => {
      for (const configuration of configurations) {
        await executeEffectConfiguration(configuration, event, configuration.trigger.conditions[0]?.type);
      }
    });
  });

  eventBus.subscribe((event) => {
    void giftCatalogService.processEvent(event).catch((error) => {
      recordLog({
        level: "warn",
        source: "event",
        message: "Gift catalog update failed",
        detail: { eventId: event.eventId, type: event.type, error: error instanceof Error ? error.message : String(error) }
      });
    });
  });

  const overlayConnectionManager = new OverlayConnectionManager({
    registry: overlayRegistry,
    publicBaseUrl: () => `http://${bindAddress}:${port}`,
    send,
    onStatusChange: () => {
      broadcastStatus();
    }
  });
  const runtimeInteractionService = new RuntimeInteractionService(runtimeStore, now, broadcastRuntime);
  fallingImageEffectService = new FallingImageEffectService(rootDir, runtimeInteractionService);
  pitchingMachineBallEffectService = new PitchingMachineBallEffectService(rootDir, runtimeInteractionService);
  giftComboTextEffectService = new GiftComboTextEffectService(rootDir, runtimeInteractionService, broadcastToControl);
  giftPileEffectService = new GiftPileEffectService((overlayId, message) => overlayConnectionManager.broadcastToOverlay(overlayId, message));
  puyoGameEffectService = new PuyoGameEffectService(runtimeInteractionService);
  timeTriggerService = new TimeTriggerService(rootDir, () => now(), {
    onFired: executeTimeTrigger,
    onChanged: (kind, trigger, log, triggerId) => {
      broadcastToControl({
        type:
          kind === "created"
            ? "time-trigger:created"
            : kind === "deleted"
              ? "time-trigger:deleted"
              : kind === "executed"
                ? "time-trigger:executed"
                : "time-trigger:updated",
        trigger,
        triggerId: triggerId ?? trigger?.id,
        log,
        createdAt: now()
      });
    },
    onError: (message, detail) => recordLog({ level: "error", source: "server", message, detail })
  });
  timeTriggerService.startScheduler();

  async function executeEffectConfiguration(
    configuration: Awaited<ReturnType<EffectConfigurationService["list"]>>[number],
    event: NormalizedEvent,
    triggerType?: string
  ): Promise<void> {
    if (configuration.effectDefinitionId === "gift-pile" && giftPileEffectService) {
      giftPileEffectService.execute(configuration, event);
      return;
    }
    if (configuration.effectDefinitionId === "falling-image" && fallingImageEffectService) {
      await fallingImageEffectService.execute(configuration, event);
      return;
    }
    if (configuration.effectDefinitionId === "pitching-machine-ball" && pitchingMachineBallEffectService) {
      await pitchingMachineBallEffectService.execute(configuration, event);
      return;
    }
    if (configuration.effectDefinitionId === "gift-combo-text" && giftComboTextEffectService) {
      await giftComboTextEffectService.execute(configuration, event);
      return;
    }
    if (configuration.effectDefinitionId === "puyo-game" && puyoGameEffectService) {
      await puyoGameEffectService.execute(configuration, event);
      return;
    }
    overlayConnectionManager.broadcastToOverlay(
      configuration.targetOverlayId,
      effectMessageFromConfiguration(configuration, {
        instanceId: `effect-config-${configuration.id}-${Date.now()}`,
        createdAt: now(),
        event,
        triggerType,
        media: await resolveEffectMedia(configuration, event)
      })
    );
  }

  async function executeTimeTrigger(trigger: TimeTrigger, event: NormalizedEvent): Promise<unknown[]> {
    await recordNormalizedEvent(event);
    const results: unknown[] = [{ type: "emit_event", eventId: event.eventId }];
    const actions = trigger.actions.filter((action) => action.isEnabled).sort((left, right) => left.order - right.order);
    for (const action of actions) {
      if (action.delayMs > 0) await delay(action.delayMs);
      results.push(await executeTimeTriggerAction(action, trigger, event));
    }
    return results;
  }

  async function executeTimeTriggerAction(action: TriggerAction, trigger: TimeTrigger, event: NormalizedEvent): Promise<unknown> {
    if (action.type === "emit_event") return { actionId: action.id, status: "success" };
    if (action.type === "play_scene") {
      const presetId = typeof action.config.presetId === "string" ? action.config.presetId : "";
      const preset = presetId ? await presetService.get(presetId) : null;
      if (!preset) return { actionId: action.id, status: "skipped", reason: "preset-not-found" };
      const configurations = await effectConfigurationService.applyPreset(preset);
      for (const configuration of configurations) {
        await executeEffectConfiguration(configuration, event, "time-trigger");
      }
      return { actionId: action.id, status: "success", presetId, configurationCount: configurations.length };
    }
    if (action.type === "show_text" || action.type === "show_asset" || action.type === "play_audio") {
      const assets = await loadCatalog(rootDir);
      const assetId = typeof action.config.assetId === "string" ? action.config.assetId : "";
      const asset = assets.find((item) => item.id === assetId);
      const targetOverlayId = defaultOverlayId(numericConfig(action.config.targetOverlayId, 1));
      const durationMs = Math.max(100, Math.round(numericConfig(action.config.durationMs, 3000)));
      const parameters = {
        imageEnabled: action.type === "show_asset" && asset?.kind === "image",
        videoEnabled: action.type === "show_asset" && asset?.kind === "video",
        audioEnabled: action.type === "play_audio" || asset?.kind === "audio",
        audioVolume: numericConfig(action.config.volume, 0.5),
        textEnabled: action.type === "show_text",
        fixedText: typeof action.config.text === "string" ? action.config.text : trigger.name,
        fontSize: numericConfig(action.config.fontSize, 56),
        textColor: typeof action.config.textColor === "string" ? action.config.textColor : "#ffffff",
        backgroundEnabled: action.type === "show_text",
        backgroundColor: "#000000",
        backgroundOpacity: 0.45,
        enterTransition: "fade",
        exitTransition: "fade"
      };
      const media = {
        imageUrl: asset?.kind === "image" ? asset.contentUrl : undefined,
        videoUrl: asset?.kind === "video" ? asset.contentUrl : undefined,
        audioUrl: asset?.kind === "audio" ? asset.contentUrl : undefined
      };
      overlayConnectionManager.broadcastToOverlay(targetOverlayId, {
        type: "effect:play",
        effectId: "simple-media",
        targetOverlayId,
        instanceId: `time-trigger-${trigger.id}-${action.id}-${Date.now()}`,
        parameters,
        visual: {
          parameters,
          position: { mode: "normalized", x: numericConfig(action.config.x, 0.5), y: numericConfig(action.config.y, 0.5), anchor: "center" },
          size: { width: numericConfig(action.config.width, 70), unit: "percent" },
          opacity: numericConfig(action.config.opacity, 1),
          zIndex: Math.round(numericConfig(action.config.zIndex, 40))
        },
        media,
        playback: {
          durationMs,
          startDelayMs: 0,
          cooldownMs: 0,
          maxConcurrent: 10,
          overlapPolicy: "allow",
          queueLimit: 10,
          stopPreviousSameEffect: false
        },
        runtimeData: { eventId: event.eventId, eventType: event.type, triggerType: "time-trigger" },
        createdAt: now()
      });
      return { actionId: action.id, status: "success", type: action.type, assetId: asset?.id };
    }
    return { actionId: action.id, status: "skipped", reason: "unsupported-action-type" };
  }

  function handleInteractionMessage(message: ClientInteractionMessage): void {
    const overlayId = defaultOverlayId(message.overlayId);
    if (message.type === "overlay:hello") {
      const overlayConfigVersion = 0;
      overlayConnectionManager.broadcastToOverlay(overlayId, {
        type: "overlay:version",
        overlayId,
        buildVersion,
        overlayConfigVersion,
        runtimeStateVersion: runtimeInteractionService.stateVersion(overlayId),
        serverInstanceId,
        createdAt: now()
      });
      if (message.currentBuildVersion !== buildVersion) {
        overlayConnectionManager.broadcastToOverlay(overlayId, overlayReloadMessage(overlayId, "build-version-changed", message.currentBuildVersion));
      }
    } else if (message.type === "interaction:session-start") {
      runtimeInteractionService.startSession(overlayId, message.mode);
      broadcastToControl(runtimeInteractionService.snapshotMessage(overlayId));
    } else if (message.type === "interaction:session-end") {
      runtimeInteractionService.endSession(overlayId);
    } else if (message.type === "interaction:object-hit") {
      runtimeInteractionService.hit(overlayId, message.objectId, message.damage);
    } else if (message.type === "interaction:object-delete") {
      runtimeInteractionService.destroy(overlayId, message.objectId);
    } else if (message.type === "interaction:clear-overlay") {
      runtimeInteractionService.clear(overlayId, message.scope);
    } else if (message.type === "runtime:snapshot-request") {
      broadcastRuntime(overlayId, runtimeInteractionService.snapshotMessage(overlayId));
    }
  }

  function overlayReloadMessage(
    overlayId: OverlayId,
    reason: OverlayReloadRequiredMessage["reason"],
    currentBuildVersion?: string
  ): OverlayReloadRequiredMessage {
    return {
      type: "overlay:reload-required",
      overlayId,
      reason,
      currentBuildVersion,
      newBuildVersion: buildVersion,
      reloadDelayMs: 500,
      createdAt: now()
    };
  }

  function overlayConfigurationVersion(updatedAt: string | undefined): number {
    const parsed = Date.parse(updatedAt ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function broadcastEventEntry(entry: EventHistoryEntry, kind: "received" | "replayed"): void {
    if (kind === "replayed") {
      const originalEventId =
        typeof entry.event.metadata?.replayedFromEventId === "string" ? entry.event.metadata.replayedFromEventId : entry.event.eventId;
      broadcastToControl({ type: "event:replayed", event: entry, originalEventId });
      return;
    }

    broadcastToControl({
      type: "event:received",
      event: entry.event,
      processing: entry.processing,
      result: entry.result,
      createdAt: entry.createdAt
    });
  }

  function broadcastLog(entry: UiLogEntry): void {
    broadcastToControl({ type: "log:updated", entry });
  }

  function recordLog(entry: Parameters<UiLogBuffer["add"]>[0]): void {
    broadcastLog(logBuffer.add(entry));
  }

  async function recordEventCatalog(event: NormalizedEvent): Promise<void> {
    const item = eventCatalogService.upsertFromEvent(event);
    broadcastToControl({ type: item.receivedCount <= 1 ? "event-catalog:created" : "event-catalog:updated", item, createdAt: now() });
  }

  async function recordNormalizedEvent(event: NormalizedEvent): Promise<void> {
    const startedAt = Date.now();
    const receivedAt = event.receivedAt || new Date().toISOString();
    const normalizedAt = new Date().toISOString();
    eventMetrics.markReceived(receivedAt);

    if (deduplicationStore.isDuplicate(event.eventId)) {
      eventMetrics.markDuplicate();
      const completedAt = new Date().toISOString();
      const entry = eventHistoryStore.add({
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
      broadcastEventEntry(entry, "received");
      recordLog({
        level: "warn",
        source: "event",
        message: `Duplicate TikTok event ignored: ${event.eventId}`,
        detail: { eventId: event.eventId, type: event.type }
      });
      return;
    }

    await recordEventCatalog(event).catch((error) => {
      recordLog({
        level: "warn",
        source: "event",
        message: "Event catalog update failed",
        detail: { eventId: event.eventId, type: event.type, error: error instanceof Error ? error.message : String(error) }
      });
    });
    const matchedActions = await matchedActionsFor(event);
    eventBus.publish(event);
    const completedAt = new Date().toISOString();
    const entry = eventHistoryStore.add({
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
    broadcastEventEntry(entry, "received");
    recordLog({
      level: "info",
      source: matchedActions.length > 0 ? "effect" : "event",
      message:
        matchedActions.length > 0
          ? `TikTok event ${event.eventId} triggered ${matchedActions.join(", ")}`
          : `TikTok event ${event.eventId} received`,
      detail: { eventId: event.eventId, type: event.type, matchedActions }
    });
  }

  const rawCaptureService = new TikTokRawCaptureService({
    store: rawCaptureStore,
    onStatus: (status) => {
      broadcastToControl({ type: "raw-capture:status", status, createdAt: now() });
    },
    onReceived: (capture, updated) => {
      broadcastToControl({ type: updated ? "raw-capture:updated" : "raw-capture:received", capture, createdAt: now() });
    },
    onCleared: () => {
      broadcastToControl({ type: "raw-capture:cleared", createdAt: now() });
    }
  });

  const tiktokManager = new TikTokConnectionManager({
    onEvents: (events) => {
      for (const event of events) {
        void recordNormalizedEvent(event);
      }
    },
    onStatus: (status) => {
      broadcastToControl({ type: "tiktok:status", status, createdAt: now() });
    },
    onError: (message, detail) => {
      recordLog({ level: "error", source: "server", message, detail });
    },
    onRawEvent: (event, status) => rawCaptureService.capture(event, status),
    onRawEventNormalized: (captureId, events, errors) => rawCaptureService.attachNormalization(captureId, events, errors),
    browser: {
      rootDir,
      frameStore: browserFrameStore,
      onBrowserStatus: (status) => {
        broadcastToControl({ type: "tiktok:browser-status", status, frameStatus: browserFrameStore.status(), createdAt: now() });
      },
      onFrame: (captureId) => {
        const frame = browserFrameStore.find(captureId);
        if (!frame) return;
        broadcastToControl({
          type: "tiktok:browser-frame-received",
          frame: browserFrameStore.summary(frame),
          frameStatus: browserFrameStore.status(),
          createdAt: now()
        });
      }
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
    } else if (request.url === "/overlay" || request.url.startsWith("/overlay/") || request.url === "/control" || request.url.startsWith("/control/")) {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
    }

    if (request.method !== "POST" || request.url !== "/api/v1/events") {
      return;
    }

    const key = request.ip;
    const current = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || bucket.resetAt <= current) {
      rateBuckets.set(key, { count: 1, resetAt: current + 1000 });
      return;
    }

    bucket.count += 1;

    if (bucket.count > 100) {
      reply.code(429).send({ accepted: false, error: "Rate limit exceeded" });
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    overlayClients: overlayConnectionManager.totalClients(),
    controlClients: controlClients.size
  }));

  app.get("/api/v1/status", async () => ({
    server: {
      status: "ok",
      bindAddress,
      port,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    },
    overlay: {
      clients: overlayConnectionManager.totalClients(),
      overlays: overlayConnectionManager.statusList()
    },
    obs: {
      connected: false
    },
    tiktok: {
      ...tiktokManager.getStatus()
    },
    httpApi: eventMetrics.snapshot(),
    events: eventHistoryStore.stats(),
    eventQueue: {
      pending: 0
    },
    currentEffects: [],
    performance: {
      targetFps: 60
    }
  }));

  app.get("/api/v1/system/version", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      appVersion,
      buildVersion,
      serverStartedAt: new Date(startedAt).toISOString(),
      serverInstanceId,
      overlayBundleVersion
    };
  });

  app.get("/api/v1/overlays/:overlayId/version", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    const config = await overlayConfigurationRepository.get(overlayId);
    reply.header("Cache-Control", "no-store");
    return {
      overlayId,
      buildVersion,
      overlayConfigVersion: overlayConfigurationVersion(config.updatedAt),
      runtimeStateVersion: runtimeInteractionService.stateVersion(overlayId),
      serverInstanceId
    };
  });

  app.post("/api/v1/overlays/:overlayId/reload", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ accepted: false, error: "Overlay not found" });
    overlayConnectionManager.broadcastToOverlay(overlayId, overlayReloadMessage(overlayId, "manual-control-ui"));
    return { accepted: true, overlayId };
  });

  app.post("/api/v1/overlays/reload-all", async () => {
    for (const overlayId of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as OverlayId[]) {
      overlayConnectionManager.broadcastToOverlay(overlayId, overlayReloadMessage(overlayId, "manual-control-ui"));
    }
    return { accepted: true };
  });

  app.get("/api/v1/logs", async () => ({
    logs: logBuffer.list()
  }));

  app.delete("/api/v1/logs", async () => {
    logBuffer.clear();
    broadcastToControl({ type: "log:cleared", createdAt: now() });
    return { cleared: true };
  });

  app.get("/api/v1/http-api/config", async () => ({
    enabled: true,
    endpointUrl: "http://127.0.0.1:3190/api/v1/events",
    apiKeyMasked: apiConfig.maskedApiKey,
    metrics: eventMetrics.snapshot()
  }));

  app.get("/api/v1/http-api/key", async () => ({
    apiKey: apiConfig.apiKey
  }));

  app.post("/api/v1/http-api/key/regenerate", async () => {
    apiConfig = regenerateApiConfig(rootDir);
    return {
      apiKey: apiConfig.apiKey,
      apiKeyMasked: apiConfig.maskedApiKey
    };
  });

  app.post("/api/v1/effects/flash/play", async (request, reply) => {
    const parsed = playSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({ accepted: false, error: parsed.error.flatten() });
    }

    const message: EffectPlayMessage = {
      type: "effect:play",
      effectId: "flash",
      targetOverlayId: defaultOverlayId(parsed.data.targetOverlayId),
      instanceId: parsed.data.instanceId ?? `manual-flash-${Date.now()}`,
      parameters: parsed.data.parameters,
      createdAt: now()
    };

    overlayConnectionManager.broadcastToOverlay(message.targetOverlayId ?? 1, message);
    return { accepted: true, triggeredEffects: ["flash"], targetOverlayId: message.targetOverlayId, instanceId: message.instanceId };
  });

  app.post("/api/v1/test/event", async () => {
    const message: EffectPlayMessage = {
      type: "effect:play",
      effectId: "flash",
      targetOverlayId: 1,
      instanceId: `test-flash-${Date.now()}`,
      parameters: { color: "#ffffff", durationMs: 650 },
      createdAt: now()
    };

    overlayConnectionManager.broadcastToOverlay(1, message);
    return { accepted: true, triggeredEffects: ["flash"], instanceId: message.instanceId };
  });

  await registerEventRoutes(app, {
    getApiKey: () => apiConfig.apiKey,
    deduplicationStore,
    eventBus,
    metrics: eventMetrics,
    getMatchedActions: matchedActionsFor,
    historyStore: eventHistoryStore,
    logBuffer,
    onEventRecorded: broadcastEventEntry,
    onEventsCleared: () => broadcastToControl({ type: "event:cleared", createdAt: now() }),
    onLogRecorded: broadcastLog,
    onCatalogEvent: recordEventCatalog
  });

  await registerTikTokRoutes(app, tiktokManager);
  await registerGiftRoutes(app, giftCatalogService);
  await registerEventCatalogRoutes(app, eventCatalogService);
  await registerTimeTriggerRoutes(app, timeTriggerService);
  await registerAssetRoutes(app, rootDir);
  await registerSystemFontRoutes(app, rootDir);
  await registerGameIntegrationRoutes(app, { rootDir, now });
  await registerPresetRoutes(app, presetService, effectConfigurationService);
  await registerEffectRoutes(app, effectConfigurationService, overlayConnectionManager, now, {
    executeFallingImage: (configuration) => fallingImageEffectService!.execute(configuration),
    executePitchingMachineBall: (configuration, event) => pitchingMachineBallEffectService!.execute(configuration, event),
    executeGiftComboText: (configuration, event) => giftComboTextEffectService!.execute(configuration, event),
    executeGiftPile: (configuration) => giftPileEffectService!.execute(configuration),
    executePuyoGame: (configuration, event) => puyoGameEffectService!.execute(configuration, event),
    resolveMedia: resolveEffectMedia
  });
  await registerRuntimeRoutes(app, runtimeInteractionService);
  app.delete("/api/v1/overlays/:overlayId/gift-pile", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId: string }).overlayId);
    if (!overlayId) return reply.code(404).send({ error: "Overlay not found" });
    giftPileEffectService!.clear(overlayId);
    return { cleared: true, overlayId };
  });
  await registerRawCaptureRoutes(app, rawCaptureService);
  await registerTikTokBrowserRoutes(app, tiktokManager, browserFrameStore, {
    onFrameCleared: () =>
      broadcastToControl({ type: "tiktok:browser-frame-cleared", frameStatus: browserFrameStore.status(), createdAt: now() }),
    onMarkerAdded: (marker) => broadcastToControl({ type: "tiktok:browser-marker-added", marker, createdAt: now() })
  });
  await registerOverlayRoutes(app, overlayConnectionManager, overlayRegistry, overlayConfigurationRepository, now);

  app.get("/ws/overlay", { websocket: true }, (socket) => {
    overlayConnectionManager.addClient(1, socket);
    send(socket, runtimeInteractionService.snapshotMessage(1));
  });

  app.get("/ws/overlay/:overlayId", { websocket: true }, (socket, request) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      socket.close(1008, "Invalid overlay id");
      return;
    }
    overlayConnectionManager.addClient(overlayId, socket);
    send(socket, runtimeInteractionService.snapshotMessage(overlayId));
    socket.on("message", (payload) => {
      const message = parseInteractionMessage(payload);
      if (message) handleInteractionMessage(message);
    });
  });

  app.get("/ws/control", { websocket: true }, (socket) => {
    controlClients.add(socket);
    send(socket, connectionStatus());
    send(socket, overlayConnectionManager.statusMessage());
    send(socket, { type: "tiktok:status", status: tiktokManager.getStatus(), createdAt: now() });
    send(socket, { type: "raw-capture:status", status: rawCaptureService.status(), createdAt: now() });
    void giftCatalogService.stats().then((stats) => send(socket, { type: "gift:catalog-stats", stats, createdAt: now() }));
    if (tiktokManager.getBrowserStatus()) {
      send(socket, {
        type: "tiktok:browser-status",
        status: tiktokManager.getBrowserStatus()!,
        frameStatus: browserFrameStore.status(),
        createdAt: now()
      });
    }
    for (const entry of eventHistoryStore.list().slice().reverse()) {
      send(socket, {
        type: "event:received",
        event: entry.event,
        processing: entry.processing,
        result: entry.result,
        createdAt: entry.createdAt
      });
    }
    for (const entry of logBuffer.list().slice().reverse()) {
      send(socket, { type: "log:updated", entry });
    }
    broadcastStatus();

    socket.on("message", (payload) => {
      const raw = typeof payload === "string" ? payload : payload.toString();
      let message: Partial<EffectPlayMessage>;

      try {
        message = JSON.parse(raw) as Partial<EffectPlayMessage>;
      } catch (error) {
        app.log.warn({ error }, "Invalid control WebSocket message");
        return;
      }

      if (message.type === "effect:play" && message.effectId === "flash") {
        const targetOverlayId = defaultOverlayId(message.targetOverlayId);
        overlayConnectionManager.broadcastToOverlay(targetOverlayId, {
          type: "effect:play",
          effectId: "flash",
          targetOverlayId,
          instanceId: message.instanceId ?? `control-flash-${Date.now()}`,
          parameters: message.parameters,
          createdAt: now()
        });
        return;
      }

      const interactionMessage = parseInteractionMessage(raw);
      if (interactionMessage) {
        handleInteractionMessage(interactionMessage);
      }
    });

    socket.on("close", () => {
      controlClients.delete(socket);
      broadcastStatus();
    });
  });

  await app.register(fastifyStatic, {
    root: path.join(rootDir, "data/assets/files"),
    prefix: "/asset-files/",
    decorateReply: false,
    setHeaders: (response) => {
      response.setHeader("Cache-Control", "no-cache");
    }
  });

  await app.register(fastifyStatic, {
    root: path.join(rootDir, "apps/control/dist/assets"),
    prefix: "/control/assets/",
    decorateReply: false,
    setHeaders: (response) => {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  await app.register(fastifyStatic, {
    root: path.join(rootDir, "apps/overlay/dist/assets"),
    prefix: "/overlay/assets/",
    decorateReply: false,
    setHeaders: (response) => {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  app.get("/control", async (_request, reply) =>
    reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/control/dist/index.html")))
  );

  app.get("/overlay", async (_request, reply) =>
    reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/overlay/dist/index.html")))
  );

  app.get("/overlay/:overlayId", async (request, reply) => {
    const overlayId = parseOverlayId((request.params as { overlayId?: string }).overlayId);
    if (!overlayId) {
      return reply.code(404).send("Overlay not found");
    }
    return reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/overlay/dist/index.html")));
  });

  app.get("/game", async (_request, reply) =>
    reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/overlay/dist/index.html")))
  );

  app.get("/game/*", async (_request, reply) =>
    reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/overlay/dist/index.html")))
  );

  app.get("/control/*", async (_request, reply) =>
    reply.type("text/html").send(createReadStream(path.join(rootDir, "apps/control/dist/index.html")))
  );

  return app;
}

function imageUrlFromEvent(parameters: Record<string, unknown>, event?: NormalizedEvent): string | undefined {
  if (!event || parameters.imageSourceMode === "asset") return undefined;
  const direct =
    stringConfig(event.data.primaryGiftImageUrl) ??
    firstStringConfig(event.data.giftImageUrls) ??
    stringConfig(event.data.imageUrl) ??
    stringConfig(event.data.pictureUrl) ??
    firstStringConfig((event.data.giftPicture as Record<string, unknown> | undefined)?.urlList);
  if (direct) return direct;
  return firstImageUrl(event.data);
}

function firstImageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return /^https?:\/\//iu.test(value) ? value : undefined;
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(imageUrl|iconUrl|pictureUrl|url|uri)$/iu.test(key) || /urlList|url_list|image|picture|giftPicture/iu.test(key)) {
      const found = firstImageUrl(child);
      if (found) return found;
    }
  }
  return undefined;
}

function stringConfig(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstStringConfig(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
}

function numericConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
