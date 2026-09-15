import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

type TikfinityEvent = {
  source: "tikfinity";
  eventType: string;
  userName: string;
  giftName: string;
  giftCount: number;
  comment: string;
  raw: unknown;
  receivedAt: string;
};
type GamePresetRule = {
  id: string;
  triggerKind: string;
  eventType: string;
  giftName: string;
  fireCount: number;
  delayMs: number;
  actionType: string;
  target: string;
  amount: number;
};
type GamePreset = {
  id: string;
  name: string;
  gameId: string;
  enabled: boolean;
  rules: GamePresetRule[];
  createdAt: string;
  updatedAt: string;
};
type GameAction = {
  id: string;
  gameId: string;
  actionType: string;
  target: string;
  amount: number;
  availableAt: number;
  source: "tikfinity";
  presetId: string;
  ruleId: string;
  event: TikfinityEvent;
  createdAt: string;
};

export async function registerGameIntegrationRoutes(app: FastifyInstance, options: { rootDir: string; now: () => string }): Promise<void> {
  let lastTikfinityEvent: TikfinityEvent | null = null;
  let presets = await loadGamePresets(options.rootDir);
  const actionQueue: GameAction[] = [];

  app.get("/api/v1/game-integrations/tikfinity", async (request) => ({
    source: "tikfinity",
    status: lastTikfinityEvent ? "event-received" : "waiting",
    endpointUrl: `http://${request.headers.host ?? "127.0.0.1:3190"}/api/v1/game-integrations/tikfinity/webhook`,
    lastEvent: lastTikfinityEvent
  }));

  app.post("/api/v1/game-integrations/tikfinity/webhook", async (request) => {
    lastTikfinityEvent = normalizeTikfinityEvent(request.body, options.now());
    const triggeredActions = enqueueGameActions(actionQueue, presets, lastTikfinityEvent, options.now());
    return {
      accepted: true,
      event: lastTikfinityEvent,
      triggeredActions
    };
  });

  app.post("/api/v1/game-integrations/tikfinity/test", async () => {
    lastTikfinityEvent = normalizeTikfinityEvent(
      {
        eventType: "gift",
        userName: "Test Viewer",
        giftName: "Rose",
        giftCount: 1
      },
      options.now()
    );
    const triggeredActions = enqueueGameActions(actionQueue, presets, lastTikfinityEvent, options.now());
    return {
      accepted: true,
      event: lastTikfinityEvent,
      triggeredActions
    };
  });

  app.get("/api/v1/game-presets", async () => ({
    presets
  }));

  app.post("/api/v1/game-presets", async (request, reply) => {
    const preset = normalizeGamePreset(request.body, options.now());
    if (!preset.name || !preset.gameId) {
      return reply.code(400).send({ accepted: false, error: "Preset name and gameId are required" });
    }
    presets = [preset, ...presets.filter((item) => item.id !== preset.id)];
    await saveGamePresets(options.rootDir, presets);
    return {
      accepted: true,
      preset
    };
  });

  app.get("/api/v1/game-integrations/actions", async (request) => {
    const query = request.query as { gameId?: string };
    const gameId = typeof query.gameId === "string" ? query.gameId : "";
    const current = Date.now();
    const actions = (gameId ? actionQueue.filter((action) => action.gameId === gameId) : [...actionQueue]).filter((action) => action.availableAt <= current);
    for (const action of actions) {
      const index = actionQueue.findIndex((item) => item.id === action.id);
      if (index >= 0) actionQueue.splice(index, 1);
    }
    return {
      actions
    };
  });
}

function enqueueGameActions(queue: GameAction[], presets: GamePreset[], event: TikfinityEvent, now: string): GameAction[] {
  const actions: GameAction[] = [];
  const current = Date.now();
  for (const preset of presets) {
    if (!preset.enabled) continue;
    for (const rule of preset.rules) {
      if (!ruleMatchesEvent(rule, event)) continue;
      const amount = Math.max(1, Math.round(rule.amount * (isGiftEvent(event.eventType) ? Math.max(1, event.giftCount) : 1)));
      const fireCount = Math.max(1, Math.round(rule.fireCount));
      for (let index = 0; index < fireCount; index += 1) {
        actions.push({
          id: `game-action-${Date.now()}-${actions.length}`,
          gameId: preset.gameId,
          actionType: rule.actionType,
          target: rule.target,
          amount,
          availableAt: current + Math.max(0, Math.round(rule.delayMs)) * (index + 1),
          source: "tikfinity",
          presetId: preset.id,
          ruleId: rule.id,
          event,
          createdAt: now
        });
      }
    }
  }
  queue.push(...actions);
  return actions;
}

function ruleMatchesEvent(rule: GamePresetRule, event: TikfinityEvent): boolean {
  if (rule.triggerKind === "any_gift") return isGiftEvent(event.eventType);
  if (rule.triggerKind === "gift_name") return isGiftEvent(event.eventType) && normalizeText(rule.giftName) === normalizeText(event.giftName);
  if (rule.triggerKind === "follow") return eventTypeMatches("follow", event.eventType);
  return eventTypeMatches(rule.eventType, event.eventType);
}

function isGiftEvent(eventType: string): boolean {
  return eventTypeMatches("gift", eventType);
}

function eventTypeMatches(ruleEventType: string, eventType: string): boolean {
  const normalizedRule = ruleEventType.replace(/^tiktok_/u, "").toLowerCase();
  const normalizedEvent = eventType.replace(/^tiktok_/u, "").toLowerCase();
  return normalizedRule === normalizedEvent;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

async function loadGamePresets(rootDir: string): Promise<GamePreset[]> {
  try {
    const raw = await readFile(gamePresetPath(rootDir), "utf8");
    const parsed = JSON.parse(raw) as { presets?: unknown[] };
    return Array.isArray(parsed.presets) ? parsed.presets.map((item) => normalizeGamePreset(item, new Date().toISOString())).filter((item) => item.name && item.gameId) : [];
  } catch {
    return [];
  }
}

async function saveGamePresets(rootDir: string, presets: GamePreset[]): Promise<void> {
  const filePath = gamePresetPath(rootDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ presets }, null, 2)}\n`, "utf8");
}

function gamePresetPath(rootDir: string): string {
  return path.join(rootDir, "data", "game", "presets.json");
}

function normalizeGamePreset(payload: unknown, now: string): GamePreset {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const id = firstString(body.id) ?? `game-preset-${Date.now()}`;
  return {
    id,
    name: firstString(body.name) ?? "",
    gameId: firstString(body.gameId) ?? "puyopuyo",
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    rules: Array.isArray(body.rules) ? body.rules.map((rule, index) => normalizeGamePresetRule(rule, index)).filter((rule) => rule.eventType && rule.actionType) : [],
    createdAt: firstString(body.createdAt) ?? now,
    updatedAt: now
  };
}

function normalizeGamePresetRule(payload: unknown, index: number): GamePresetRule {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const triggerKind = firstString(body.triggerKind) ?? triggerKindFromLegacyEventType(firstString(body.eventType) ?? "gift");
  return {
    id: firstString(body.id) ?? `rule-${Date.now()}-${index}`,
    triggerKind,
    eventType: eventTypeFromTriggerKind(triggerKind, firstString(body.eventType) ?? "gift"),
    giftName: firstString(body.giftName, body.gift) ?? "",
    fireCount: Math.max(1, Math.round(firstNumber(body.fireCount, body.repeatCount) ?? 1)),
    delayMs: Math.max(0, Math.round(firstNumber(body.delayMs, body.fireDelayMs) ?? 0)),
    actionType: firstString(body.actionType) ?? "drop_ojama",
    target: firstString(body.target) ?? "player",
    amount: Math.max(1, Math.round(firstNumber(body.amount) ?? 1))
  };
}

function triggerKindFromLegacyEventType(eventType: string): string {
  if (eventType === "follow" || eventType === "tiktok_follow") return "follow";
  return "any_gift";
}

function eventTypeFromTriggerKind(triggerKind: string, fallback: string): string {
  if (triggerKind === "follow") return "follow";
  if (triggerKind === "any_gift" || triggerKind === "gift_name") return "gift";
  return fallback;
}

function normalizeTikfinityEvent(payload: unknown, receivedAt: string): TikfinityEvent {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    source: "tikfinity",
    eventType: firstString(body.eventType, body.type, body.event, body.action) ?? "unknown",
    userName: firstString(body.userName, body.nickname, body.uniqueId, body.username, body.user) ?? "",
    giftName: firstString(body.giftName, body.gift, body.gift_name) ?? "",
    giftCount: firstNumber(body.giftCount, body.repeatCount, body.count, body.amount) ?? 1,
    comment: firstString(body.comment, body.message, body.text) ?? "",
    raw: payload ?? null,
    receivedAt
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
