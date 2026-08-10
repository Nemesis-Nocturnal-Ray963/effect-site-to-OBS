import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { EventCatalogItem, EventCatalogSourceType, NormalizedEvent } from "@obs-effect/shared-types";

export interface EventCatalogListOptions {
  search?: string;
  sourceType?: EventCatalogSourceType | "all";
  eventType?: string;
  enabled?: "all" | "enabled" | "disabled";
  favorite?: "all" | "favorite";
  sort?: "displayName" | "firstReceivedAt" | "lastReceivedAt" | "receivedCount" | "updatedAt" | "triggerAssignmentCount";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export type EventCatalogPatch = Partial<
  Pick<EventCatalogItem, "description" | "memo" | "category" | "isEnabled" | "isFavorite" | "customDisplayName">
> & { tags?: string[]; displayName?: string };

export interface ManualEventCatalogInput {
  sourceType: EventCatalogSourceType;
  eventType: string;
  externalEventId: string;
  displayName: string;
  description?: string;
  memo?: string;
  category?: string;
  tags?: string[];
}

const schemaVersion = 1;
const sensitiveKeys = new Set(["authorization", "cookie", "token", "access_token", "refresh_token", "api_key", "password", "secret"]);
const jsonLimit = 12000;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDatabase };

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteStatement {
  all(...values: unknown[]): unknown[];
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
}

export class EventCatalogService {
  private readonly db: SqliteDatabase;

  constructor(rootDir: string, private readonly now: () => string) {
    const dbDir = path.join(rootDir, "data", "events");
    mkdirSync(dbDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dbDir, "event-catalog.sqlite"));
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  list(options: EventCatalogListOptions = {}): EventCatalogItem[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (options.search?.trim()) {
      const search = `%${options.search.trim().toLocaleLowerCase("ja-JP")}%`;
      clauses.push("(lower(display_name) LIKE ? OR lower(external_event_id) LIKE ? OR lower(event_type) LIKE ? OR lower(source_type) LIKE ? OR lower(coalesce(memo, '')) LIKE ? OR lower(coalesce(category, '')) LIKE ? OR lower(tags_json) LIKE ?)");
      values.push(search, search, search, search, search, search, search);
    }
    if (options.sourceType && options.sourceType !== "all") {
      clauses.push("source_type = ?");
      values.push(options.sourceType);
    }
    if (options.eventType?.trim()) {
      clauses.push("event_type = ?");
      values.push(options.eventType.trim());
    }
    if (options.enabled === "enabled") clauses.push("is_enabled = 1");
    if (options.enabled === "disabled") clauses.push("is_enabled = 0");
    if (options.favorite === "favorite") clauses.push("is_favorite = 1");
    const sortColumn = sortColumnName(options.sort ?? "lastReceivedAt");
    const order = options.order === "asc" ? "ASC" : "DESC";
    const limit = clampInteger(options.limit ?? 200, 1, 1000);
    const offset = clampInteger(options.offset ?? 0, 0, 1_000_000);
    values.push(limit, offset);
    const sql = `SELECT * FROM event_catalog ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${sortColumn} ${order}, updated_at DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...values).map(rowToItem);
  }

  get(id: string): EventCatalogItem | null {
    const row = this.db.prepare("SELECT * FROM event_catalog WHERE id = ?").get(id);
    return row ? rowToItem(row) : null;
  }

  update(id: string, patch: EventCatalogPatch): EventCatalogItem | null {
    const current = this.get(id);
    if (!current) return null;
    const customDisplayName = patch.displayName ?? patch.customDisplayName ?? current.customDisplayName;
    const updatedAt = this.now();
    this.db
      .prepare(
        `UPDATE event_catalog SET
          custom_display_name = ?,
          display_name = ?,
          description = ?,
          memo = ?,
          category = ?,
          tags_json = ?,
          is_enabled = ?,
          is_favorite = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        stringOrNull(customDisplayName),
        customDisplayName?.trim() || current.originalDisplayName,
        patch.description !== undefined ? stringOrNull(patch.description) : stringOrNull(current.description),
        patch.memo !== undefined ? stringOrNull(patch.memo) : stringOrNull(current.memo),
        patch.category !== undefined ? stringOrNull(patch.category) : stringOrNull(current.category),
        JSON.stringify(normalizeTags(patch.tags ?? current.tags)),
        patch.isEnabled ?? current.isEnabled ? 1 : 0,
        patch.isFavorite ?? current.isFavorite ? 1 : 0,
        updatedAt,
        id
      );
    return this.get(id);
  }

  createManual(input: ManualEventCatalogInput): EventCatalogItem {
    const timestamp = this.now();
    const sourceType = input.sourceType || "manual";
    const eventType = normalizeKeyPart(input.eventType || "manual");
    const externalEventId = normalizeKeyPart(input.externalEventId || input.displayName || "manual");
    const existing = this.findByKey(sourceType, eventType, externalEventId);
    if (existing) return existing;
    const displayName = input.displayName.trim() || externalEventId;
    this.db
      .prepare(
        `INSERT INTO event_catalog (
          id, source_type, event_type, external_event_id, display_name, original_display_name, description, memo, category, tags_json,
          first_received_at, last_received_at, received_count, is_enabled, is_favorite, is_manually_created, trigger_assignment_count, created_at, updated_at, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, 0, 1, 0, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        sourceType,
        eventType,
        externalEventId,
        displayName,
        displayName,
        stringOrNull(input.description),
        stringOrNull(input.memo),
        stringOrNull(input.category),
        JSON.stringify(normalizeTags(input.tags ?? [])),
        timestamp,
        timestamp,
        schemaVersion
      );
    return this.findByKey(sourceType, eventType, externalEventId)!;
  }

  upsertFromEvent(event: NormalizedEvent): EventCatalogItem {
    const normalized = catalogEventFrom(event);
    const timestamp = this.now();
    const existing = this.findByKey(normalized.sourceType, normalized.eventType, normalized.externalEventId);
    const rawSample = safeJson(event);
    const normalizedSample = safeJson(normalized.samplePayload);
    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO event_catalog (
            id, source_type, event_type, external_event_id, display_name, original_display_name, tags_json, icon_url,
            raw_sample_payload_json, normalized_sample_payload_json, first_received_at, last_received_at, received_count,
            is_enabled, is_favorite, is_manually_created, trigger_assignment_count, created_at, updated_at, schema_version
          ) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 1, 1, 0, 0, 0, ?, ?, ?)`
        )
        .run(
          id,
          normalized.sourceType,
          normalized.eventType,
          normalized.externalEventId,
          normalized.displayName,
          normalized.displayName,
          stringOrNull(normalized.iconUrl),
          rawSample,
          normalizedSample,
          event.timestamp,
          event.timestamp,
          timestamp,
          timestamp,
          schemaVersion
        );
      return this.get(id)!;
    }

    const nextOriginalDisplayName = existing.customDisplayName ? existing.originalDisplayName : normalized.displayName;
    this.db
      .prepare(
        `UPDATE event_catalog SET
          display_name = ?,
          original_display_name = ?,
          icon_url = coalesce(?, icon_url),
          raw_sample_payload_json = ?,
          normalized_sample_payload_json = ?,
          last_received_at = ?,
          received_count = received_count + 1,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        existing.customDisplayName ?? normalized.displayName,
        nextOriginalDisplayName,
        stringOrNull(normalized.iconUrl),
        rawSample,
        normalizedSample,
        event.timestamp,
        timestamp,
        existing.id
      );
    return this.get(existing.id)!;
  }

  private findByKey(sourceType: EventCatalogSourceType, eventType: string, externalEventId: string): EventCatalogItem | null {
    const row = this.db
      .prepare("SELECT * FROM event_catalog WHERE source_type = ? AND event_type = ? AND external_event_id = ?")
      .get(sourceType, eventType, externalEventId);
    return row ? rowToItem(row) : null;
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_catalog (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        original_display_name TEXT NOT NULL,
        custom_display_name TEXT,
        description TEXT,
        memo TEXT,
        category TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        icon_url TEXT,
        thumbnail_path TEXT,
        raw_sample_payload_json TEXT,
        normalized_sample_payload_json TEXT,
        first_received_at TEXT,
        last_received_at TEXT,
        received_count INTEGER NOT NULL DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_manually_created INTEGER NOT NULL DEFAULT 0,
        trigger_assignment_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(source_type, event_type, external_event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_event_catalog_last_received ON event_catalog(last_received_at);
      CREATE INDEX IF NOT EXISTS idx_event_catalog_source_type ON event_catalog(source_type);
      CREATE INDEX IF NOT EXISTS idx_event_catalog_event_type ON event_catalog(event_type);
    `);
  }
}

function catalogEventFrom(event: NormalizedEvent): {
  sourceType: EventCatalogSourceType;
  eventType: string;
  externalEventId: string;
  displayName: string;
  iconUrl?: string;
  samplePayload: unknown;
} {
  const sourceType = sourceTypeFrom(event);
  const eventType = event.source === "timer" ? normalizeKeyPart(String(event.data.eventType ?? "elapsed")) : event.type.startsWith("gift") ? "gift" : event.type;
  const externalEventId = externalIdFrom(event, eventType);
  const displayName = displayNameFrom(event, eventType, externalEventId);
  return {
    sourceType,
    eventType,
    externalEventId,
    displayName,
    iconUrl: stringValue(event.data.primaryGiftImageUrl) ?? firstString(event.data.giftImageUrls),
    samplePayload: {
      eventId: event.eventId,
      sourceType,
      eventType,
      externalEventId,
      displayName,
      timestamp: event.timestamp,
      sender: event.user
        ? { id: event.user.id ?? event.user.uniqueId, name: event.user.displayName ?? event.user.uniqueId, avatarUrl: event.user.avatarUrl }
        : undefined,
      values: {
        quantity: numericValue(event.data.normalizedGiftQuantity) ?? numericValue(event.data.repeatCount),
        coinValue: numericValue(event.data.coinValueTotal) ?? numericValue(event.data.diamondValueTotal) ?? numericValue(event.data.coinValue) ?? numericValue(event.data.diamondValue),
        text: stringValue(event.data.comment)
      },
      payload: redactPayload(event.data)
    }
  };
}

function sourceTypeFrom(event: NormalizedEvent): EventCatalogSourceType {
  if (event.source === "timer") return "timer";
  if (event.source === "external-http") return "http";
  if (event.platform === "tiktok" || event.source === "tiktok-direct") return "tiktok";
  if (event.source === "control-ui" || event.source === "test") return "internal";
  return "unknown";
}

function externalIdFrom(event: NormalizedEvent, eventType: string): string {
  if (event.source === "timer") return normalizeKeyPart(String(event.data.externalEventId ?? event.data.timeTriggerId ?? "time-trigger"));
  if (eventType === "gift") return normalizeKeyPart(String(event.data.giftId ?? event.data.platformGiftId ?? event.data.giftName ?? "gift"));
  if (eventType === "custom") return normalizeKeyPart(String(event.data.eventType ?? event.data.rawEventType ?? "custom"));
  return normalizeKeyPart(eventType);
}

function displayNameFrom(event: NormalizedEvent, eventType: string, externalEventId: string): string {
  if (event.source === "timer") return stringValue(event.data.displayName) ?? externalEventId;
  if (eventType === "gift") return stringValue(event.data.giftName) ?? externalEventId;
  if (eventType === "comment") return "Comment";
  if (eventType === "follow") return "Follow";
  if (eventType === "share") return "Share";
  if (eventType === "member-join") return "Member Join";
  return eventType;
}

function rowToItem(row: unknown): EventCatalogItem {
  const record = row as Record<string, unknown>;
  const customDisplayName = stringValue(record.custom_display_name);
  const originalDisplayName = stringValue(record.original_display_name) ?? stringValue(record.display_name) ?? "";
  return {
    id: String(record.id),
    sourceType: record.source_type as EventCatalogSourceType,
    eventType: String(record.event_type),
    externalEventId: String(record.external_event_id),
    displayName: customDisplayName || String(record.display_name),
    originalDisplayName,
    customDisplayName,
    description: stringValue(record.description),
    memo: stringValue(record.memo),
    category: stringValue(record.category),
    tags: parseJsonArray(record.tags_json),
    iconUrl: stringValue(record.icon_url),
    thumbnailPath: stringValue(record.thumbnail_path),
    rawSamplePayload: parseJson(record.raw_sample_payload_json),
    normalizedSamplePayload: parseJson(record.normalized_sample_payload_json),
    firstReceivedAt: stringValue(record.first_received_at),
    lastReceivedAt: stringValue(record.last_received_at),
    receivedCount: Number(record.received_count ?? 0),
    isEnabled: Number(record.is_enabled ?? 1) === 1,
    isFavorite: Number(record.is_favorite ?? 0) === 1,
    isManuallyCreated: Number(record.is_manually_created ?? 0) === 1,
    triggerAssignmentCount: Number(record.trigger_assignment_count ?? 0),
    createdAt: String(record.created_at),
    updatedAt: String(record.updated_at),
    schemaVersion: Number(record.schema_version ?? 1)
  };
}

function sortColumnName(sort: NonNullable<EventCatalogListOptions["sort"]>): string {
  if (sort === "displayName") return "display_name";
  if (sort === "firstReceivedAt") return "first_received_at";
  if (sort === "receivedCount") return "received_count";
  if (sort === "updatedAt") return "updated_at";
  if (sort === "triggerAssignmentCount") return "trigger_assignment_count";
  return "last_received_at";
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLocaleLowerCase("ja-JP").replace(/\s+/gu, "-") || "unknown";
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 50);
}

function safeJson(value: unknown): string {
  const redacted = redactPayload(value);
  const serialized = JSON.stringify(redacted);
  return serialized.length <= jsonLimit ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, jsonLimit) });
}

function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(redactPayload);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKeys.has(key.toLocaleLowerCase("en-US"))) output[key] = "[redacted]";
    else output[key] = redactPayload(child);
  }
  return output;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}
