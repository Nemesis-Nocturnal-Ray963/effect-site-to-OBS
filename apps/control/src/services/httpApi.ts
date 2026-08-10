import type {
  AssetCatalogItem,
  EffectPreset,
  EffectPresetSlot,
  EventHistoryEntry,
  EventCatalogItem,
  EventCatalogSourceType,
  EventMonitorStats,
  EventPlatform,
  EffectConfiguration,
  EffectDefinition,
  EffectTriggerCondition,
  GiftCatalogRecord,
  GiftCatalogStats,
  GiftImageCacheStatus,
  BrowserConnectorStatus,
  BrowserFrameStoreStatus,
  BrowserWebSocketFrameCapture,
  BrowserWebSocketFrameCaptureSummary,
  NormalizedEvent,
  NormalizedEventType,
  OverlayId,
  OverlayConfiguration,
  OverlayStatus,
  RawCaptureStatus,
  RawNormalizationStatus,
  RuntimeEffectObject,
  RuntimeOverlaySnapshot,
  TimeTrigger,
  TimeTriggerExecutionLog,
  TimeTriggerMode,
  TimeTriggerStartBasis,
  TriggerAction,
  TriggerActionType,
  TikTokRawEventCapture,
  TikTokRawEventCaptureSummary,
  TikTokConnectOptions,
  TikTokConnectionStatus,
  UiLogEntry
} from "@obs-effect/shared-types";

export interface HttpApiConfig {
  enabled: boolean;
  endpointUrl: string;
  apiKeyMasked: string;
  metrics: {
    enabled: boolean;
    receivedCount: number;
    duplicateCount: number;
    validationErrorCount: number;
    lastReceivedAt: string | null;
  };
}

export interface EventTestForm {
  eventId: string;
  platform: EventPlatform;
  type: NormalizedEventType;
  displayName: string;
  giftName: string;
  repeatCount: number;
  diamondValueTotal: number;
  comment: string;
}

export async function fetchHttpApiConfig(): Promise<HttpApiConfig> {
  const response = await fetch("/api/v1/http-api/config");
  if (!response.ok) {
    throw new Error("Failed to load HTTP API config");
  }
  return (await response.json()) as HttpApiConfig;
}

export async function fetchApiKey(): Promise<string> {
  const response = await fetch("/api/v1/http-api/key");
  if (!response.ok) {
    throw new Error("Failed to load API key");
  }
  const data = (await response.json()) as { apiKey: string };
  return data.apiKey;
}

export async function regenerateApiKey(): Promise<{ apiKey: string; apiKeyMasked: string }> {
  const response = await fetch("/api/v1/http-api/key/regenerate", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to regenerate API key");
  }
  return (await response.json()) as { apiKey: string; apiKeyMasked: string };
}

export function buildTestEvent(form: EventTestForm): NormalizedEvent {
  const data: Record<string, unknown> = {};

  if (form.giftName) {
    data.giftName = form.giftName;
  }
  if (form.repeatCount > 0) {
    data.repeatCount = form.repeatCount;
  }
  if (form.diamondValueTotal > 0) {
    data.diamondValueTotal = form.diamondValueTotal;
  }
  if (form.comment) {
    data.comment = form.comment;
  }

  return {
    schemaVersion: "1.0",
    eventId: form.eventId,
    source: "test",
    platform: form.platform,
    type: form.type,
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    user: form.displayName ? { displayName: form.displayName } : undefined,
    data
  };
}

export async function postEvent(event: NormalizedEvent, apiKey: string): Promise<unknown> {
  const response = await fetch("/api/v1/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Effect-App-Key": apiKey
    },
    body: JSON.stringify(event)
  });

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

export async function fetchEventHistory(): Promise<{ events: EventHistoryEntry[]; stats: EventMonitorStats }> {
  const response = await fetch("/api/v1/events/history");
  if (!response.ok) {
    throw new Error("Failed to load event history");
  }
  return (await response.json()) as { events: EventHistoryEntry[]; stats: EventMonitorStats };
}

export async function fetchEventCatalog(params: {
  search?: string;
  sourceType?: EventCatalogSourceType | "all";
  eventType?: string;
  enabled?: "all" | "enabled" | "disabled";
  favorite?: "all" | "favorite";
  sort?: "displayName" | "firstReceivedAt" | "lastReceivedAt" | "receivedCount" | "updatedAt" | "triggerAssignmentCount";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
} = {}): Promise<EventCatalogItem[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.sourceType && params.sourceType !== "all") query.set("sourceType", params.sourceType);
  if (params.eventType) query.set("eventType", params.eventType);
  if (params.enabled && params.enabled !== "all") query.set("enabled", params.enabled);
  if (params.favorite && params.favorite !== "all") query.set("favorite", params.favorite);
  if (params.sort) query.set("sort", params.sort);
  if (params.order) query.set("order", params.order);
  query.set("limit", String(params.limit ?? 300));
  query.set("offset", String(params.offset ?? 0));
  const response = await fetch(`/api/v1/event-catalog?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load event catalog");
  const data = (await response.json()) as { events: EventCatalogItem[] };
  return data.events;
}

export async function updateEventCatalogItem(
  id: string,
  patch: Partial<Pick<EventCatalogItem, "description" | "memo" | "category" | "tags" | "isEnabled" | "isFavorite" | "displayName" | "customDisplayName">>
): Promise<EventCatalogItem> {
  const response = await fetch(`/api/v1/event-catalog/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update event catalog item");
  const data = (await response.json()) as { event: EventCatalogItem };
  return data.event;
}

export async function createManualEventCatalogItem(input: {
  sourceType: EventCatalogSourceType;
  eventType: string;
  externalEventId: string;
  displayName: string;
  description?: string;
  memo?: string;
  category?: string;
  tags?: string[];
}): Promise<EventCatalogItem> {
  const response = await fetch("/api/v1/event-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error("Failed to create manual event");
  const data = (await response.json()) as { event: EventCatalogItem };
  return data.event;
}

export async function fetchGifts(params: {
  search?: string;
  sort?: "name" | "lastSeenAt" | "firstSeenAt" | "seenCount" | "diamondValue" | "coinValue";
  order?: "asc" | "desc";
  hasImage?: boolean;
  hasDiamondValue?: boolean;
  hasCoinValue?: boolean;
  cacheStatus?: GiftImageCacheStatus;
  limit?: number;
  offset?: number;
}): Promise<GiftCatalogRecord[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  if (params.order) query.set("order", params.order);
  if (params.hasImage !== undefined) query.set("hasImage", String(params.hasImage));
  if (params.hasDiamondValue !== undefined) query.set("hasDiamondValue", String(params.hasDiamondValue));
  if (params.hasCoinValue !== undefined) query.set("hasCoinValue", String(params.hasCoinValue));
  if (params.cacheStatus) query.set("cacheStatus", params.cacheStatus);
  query.set("limit", String(params.limit ?? 200));
  query.set("offset", String(params.offset ?? 0));
  const response = await fetch(`/api/v1/gifts?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load gifts");
  const data = (await response.json()) as { gifts: GiftCatalogRecord[] };
  return data.gifts;
}

export async function fetchGiftStats(): Promise<GiftCatalogStats> {
  const response = await fetch("/api/v1/gifts/stats");
  if (!response.ok) throw new Error("Failed to load gift stats");
  const data = (await response.json()) as { stats: GiftCatalogStats };
  return data.stats;
}

export async function fetchGift(id: string): Promise<GiftCatalogRecord> {
  const response = await fetch(`/api/v1/gifts/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Failed to load gift");
  const data = (await response.json()) as { gift: GiftCatalogRecord };
  return data.gift;
}

export async function updateGift(
  id: string,
  patch: Partial<Pick<GiftCatalogRecord, "name" | "diamondValue" | "coinValue" | "isActive">> & { primaryImageUrl?: string | null }
): Promise<GiftCatalogRecord> {
  const response = await fetch(`/api/v1/gifts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update gift");
  const data = (await response.json()) as { gift: GiftCatalogRecord };
  return data.gift;
}

export async function clearEventHistory(): Promise<void> {
  const response = await fetch("/api/v1/events/history", { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Failed to clear event history");
  }
}

export async function replayEvent(eventId: string): Promise<void> {
  const response = await fetch(`/api/v1/events/${encodeURIComponent(eventId)}/replay`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to replay event");
  }
}

export async function fetchLogs(): Promise<UiLogEntry[]> {
  const response = await fetch("/api/v1/logs");
  if (!response.ok) {
    throw new Error("Failed to load logs");
  }
  const data = (await response.json()) as { logs: UiLogEntry[] };
  return data.logs;
}

export async function clearLogs(): Promise<void> {
  const response = await fetch("/api/v1/logs", { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Failed to clear logs");
  }
}

export async function fetchTikTokStatus(): Promise<TikTokConnectionStatus> {
  const response = await fetch("/api/v1/tiktok/status");
  if (!response.ok) {
    throw new Error("Failed to load TikTok status");
  }
  const data = (await response.json()) as { status: TikTokConnectionStatus };
  return data.status;
}

export async function connectTikTok(options: TikTokConnectOptions): Promise<TikTokConnectionStatus> {
  const response = await fetch("/api/v1/tiktok/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  const data = (await response.json()) as { status?: TikTokConnectionStatus; error?: unknown };
  if (!response.ok || !data.status) {
    throw new Error(JSON.stringify(data.error ?? data));
  }
  return data.status;
}

export async function disconnectTikTok(): Promise<TikTokConnectionStatus> {
  const response = await fetch("/api/v1/tiktok/disconnect", { method: "POST" });
  const data = (await response.json()) as { status: TikTokConnectionStatus };
  if (!response.ok) {
    throw new Error("Failed to disconnect TikTok");
  }
  return data.status;
}

export async function reconnectTikTok(): Promise<TikTokConnectionStatus> {
  const response = await fetch("/api/v1/tiktok/reconnect", { method: "POST" });
  const data = (await response.json()) as { status: TikTokConnectionStatus };
  if (!response.ok) {
    throw new Error("Failed to reconnect TikTok");
  }
  return data.status;
}

export async function sendMockTikTokEvent(rawEvent: unknown): Promise<void> {
  const response = await fetch("/api/v1/tiktok/mock-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rawEvent)
  });
  if (!response.ok) {
    throw new Error("Mock connector is not active");
  }
}

export async function fetchOverlays(): Promise<OverlayStatus[]> {
  const response = await fetch("/api/v1/overlays");
  if (!response.ok) {
    throw new Error("Failed to load overlays");
  }
  const data = (await response.json()) as { overlays: OverlayStatus[] };
  return data.overlays;
}

export interface SystemVersionInfo {
  appVersion: string;
  buildVersion: string;
  serverStartedAt: string;
  serverInstanceId: string;
  overlayBundleVersion: string;
}

export async function fetchSystemVersion(): Promise<SystemVersionInfo> {
  const response = await fetch("/api/v1/system/version");
  if (!response.ok) throw new Error("Failed to load system version");
  return (await response.json()) as SystemVersionInfo;
}

export async function reloadOverlay(overlayId: OverlayId): Promise<void> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual-control-ui" })
  });
  if (!response.ok) throw new Error("Failed to reload overlay");
}

export async function reloadAllOverlays(): Promise<void> {
  const response = await fetch("/api/v1/overlays/reload-all", { method: "POST" });
  if (!response.ok) throw new Error("Failed to reload overlays");
}

export async function fetchOverlayConfig(overlayId: OverlayId): Promise<OverlayConfiguration> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/config`);
  if (!response.ok) throw new Error("Failed to load overlay config");
  const data = (await response.json()) as { config: OverlayConfiguration };
  return data.config;
}

export async function updateOverlayConfig(
  overlayId: OverlayId,
  patch: Partial<Omit<OverlayConfiguration, "overlayId" | "updatedAt">>
): Promise<OverlayConfiguration> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update overlay config");
  const data = (await response.json()) as { config: OverlayConfiguration };
  return data.config;
}

export async function fetchRuntimeSnapshot(overlayId: OverlayId): Promise<RuntimeOverlaySnapshot> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/runtime`);
  if (!response.ok) throw new Error("Failed to load runtime snapshot");
  const data = (await response.json()) as { snapshot: RuntimeOverlaySnapshot };
  return data.snapshot;
}

export async function startInteractionSession(overlayId: OverlayId, mode: "view" | "interactive"): Promise<RuntimeOverlaySnapshot> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/interactions/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  if (!response.ok) throw new Error("Failed to start interaction session");
  const data = (await response.json()) as { snapshot: RuntimeOverlaySnapshot };
  return data.snapshot;
}

export async function endInteractionSession(overlayId: OverlayId): Promise<void> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/interactions/session`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to end interaction session");
}

export async function createMockRuntimeObject(overlayId: OverlayId): Promise<RuntimeEffectObject> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/runtime/mock-object`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to create mock runtime object");
  const data = (await response.json()) as { object: RuntimeEffectObject };
  return data.object;
}

export async function hitRuntimeObject(overlayId: OverlayId, objectId: string): Promise<RuntimeEffectObject> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/objects/${encodeURIComponent(objectId)}/hit`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to hit runtime object");
  const data = (await response.json()) as { object: RuntimeEffectObject };
  return data.object;
}

export async function deleteRuntimeObject(overlayId: OverlayId, objectId: string): Promise<RuntimeEffectObject> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/objects/${encodeURIComponent(objectId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete runtime object");
  const data = (await response.json()) as { object: RuntimeEffectObject };
  return data.object;
}

export async function moveRuntimeObject(
  overlayId: OverlayId,
  objectId: string,
  position: { normalizedX: number; normalizedY: number }
): Promise<RuntimeEffectObject> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/objects/${encodeURIComponent(objectId)}/position`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(position)
  });
  if (!response.ok) throw new Error("Failed to move runtime object");
  const data = (await response.json()) as { object: RuntimeEffectObject };
  return data.object;
}

export async function clearRuntimeObjects(overlayId: OverlayId, scope: "interactive" | "all" = "interactive"): Promise<void> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/runtime?scope=${scope}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to clear runtime objects");
}

export async function fetchAssets(): Promise<AssetCatalogItem[]> {
  const response = await fetch("/api/v1/assets");
  if (!response.ok) throw new Error("Failed to load assets");
  const data = (await response.json()) as { assets: AssetCatalogItem[] };
  return data.assets;
}

export async function uploadAsset(file: File): Promise<AssetCatalogItem> {
  const query = new URLSearchParams({ filename: file.name });
  const response = await fetch(`/api/v1/assets/upload?${query.toString()}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file
  });
  const data = await readJson<{ asset?: AssetCatalogItem; error?: unknown }>(response);
  if (!response.ok || !data.asset) {
    if (response.status === 413) {
      throw new Error("ファイルが大きすぎます。500MB 以下のファイルを選択してください。");
    }
    if (response.status === 415) {
      throw new Error("対応している画像、動画、音声、フォントファイルを選択してください。");
    }
    throw new Error(typeof data.error === "string" ? data.error : "Failed to upload asset");
  }
  return data.asset;
}

export async function renameAsset(id: string, name: string): Promise<AssetCatalogItem> {
  const response = await fetch(`/api/v1/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const data = await readJson<{ asset?: AssetCatalogItem; error?: unknown }>(response);
  if (!response.ok || !data.asset) {
    throw new Error(typeof data.error === "string" ? data.error : "Failed to rename asset");
  }
  return data.asset;
}

export async function deleteAsset(id: string): Promise<void> {
  const response = await fetch(`/api/v1/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await readJson<{ error?: unknown }>(response);
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Failed to delete asset");
  }
}

export interface TimeTriggerDraft {
  name?: string;
  description?: string;
  memo?: string;
  isEnabled?: boolean;
  triggerMode?: TimeTriggerMode;
  startBasis?: TimeTriggerStartBasis;
  durationMs?: number;
  targetDateTime?: string;
  dailyTime?: string;
  intervalMs?: number;
  repeatCount?: number;
  maxExecutions?: number;
  resumeAfterRestart?: boolean;
}

export interface TriggerActionDraft {
  type?: TriggerActionType;
  name?: string;
  config?: Record<string, unknown>;
  order?: number;
  delayMs?: number;
  isEnabled?: boolean;
}

export async function fetchTimeTriggers(params: { search?: string; status?: string; enabled?: string } = {}): Promise<TimeTrigger[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.enabled && params.enabled !== "all") query.set("enabled", params.enabled);
  const response = await fetch(`/api/v1/time-triggers?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load time triggers");
  const data = (await response.json()) as { triggers: TimeTrigger[] };
  return data.triggers;
}

export async function createTimeTrigger(draft: TimeTriggerDraft): Promise<TimeTrigger> {
  const response = await fetch("/api/v1/time-triggers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("Failed to create time trigger");
  const data = (await response.json()) as { trigger: TimeTrigger };
  return data.trigger;
}

export async function updateTimeTrigger(id: string, patch: TimeTriggerDraft): Promise<TimeTrigger> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update time trigger");
  const data = (await response.json()) as { trigger: TimeTrigger };
  return data.trigger;
}

export async function deleteTimeTrigger(id: string): Promise<void> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete time trigger");
}

export async function startTimeTrigger(id: string): Promise<TimeTrigger> {
  return await timeTriggerCommand(id, "start");
}

export async function stopTimeTrigger(id: string): Promise<TimeTrigger> {
  return await timeTriggerCommand(id, "stop");
}

export async function resetTimeTrigger(id: string): Promise<TimeTrigger> {
  return await timeTriggerCommand(id, "reset");
}

export async function executeTimeTriggerNow(id: string): Promise<TimeTrigger> {
  return await timeTriggerCommand(id, "execute-now");
}

async function timeTriggerCommand(id: string, command: "start" | "stop" | "reset" | "execute-now"): Promise<TimeTrigger> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(id)}/${command}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to update time trigger state");
  const data = (await response.json()) as { trigger: TimeTrigger };
  return data.trigger;
}

export async function addTimeTriggerAction(triggerId: string, draft: TriggerActionDraft): Promise<TriggerAction> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(triggerId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("Failed to add time trigger action");
  const data = (await response.json()) as { action: TriggerAction };
  return data.action;
}

export async function updateTimeTriggerAction(triggerId: string, actionId: string, patch: TriggerActionDraft): Promise<TriggerAction> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(triggerId)}/actions/${encodeURIComponent(actionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update time trigger action");
  const data = (await response.json()) as { action: TriggerAction };
  return data.action;
}

export async function deleteTimeTriggerAction(triggerId: string, actionId: string): Promise<void> {
  const response = await fetch(`/api/v1/time-triggers/${encodeURIComponent(triggerId)}/actions/${encodeURIComponent(actionId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete time trigger action");
}

export async function fetchTimeTriggerLogs(triggerId?: string): Promise<TimeTriggerExecutionLog[]> {
  const query = triggerId ? `?triggerId=${encodeURIComponent(triggerId)}` : "";
  const response = await fetch(`/api/v1/time-triggers/logs${query}`);
  if (!response.ok) throw new Error("Failed to load time trigger logs");
  const data = (await response.json()) as { logs: TimeTriggerExecutionLog[] };
  return data.logs;
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function testOverlayFlash(overlayId: OverlayId, parameters: { color?: string; durationMs?: number }): Promise<void> {
  const response = await fetch(`/api/v1/overlays/${overlayId}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parameters)
  });
  if (!response.ok) {
    throw new Error("Failed to test overlay");
  }
}

export async function fetchEffectDefinitions(): Promise<EffectDefinition[]> {
  const response = await fetch("/api/v1/effect-definitions");
  if (!response.ok) throw new Error("Failed to load effect definitions");
  const data = (await response.json()) as { definitions: EffectDefinition[] };
  return data.definitions;
}

export async function fetchEffectConfigurations(): Promise<EffectConfiguration[]> {
  const response = await fetch("/api/v1/effect-configurations");
  if (!response.ok) throw new Error("Failed to load effect configurations");
  const data = (await response.json()) as { configurations: EffectConfiguration[] };
  return data.configurations;
}

export interface EffectConfigurationDraft {
  name?: string;
  description?: string;
  effectDefinitionId?: string;
  enabled?: boolean;
  targetOverlayId?: OverlayId;
  trigger?: { mode: "all" | "any"; conditions: EffectTriggerCondition[] };
  visual?: Partial<EffectConfiguration["visual"]>;
  media?: EffectConfiguration["media"];
  playback?: Partial<EffectConfiguration["playback"]>;
}

export interface EffectPresetDraft {
  name?: string;
  description?: string;
  enabled?: boolean;
}

export type EffectPresetSlotDraft = Partial<Omit<EffectPresetSlot, "id" | "createdAt" | "updatedAt" | "visual" | "playback">> & {
  visual?: Partial<EffectPresetSlot["visual"]>;
  playback?: Partial<EffectPresetSlot["playback"]>;
};

export interface SystemFontInfo {
  id: string;
  family: string;
  displayName: string;
  source: "system" | "asset";
  styles: string[];
  assetId?: string;
  contentUrl?: string;
}

export async function fetchSystemFonts(): Promise<SystemFontInfo[]> {
  const response = await fetch("/api/v1/system/fonts");
  if (!response.ok) throw new Error("Failed to load system fonts");
  const data = (await response.json()) as { fonts: SystemFontInfo[] };
  return data.fonts;
}

export async function createEffectConfiguration(draft: EffectConfigurationDraft): Promise<EffectConfiguration> {
  const response = await fetch("/api/v1/effect-configurations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("Failed to create effect configuration");
  const data = (await response.json()) as { configuration: EffectConfiguration };
  return data.configuration;
}

export async function updateEffectConfiguration(id: string, patch: EffectConfigurationDraft): Promise<EffectConfiguration> {
  const response = await fetch(`/api/v1/effect-configurations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update effect configuration");
  const data = (await response.json()) as { configuration: EffectConfiguration };
  return data.configuration;
}

export async function deleteEffectConfiguration(id: string): Promise<void> {
  const response = await fetch(`/api/v1/effect-configurations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete effect configuration");
}

export async function duplicateEffectConfiguration(id: string): Promise<EffectConfiguration> {
  const response = await fetch(`/api/v1/effect-configurations/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to duplicate effect configuration");
  const data = (await response.json()) as { configuration: EffectConfiguration };
  return data.configuration;
}

export async function setEffectConfigurationEnabled(id: string, enabled: boolean): Promise<EffectConfiguration> {
  const response = await fetch(`/api/v1/effect-configurations/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to update effect configuration state");
  const data = (await response.json()) as { configuration: EffectConfiguration };
  return data.configuration;
}

export async function fetchPresets(): Promise<EffectPreset[]> {
  const response = await fetch("/api/v1/presets");
  if (!response.ok) throw new Error("Failed to load presets");
  const data = (await response.json()) as { presets: EffectPreset[] };
  return data.presets;
}

export async function createPreset(draft: EffectPresetDraft): Promise<EffectPreset> {
  const response = await fetch("/api/v1/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft)
  });
  if (!response.ok) throw new Error("Failed to create preset");
  const data = (await response.json()) as { preset: EffectPreset };
  return data.preset;
}

export async function updatePreset(id: string, patch: EffectPresetDraft): Promise<EffectPreset> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update preset");
  const data = (await response.json()) as { preset: EffectPreset };
  return data.preset;
}

export async function deletePreset(id: string): Promise<void> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete preset");
}

export async function savePreset(id: string): Promise<{ configurationCount: number }> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(id)}/save`, { method: "POST" });
  const data = (await response.json()) as { saved?: boolean; configurationCount?: number; error?: unknown };
  if (!response.ok || !data.saved) {
    throw new Error(typeof data.error === "string" ? data.error : "Failed to save preset");
  }
  return { configurationCount: data.configurationCount ?? 0 };
}

export async function selectPreset(id: string): Promise<EffectPreset> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(id)}/select`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to select preset");
  const data = (await response.json()) as { preset: EffectPreset };
  return data.preset;
}

export async function addPresetSlot(presetId: string): Promise<EffectPresetSlot> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(presetId)}/slots`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to add preset slot");
  const data = (await response.json()) as { slot: EffectPresetSlot };
  return data.slot;
}

export async function updatePresetSlot(presetId: string, slotId: string, patch: EffectPresetSlotDraft): Promise<EffectPresetSlot> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(presetId)}/slots/${encodeURIComponent(slotId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Failed to update preset slot");
  const data = (await response.json()) as { slot: EffectPresetSlot };
  return data.slot;
}

export async function deletePresetSlot(presetId: string, slotId: string): Promise<void> {
  const response = await fetch(`/api/v1/presets/${encodeURIComponent(presetId)}/slots/${encodeURIComponent(slotId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete preset slot");
}

export async function testEffectConfiguration(id: string, options?: { pitchingScenario?: "manual" | "same-listener-gifts" | "multiple-listener-gifts" | "new-listener-gift" }): Promise<void> {
  const response = await fetch(`/api/v1/effect-configurations/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options ?? {})
  });
  if (!response.ok) throw new Error("Failed to test effect configuration");
}

export async function fetchRawCaptureStatus(): Promise<RawCaptureStatus> {
  const response = await fetch("/api/v1/tiktok/raw-captures/status");
  if (!response.ok) throw new Error("Failed to load raw capture status");
  return (await response.json()) as RawCaptureStatus;
}

export async function setRawCaptureEnabled(enabled: boolean): Promise<RawCaptureStatus> {
  const response = await fetch(`/api/v1/tiktok/raw-captures/${enabled ? "enable" : "disable"}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to update raw capture state");
  return (await response.json()) as RawCaptureStatus;
}

export async function fetchRawCaptures(params: {
  eventName?: string;
  normalizationStatus?: RawNormalizationStatus | "all";
  search?: string;
  limit?: number;
}): Promise<{ captures: TikTokRawEventCaptureSummary[]; status: RawCaptureStatus }> {
  const query = new URLSearchParams();
  if (params.eventName) query.set("eventName", params.eventName);
  if (params.normalizationStatus && params.normalizationStatus !== "all") query.set("normalizationStatus", params.normalizationStatus);
  if (params.search) query.set("search", params.search);
  query.set("limit", String(params.limit ?? 200));
  const response = await fetch(`/api/v1/tiktok/raw-captures?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load raw captures");
  return (await response.json()) as { captures: TikTokRawEventCaptureSummary[]; status: RawCaptureStatus };
}

export async function fetchRawCapture(captureId: string): Promise<TikTokRawEventCapture> {
  const response = await fetch(`/api/v1/tiktok/raw-captures/${encodeURIComponent(captureId)}`);
  if (!response.ok) throw new Error("Failed to load raw capture");
  const data = (await response.json()) as { capture: TikTokRawEventCapture };
  return data.capture;
}

export async function clearRawCaptures(): Promise<RawCaptureStatus> {
  const response = await fetch("/api/v1/tiktok/raw-captures", { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to clear raw captures");
  const data = (await response.json()) as { status: RawCaptureStatus };
  return data.status;
}

export async function fetchBrowserStatus(): Promise<{ status: BrowserConnectorStatus | null; frameStatus: BrowserFrameStoreStatus }> {
  const response = await fetch("/api/v1/tiktok/browser/status");
  if (!response.ok) throw new Error("Failed to load browser connector status");
  return (await response.json()) as { status: BrowserConnectorStatus | null; frameStatus: BrowserFrameStoreStatus };
}

export async function fetchBrowserFrames(params: {
  direction?: "received" | "sent" | "all";
  search?: string;
  limit?: number;
}): Promise<{ frames: BrowserWebSocketFrameCaptureSummary[]; status: BrowserFrameStoreStatus }> {
  const query = new URLSearchParams();
  if (params.direction && params.direction !== "all") query.set("direction", params.direction);
  if (params.search) query.set("search", params.search);
  query.set("limit", String(params.limit ?? 200));
  const response = await fetch(`/api/v1/tiktok/browser/frames?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load browser frames");
  return (await response.json()) as { frames: BrowserWebSocketFrameCaptureSummary[]; status: BrowserFrameStoreStatus };
}

export async function fetchBrowserFrame(captureId: string): Promise<BrowserWebSocketFrameCapture> {
  const response = await fetch(`/api/v1/tiktok/browser/frames/${encodeURIComponent(captureId)}`);
  if (!response.ok) throw new Error("Failed to load browser frame");
  const data = (await response.json()) as { frame: BrowserWebSocketFrameCapture };
  return data.frame;
}

export async function setBrowserFrameCaptureEnabled(enabled: boolean): Promise<BrowserFrameStoreStatus> {
  const response = await fetch(`/api/v1/tiktok/browser/capture/${enabled ? "enable" : "disable"}`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to update browser frame capture");
  return (await response.json()) as BrowserFrameStoreStatus;
}

export async function clearBrowserFrames(): Promise<BrowserFrameStoreStatus> {
  const response = await fetch("/api/v1/tiktok/browser/frames", { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to clear browser frames");
  const data = (await response.json()) as { status: BrowserFrameStoreStatus };
  return data.status;
}

export async function exportBrowserFrames(format: "json" | "jsonl"): Promise<Blob> {
  const response = await fetch("/api/v1/tiktok/browser/frames/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format })
  });
  if (!response.ok) throw new Error("Failed to export browser frames");
  return await response.blob();
}

export async function exportRawCaptures(params: {
  format: "json" | "jsonl";
  anonymize: boolean;
  captureIds?: string[];
}): Promise<Blob> {
  const response = await fetch("/api/v1/tiktok/raw-captures/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error("Failed to export raw captures");
  return await response.blob();
}
