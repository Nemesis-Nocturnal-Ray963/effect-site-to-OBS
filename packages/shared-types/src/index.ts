export type EffectKind =
  | "flash"
  | "image"
  | "video"
  | "audio"
  | "text"
  | "particle"
  | "shockwave"
  | "speed-lines"
  | "falling-image"
  | "pitching-machine-ball"
  | "puyo-game"
  | "gift-pile"
  | "gift-combo-text"
  | "ball-reveal"
  | "simple-media"
  | "media-composite";
export type OverlayId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type EventSource = "external-http" | "control-ui" | "test" | "tiktok-direct" | "timer" | "unknown";

export type EventPlatform = "tiktok" | "youtube" | "twitch" | "local" | "external";

export type NormalizedEventType =
  | "connect"
  | "disconnect"
  | "stream-start"
  | "stream-end"
  | "comment"
  | "like"
  | "like-batch"
  | "follow"
  | "share"
  | "gift"
  | "gift-streak-start"
  | "gift-streak-update"
  | "gift-streak-end"
  | "subscribe"
  | "member-join"
  | "viewer-count"
  | "custom";

export interface NormalizedEvent {
  schemaVersion: "1.0";
  eventId: string;
  source: EventSource;
  platform: EventPlatform;
  type: NormalizedEventType;
  timestamp: string;
  receivedAt: string;
  room?: {
    id?: string;
    uniqueId?: string;
  };
  user?: {
    id?: string;
    uniqueId?: string;
    displayName?: string;
    avatarUrl?: string | null;
    isModerator?: boolean;
    isSubscriber?: boolean;
  };
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface EffectPlayMessage {
  type: "effect:play";
  effectId: EffectKind;
  effectConfigId?: string;
  targetOverlayId?: OverlayId;
  instanceId: string;
  parameters?: Record<string, unknown>;
  visual?: EffectConfiguration["visual"];
  media?: ResolvedEffectMedia;
  playback?: EffectPlaybackSettings;
  runtimeData?: Record<string, unknown>;
  createdAt: string;
}

export interface EffectStopMessage {
  type: "effect:stop" | "effect:clear";
  instanceId?: string;
  effectId?: EffectKind;
  targetOverlayId?: OverlayId;
  scope?: "target-overlay" | "all-overlays";
  createdAt: string;
}

export interface OverlayStatus {
  overlayId: OverlayId;
  name: string;
  url: string;
  connectedClients: number;
  isInUse: boolean;
  connectedAt?: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  width: number;
  height: number;
  fps: number;
}

export interface OverlayConfiguration {
  overlayId: OverlayId;
  name: string;
  width: number;
  height: number;
  fps: number;
  purpose?: string;
  scaleMode: "fit" | "stretch" | "native";
  safeAreaEnabled: boolean;
  debugBackground?: string;
  updatedAt: string;
}

export interface EffectParameterSchema {
  fields: Array<{
    key: string;
    label: string;
    type: "string" | "number" | "boolean" | "color" | "select";
    defaultValue?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string; label: string }>;
  }>;
}

export interface EffectDefinition {
  id: string;
  kind: EffectKind;
  name: string;
  description: string;
  version: string;
  parameterSchema: EffectParameterSchema;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsAudio: boolean;
  supportsText: boolean;
  defaultDurationMs: number;
  defaultOverlayId: OverlayId;
}

export type EffectTriggerType =
  | "manual"
  | "comment"
  | "like-batch"
  | "like-total-threshold"
  | "gift-any"
  | "gift-specific"
  | "gift-value"
  | "follow"
  | "share"
  | "member-join"
  | "external-event";

export type EffectTriggerCondition =
  | { type: "manual" }
  | { type: "comment"; keyword?: string; matchMode?: "any" | "contains" | "equals" }
  | { type: "like-batch"; minimumCount: number }
  | { type: "like-total-threshold"; threshold: number }
  | { type: "gift-any"; triggerOn: "gift" | "streak-start" | "streak-end" }
  | {
      type: "gift-specific";
      giftCatalogId?: string;
      platform: GiftPlatform;
      platformGiftId: string;
      minimumRepeatCount?: number;
      triggerOn: "gift" | "streak-start" | "streak-end";
    }
  | { type: "gift-value"; minimumCoinValue: number; triggerOn: "gift" | "streak-start" | "streak-end" }
  | { type: "follow"; oncePerUserPerStream?: boolean }
  | { type: "share" }
  | { type: "member-join" }
  | { type: "external-event"; eventType: string };

export interface EffectTriggerGroup {
  mode: "all" | "any";
  conditions: EffectTriggerCondition[];
}

export interface EffectPosition {
  mode: "absolute" | "normalized" | "anchor";
  x: number;
  y: number;
  anchor:
    | "top-left"
    | "top-center"
    | "top-right"
    | "center-left"
    | "center"
    | "center-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
}

export interface EffectSize {
  width?: number;
  height?: number;
  scale?: number;
  unit: "px" | "percent";
}

export interface EffectPlaybackSettings {
  durationMs: number;
  startDelayMs: number;
  cooldownMs: number;
  maxConcurrent: number;
  overlapPolicy: "allow" | "ignore-new" | "replace-old" | "queue";
  queueLimit: number;
  stopPreviousSameEffect: boolean;
}

export interface EffectConfiguration {
  id: string;
  presetId?: string;
  presetSlotId?: string;
  name: string;
  description?: string;
  effectDefinitionId: string;
  enabled: boolean;
  targetOverlayId: OverlayId;
  trigger: EffectTriggerGroup;
  visual: {
    parameters: Record<string, unknown>;
    position: EffectPosition;
    size: EffectSize;
    opacity: number;
    zIndex: number;
  };
  media: {
    imageAssetId?: string;
    videoAssetId?: string;
    audioAssetId?: string;
  };
  playback: EffectPlaybackSettings;
  createdAt: string;
  updatedAt: string;
}

export interface EffectPresetSlot {
  id: string;
  name: string;
  description?: string;
  effectDefinitionId?: string;
  enabled: boolean;
  targetOverlayId: OverlayId;
  trigger: EffectTriggerGroup;
  visual: {
    parameters: Record<string, unknown>;
    position: EffectPosition;
    size: EffectSize;
    opacity: number;
    zIndex: number;
  };
  media: {
    imageAssetId?: string;
    videoAssetId?: string;
    audioAssetId?: string;
  };
  playback: EffectPlaybackSettings;
  createdAt: string;
  updatedAt: string;
}

export interface EffectPreset {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  slots: EffectPresetSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedEffectMedia {
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

export type SimpleLayerAnimation = "none" | "fade" | "scale" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "bounce";
export type SimpleMediaFit = "contain" | "cover" | "fill" | "none";
export type SimpleTransitionType = "none" | "fade" | "scale" | "slide-up" | "slide-down" | "slide-left" | "slide-right";

export interface SimpleTransition {
  type: SimpleTransitionType;
  durationMs: number;
  easing: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface SimpleMediaParameters {
  imageEnabled?: boolean;
  imageSourceMode?: "asset" | "gift-image" | "event-image";
  imageFit?: SimpleMediaFit;
  imageOpacity?: number;
  imageAnimation?: SimpleLayerAnimation;
  videoEnabled?: boolean;
  videoFit?: SimpleMediaFit;
  videoLoop?: boolean;
  videoVolume?: number;
  videoMuted?: boolean;
  audioEnabled?: boolean;
  audioVolume?: number;
  audioStartDelayMs?: number;
  textEnabled?: boolean;
  textMode?: "fixed" | "event-field";
  fixedText?: string;
  eventFieldPath?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  textAlign?: "left" | "center" | "right";
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundBorderRadius?: number;
  backgroundPadding?: number;
  enterTransition?: SimpleTransitionType;
  enterDurationMs?: number;
  exitTransition?: SimpleTransitionType;
  exitDurationMs?: number;
}

export type AssetKind = "image" | "video" | "audio" | "font";

export interface AssetCatalogItem {
  id: string;
  kind: AssetKind;
  name: string;
  description?: string;
  fileName: string;
  contentUrl: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
  source: "bundled" | "local-copy" | "external";
  tags: string[];
}

export type RuntimeObjectType =
  | "falling-image"
  | "pitching-machine"
  | "pitching-ball"
  | "pitching-impact"
  | "puyo-game"
  | "gift-combo-text"
  | "image"
  | "particle-emitter"
  | "interactive-target";

export interface RuntimeEffectObject {
  objectId: string;
  overlayId: OverlayId;
  executionId: string;
  effectConfigId: string;
  objectType: RuntimeObjectType;
  state: "active" | "destroying" | "destroyed";
  interactive: boolean;
  hitPoints?: number;
  maxHitPoints?: number;
  spawn: {
    normalizedX: number;
    normalizedY: number;
    velocityX?: number;
    velocityY?: number;
    rotation?: number;
    rotationSpeed?: number;
    scale?: number;
    randomSeed?: string;
  };
  asset?: {
    assetId?: string;
    contentUrl?: string;
  };
  createdAt: string;
  expiresAt?: string;
  destroyedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeOverlaySnapshot {
  overlayId: OverlayId;
  objects: RuntimeEffectObject[];
  generatedAt: string;
}

export type OverlayInteractionSessionMode = "view" | "interactive";
export type InteractionTool = "select" | "attack" | "delete" | "inspect";

export interface RuntimeSnapshotMessage {
  type: "runtime:snapshot";
  snapshot: RuntimeOverlaySnapshot;
  createdAt: string;
}

export interface RuntimeObjectChangedMessage {
  type: "runtime:object-created" | "runtime:object-updated" | "runtime:object-destroyed";
  object: RuntimeEffectObject;
  createdAt: string;
}

export interface RuntimeOverlayClearedMessage {
  type: "runtime:overlay-cleared";
  overlayId: OverlayId;
  scope: "interactive" | "all";
  createdAt: string;
}

export interface AppAudioComboMessage {
  type: "app-audio:combo";
  action: "start" | "update" | "stop";
  queueId: string;
  soundUrl?: string;
  targetCombo?: number;
  countSpeedMode?: string;
  constantAddsPerSecond?: number;
  acceleratingBaseAddsPerSecond?: number;
  acceleratingMaxAddsPerSecond?: number;
  accelerationStrength?: number;
  minimumSoundIntervalMs?: number;
  soundVolume?: number;
  pitchEnabled?: boolean;
  basePlaybackRate?: number;
  maxPlaybackRate?: number;
  pitchCurveStrength?: number;
  createdAt: string;
}

export interface InteractionSessionStatusMessage {
  type: "interaction:session-status";
  overlayId: OverlayId;
  mode: OverlayInteractionSessionMode;
  active: boolean;
  createdAt: string;
}

export type ClientInteractionMessage =
  | {
      type: "interaction:session-start";
      overlayId: OverlayId;
      mode: OverlayInteractionSessionMode;
      createdAt: string;
    }
  | {
      type: "interaction:session-end";
      overlayId: OverlayId;
      createdAt: string;
    }
  | {
      type: "interaction:object-hit";
      overlayId: OverlayId;
      objectId: string;
      executionId?: string;
      damage?: number;
      pointer?: { normalizedX: number; normalizedY: number };
      createdAt: string;
    }
  | {
      type: "interaction:object-delete";
      overlayId: OverlayId;
      objectId: string;
      createdAt: string;
    }
  | {
      type: "interaction:clear-overlay";
      overlayId: OverlayId;
      scope: "interactive" | "all";
      createdAt: string;
    }
  | {
      type: "runtime:snapshot-request";
      overlayId: OverlayId;
      createdAt: string;
    }
  | {
      type: "overlay:hello";
      overlayId: OverlayId;
      currentBuildVersion: string;
      currentOverlayConfigVersion?: number;
      createdAt: string;
    };

export interface OverlayVersionMessage {
  type: "overlay:version";
  overlayId: OverlayId;
  buildVersion: string;
  overlayConfigVersion: number;
  runtimeStateVersion: number;
  serverInstanceId: string;
  createdAt: string;
}

export interface OverlayReloadRequiredMessage {
  type: "overlay:reload-required";
  overlayId: OverlayId;
  reason: "build-version-changed" | "server-restart" | "manual-control-ui";
  currentBuildVersion?: string;
  newBuildVersion: string;
  reloadDelayMs: number;
  createdAt: string;
}

export interface OverlayStatusMessage {
  type: "overlay:status";
  overlays: OverlayStatus[];
  createdAt: string;
}

export interface ConnectionStatusMessage {
  type: "connection:status";
  overlayClients: number;
  controlClients: number;
  createdAt: string;
}

export interface TikTokConnectOptions {
  uniqueId?: string;
  sessionId?: string;
  connectorMode?: "tikfinity" | "browser" | "library" | "mock";
  enableExtendedGiftInfo?: boolean;
  fetchRoomInfoOnConnect?: boolean;
  autoReconnect?: boolean;
  useMockConnector?: boolean;
  tikfinity?: {
    endpointUrl?: string;
  };
  browser?: {
    browserType?: "chrome" | "edge" | "auto";
    executablePath?: string;
    debuggingPort?: number;
    headless?: boolean;
    captureFrames?: boolean;
  };
}

export type TikTokConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "stream-offline"
  | "authentication-required"
  | "rate-limited"
  | "error";

export interface TikTokConnectionStatus {
  enabled: boolean;
  state: TikTokConnectionState;
  uniqueId?: string;
  roomId?: string;
  connectedAt?: string;
  lastEventAt?: string;
  receivedCount: number;
  reconnectAttempt: number;
  errorCode?: string;
  errorMessage?: string;
  lastError?: string;
  connector: {
    mode: "tikfinity" | "mock" | "library" | "browser" | "unavailable";
    libraryName: string;
    libraryVersion?: string;
    license?: string;
    note: string;
  };
}

export interface TikTokStatusMessage {
  type: "tiktok:status";
  status: TikTokConnectionStatus;
  createdAt: string;
}

export type RawCaptureSource = "tiktok-tikfinity" | "tiktok-browser" | "tiktok-library" | "tiktok-mock";
export type RawNormalizationStatus = "success" | "warning" | "failed" | "not-normalized";

export interface TikTokRawEventCaptureSummary {
  captureId: string;
  capturedAt: string;
  rawEventName: string;
  rawEventSizeBytes: number;
  normalizationStatus: RawNormalizationStatus;
  truncated: boolean;
  warningCount: number;
  errorCount: number;
  userSummary?: string;
}

export interface TikTokRawEventCapture {
  captureId: string;
  capturedAt: string;
  connector: {
    name: string;
    version?: string;
    mode: "tikfinity" | "browser" | "library" | "mock";
  };
  connection: {
    uniqueId?: string;
    roomId?: string;
    state?: string;
  };
  rawEventName: string;
  rawEventSizeBytes: number;
  rawEvent: unknown;
  normalization: {
    status: RawNormalizationStatus;
    normalizedEvent?: NormalizedEvent;
    warnings: string[];
    errors: string[];
  };
  metadata: {
    truncated: boolean;
    redactedFields: string[];
    serializationWarnings: string[];
  };
}

export interface RawCaptureStatus {
  enabled: boolean;
  count: number;
  maxCount: number;
  estimatedBytes: number;
  truncatedCount: number;
  failedNormalizationCount: number;
}

export interface RawCaptureStatusMessage {
  type: "raw-capture:status";
  status: RawCaptureStatus;
  createdAt: string;
}

export interface RawCaptureReceivedMessage {
  type: "raw-capture:received" | "raw-capture:updated";
  capture: TikTokRawEventCaptureSummary;
  createdAt: string;
}

export interface RawCaptureClearedMessage {
  type: "raw-capture:cleared";
  createdAt: string;
}

export type BrowserConnectorState =
  | "idle"
  | "browser-not-found"
  | "browser-launching"
  | "browser-running"
  | "cdp-connecting"
  | "cdp-connected"
  | "page-loading"
  | "login-required"
  | "live-page-ready"
  | "capturing"
  | "connected"
  | "reconnecting"
  | "stream-offline"
  | "error";

export interface BrowserConnectorStatus {
  enabled: boolean;
  state: BrowserConnectorState;
  browserType?: "chrome" | "edge";
  executablePath?: string;
  debuggingPort: number;
  profileDir: string;
  pageUrl?: string;
  pageTitle?: string;
  uniqueId?: string;
  connectedAt?: string;
  lastFrameAt?: string;
  socketCount: number;
  receivedFrameCount: number;
  sentFrameCount: number;
  binaryFrameCount: number;
  textFrameCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface BrowserWebSocketFrameCaptureSummary {
  captureId: string;
  capturedAt: string;
  direction: "received" | "sent";
  opcode: number;
  socketUrl?: string;
  payloadSizeBytes: number;
  payloadEncoding: "text" | "base64" | "unknown";
  decodeStatus: "json" | "text" | "binary" | "unsupported";
  eventCount: number;
  truncated: boolean;
}

export interface BrowserWebSocketFrameCapture extends BrowserWebSocketFrameCaptureSummary {
  browser: {
    type: "chrome" | "edge";
    version?: string;
    debuggingPort: number;
  };
  page: {
    url: string;
    title?: string;
    uniqueId?: string;
  };
  socket: {
    requestId: string;
    url?: string;
    direction: "received" | "sent";
    opcode: number;
  };
  frame: {
    payloadEncoding: "text" | "base64" | "unknown";
    payloadData: string;
    payloadSizeBytes: number;
    textPreview?: string;
    hexPreview?: string;
  };
  decode: {
    status: "json" | "text" | "binary" | "unsupported";
    json?: unknown;
    error?: string;
    eventCount: number;
  };
  metadata: {
    truncated: boolean;
    redactedFields: string[];
  };
}

export interface BrowserFrameStoreStatus {
  enabled: boolean;
  count: number;
  maxCount: number;
  estimatedBytes: number;
  receivedFrameCount: number;
  sentFrameCount: number;
  binaryFrameCount: number;
  textFrameCount: number;
}

export interface BrowserCaptureMarker {
  markerId: string;
  createdAt: string;
  label: string;
  note?: string;
}

export interface TikTokBrowserStatusMessage {
  type: "tiktok:browser-status";
  status: BrowserConnectorStatus;
  frameStatus: BrowserFrameStoreStatus;
  createdAt: string;
}

export interface TikTokBrowserFrameReceivedMessage {
  type: "tiktok:browser-frame-received" | "tiktok:browser-frame-updated";
  frame: BrowserWebSocketFrameCaptureSummary;
  frameStatus: BrowserFrameStoreStatus;
  createdAt: string;
}

export interface TikTokBrowserFrameClearedMessage {
  type: "tiktok:browser-frame-cleared";
  frameStatus: BrowserFrameStoreStatus;
  createdAt: string;
}

export interface TikTokBrowserMarkerAddedMessage {
  type: "tiktok:browser-marker-added";
  marker: BrowserCaptureMarker;
  createdAt: string;
}

export interface EventReceivedMessage {
  type: "event:received";
  event: NormalizedEvent;
  processing: EventProcessingInfo;
  result: EventProcessingResult;
  createdAt: string;
}

export interface EventUpdatedMessage {
  type: "event:updated";
  event: EventHistoryEntry;
}

export interface EventReplayedMessage {
  type: "event:replayed";
  event: EventHistoryEntry;
  originalEventId: string;
}

export interface EventClearedMessage {
  type: "event:cleared";
  createdAt: string;
}

export interface LogUpdatedMessage {
  type: "log:updated";
  entry: UiLogEntry;
}

export interface LogClearedMessage {
  type: "log:cleared";
  createdAt: string;
}

export interface EventProcessingInfo {
  receivedAt: string;
  normalizedAt: string;
  completedAt?: string;
  latencyMs?: number;
}

export interface EventProcessingResult {
  duplicate: boolean;
  matchedActions: string[];
  triggeredEffects: string[];
  errors: string[];
}

export interface EventHistoryEntry {
  event: NormalizedEvent;
  processing: EventProcessingInfo;
  result: EventProcessingResult;
  createdAt: string;
}

export type EventCatalogSourceType = "tiktok" | "http" | "websocket" | "internal" | "manual" | "timer" | "plugin" | "unknown";

export interface EventCatalogItem {
  id: string;
  sourceType: EventCatalogSourceType;
  eventType: string;
  externalEventId: string;
  displayName: string;
  originalDisplayName: string;
  customDisplayName?: string;
  description?: string;
  memo?: string;
  category?: string;
  tags: string[];
  iconUrl?: string;
  thumbnailPath?: string;
  rawSamplePayload?: unknown;
  normalizedSamplePayload?: unknown;
  firstReceivedAt?: string;
  lastReceivedAt?: string;
  receivedCount: number;
  isEnabled: boolean;
  isFavorite: boolean;
  isManuallyCreated: boolean;
  triggerAssignmentCount: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export interface EventCatalogChangedMessage {
  type: "event-catalog:created" | "event-catalog:updated";
  item: EventCatalogItem;
  createdAt: string;
}

export type TimeTriggerMode = "elapsed" | "absolute_datetime" | "daily_time" | "interval";
export type TimeTriggerStartBasis =
  | "manual"
  | "app_start"
  | "session_start"
  | "scene_start"
  | "event_received"
  | "effect_started"
  | "effect_completed";
export type TimeTriggerStatus = "idle" | "scheduled" | "running" | "paused" | "completed" | "cancelled" | "error";
export type TriggerActionType =
  | "show_asset"
  | "show_text"
  | "play_scene"
  | "run_program_effect"
  | "play_audio"
  | "send_http"
  | "emit_event";

export interface TriggerAction {
  id: string;
  type: TriggerActionType;
  name: string;
  config: Record<string, unknown>;
  order: number;
  delayMs: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimeTrigger {
  id: string;
  name: string;
  description?: string;
  memo?: string;
  isEnabled: boolean;
  triggerMode: TimeTriggerMode;
  startBasis: TimeTriggerStartBasis;
  durationMs?: number;
  targetDateTime?: string;
  dailyTime?: string;
  intervalMs?: number;
  repeatCount?: number;
  maxExecutions?: number;
  actionIds: string[];
  actions: TriggerAction[];
  eventReference?: {
    sourceType: string;
    eventType: string;
    externalEventId: string;
  };
  status: TimeTriggerStatus;
  startedAt?: string;
  scheduledAt?: string;
  lastExecutedAt?: string;
  nextExecutionAt?: string;
  executionCount: number;
  resumeAfterRestart: boolean;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export interface TimeTriggerExecutionLog {
  id: string;
  triggerId: string;
  triggerName: string;
  scheduledAt: string;
  executedAt?: string;
  status: "success" | "failed" | "skipped" | "cancelled";
  delayMs?: number;
  errorMessage?: string;
  actionResults?: unknown[];
  isTest: boolean;
  createdAt: string;
}

export interface TimeTriggerChangedMessage {
  type: "time-trigger:created" | "time-trigger:updated" | "time-trigger:deleted" | "time-trigger:executed";
  trigger?: TimeTrigger;
  triggerId?: string;
  log?: TimeTriggerExecutionLog;
  createdAt: string;
}

export interface UiLogEntry {
  id: string;
  level: "info" | "warn" | "error";
  source: "http" | "event" | "effect" | "server";
  timestamp: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type GiftPlatform = "tiktok";
export type GiftValueSource = "event" | "extended-gift-info" | "catalog" | "manual" | "unknown";
export type GiftImageCacheStatus = "not-requested" | "pending" | "cached" | "failed";

export interface GiftImageInfo {
  primaryUrl?: string;
  urls: string[];
  localPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  cachedAt?: string;
  cacheStatus: GiftImageCacheStatus;
}

export interface GiftCatalogRecord {
  id: string;
  platform: GiftPlatform;
  platformGiftId: string;
  name: string;
  aliases: string[];
  diamondValue: number | null;
  coinValue: number | null;
  valueSource: GiftValueSource;
  image: GiftImageInfo;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  firstSeenRawEventName?: string;
  lastSeenRawEventName?: string;
  isActive: boolean;
  isManuallyEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GiftCatalogStats {
  total: number;
  withImage: number;
  withDiamondValue: number;
  withCoinValue: number;
  missingValue: number;
  imageCacheFailed: number;
  lastDiscoveredAt: string | null;
}

export interface GiftCatalogChangedMessage {
  type: "gift:catalog-created" | "gift:catalog-updated" | "gift:catalog-deleted" | "gift:image-cache-updated";
  gift: GiftCatalogRecord;
  createdAt: string;
}

export interface GiftCatalogStatsMessage {
  type: "gift:catalog-stats";
  stats: GiftCatalogStats;
  createdAt: string;
}

export interface HttpApiMetrics {
  enabled: boolean;
  receivedCount: number;
  duplicateCount: number;
  validationErrorCount: number;
  lastReceivedAt: string | null;
}

export interface EventMonitorStats {
  recentCount: number;
  receivedCount: number;
  duplicateCount: number;
  errorCount: number;
  averageLatencyMs: number | null;
  lastReceivedAt: string | null;
}

export type ServerMessage =
  | EffectPlayMessage
  | EffectStopMessage
  | OverlayStatusMessage
  | ConnectionStatusMessage
  | TikTokStatusMessage
  | RawCaptureStatusMessage
  | RawCaptureReceivedMessage
  | RawCaptureClearedMessage
  | TikTokBrowserStatusMessage
  | TikTokBrowserFrameReceivedMessage
  | TikTokBrowserFrameClearedMessage
  | TikTokBrowserMarkerAddedMessage
  | EventReceivedMessage
  | EventUpdatedMessage
  | EventReplayedMessage
  | EventClearedMessage
  | EventCatalogChangedMessage
  | TimeTriggerChangedMessage
  | GiftCatalogChangedMessage
  | GiftCatalogStatsMessage
  | RuntimeSnapshotMessage
  | RuntimeObjectChangedMessage
  | RuntimeOverlayClearedMessage
  | AppAudioComboMessage
  | OverlayVersionMessage
  | OverlayReloadRequiredMessage
  | InteractionSessionStatusMessage
  | LogUpdatedMessage
  | LogClearedMessage;
