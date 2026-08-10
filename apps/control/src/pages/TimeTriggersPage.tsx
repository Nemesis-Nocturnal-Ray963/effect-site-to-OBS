import React from "react";
import type { AssetCatalogItem, EffectPreset, TimeTrigger, TimeTriggerExecutionLog, TriggerAction, TriggerActionType } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import {
  addTimeTriggerAction,
  createTimeTrigger,
  deleteTimeTrigger,
  deleteTimeTriggerAction,
  executeTimeTriggerNow,
  fetchAssets,
  fetchPresets,
  fetchTimeTriggerLogs,
  fetchTimeTriggers,
  resetTimeTrigger,
  startTimeTrigger,
  stopTimeTrigger,
  updateTimeTrigger,
  updateTimeTriggerAction
} from "../services/httpApi";

type DurationParts = { hours: number; minutes: number; seconds: number };

const actionTypes: Array<{ value: TriggerActionType; label: string }> = [
  { value: "show_text", label: "Text" },
  { value: "show_asset", label: "Asset" },
  { value: "play_audio", label: "Audio" },
  { value: "play_scene", label: "Preset" },
  { value: "emit_event", label: "Emit event" }
];

export function TimeTriggersPage(): React.ReactElement {
  const { t } = useI18n();
  const [triggers, setTriggers] = React.useState<TimeTrigger[]>([]);
  const [assets, setAssets] = React.useState<AssetCatalogItem[]>([]);
  const [presets, setPresets] = React.useState<EffectPreset[]>([]);
  const [logs, setLogs] = React.useState<TimeTriggerExecutionLog[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [message, setMessage] = React.useState("");
  const selected = triggers.find((trigger) => trigger.id === selectedId) ?? triggers[0] ?? null;

  React.useEffect(() => {
    void loadAll();
  }, []);

  React.useEffect(() => {
    if (!selected) {
      setLogs([]);
      return;
    }
    void fetchTimeTriggerLogs(selected.id).then(setLogs).catch(() => undefined);
  }, [selected?.id]);

  async function loadAll(): Promise<void> {
    try {
      const [nextTriggers, nextAssets, nextPresets] = await Promise.all([fetchTimeTriggers(), fetchAssets(), fetchPresets()]);
      setTriggers(nextTriggers);
      setAssets(nextAssets);
      setPresets(nextPresets);
      setSelectedId((current) => current ?? nextTriggers[0]?.id ?? null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Failed to load"));
    }
  }

  async function replaceTrigger(trigger: TimeTrigger): Promise<void> {
    setTriggers((current) => current.map((item) => (item.id === trigger.id ? trigger : item)));
    setSelectedId(trigger.id);
    setLogs(await fetchTimeTriggerLogs(trigger.id));
  }

  async function handleCreate(): Promise<void> {
    const trigger = await createTimeTrigger({ name: "New Time Trigger", triggerMode: "elapsed", startBasis: "manual", durationMs: 60_000 });
    setTriggers((current) => [trigger, ...current]);
    setSelectedId(trigger.id);
  }

  async function handleDelete(): Promise<void> {
    if (!selected || !window.confirm(t("Delete this time trigger?"))) return;
    await deleteTimeTrigger(selected.id);
    const next = triggers.filter((trigger) => trigger.id !== selected.id);
    setTriggers(next);
    setSelectedId(next[0]?.id ?? null);
  }

  async function command(run: (id: string) => Promise<TimeTrigger>): Promise<void> {
    if (!selected) return;
    setMessage("");
    try {
      await replaceTrigger(await run(selected.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Command failed"));
    }
  }

  const visibleTriggers = triggers.filter((trigger) => {
    const query = search.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
    if (!query) return true;
    return [trigger.name, trigger.description ?? "", trigger.memo ?? "", trigger.triggerMode, trigger.status].join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(query);
  });

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Time Trigger")}</p>
        <h2>{t("Scheduled effects")}</h2>
      </div>

      <div className="action-panel time-trigger-toolbar">
        <label>
          {t("Search")}
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search time triggers")} />
        </label>
        <button type="button" onClick={() => void handleCreate()}>
          {t("New Time Trigger")}
        </button>
        <span className="empty-text">{message}</span>
      </div>

      <section className="time-trigger-layout">
        <div className="time-trigger-list">
          <table>
            <thead>
              <tr>
                <th>{t("Status")}</th>
                <th>{t("Name")}</th>
                <th>{t("Mode")}</th>
                <th>{t("Next")}</th>
                <th>{t("Count")}</th>
                <th>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleTriggers.map((trigger) => (
                <tr className={trigger.id === selected?.id ? "selected" : ""} key={trigger.id} onClick={() => setSelectedId(trigger.id)}>
                  <td>{t(trigger.status)}</td>
                  <td>
                    <strong>{trigger.name}</strong>
                    <span>{timeSummary(trigger)}</span>
                  </td>
                  <td>{t(trigger.triggerMode)}</td>
                  <td>{formatDate(trigger.nextExecutionAt)}</td>
                  <td>{trigger.executionCount}</td>
                  <td>{trigger.actions.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <aside className="panel time-trigger-detail">
            <div className="button-row">
              <button type="button" onClick={() => void command(startTimeTrigger)} disabled={!selected.isEnabled}>
                {t("Start")}
              </button>
              <button type="button" onClick={() => void command(stopTimeTrigger)}>
                {t("Stop")}
              </button>
              <button type="button" onClick={() => void command(resetTimeTrigger)}>
                {t("Reset")}
              </button>
              <button type="button" onClick={() => void command(executeTimeTriggerNow)}>
                {t("Execute now")}
              </button>
            </div>

            <TriggerEditor trigger={selected} onChange={replaceTrigger} />
            <ActionEditor trigger={selected} assets={assets} presets={presets} onChange={() => void loadAll()} />

            <div>
              <h3>{t("Execution logs")}</h3>
              <div className="time-trigger-log-list">
                {logs.map((log) => (
                  <div className="log-row" key={log.id}>
                    <strong>{t(log.status)}</strong>
                    <span>{formatDate(log.executedAt ?? log.scheduledAt)}</span>
                    <span>{log.isTest ? t("test") : `${log.delayMs ?? 0}ms`}</span>
                  </div>
                ))}
                {logs.length === 0 ? <p className="empty-text">{t("No logs yet.")}</p> : null}
              </div>
            </div>

            <button className="danger-button" type="button" onClick={() => void handleDelete()}>
              {t("Delete")}
            </button>
          </aside>
        ) : null}
      </section>
    </section>
  );
}

function TriggerEditor({ trigger, onChange }: { trigger: TimeTrigger; onChange: (trigger: TimeTrigger) => Promise<void> }): React.ReactElement {
  const { t } = useI18n();
  const duration = durationParts(trigger.triggerMode === "interval" ? trigger.intervalMs ?? 60_000 : trigger.durationMs ?? 60_000);

  async function patch(patchValue: Parameters<typeof updateTimeTrigger>[1]): Promise<void> {
    await onChange(await updateTimeTrigger(trigger.id, patchValue));
  }

  return (
    <div className="time-trigger-editor">
      <label>
        {t("Name")}
        <input defaultValue={trigger.name} onBlur={(event) => void patch({ name: event.target.value })} />
      </label>
      <label>
        {t("Memo")}
        <textarea defaultValue={trigger.memo ?? ""} onBlur={(event) => void patch({ memo: event.target.value })} />
      </label>
      <label>
        {t("Enabled")}
        <input type="checkbox" checked={trigger.isEnabled} onChange={(event) => void patch({ isEnabled: event.target.checked })} />
      </label>
      <label>
        {t("Mode")}
        <select value={trigger.triggerMode} onChange={(event) => void patch({ triggerMode: event.target.value as TimeTrigger["triggerMode"] })}>
          <option value="elapsed">{t("Elapsed time")}</option>
          <option value="absolute_datetime">{t("Specific date/time")}</option>
          <option value="interval">{t("Interval")}</option>
          <option value="daily_time">{t("Daily time")}</option>
        </select>
      </label>
      <label>
        {t("Start basis")}
        <select value={trigger.startBasis} onChange={(event) => void patch({ startBasis: event.target.value as TimeTrigger["startBasis"] })}>
          <option value="manual">{t("Manual")}</option>
          <option value="app_start">{t("App start")}</option>
          <option value="session_start">{t("Session start")}</option>
        </select>
      </label>
      {trigger.triggerMode === "absolute_datetime" ? (
        <label>
          {t("Target date/time")}
          <input type="datetime-local" defaultValue={toDatetimeLocal(trigger.targetDateTime)} onBlur={(event) => void patch({ targetDateTime: event.target.value ? new Date(event.target.value).toISOString() : undefined })} />
        </label>
      ) : trigger.triggerMode === "daily_time" ? (
        <label>
          {t("Daily time")}
          <input type="time" value={trigger.dailyTime ?? "21:00"} onChange={(event) => void patch({ dailyTime: event.target.value })} />
        </label>
      ) : (
        <div className="duration-inputs">
          <span>{t("Time")}</span>
          <NumberBox label={t("Hours")} value={duration.hours} onCommit={(hours) => void patch(durationPatch(trigger, { ...duration, hours }))} />
          <NumberBox label={t("Minutes")} value={duration.minutes} max={59} onCommit={(minutes) => void patch(durationPatch(trigger, { ...duration, minutes }))} />
          <NumberBox label={t("Seconds")} value={duration.seconds} max={59} onCommit={(seconds) => void patch(durationPatch(trigger, { ...duration, seconds }))} />
        </div>
      )}
      {trigger.triggerMode === "interval" ? (
        <label>
          {t("Max executions")}
          <input type="number" min={1} value={trigger.maxExecutions ?? ""} onChange={(event) => void patch({ maxExecutions: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
      ) : null}
    </div>
  );
}

function ActionEditor({
  trigger,
  assets,
  presets,
  onChange
}: {
  trigger: TimeTrigger;
  assets: AssetCatalogItem[];
  presets: EffectPreset[];
  onChange: () => void;
}): React.ReactElement {
  const { t } = useI18n();

  async function add(type: TriggerActionType): Promise<void> {
    await addTimeTriggerAction(trigger.id, { type, name: actionTypes.find((item) => item.value === type)?.label, config: defaultConfig(type) });
    onChange();
  }

  async function patch(action: TriggerAction, patchValue: Parameters<typeof updateTimeTriggerAction>[2]): Promise<void> {
    await updateTimeTriggerAction(trigger.id, action.id, patchValue);
    onChange();
  }

  async function remove(action: TriggerAction): Promise<void> {
    await deleteTimeTriggerAction(trigger.id, action.id);
    onChange();
  }

  return (
    <div>
      <div className="section-heading-row">
        <h3>{t("Actions")}</h3>
        <select defaultValue="" onChange={(event) => event.target.value && void add(event.target.value as TriggerActionType)}>
          <option value="">{t("Add action")}</option>
          {actionTypes.map((item) => (
            <option key={item.value} value={item.value}>
              {t(item.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="time-action-stack">
        {trigger.actions.map((action) => (
          <div className="time-action-card" key={action.id}>
            <div className="button-row">
              <strong>{t(action.type)}</strong>
              <label>
                {t("Delay ms")}
                <input type="number" min={0} defaultValue={action.delayMs} onBlur={(event) => void patch(action, { delayMs: Number(event.target.value) })} />
              </label>
              <button type="button" onClick={() => void remove(action)}>
                {t("Delete")}
              </button>
            </div>
            <ActionConfig action={action} assets={assets} presets={presets} onPatch={(config) => void patch(action, { config })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionConfig({
  action,
  assets,
  presets,
  onPatch
}: {
  action: TriggerAction;
  assets: AssetCatalogItem[];
  presets: EffectPreset[];
  onPatch: (config: Record<string, unknown>) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const config = action.config;
  if (action.type === "show_text") {
    return (
      <label>
        {t("Text")}
        <textarea defaultValue={String(config.text ?? "")} onBlur={(event) => onPatch({ ...config, text: event.target.value })} />
      </label>
    );
  }
  if (action.type === "show_asset" || action.type === "play_audio") {
    const candidates = action.type === "play_audio" ? assets.filter((asset) => asset.kind === "audio") : assets.filter((asset) => asset.kind !== "font");
    return (
      <div className="time-action-config-grid">
        <label>
          {t("Asset")}
          <select value={String(config.assetId ?? "")} onChange={(event) => onPatch({ ...config, assetId: event.target.value })}>
            <option value="">{t("Choose asset")}</option>
            {candidates.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Volume")}
          <input type="number" min={0} max={1} step={0.05} defaultValue={Number(config.volume ?? 0.5)} onBlur={(event) => onPatch({ ...config, volume: Number(event.target.value) })} />
        </label>
      </div>
    );
  }
  if (action.type === "play_scene") {
    return (
      <label>
        {t("Preset")}
        <select value={String(config.presetId ?? "")} onChange={(event) => onPatch({ ...config, presetId: event.target.value })}>
          <option value="">{t("Choose preset")}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return <p className="empty-text">{t("This action only emits the timer event.")}</p>;
}

function NumberBox({ label, value, max, onCommit }: { label: string; value: number; max?: number; onCommit: (value: number) => void }): React.ReactElement {
  return (
    <label>
      {label}
      <input type="number" min={0} max={max} defaultValue={value} onBlur={(event) => onCommit(Number(event.target.value))} />
    </label>
  );
}

function durationParts(ms: number): DurationParts {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  return { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor((totalSeconds % 3600) / 60), seconds: totalSeconds % 60 };
}

function durationMs(parts: DurationParts): number {
  return Math.max(1, parts.hours * 3600 + parts.minutes * 60 + parts.seconds) * 1000;
}

function durationPatch(trigger: TimeTrigger, parts: DurationParts): Partial<TimeTrigger> {
  const ms = durationMs(parts);
  return trigger.triggerMode === "interval" ? { intervalMs: ms } : { durationMs: ms };
}

function timeSummary(trigger: TimeTrigger): string {
  if (trigger.triggerMode === "absolute_datetime") return formatDate(trigger.targetDateTime);
  if (trigger.triggerMode === "daily_time") return trigger.dailyTime ?? "";
  const parts = durationParts(trigger.triggerMode === "interval" ? trigger.intervalMs ?? 0 : trigger.durationMs ?? 0);
  return `${parts.hours}h ${parts.minutes}m ${parts.seconds}s`;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ja-JP");
}

function toDatetimeLocal(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultConfig(type: TriggerActionType): Record<string, unknown> {
  if (type === "show_text") return { text: "Time trigger", durationMs: 3000, targetOverlayId: 1 };
  if (type === "show_asset") return { assetId: "", durationMs: 3000, targetOverlayId: 1 };
  if (type === "play_audio") return { assetId: "", volume: 0.5, durationMs: 3000, targetOverlayId: 1 };
  if (type === "play_scene") return { presetId: "" };
  return {};
}
