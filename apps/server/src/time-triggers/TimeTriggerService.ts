import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  NormalizedEvent,
  TimeTrigger,
  TimeTriggerExecutionLog,
  TimeTriggerMode,
  TimeTriggerStartBasis,
  TimeTriggerStatus,
  TriggerAction,
  TriggerActionType
} from "@obs-effect/shared-types";

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

export interface TimeTriggerInput {
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

export interface TriggerActionInput {
  type?: TriggerActionType;
  name?: string;
  config?: Record<string, unknown>;
  order?: number;
  delayMs?: number;
  isEnabled?: boolean;
}

export interface TimeTriggerListOptions {
  search?: string;
  status?: TimeTriggerStatus | "all";
  enabled?: "all" | "enabled" | "disabled";
}

export interface TimeTriggerSchedulerCallbacks {
  onFired: (trigger: TimeTrigger, event: NormalizedEvent, context: { scheduledAt: string; isTest: boolean }) => Promise<unknown[]>;
  onChanged?: (kind: "created" | "updated" | "deleted" | "executed", trigger?: TimeTrigger, log?: TimeTriggerExecutionLog, triggerId?: string) => void;
  onError?: (message: string, detail?: Record<string, unknown>) => void;
}

const schemaVersion = 1;
const tickMs = 500;
const maxTimerDelayMs = 2_147_483_647;

export class TimeTriggerService {
  private readonly db: SqliteDatabase;
  private timer: NodeJS.Timeout | null = null;
  private executing = false;

  constructor(
    rootDir: string,
    private readonly now: () => string,
    private readonly callbacks: TimeTriggerSchedulerCallbacks
  ) {
    const dbDir = path.join(rootDir, "data", "time-triggers");
    mkdirSync(dbDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dbDir, "time-triggers.sqlite"));
    this.initialize();
    this.restoreAppStartTriggers();
  }

  startScheduler(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.db.close();
  }

  list(options: TimeTriggerListOptions = {}): TimeTrigger[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (options.search?.trim()) {
      const search = `%${options.search.trim().toLocaleLowerCase("ja-JP")}%`;
      clauses.push("(lower(name) LIKE ? OR lower(coalesce(description, '')) LIKE ? OR lower(coalesce(memo, '')) LIKE ?)");
      values.push(search, search, search);
    }
    if (options.status && options.status !== "all") {
      clauses.push("status = ?");
      values.push(options.status);
    }
    if (options.enabled === "enabled") clauses.push("is_enabled = 1");
    if (options.enabled === "disabled") clauses.push("is_enabled = 0");
    const rows = this.db
      .prepare(`SELECT * FROM time_triggers ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`)
      .all(...values);
    return rows.map((row) => this.rowToTrigger(row));
  }

  get(id: string): TimeTrigger | null {
    const row = this.db.prepare("SELECT * FROM time_triggers WHERE id = ?").get(id);
    return row ? this.rowToTrigger(row) : null;
  }

  logs(triggerId?: string): TimeTriggerExecutionLog[] {
    const sql = triggerId
      ? "SELECT * FROM time_trigger_execution_logs WHERE trigger_id = ? ORDER BY created_at DESC LIMIT 300"
      : "SELECT * FROM time_trigger_execution_logs ORDER BY created_at DESC LIMIT 300";
    const rows = triggerId ? this.db.prepare(sql).all(triggerId) : this.db.prepare(sql).all();
    return rows.map(rowToLog);
  }

  create(input: TimeTriggerInput): TimeTrigger {
    const timestamp = this.now();
    const mode = input.triggerMode ?? "elapsed";
    const startBasis = input.startBasis ?? "manual";
    const durationMs = normalizeDuration(input.durationMs ?? 60_000);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO time_triggers (
          id, name, description, memo, is_enabled, trigger_mode, start_basis, duration_ms, target_datetime, daily_time,
          interval_ms, repeat_count, max_executions, event_reference_json, status, execution_count, resume_after_restart,
          created_at, updated_at, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'idle', 0, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name?.trim() || "New Time Trigger",
        stringOrNull(input.description),
        stringOrNull(input.memo),
        input.isEnabled ?? true ? 1 : 0,
        mode,
        startBasis,
        mode === "elapsed" ? durationMs : null,
        stringOrNull(input.targetDateTime),
        stringOrNull(input.dailyTime),
        mode === "interval" ? normalizeDuration(input.intervalMs ?? durationMs) : null,
        integerOrNull(input.repeatCount),
        integerOrNull(input.maxExecutions),
        input.resumeAfterRestart ?? false ? 1 : 0,
        timestamp,
        timestamp,
        schemaVersion
      );
    const trigger = this.get(id)!;
    this.callbacks.onChanged?.("created", trigger);
    return trigger;
  }

  update(id: string, patch: TimeTriggerInput): TimeTrigger | null {
    const current = this.get(id);
    if (!current) return null;
    const updatedAt = this.now();
    this.db
      .prepare(
        `UPDATE time_triggers SET
          name = ?, description = ?, memo = ?, is_enabled = ?, trigger_mode = ?, start_basis = ?, duration_ms = ?,
          target_datetime = ?, daily_time = ?, interval_ms = ?, repeat_count = ?, max_executions = ?,
          resume_after_restart = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        patch.name !== undefined ? patch.name.trim() || current.name : current.name,
        patch.description !== undefined ? stringOrNull(patch.description) : stringOrNull(current.description),
        patch.memo !== undefined ? stringOrNull(patch.memo) : stringOrNull(current.memo),
        patch.isEnabled ?? current.isEnabled ? 1 : 0,
        patch.triggerMode ?? current.triggerMode,
        patch.startBasis ?? current.startBasis,
        patch.durationMs !== undefined ? normalizeDuration(patch.durationMs) : current.durationMs ?? null,
        patch.targetDateTime !== undefined ? stringOrNull(patch.targetDateTime) : stringOrNull(current.targetDateTime),
        patch.dailyTime !== undefined ? stringOrNull(patch.dailyTime) : stringOrNull(current.dailyTime),
        patch.intervalMs !== undefined ? normalizeDuration(patch.intervalMs) : current.intervalMs ?? null,
        patch.repeatCount !== undefined ? integerOrNull(patch.repeatCount) : integerOrNull(current.repeatCount),
        patch.maxExecutions !== undefined ? integerOrNull(patch.maxExecutions) : integerOrNull(current.maxExecutions),
        patch.resumeAfterRestart ?? current.resumeAfterRestart ? 1 : 0,
        updatedAt,
        id
      );
    const updated = this.get(id)!;
    this.callbacks.onChanged?.("updated", updated);
    return updated;
  }

  delete(id: string): boolean {
    const current = this.get(id);
    if (!current) return false;
    this.db.prepare("DELETE FROM trigger_actions WHERE trigger_id = ?").run(id);
    this.db.prepare("DELETE FROM time_triggers WHERE id = ?").run(id);
    this.callbacks.onChanged?.("deleted", undefined, undefined, id);
    return true;
  }

  addAction(triggerId: string, input: TriggerActionInput): TriggerAction | null {
    const trigger = this.get(triggerId);
    if (!trigger) return null;
    const timestamp = this.now();
    const action: TriggerAction = {
      id: randomUUID(),
      type: input.type ?? "show_text",
      name: input.name?.trim() || "New Action",
      config: input.config ?? defaultActionConfig(input.type ?? "show_text"),
      order: Math.round(input.order ?? trigger.actions.length),
      delayMs: Math.max(0, Math.round(input.delayMs ?? 0)),
      isEnabled: input.isEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db
      .prepare(
        `INSERT INTO trigger_actions (id, trigger_id, action_type, name, config_json, action_order, delay_ms, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(action.id, triggerId, action.type, action.name, JSON.stringify(action.config), action.order, action.delayMs, action.isEnabled ? 1 : 0, timestamp, timestamp);
    this.callbacks.onChanged?.("updated", this.get(triggerId)!);
    return action;
  }

  updateAction(triggerId: string, actionId: string, patch: TriggerActionInput): TriggerAction | null {
    const current = this.actionsFor(triggerId).find((action) => action.id === actionId);
    if (!current) return null;
    const updatedAt = this.now();
    this.db
      .prepare(
        `UPDATE trigger_actions SET action_type = ?, name = ?, config_json = ?, action_order = ?, delay_ms = ?, is_enabled = ?, updated_at = ?
         WHERE id = ? AND trigger_id = ?`
      )
      .run(
        patch.type ?? current.type,
        patch.name !== undefined ? patch.name.trim() || current.name : current.name,
        JSON.stringify(patch.config ?? current.config),
        Math.round(patch.order ?? current.order),
        Math.max(0, Math.round(patch.delayMs ?? current.delayMs)),
        patch.isEnabled ?? current.isEnabled ? 1 : 0,
        updatedAt,
        actionId,
        triggerId
      );
    this.callbacks.onChanged?.("updated", this.get(triggerId)!);
    return this.actionsFor(triggerId).find((action) => action.id === actionId) ?? null;
  }

  deleteAction(triggerId: string, actionId: string): boolean {
    const exists = this.actionsFor(triggerId).some((action) => action.id === actionId);
    if (!exists) return false;
    this.db.prepare("DELETE FROM trigger_actions WHERE trigger_id = ? AND id = ?").run(triggerId, actionId);
    this.callbacks.onChanged?.("updated", this.get(triggerId)!);
    return true;
  }

  start(id: string): TimeTrigger | null {
    const trigger = this.get(id);
    if (!trigger || !trigger.isEnabled) return trigger;
    const startTime = Date.parse(this.now());
    const nextExecutionAt = nextExecutionDate(trigger, startTime, 0);
    if (!nextExecutionAt) {
      return this.setStatus(id, "error");
    }
    return this.schedule(id, new Date(startTime).toISOString(), nextExecutionAt.toISOString(), nextExecutionAt.toISOString(), "scheduled", 0);
  }

  stop(id: string): TimeTrigger | null {
    return this.schedule(id, undefined, undefined, undefined, "idle", 0);
  }

  reset(id: string): TimeTrigger | null {
    return this.schedule(id, undefined, undefined, undefined, "idle", 0);
  }

  async executeNow(id: string): Promise<TimeTrigger | null> {
    const trigger = this.get(id);
    if (!trigger || !trigger.isEnabled) return trigger;
    await this.execute(trigger, this.now(), true);
    return this.get(id);
  }

  private async tick(): Promise<void> {
    if (this.executing) return;
    this.executing = true;
    try {
      const current = Date.parse(this.now());
      const due = this.list({ status: "scheduled", enabled: "enabled" }).filter((trigger) => {
        const next = Date.parse(trigger.nextExecutionAt ?? "");
        return Number.isFinite(next) && next <= current;
      });
      for (const trigger of due) {
        await this.execute(trigger, trigger.nextExecutionAt ?? this.now(), false);
      }
    } finally {
      this.executing = false;
    }
  }

  private async execute(trigger: TimeTrigger, scheduledAt: string, isTest: boolean): Promise<void> {
    const executedAt = this.now();
    const event: NormalizedEvent = {
      schemaVersion: "1.0",
      eventId: `evt_time_${randomUUID()}`,
      source: "timer",
      platform: "local",
      type: "custom",
      timestamp: executedAt,
      receivedAt: executedAt,
      data: {
        eventType: trigger.triggerMode === "interval" ? "interval" : trigger.triggerMode === "absolute_datetime" ? "absolute_datetime" : "elapsed",
        externalEventId: trigger.id,
        displayName: trigger.name,
        timeTriggerId: trigger.id,
        executionCount: trigger.executionCount + 1,
        scheduledAt,
        actualExecutedAt: executedAt,
        amount: trigger.durationMs ?? trigger.intervalMs,
        isTest,
        isManualExecution: isTest
      }
    };
    let status: TimeTriggerExecutionLog["status"] = "success";
    let errorMessage: string | undefined;
    let actionResults: unknown[] = [];
    try {
      this.setStatus(trigger.id, "running");
      actionResults = await this.callbacks.onFired(trigger, event, { scheduledAt, isTest });
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.("Time trigger execution failed", { triggerId: trigger.id, error: errorMessage });
    }

    const latest = this.get(trigger.id) ?? trigger;
    const nextCount = latest.executionCount + 1;
    const next = isTest ? (latest.nextExecutionAt ? new Date(latest.nextExecutionAt) : null) : calculateFollowingExecution(latest, nextCount);
    const nextStatus: TimeTriggerStatus = status === "failed" ? "error" : next ? "scheduled" : "completed";
    this.db
      .prepare(
        `UPDATE time_triggers SET status = ?, last_executed_at = ?, next_execution_at = ?, execution_count = ?, updated_at = ? WHERE id = ?`
      )
      .run(nextStatus, executedAt, next?.toISOString() ?? null, nextCount, executedAt, trigger.id);
    const log = this.insertLog(latest, scheduledAt, executedAt, status, errorMessage, actionResults, isTest);
    this.callbacks.onChanged?.("executed", this.get(trigger.id) ?? undefined, log);
  }

  private insertLog(
    trigger: TimeTrigger,
    scheduledAt: string,
    executedAt: string,
    status: TimeTriggerExecutionLog["status"],
    errorMessage: string | undefined,
    actionResults: unknown[],
    isTest: boolean
  ): TimeTriggerExecutionLog {
    const log: TimeTriggerExecutionLog = {
      id: randomUUID(),
      triggerId: trigger.id,
      triggerName: trigger.name,
      scheduledAt,
      executedAt,
      status,
      delayMs: Math.max(0, Date.parse(executedAt) - Date.parse(scheduledAt)),
      errorMessage,
      actionResults,
      isTest,
      createdAt: this.now()
    };
    this.db
      .prepare(
        `INSERT INTO time_trigger_execution_logs (
          id, trigger_id, trigger_name, scheduled_at, executed_at, status, delay_ms, error_message, action_results_json, is_test, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        log.id,
        log.triggerId,
        log.triggerName,
        log.scheduledAt,
        log.executedAt,
        log.status,
        log.delayMs ?? null,
        stringOrNull(log.errorMessage),
        JSON.stringify(actionResults),
        isTest ? 1 : 0,
        log.createdAt
      );
    return log;
  }

  private schedule(
    id: string,
    startedAt: string | undefined,
    scheduledAt: string | undefined,
    nextExecutionAt: string | undefined,
    status: TimeTriggerStatus,
    executionCount: number
  ): TimeTrigger | null {
    this.db
      .prepare(
        `UPDATE time_triggers SET status = ?, started_at = ?, scheduled_at = ?, next_execution_at = ?, execution_count = ?, updated_at = ? WHERE id = ?`
      )
      .run(status, startedAt ?? null, scheduledAt ?? null, nextExecutionAt ?? null, executionCount, this.now(), id);
    const trigger = this.get(id);
    if (trigger) this.callbacks.onChanged?.("updated", trigger);
    return trigger;
  }

  private setStatus(id: string, status: TimeTriggerStatus): TimeTrigger | null {
    this.db.prepare("UPDATE time_triggers SET status = ?, updated_at = ? WHERE id = ?").run(status, this.now(), id);
    const trigger = this.get(id);
    if (trigger) this.callbacks.onChanged?.("updated", trigger);
    return trigger;
  }

  private actionsFor(triggerId: string): TriggerAction[] {
    return this.db.prepare("SELECT * FROM trigger_actions WHERE trigger_id = ? ORDER BY action_order ASC, created_at ASC").all(triggerId).map(rowToAction);
  }

  private rowToTrigger(row: unknown): TimeTrigger {
    const record = row as Record<string, unknown>;
    const actions = this.actionsFor(String(record.id));
    return {
      id: String(record.id),
      name: String(record.name),
      description: stringValue(record.description),
      memo: stringValue(record.memo),
      isEnabled: Number(record.is_enabled ?? 1) === 1,
      triggerMode: record.trigger_mode as TimeTriggerMode,
      startBasis: record.start_basis as TimeTriggerStartBasis,
      durationMs: numericValue(record.duration_ms),
      targetDateTime: stringValue(record.target_datetime),
      dailyTime: stringValue(record.daily_time),
      intervalMs: numericValue(record.interval_ms),
      repeatCount: numericValue(record.repeat_count),
      maxExecutions: numericValue(record.max_executions),
      actionIds: actions.map((action) => action.id),
      actions,
      eventReference: parseJson(record.event_reference_json) as TimeTrigger["eventReference"],
      status: record.status as TimeTriggerStatus,
      startedAt: stringValue(record.started_at),
      scheduledAt: stringValue(record.scheduled_at),
      lastExecutedAt: stringValue(record.last_executed_at),
      nextExecutionAt: stringValue(record.next_execution_at),
      executionCount: Number(record.execution_count ?? 0),
      resumeAfterRestart: Number(record.resume_after_restart ?? 0) === 1,
      createdAt: String(record.created_at),
      updatedAt: String(record.updated_at),
      schemaVersion: Number(record.schema_version ?? 1)
    };
  }

  private restoreAppStartTriggers(): void {
    const startNow = this.now();
    for (const trigger of this.list({ enabled: "enabled" })) {
      if (trigger.startBasis === "app_start" && trigger.status === "idle") {
        this.start(trigger.id);
      } else if (trigger.status === "scheduled" && trigger.resumeAfterRestart) {
        const next = Date.parse(trigger.nextExecutionAt ?? "");
        if (!Number.isFinite(next) || next < Date.parse(startNow) - maxTimerDelayMs) {
          this.reset(trigger.id);
        }
      } else if (trigger.status === "scheduled" && !trigger.resumeAfterRestart) {
        this.reset(trigger.id);
      }
    }
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS time_triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        memo TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        trigger_mode TEXT NOT NULL,
        start_basis TEXT NOT NULL,
        duration_ms INTEGER,
        target_datetime TEXT,
        daily_time TEXT,
        interval_ms INTEGER,
        repeat_count INTEGER,
        max_executions INTEGER,
        event_reference_json TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        started_at TEXT,
        scheduled_at TEXT,
        last_executed_at TEXT,
        next_execution_at TEXT,
        execution_count INTEGER NOT NULL DEFAULT 0,
        resume_after_restart INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS trigger_actions (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        action_order INTEGER NOT NULL DEFAULT 0,
        delay_ms INTEGER NOT NULL DEFAULT 0,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(trigger_id) REFERENCES time_triggers(id)
      );
      CREATE TABLE IF NOT EXISTS time_trigger_execution_logs (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL,
        trigger_name TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        executed_at TEXT,
        status TEXT NOT NULL,
        delay_ms INTEGER,
        error_message TEXT,
        action_results_json TEXT,
        is_test INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_time_triggers_next ON time_triggers(next_execution_at);
      CREATE INDEX IF NOT EXISTS idx_time_trigger_logs_trigger ON time_trigger_execution_logs(trigger_id);
    `);
  }
}

function nextExecutionDate(trigger: TimeTrigger, startTime: number, executionCount: number): Date | null {
  if (trigger.triggerMode === "absolute_datetime") {
    const target = Date.parse(trigger.targetDateTime ?? "");
    return Number.isFinite(target) ? new Date(Math.max(target, startTime)) : null;
  }
  if (trigger.triggerMode === "interval") {
    const intervalMs = normalizeDuration(trigger.intervalMs ?? trigger.durationMs ?? 60_000);
    return new Date(startTime + intervalMs * (executionCount + 1));
  }
  if (trigger.triggerMode === "daily_time") {
    return nextDailyTime(trigger.dailyTime, startTime);
  }
  return new Date(startTime + normalizeDuration(trigger.durationMs ?? 60_000));
}

function calculateFollowingExecution(trigger: TimeTrigger, nextExecutionCount: number): Date | null {
  const maxExecutions = trigger.maxExecutions ?? trigger.repeatCount;
  if (maxExecutions && nextExecutionCount >= maxExecutions) return null;
  if (trigger.triggerMode === "interval") {
    const start = Date.parse(trigger.startedAt ?? trigger.scheduledAt ?? trigger.createdAt);
    return nextExecutionDate(trigger, Number.isFinite(start) ? start : Date.now(), nextExecutionCount);
  }
  if (trigger.triggerMode === "daily_time") {
    return nextDailyTime(trigger.dailyTime, Date.now() + 1000);
  }
  return null;
}

function nextDailyTime(dailyTime: string | undefined, current: number): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(dailyTime ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const next = new Date(current);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= current) next.setDate(next.getDate() + 1);
  return next;
}

function rowToAction(row: unknown): TriggerAction {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    type: record.action_type as TriggerActionType,
    name: String(record.name),
    config: (parseJson(record.config_json) as Record<string, unknown>) ?? {},
    order: Number(record.action_order ?? 0),
    delayMs: Number(record.delay_ms ?? 0),
    isEnabled: Number(record.is_enabled ?? 1) === 1,
    createdAt: String(record.created_at),
    updatedAt: String(record.updated_at)
  };
}

function rowToLog(row: unknown): TimeTriggerExecutionLog {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    triggerId: String(record.trigger_id),
    triggerName: String(record.trigger_name),
    scheduledAt: String(record.scheduled_at),
    executedAt: stringValue(record.executed_at),
    status: record.status as TimeTriggerExecutionLog["status"],
    delayMs: numericValue(record.delay_ms),
    errorMessage: stringValue(record.error_message),
    actionResults: parseJson(record.action_results_json) as unknown[],
    isTest: Number(record.is_test ?? 0) === 1,
    createdAt: String(record.created_at)
  };
}

function defaultActionConfig(type: TriggerActionType): Record<string, unknown> {
  if (type === "show_text") return { text: "Time trigger", durationMs: 3000, targetOverlayId: 1 };
  if (type === "show_asset" || type === "play_audio") return { assetId: "", durationMs: 3000, targetOverlayId: 1, volume: 0.5 };
  if (type === "play_scene") return { presetId: "" };
  return {};
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeDuration(value: number): number {
  return Math.max(1000, Math.round(Number.isFinite(value) ? value : 1000));
}
