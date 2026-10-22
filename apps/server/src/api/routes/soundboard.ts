import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  EffectPlayMessage,
  OverlayId,
  ServerMessage,
  SoundboardBoard,
  SoundboardPad
} from "@obs-effect/shared-types";
import type { OverlayConnectionManager } from "../../overlays/overlayConnectionManager.js";
import type { SoundboardRepository } from "../../soundboard/SoundboardRepository.js";
import { loadCatalog } from "./assets.js";

const overlayIdSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10)
]);
const padSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/iu),
  enabled: z.boolean(),
  targetOverlayId: overlayIdSchema,
  visualAssetId: z.string().max(200).optional(),
  audioAssetId: z.string().max(200).optional(),
  durationMs: z.number().int().min(100).max(60 * 60 * 1000),
  audioVolume: z.number().min(0).max(1),
  retriggerMode: z.enum(["restart", "overlap"])
});
const boardSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  columns: z.number().int().min(2).max(5),
  pads: z.array(padSchema).max(100),
  updatedAt: z.string()
});

interface SoundboardRouteOptions {
  rootDir: string;
  repository: SoundboardRepository;
  overlays: OverlayConnectionManager;
  broadcastToControl: (message: ServerMessage) => void;
  now: () => string;
  remoteBaseUrl: () => string;
}

export async function registerSoundboardRoutes(app: FastifyInstance, options: SoundboardRouteOptions): Promise<void> {
  app.get("/api/v1/soundboard", async () => {
    const config = await options.repository.get();
    return {
      board: config.board,
      accessToken: config.accessToken,
      remoteUrl: `${options.remoteBaseUrl()}/control/soundboard/remote?token=${encodeURIComponent(config.accessToken)}`
    };
  });

  app.get("/api/v1/soundboard/remote", async (request, reply) => {
    const config = await options.repository.get();
    if (!hasToken(request.headers["x-soundboard-token"], config.accessToken)) {
      return reply.code(401).send({ error: "Invalid soundboard token" });
    }
    return { board: config.board };
  });

  app.put("/api/v1/soundboard", async (request, reply) => {
    const parsed = boardSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const saved = await options.repository.save(parsed.data as SoundboardBoard);
    return { board: saved.board };
  });

  app.post("/api/v1/soundboard/pads/:padId/play", async (request, reply) => {
    const config = await options.repository.get();
    if (!hasToken(request.headers["x-soundboard-token"], config.accessToken)) {
      return reply.code(401).send({ accepted: false, error: "Invalid soundboard token" });
    }
    const padId = (request.params as { padId?: string }).padId;
    const pad = config.board.pads.find((candidate) => candidate.id === padId);
    if (!pad) return reply.code(404).send({ accepted: false, error: "Pad not found" });
    if (!pad.enabled) return reply.code(409).send({ accepted: false, error: "Pad is disabled" });

    const result = await playPad(pad, options);
    return { accepted: true, ...result };
  });

  app.post("/api/v1/soundboard/stop-all", async (request, reply) => {
    const config = await options.repository.get();
    if (!hasToken(request.headers["x-soundboard-token"], config.accessToken)) {
      return reply.code(401).send({ accepted: false, error: "Invalid soundboard token" });
    }
    const createdAt = options.now();
    for (let overlayId = 1; overlayId <= 10; overlayId += 1) {
      options.overlays.broadcastToOverlay(overlayId as OverlayId, {
        type: "effect:clear",
        scope: "target-overlay",
        targetOverlayId: overlayId as OverlayId,
        createdAt
      });
    }
    options.broadcastToControl({
      type: "soundboard:audio",
      action: "stop-all",
      executionId: `soundboard-stop-${Date.now()}`,
      createdAt
    });
    return { accepted: true };
  });
}

async function playPad(pad: SoundboardPad, options: SoundboardRouteOptions): Promise<{ executionId: string; visual: boolean; audio: boolean }> {
  const assets = await loadCatalog(options.rootDir);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const visualAsset = pad.visualAssetId ? byId.get(pad.visualAssetId) : undefined;
  const audioAsset = pad.audioAssetId ? byId.get(pad.audioAssetId) : undefined;
  const mediaSoundUrl = visualAsset?.kind === "video" && visualAsset.hasEmbeddedAudio ? visualAsset.contentUrl : undefined;
  const executionId = `soundboard-${pad.id}-${Date.now()}`;
  const createdAt = options.now();

  if (visualAsset && (visualAsset.kind === "image" || visualAsset.kind === "video")) {
    const isVideo = visualAsset.kind === "video";
    const message: EffectPlayMessage = {
      type: "effect:play",
      effectId: "simple-media",
      effectConfigId: `soundboard-${pad.id}`,
      targetOverlayId: pad.targetOverlayId,
      instanceId: executionId,
      parameters: {
        imageEnabled: !isVideo,
        videoEnabled: isVideo,
        videoMuted: true,
        imageFit: "contain",
        videoFit: "contain",
        enterTransition: "fade",
        exitTransition: "fade",
        soundboardPadId: pad.id,
        soundboardRetriggerMode: pad.retriggerMode
      },
      visual: {
        parameters: {},
        position: { mode: "normalized", x: 0.5, y: 0.5, anchor: "center" },
        size: { width: 86, height: 86, unit: "percent", scale: 1 },
        opacity: 1,
        zIndex: 50
      },
      media: isVideo ? { videoUrl: visualAsset.contentUrl } : { imageUrl: visualAsset.contentUrl },
      playback: {
        durationMs: pad.durationMs,
        startDelayMs: 0,
        cooldownMs: 0,
        maxConcurrent: pad.retriggerMode === "overlap" ? 10 : 1,
        overlapPolicy: pad.retriggerMode === "overlap" ? "allow" : "replace-old",
        queueLimit: 0,
        stopPreviousSameEffect: pad.retriggerMode === "restart"
      },
      createdAt
    };
    options.overlays.broadcastToOverlay(pad.targetOverlayId, message);
  }

  if (audioAsset?.kind === "audio" || mediaSoundUrl) {
    options.broadcastToControl({
      type: "soundboard:audio",
      action: "play",
      executionId,
      padId: pad.id,
      soundUrl: audioAsset?.kind === "audio" ? audioAsset.contentUrl : undefined,
      mediaSoundUrl,
      volume: pad.audioVolume,
      retriggerMode: pad.retriggerMode,
      createdAt
    });
  }

  return { executionId, visual: Boolean(visualAsset), audio: audioAsset?.kind === "audio" || Boolean(mediaSoundUrl) };
}

function hasToken(header: string | string[] | undefined, expected: string): boolean {
  return typeof header === "string" && header === expected;
}
