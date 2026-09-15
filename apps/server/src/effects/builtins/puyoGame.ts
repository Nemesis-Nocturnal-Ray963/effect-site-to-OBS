import type { EffectConfiguration, NormalizedEvent, RuntimeEffectObject } from "@obs-effect/shared-types";
import type { EffectDefinition } from "@obs-effect/shared-types";
import type { RuntimeInteractionService } from "../../runtime/RuntimeInteractionService.js";

export const puyoGameEffectDefinition: EffectDefinition = {
  id: "puyo-game",
  kind: "puyo-game",
  name: "Puyo Game",
  description: "Start a canvas-based falling-puzzle game layer on the target overlay.",
  version: "0.1.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsText: false,
  defaultDurationMs: 60000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "boardColumns", label: "Board columns", type: "number", defaultValue: 6, min: 4, max: 12, step: 1 },
      { key: "boardRows", label: "Board rows", type: "number", defaultValue: 12, min: 8, max: 20, step: 1 },
      { key: "cellSizePx", label: "Cell size px", type: "number", defaultValue: 56, min: 24, max: 120, step: 1 },
      { key: "boardXPercent", label: "Board X %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "boardYPercent", label: "Board Y %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "gravityMs", label: "Gravity ms", type: "number", defaultValue: 650, min: 80, max: 2000, step: 10 },
      { key: "chainTarget", label: "Chain target", type: "number", defaultValue: 4, min: 3, max: 8, step: 1 },
      { key: "seedFillRows", label: "Seed fill rows", type: "number", defaultValue: 3, min: 0, max: 10, step: 1 },
      { key: "showDebugGrid", label: "Show debug grid", type: "boolean", defaultValue: true }
    ]
  }
};

export interface PuyoGameExecutionResult {
  spawnedObjects: RuntimeEffectObject[];
  skipped: boolean;
  reason?: string;
}

export class PuyoGameEffectService {
  constructor(private readonly runtimeInteractionService: RuntimeInteractionService) {}

  async execute(configuration: EffectConfiguration, event?: NormalizedEvent): Promise<PuyoGameExecutionResult> {
    const settings = normalizeSettings(configuration.visual.parameters);
    const lifetimeMs = Math.max(1000, configuration.playback.durationMs);
    const object = this.runtimeInteractionService.createObject({
      overlayId: configuration.targetOverlayId,
      executionId: `puyo-game-${configuration.id}-${Date.now()}`,
      effectConfigId: configuration.id,
      objectType: "puyo-game",
      interactive: false,
      maxHitPoints: 1,
      normalizedX: settings.boardXPercent / 100,
      normalizedY: settings.boardYPercent / 100,
      scale: configuration.visual.size.scale ?? 1,
      expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
      metadata: {
        ...settings,
        opacity: configuration.visual.opacity,
        zIndex: configuration.visual.zIndex,
        eventId: event?.eventId,
        eventType: event?.type
      }
    });
    return { spawnedObjects: [object], skipped: false };
  }
}

interface PuyoGameSettings {
  boardColumns: number;
  boardRows: number;
  cellSizePx: number;
  boardXPercent: number;
  boardYPercent: number;
  gravityMs: number;
  chainTarget: number;
  seedFillRows: number;
  showDebugGrid: boolean;
}

function normalizeSettings(parameters: Record<string, unknown>): PuyoGameSettings {
  return {
    boardColumns: integerParam(parameters.boardColumns, 6, 4, 12),
    boardRows: integerParam(parameters.boardRows, 12, 8, 20),
    cellSizePx: integerParam(parameters.cellSizePx, 56, 24, 120),
    boardXPercent: numberParam(parameters.boardXPercent, 50, 0, 100),
    boardYPercent: numberParam(parameters.boardYPercent, 50, 0, 100),
    gravityMs: integerParam(parameters.gravityMs, 650, 80, 2000),
    chainTarget: integerParam(parameters.chainTarget, 4, 3, 8),
    seedFillRows: integerParam(parameters.seedFillRows, 3, 0, 10),
    showDebugGrid: typeof parameters.showDebugGrid === "boolean" ? parameters.showDebugGrid : true
  };
}

function integerParam(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(numberParam(value, fallback, min, max));
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numberValue));
}
