import React from "react";
import type { AssetCatalogItem, EffectConfiguration, EffectDefinition, EffectTriggerCondition, GiftCatalogRecord, OverlayId, OverlayStatus } from "@obs-effect/shared-types";
import {
  createEffectConfiguration,
  deleteEffectConfiguration,
  duplicateEffectConfiguration,
  fetchAssets,
  fetchEffectConfigurations,
  fetchEffectDefinitions,
  fetchGifts,
  fetchOverlays,
  fetchSystemFonts,
  setEffectConfigurationEnabled,
  testEffectConfiguration,
  updateEffectConfiguration,
  type EffectConfigurationDraft,
  type SystemFontInfo
} from "../services/httpApi";
import { useI18n } from "../i18n/I18nProvider";
import { useConnectionStore } from "../stores/connectionStore";
import { CoordinatePicker } from "../components/CoordinatePicker";

const triggerOptions: Array<{ value: EffectTriggerCondition["type"]; label: string }> = [
  { value: "manual", label: "Manual only" },
  { value: "comment", label: "Comment" },
  { value: "gift-any", label: "Any gift" },
  { value: "gift-specific", label: "Specific gift" },
  { value: "gift-value", label: "Gift coin value" },
  { value: "follow", label: "Follow" },
  { value: "share", label: "Share" },
  { value: "member-join", label: "Member join" },
  { value: "like-batch", label: "Like batch" }
];

type PitchingTestScenario = "manual" | "same-listener-gifts" | "multiple-listener-gifts" | "new-listener-gift";

function newCondition(type: EffectTriggerCondition["type"]): EffectTriggerCondition {
  if (type === "comment") return { type, keyword: "" };
  if (type === "gift-any") return { type, triggerOn: "streak-end" };
  if (type === "gift-specific") return { type, platform: "tiktok", platformGiftId: "", minimumRepeatCount: 1, triggerOn: "streak-end" };
  if (type === "gift-value") return { type, minimumCoinValue: 1, triggerOn: "streak-end" };
  if (type === "like-batch") return { type, minimumCount: 1 };
  if (type === "external-event") return { type, eventType: "" };
  if (type === "follow") return { type, oncePerUserPerStream: true };
  return { type } as EffectTriggerCondition;
}

function defaultTikTokTrigger(effectDefinitionId: string): EffectConfiguration["trigger"] | undefined {
  if (effectDefinitionId === "gift-combo-text") return { mode: "any", conditions: [{ type: "gift-any", triggerOn: "gift" }] };
  if (["flash", "simple-media", "pitching-machine-ball", "falling-image", "puyo-game"].includes(effectDefinitionId)) return { mode: "any", conditions: [{ type: "gift-any", triggerOn: "streak-end" }] };
  return undefined;
}

function triggerSummary(configuration: EffectConfiguration): string {
  return configuration.trigger.conditions
    .map((condition) => {
      if (condition.type === "comment") return condition.keyword ? `comment includes "${condition.keyword}"` : "any comment";
      if (condition.type === "gift-any") return `any gift (${condition.triggerOn})`;
      if (condition.type === "gift-specific") return `gift ${condition.platformGiftId || "-"} (${condition.triggerOn})`;
      if (condition.type === "gift-value") return `gift coin >= ${condition.minimumCoinValue}`;
      if (condition.type === "like-batch") return `likes >= ${condition.minimumCount}`;
      return condition.type;
    })
    .join(configuration.trigger.mode === "all" ? " + " : " / ");
}

export function EffectsPage(): React.ReactElement {
  const { t } = useI18n();
  const overlays = useConnectionStore((state) => state.overlays);
  const hydrateOverlays = useConnectionStore((state) => state.hydrateOverlays);
  const [definitions, setDefinitions] = React.useState<EffectDefinition[]>([]);
  const [configurations, setConfigurations] = React.useState<EffectConfiguration[]>([]);
  const [assets, setAssets] = React.useState<AssetCatalogItem[]>([]);
  const [gifts, setGifts] = React.useState<GiftCatalogRecord[]>([]);
  const [fonts, setFonts] = React.useState<SystemFontInfo[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const libraryConfigurations = configurations.filter((configuration) => !configuration.presetId && !configuration.presetSlotId);
  const selected = libraryConfigurations.find((configuration) => configuration.id === selectedId) ?? null;
  const effectRows = definitions.map((definition) => ({
    definition,
    configuration: libraryConfigurations.find((configuration) => configuration.effectDefinitionId === definition.id) ?? null
  }));

  const reload = React.useCallback(async (): Promise<void> => {
    const [nextDefinitions, nextConfigurations, nextOverlays, nextAssets, nextGifts, nextFonts] = await Promise.all([
      fetchEffectDefinitions(),
      fetchEffectConfigurations(),
      fetchOverlays(),
      fetchAssets(),
      fetchGifts({ sort: "lastSeenAt", order: "desc", limit: 300 }),
      fetchSystemFonts()
    ]);
    setDefinitions(nextDefinitions);
    setConfigurations(nextConfigurations);
    setAssets(nextAssets);
    setGifts(nextGifts);
    setFonts(nextFonts);
    hydrateOverlays(nextOverlays);
  }, [hydrateOverlays]);

  React.useEffect(() => {
    void reload().catch(() => setMessage(t("Could not load effect configurations")));
  }, [reload, t]);

  async function createConfiguration(effectDefinitionId: string, name?: string): Promise<EffectConfiguration> {
    const definition = definitions.find((item) => item.id === effectDefinitionId);
    const imageAsset = assets.find((asset) => asset.kind === "image");
    const videoAsset = assets.find((asset) => asset.kind === "video");
    const audioAsset = assets.find((asset) => asset.kind === "audio");
    const parameters = Object.fromEntries(definition?.parameterSchema.fields.map((field) => [field.key, field.defaultValue]) ?? []);
    if (effectDefinitionId === "gift-combo-text" && audioAsset?.id) {
      parameters.soundAssetId = audioAsset.id;
    }
    const configuration = await createEffectConfiguration({
      name: name?.trim() || `${definition?.name ?? "Effect"} Configuration`,
      effectDefinitionId,
      targetOverlayId: definition?.defaultOverlayId ?? 1,
      trigger: defaultTikTokTrigger(effectDefinitionId),
      visual: { parameters },
      media:
        effectDefinitionId === "falling-image"
          ? { imageAssetId: imageAsset?.id }
          : effectDefinitionId === "simple-media"
            ? { imageAssetId: imageAsset?.id, videoAssetId: videoAsset?.id, audioAssetId: audioAsset?.id }
            : effectDefinitionId === "pitching-machine-ball"
              ? { imageAssetId: imageAsset?.id, audioAssetId: audioAsset?.id }
              : undefined,
      playback: { durationMs: definition?.defaultDurationMs ?? 650 }
    });
    await reload();
    setMessage(`${definition?.name ?? t("Effect")} ${t("configuration created")}`);
    return configuration;
  }

  async function ensureConfiguration(effectDefinitionId: string): Promise<EffectConfiguration> {
    const existing = libraryConfigurations.find((configuration) => configuration.effectDefinitionId === effectDefinitionId);
    return existing ?? (await createConfiguration(effectDefinitionId));
  }

  async function patchSelected(patch: EffectConfigurationDraft): Promise<void> {
    if (!selected) return;
    const updated = await updateEffectConfiguration(selected.id, patch);
    setConfigurations((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelectedId(updated.id);
    setMessage(t("Saved"));
  }

  async function removeSelected(): Promise<void> {
    if (!selected) return;
    await deleteEffectConfiguration(selected.id);
    setSelectedId(null);
    await reload();
    setMessage(t("Deleted"));
  }

  async function runTest(configuration: EffectConfiguration): Promise<void> {
    await testEffectConfiguration(configuration.id);
    setMessage(`Test sent to Overlay ${configuration.targetOverlayId}`);
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Effects")}</p>
        <h2>{t("Effect Configurations")}</h2>
        <button type="button" onClick={() => setAddOpen((current) => !current)}>
          {t("+ Add Effect")}
        </button>
      </div>

      {addOpen ? (
        <section className="action-panel">
          <div>
            <h3>{t("Add Effect")}</h3>
            <p className="empty-text">{t("Add a Simple Media Effect or an existing programmed effect configuration.")}</p>
          </div>
          <div className="control-row">
            <button
              type="button"
              onClick={async () => {
                const created = await createConfiguration("simple-media", "Simple Media Effect");
                setSelectedId(created.id);
                setAddOpen(false);
              }}
            >
              Simple Media Effect
            </button>
            {definitions
              .filter((definition) => definition.id !== "simple-media")
              .map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  onClick={async () => {
                    const created = await createConfiguration(definition.id);
                    setSelectedId(created.id);
                    setAddOpen(false);
                  }}
                >
                  {definition.name}
                </button>
              ))}
          </div>
        </section>
      ) : null}

      <div className="table-meta">
        <span>{effectRows.length} {t("effects")}</span>
        <span>{message}</span>
      </div>

      <section className="effect-config-list">
        {effectRows.map(({ definition, configuration }) => {
          return (
            <article className="effect-config-row" key={definition.id}>
              <div className="effect-config-main">
                <p className="eyebrow">{definition.kind}</p>
                <h3>{configuration?.name ?? definition.name}</h3>
                <p className="empty-text">
                  {configuration ? `${triggerSummary(configuration)} / ${t("Overlay")} ${configuration.targetOverlayId}` : `${t("not set")} / ${t("Details")}`}
                </p>
              </div>
              <span className={`overlay-status ${configuration?.enabled ? "active" : ""}`}>{configuration ? (configuration.enabled ? t("enabled") : t("disabled")) : t("not set")}</span>
              <div className="effect-config-actions">
                <button
                  type="button"
                  onClick={async () => {
                    const target = await ensureConfiguration(definition.id);
                    await runTest(target);
                  }}
                >
                  {t("Test")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = await ensureConfiguration(definition.id);
                    setSelectedId(target.id);
                  }}
                >
                  {t("Details")}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {effectRows.length === 0 ? <p className="empty-text">{t("No effects available.")}</p> : null}

      {selected ? (
        <EffectDrawer
          configuration={selected}
          definitions={definitions}
          overlays={overlays.length ? overlays : Array.from({ length: 10 }, (_, index) => ({ overlayId: (index + 1) as OverlayId, width: 1920, height: 1080 }))}
          assets={assets}
          gifts={gifts}
          fonts={fonts}
          onClose={() => setSelectedId(null)}
          onPatch={patchSelected}
          onDelete={removeSelected}
          onDuplicate={async () => {
            const duplicate = await duplicateEffectConfiguration(selected.id);
            await reload();
            setSelectedId(duplicate.id);
            setMessage(t("Duplicated"));
          }}
          onToggle={async () => {
            const updated = await setEffectConfigurationEnabled(selected.id, !selected.enabled);
            setConfigurations((items) => items.map((item) => (item.id === updated.id ? updated : item)));
          }}
          onTest={async (pitchingScenario) => {
            await testEffectConfiguration(selected.id, pitchingScenario ? { pitchingScenario } : undefined);
            setMessage(`Test sent to Overlay ${selected.targetOverlayId}`);
          }}
        />
      ) : null}
    </section>
  );
}

interface EffectDrawerProps {
  configuration: EffectConfiguration;
  definitions: EffectDefinition[];
  overlays: Array<Pick<OverlayStatus, "overlayId" | "width" | "height">>;
  assets: AssetCatalogItem[];
  gifts: GiftCatalogRecord[];
  fonts: SystemFontInfo[];
  onClose: () => void;
  onPatch: (patch: EffectConfigurationDraft) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onToggle: () => Promise<void>;
  onTest: (pitchingScenario?: PitchingTestScenario) => Promise<void>;
}

function EffectDrawer(props: EffectDrawerProps): React.ReactElement {
  const { t } = useI18n();
  const { configuration } = props;
  const condition = configuration.trigger.conditions[0] ?? { type: "manual" as const };
  const definition = props.definitions.find((item) => item.id === configuration.effectDefinitionId);
  const imageAssets = props.assets.filter((asset) => asset.kind === "image");
  const audioAssets = props.assets.filter((asset) => asset.kind === "audio");
  const videoAssets = props.assets.filter((asset) => asset.kind === "video");
  const isFallingImage = configuration.effectDefinitionId === "falling-image";
  const isSimpleMedia = configuration.effectDefinitionId === "simple-media";
  const isPitchingMachineBall = configuration.effectDefinitionId === "pitching-machine-ball";
  const isGiftComboText = configuration.effectDefinitionId === "gift-combo-text";
  const selectedOverlay = props.overlays.find((overlay) => overlay.overlayId === configuration.targetOverlayId);

  function patchCondition(next: EffectTriggerCondition): Promise<void> {
    return props.onPatch({ trigger: { mode: configuration.trigger.mode, conditions: [next] } });
  }

  function patchParameter(key: string, value: unknown): Promise<void> {
    return props.onPatch({ visual: { parameters: { ...configuration.visual.parameters, [key]: value } } });
  }

  function parameterNumber(key: string, fallback: number): number {
    const value = configuration.visual.parameters[key];
    return typeof value === "number" ? value : fallback;
  }

  function parameterString(key: string, fallback: string): string {
    const value = configuration.visual.parameters[key];
    return typeof value === "string" ? value : fallback;
  }

  function parameterBoolean(key: string, fallback: boolean): boolean {
    const value = configuration.visual.parameters[key];
    return typeof value === "boolean" ? value : fallback;
  }

  function selectedGiftIds(): string[] {
    return parameterString("giftIdsCsv", "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function patchGiftIds(ids: string[]): Promise<void> {
    return patchParameter("giftIdsCsv", ids.join(","));
  }

  return (
    <aside className="detail-drawer">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">{t("Effect detail")}</p>
          <h3>{configuration.name}</h3>
          <p className="empty-text">{definition?.name ?? configuration.effectDefinitionId}</p>
        </div>
        <button type="button" onClick={props.onClose}>
          {t("Close")}
        </button>
      </div>

      <div className="form-grid">
        <label>
          {t("Name")}
          <input value={configuration.name} onChange={(event) => void props.onPatch({ name: event.target.value })} />
        </label>
        <label>
          {t("Output")}
          <select
            value={configuration.targetOverlayId}
            onChange={(event) => void props.onPatch({ targetOverlayId: Number(event.target.value) as OverlayId })}
          >
            {props.overlays.map((overlay) => (
              <option key={overlay.overlayId} value={overlay.overlayId}>
                {t("Overlay")} {overlay.overlayId}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Trigger")}
          <select value={condition.type} onChange={(event) => void patchCondition(newCondition(event.target.value as EffectTriggerCondition["type"]))}>
            {triggerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        {condition.type === "comment" ? (
          <>
            <label>
              {t("Comment match")}
              <select
                value={condition.matchMode ?? (condition.keyword ? "contains" : "any")}
                onChange={(event) => void patchCondition({ ...condition, matchMode: event.target.value as "any" | "contains" | "equals" })}
              >
                <option value="any">{t("Any comment")}</option>
                <option value="contains">{t("Contains")}</option>
                <option value="equals">{t("Equals")}</option>
              </select>
            </label>
            <label>
              {t("Keyword")}
              <input value={condition.keyword ?? ""} onChange={(event) => void patchCondition({ ...condition, keyword: event.target.value })} />
            </label>
          </>
        ) : null}
        {condition.type === "gift-specific" ? (
          <label>
            {t("TikTok Gift ID")}
            <input
              value={condition.platformGiftId}
              onChange={(event) => void patchCondition({ ...condition, platformGiftId: event.target.value })}
            />
          </label>
        ) : null}
        {condition.type === "gift-value" ? (
          <label>
            {t("Minimum coin")}
            <input
              type="number"
              min="1"
              value={condition.minimumCoinValue}
              onChange={(event) => void patchCondition({ ...condition, minimumCoinValue: Number(event.target.value) })}
            />
          </label>
        ) : null}
        {condition.type === "follow" ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={condition.oncePerUserPerStream ?? false}
              onChange={(event) => void patchCondition({ ...condition, oncePerUserPerStream: event.target.checked })}
            />
            {t("Once per user per live")}
          </label>
        ) : null}
        {"triggerOn" in condition ? (
          <label>
            {t("Gift timing")}
            <select value={condition.triggerOn} onChange={(event) => void patchCondition({ ...condition, triggerOn: event.target.value as "gift" })}>
              <option value="gift">{t("single gift")}</option>
              <option value="streak-start">{t("streak start")}</option>
              <option value="streak-end">{t("streak end")}</option>
            </select>
          </label>
        ) : null}
        <label>
          {t("Duration")}
          <input
            type="number"
            min="50"
            step="50"
            value={configuration.playback.durationMs}
            onChange={(event) => void props.onPatch({ playback: { durationMs: Number(event.target.value) } })}
          />
        </label>
        <label>
          {t("Cooldown")}
          <input
            type="number"
            min="0"
            step="100"
            value={configuration.playback.cooldownMs}
            onChange={(event) => void props.onPatch({ playback: { cooldownMs: Number(event.target.value) } })}
          />
        </label>
        {isSimpleMedia ? (
          <>
            <label>
              {t("Image asset")}
              <select
                value={configuration.media.imageAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, imageAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("None")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Video asset")}
              <select
                value={configuration.media.videoAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, videoAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("None")}</option>
                {videoAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Audio asset")}
              <select
                value={configuration.media.audioAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, audioAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("None")}</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("imageEnabled", true)}
                onChange={(event) => void patchParameter("imageEnabled", event.target.checked)}
              />
              {t("Image enabled")}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("videoEnabled", false)}
                onChange={(event) => void patchParameter("videoEnabled", event.target.checked)}
              />
              {t("Video enabled")}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("audioEnabled", false)}
                onChange={(event) => void patchParameter("audioEnabled", event.target.checked)}
              />
              {t("Audio enabled")}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("textEnabled", false)}
                onChange={(event) => void patchParameter("textEnabled", event.target.checked)}
              />
              {t("Text enabled")}
            </label>
            <label>
              {t("Text")}
              <input value={parameterString("fixedText", "New Effect")} onChange={(event) => void patchParameter("fixedText", event.target.value)} />
            </label>
            <NumberField label={t("Font size")} value={parameterNumber("fontSize", 48)} min={8} max={240} onChange={(value) => patchParameter("fontSize", value)} />
            <label>
              {t("Text color")}
              <input type="color" value={parameterString("textColor", "#ffffff")} onChange={(event) => void patchParameter("textColor", event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("backgroundEnabled", false)}
                onChange={(event) => void patchParameter("backgroundEnabled", event.target.checked)}
              />
              {t("Background enabled")}
            </label>
            <label>
              {t("Background color")}
              <input
                type="color"
                value={parameterString("backgroundColor", "#000000")}
                onChange={(event) => void patchParameter("backgroundColor", event.target.value)}
              />
            </label>
            <NumberField label={t("Background opacity")} value={parameterNumber("backgroundOpacity", 0.4)} min={0} max={1} step={0.05} onChange={(value) => patchParameter("backgroundOpacity", value)} />
            <label>
              {t("Enter transition")}
              <select value={parameterString("enterTransition", "fade")} onChange={(event) => void patchParameter("enterTransition", event.target.value)}>
                <option value="none">{t("None")}</option>
                <option value="fade">{t("Fade")}</option>
                <option value="scale">{t("Scale")}</option>
                <option value="slide-up">{t("Slide up")}</option>
                <option value="slide-down">{t("Slide down")}</option>
                <option value="slide-left">{t("Slide left")}</option>
                <option value="slide-right">{t("Slide right")}</option>
              </select>
            </label>
          </>
        ) : null}
        {isPitchingMachineBall ? (
          <>
            <label>
              {t("Machine asset")}
              <select
                value={configuration.media.imageAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, imageAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("Select image")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Ball asset")}
              <select
                value={parameterString("ballAssetId", "")}
                onChange={(event) => void patchParameter("ballAssetId", event.target.value)}
              >
                <option value="">{t("Use machine asset")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Launch sound")}
              <select
                value={parameterString("launchAudioAssetId", "")}
                onChange={(event) => void patchParameter("launchAudioAssetId", event.target.value)}
              >
                <option value="">{t("None")}</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Impact sound")}
              <select
                value={parameterString("impactAudioAssetId", "")}
                onChange={(event) => void patchParameter("impactAudioAssetId", event.target.value)}
              >
                <option value="">{t("None")}</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <CoordinatePicker
              label={t("Target coordinates")}
              xPercent={parameterNumber("targetXPercent", 50)}
              yPercent={parameterNumber("targetYPercent", 50)}
              overlay={selectedOverlay}
              onChange={(point) =>
                props.onPatch({
                  visual: {
                    parameters: {
                      ...configuration.visual.parameters,
                      targetXPercent: point.xPercent,
                      targetYPercent: point.yPercent
                    }
                  }
                })
              }
            />
            <NumberField label={t("Target radius px")} value={parameterNumber("targetRadiusPx", 72)} min={1} max={400} onChange={(value) => patchParameter("targetRadiusPx", value)} />
            <NumberField label={t("Audio volume")} value={parameterNumber("audioVolume", 0.8)} min={0} max={1} step={0.05} onChange={(value) => patchParameter("audioVolume", value)} />
            <NumberField label={t("Horizontal edge offset px")} value={parameterNumber("horizontalEdgeOffsetPx", 0)} min={-4000} max={4000} step={10} onChange={(value) => patchParameter("horizontalEdgeOffsetPx", value)} />
            <NumberField label={t("Machine scale")} value={parameterNumber("machineScale", 1)} min={0.1} max={5} step={0.05} onChange={(value) => patchParameter("machineScale", value)} />
            <NumberField label={t("Ball scale")} value={parameterNumber("ballScale", 0.7)} min={0.1} max={5} step={0.05} onChange={(value) => patchParameter("ballScale", value)} />
            <NumberField label={t("Machine enter duration ms")} value={parameterNumber("machineEnterDurationMs", 420)} min={0} max={3000} step={50} onChange={(value) => patchParameter("machineEnterDurationMs", value)} />
            <NumberField label={t("Machine exit duration ms")} value={parameterNumber("machineExitDurationMs", 520)} min={0} max={3000} step={50} onChange={(value) => patchParameter("machineExitDurationMs", value)} />
            <NumberField label={t("Gift queue grace ms")} value={parameterNumber("giftQueueGraceMs", 1800)} min={0} max={30000} step={100} onChange={(value) => patchParameter("giftQueueGraceMs", value)} />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("listenerNameEnabled", true)}
                onChange={(event) => void patchParameter("listenerNameEnabled", event.target.checked)}
              />
              {t("Show listener name")}
            </label>
            <NumberField label={t("Delay before launch ms")} value={parameterNumber("delayBeforeLaunchMs", 450)} min={0} max={10000} step={50} onChange={(value) => patchParameter("delayBeforeLaunchMs", value)} />
            <label>
              {t("Trajectory mode")}
              <select value={parameterString("trajectoryMode", "direct")} onChange={(event) => void patchParameter("trajectoryMode", event.target.value)}>
                <option value="direct">{t("Direct")}</option>
                <option value="arc">{t("Arc")}</option>
              </select>
            </label>
            <NumberField label={t("Travel duration ms")} value={parameterNumber("travelDurationMs", 750)} min={50} max={10000} step={50} onChange={(value) => patchParameter("travelDurationMs", value)} />
            <NumberField label={t("Arc height px")} value={parameterNumber("arcHeightPx", 220)} min={-2000} max={2000} step={10} onChange={(value) => patchParameter("arcHeightPx", value)} />
            <NumberField label={t("Balls per trigger")} value={parameterNumber("ballsPerTrigger", 1)} min={1} max={50} onChange={(value) => patchParameter("ballsPerTrigger", value)} />
            <NumberField label={t("Ball interval ms")} value={parameterNumber("intervalBetweenBallsMs", 120)} min={0} max={5000} step={10} onChange={(value) => patchParameter("intervalBetweenBallsMs", value)} />
            <NumberField label={t("Target variation radius px")} value={parameterNumber("targetVariationRadiusPx", 24)} min={0} max={1000} onChange={(value) => patchParameter("targetVariationRadiusPx", value)} />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("impactEnabled", true)}
                onChange={(event) => void patchParameter("impactEnabled", event.target.checked)}
              />
              {t("Impact enabled")}
            </label>
            <NumberField label={t("Impact duration ms")} value={parameterNumber("impactDurationMs", 420)} min={50} max={5000} step={50} onChange={(value) => patchParameter("impactDurationMs", value)} />
            <NumberField label={t("Gravity")} value={parameterNumber("gravity", 3.2)} min={0} max={20} step={0.1} onChange={(value) => patchParameter("gravity", value)} />
            <NumberField label={t("Bounce power")} value={parameterNumber("restitution", 0.58)} min={0} max={1.5} step={0.01} onChange={(value) => patchParameter("restitution", value)} />
            <label>
              {t("Ground collision")}
              <select value={parameterString("groundCollisionMode", "bounce")} onChange={(event) => void patchParameter("groundCollisionMode", event.target.value)}>
                <option value="bounce">{t("Bounce")}</option>
                <option value="pass-through">{t("Pass through")}</option>
              </select>
            </label>
            <NumberField label={t("Ball lifetime ms")} value={parameterNumber("ballLifetimeMs", parameterNumber("postImpactLifetimeMs", 4500))} min={100} max={60000} step={100} onChange={(value) => patchParameter("ballLifetimeMs", value)} />
          </>
        ) : null}
        {isGiftComboText ? (
          <>
            <label>
              {t("Gift target mode")}
              <select value={parameterString("targetMode", "any-gift")} onChange={(event) => void patchParameter("targetMode", event.target.value)}>
                <option value="any-gift">{t("Any gift")}</option>
                <option value="specific-gifts">{t("Specific gifts")}</option>
              </select>
            </label>
            {parameterString("targetMode", "any-gift") === "specific-gifts" ? (
              <div className="gift-combo-picker">
                <div className="button-row">
                  <button type="button" onClick={() => void patchGiftIds([])}>
                    {t("Clear gifts")}
                  </button>
                </div>
                <div className="gift-combo-gift-list">
                  {props.gifts.map((gift) => {
                    const selectedIds = selectedGiftIds();
                    const checked = selectedIds.includes(gift.id) || selectedIds.includes(gift.platformGiftId);
                    return (
                      <label className="gift-combo-gift-row" key={gift.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const next = new Set(selectedIds);
                            if (event.target.checked) next.add(gift.id);
                            else {
                              next.delete(gift.id);
                              next.delete(gift.platformGiftId);
                            }
                            void patchGiftIds([...next]);
                          }}
                        />
                        {gift.image.primaryUrl ? <img src={gift.image.primaryUrl} alt="" /> : <span className="gift-combo-gift-fallback" />}
                        <span>
                          <strong>{gift.name}</strong>
                          <small>
                            {gift.platformGiftId} · {gift.coinValue ?? gift.diamondValue ?? "-"} {t("coins")}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <NumberField label={t("Acceptance duration ms")} value={parameterNumber("acceptanceDurationMs", 3000)} min={100} max={60000} step={100} onChange={(value) => patchParameter("acceptanceDurationMs", value)} />
            <label>
              {t("Count speed mode")}
              <select value={parameterString("countSpeedMode", "accelerating")} onChange={(event) => void patchParameter("countSpeedMode", event.target.value)}>
                <option value="constant">{t("Constant")}</option>
                <option value="accelerating">{t("Accelerating")}</option>
              </select>
            </label>
            <NumberField label={t("Constant adds per second")} value={parameterNumber("constantAddsPerSecond", 20)} min={1} max={10000} onChange={(value) => patchParameter("constantAddsPerSecond", value)} />
            <NumberField label={t("Base adds per second")} value={parameterNumber("acceleratingBaseAddsPerSecond", 16)} min={1} max={10000} onChange={(value) => patchParameter("acceleratingBaseAddsPerSecond", value)} />
            <NumberField label={t("Max adds per second")} value={parameterNumber("acceleratingMaxAddsPerSecond", 420)} min={1} max={20000} onChange={(value) => patchParameter("acceleratingMaxAddsPerSecond", value)} />
            <NumberField label={t("Acceleration strength")} value={parameterNumber("accelerationStrength", 0.01)} min={0.0001} max={1} step={0.001} onChange={(value) => patchParameter("accelerationStrength", value)} />
            <NumberField label={t("Max frame step")} value={parameterNumber("maxFrameStep", 100)} min={1} max={10000} onChange={(value) => patchParameter("maxFrameStep", value)} />
            <label>
              {t("Display language")}
              <select value={parameterString("displayLanguage", "english")} onChange={(event) => void patchParameter("displayLanguage", event.target.value)}>
                <option value="english">{t("English")}</option>
                <option value="japanese">{t("Japanese")}</option>
              </select>
            </label>
            <label>
              {t("Font family")}
              <FontFamilyField
                value={parameterString("fontFamily", "Impact")}
                fonts={props.fonts}
                onChange={(value) => patchParameter("fontFamily", value)}
              />
            </label>
            <NumberField label={t("Font size")} value={parameterNumber("fontSizePx", 96)} min={8} max={360} onChange={(value) => patchParameter("fontSizePx", value)} />
            <NumberField label={t("Font weight")} value={parameterNumber("fontWeight", 900)} min={100} max={900} step={100} onChange={(value) => patchParameter("fontWeight", value)} />
            <NumberField label={t("Letter spacing px")} value={parameterNumber("letterSpacingPx", 0)} min={-20} max={80} onChange={(value) => patchParameter("letterSpacingPx", value)} />
            <label>
              {t("Color mode")}
              <select value={parameterString("colorMode", "solid")} onChange={(event) => void patchParameter("colorMode", event.target.value)}>
                <option value="solid">{t("Solid")}</option>
                <option value="cmy-rainbow-loop">{t("CMY rainbow loop")}</option>
              </select>
            </label>
            <label>
              {t("Text color")}
              <input type="color" value={parameterString("solidColor", "#ffffff")} onChange={(event) => void patchParameter("solidColor", event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={parameterBoolean("strokeEnabled", true)} onChange={(event) => void patchParameter("strokeEnabled", event.target.checked)} />
              {t("Stroke enabled")}
            </label>
            <label>
              {t("Stroke color")}
              <input type="color" value={parameterString("strokeColor", "#000000")} onChange={(event) => void patchParameter("strokeColor", event.target.value)} />
            </label>
            <NumberField label={t("Stroke width px")} value={parameterNumber("strokeWidthPx", 6)} min={0} max={30} onChange={(value) => patchParameter("strokeWidthPx", value)} />
            <NumberField label={t("Stroke opacity")} value={parameterNumber("strokeOpacity", 1)} min={0} max={1} step={0.05} onChange={(value) => patchParameter("strokeOpacity", value)} />
            <section className="combo-sound-settings">
              <div className="combo-sound-header">
                <h3>{t("Combo sound")}</h3>
                <label className="checkbox-row">
                  <input type="checkbox" checked={parameterBoolean("soundEnabled", false)} onChange={(event) => void patchParameter("soundEnabled", event.target.checked)} />
                  {t("Sound enabled")}
                </label>
              </div>
              <div className="combo-sound-grid">
                <label className="combo-sound-asset-field">
                  {t("Sound asset")}
                  <select value={parameterString("soundAssetId", configuration.media.audioAssetId ?? "")} onChange={(event) => void patchParameter("soundAssetId", event.target.value)}>
                    <option value="">{t("None")}</option>
                    {audioAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField label={t("Sound volume")} value={parameterNumber("soundVolume", 0.5)} min={0} max={1} step={0.05} onChange={(value) => patchParameter("soundVolume", value)} />
                <NumberField label={t("Sound interval ms")} value={parameterNumber("minimumSoundIntervalMs", 40)} min={0} max={10000} step={10} onChange={(value) => patchParameter("minimumSoundIntervalMs", value)} />
                <label className="checkbox-row">
                  <input type="checkbox" checked={parameterBoolean("pitchEnabled", true)} onChange={(event) => void patchParameter("pitchEnabled", event.target.checked)} />
                  {t("Pitch enabled")}
                </label>
                <NumberField label={t("Base pitch")} value={parameterNumber("basePlaybackRate", 1)} min={0.1} max={4} step={0.05} onChange={(value) => patchParameter("basePlaybackRate", value)} />
                <NumberField label={t("Max pitch")} value={parameterNumber("maxPlaybackRate", 1.8)} min={0.1} max={4} step={0.05} onChange={(value) => patchParameter("maxPlaybackRate", value)} />
                <NumberField label={t("Pitch curve strength")} value={parameterNumber("pitchCurveStrength", 0.01)} min={0.0001} max={1} step={0.001} onChange={(value) => patchParameter("pitchCurveStrength", value)} />
              </div>
            </section>
          </>
        ) : null}
        {isFallingImage ? (
          <>
            <label>
              {t("Image asset")}
              <select
                value={configuration.media.imageAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, imageAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("Select image")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Audio asset")}
              <select
                value={configuration.media.audioAssetId ?? ""}
                onChange={(event) => void props.onPatch({ media: { ...configuration.media, audioAssetId: event.target.value || undefined } })}
              >
                <option value="">{t("None")}</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Spawn mode")}
              <select value={parameterString("spawnCountMode", "fixed")} onChange={(event) => void patchParameter("spawnCountMode", event.target.value)}>
                <option value="fixed">{t("Fixed")}</option>
                <option value="event-value">{t("Event value")}</option>
                <option value="multiplied">{t("Multiplied")}</option>
              </select>
            </label>
            <NumberField label={t("Fixed count")} value={parameterNumber("fixedCount", 8)} min={1} max={100} onChange={(value) => patchParameter("fixedCount", value)} />
            <NumberField label={t("Multiplier")} value={parameterNumber("multiplier", 1)} min={0.1} max={20} step={0.1} onChange={(value) => patchParameter("multiplier", value)} />
            <NumberField label={t("Min count")} value={parameterNumber("minimumCount", 1)} min={1} max={100} onChange={(value) => patchParameter("minimumCount", value)} />
            <NumberField label={t("Max count")} value={parameterNumber("maximumCount", 40)} min={1} max={200} onChange={(value) => patchParameter("maximumCount", value)} />
            <label>
              {t("Spawn pattern")}
              <select value={parameterString("spawnPattern", "stagger")} onChange={(event) => void patchParameter("spawnPattern", event.target.value)}>
                <option value="burst">{t("Burst")}</option>
                <option value="stagger">{t("Stagger")}</option>
              </select>
            </label>
            <NumberField label={t("Trigger delay ms")} value={parameterNumber("triggerDelayMs", 0)} min={0} max={60000} step={50} onChange={(value) => patchParameter("triggerDelayMs", value)} />
            <NumberField label={t("Object interval ms")} value={parameterNumber("intervalBetweenObjectsMs", 80)} min={0} max={5000} step={10} onChange={(value) => patchParameter("intervalBetweenObjectsMs", value)} />
            <NumberField label={t("Start X min %")} value={parameterNumber("startXMinPercent", 5)} min={0} max={100} onChange={(value) => patchParameter("startXMinPercent", value)} />
            <NumberField label={t("Start X max %")} value={parameterNumber("startXMaxPercent", 95)} min={0} max={100} onChange={(value) => patchParameter("startXMaxPercent", value)} />
            <NumberField label={t("Start Y %")} value={parameterNumber("startYPercent", -10)} min={-100} max={100} onChange={(value) => patchParameter("startYPercent", value)} />
            <NumberField label={t("Gravity")} value={parameterNumber("gravity", 3)} min={0} max={12} step={0.1} onChange={(value) => patchParameter("gravity", value)} />
            <label>
              {t("Floor behavior")}
              <select value={parameterString("floorBehavior", "bounce")} onChange={(event) => void patchParameter("floorBehavior", event.target.value)}>
                <option value="bounce">{t("Bounce on floor")}</option>
                <option value="pass-through">{t("Pass through floor")}</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("objectCollisionEnabled", true)}
                onChange={(event) => void patchParameter("objectCollisionEnabled", event.target.checked)}
              />
              {t("Object collision")}
            </label>
            <NumberField label={t("Bounce power")} value={parameterNumber("bounceRestitution", 0.58)} min={0} max={1} step={0.01} onChange={(value) => patchParameter("bounceRestitution", value)} />
            <NumberField label={t("Floor friction")} value={parameterNumber("floorFriction", 0.82)} min={0} max={1} step={0.01} onChange={(value) => patchParameter("floorFriction", value)} />
            <NumberField label={t("Scale min")} value={parameterNumber("scaleMin", 0.65)} min={0.1} max={5} step={0.05} onChange={(value) => patchParameter("scaleMin", value)} />
            <NumberField label={t("Scale max")} value={parameterNumber("scaleMax", 1.15)} min={0.1} max={5} step={0.05} onChange={(value) => patchParameter("scaleMax", value)} />
            <NumberField label={t("Lifetime ms")} value={parameterNumber("lifetimeMs", 7000)} min={100} max={120000} step={100} onChange={(value) => patchParameter("lifetimeMs", value)} />
            <NumberField label={t("Hit points")} value={parameterNumber("maxHitPoints", 1)} min={1} max={100} onChange={(value) => patchParameter("maxHitPoints", value)} />
            <NumberField label={t("Click damage")} value={parameterNumber("clickDamage", 1)} min={1} max={100} onChange={(value) => patchParameter("clickDamage", value)} />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={parameterBoolean("interactionEnabled", true)}
                onChange={(event) => void patchParameter("interactionEnabled", event.target.checked)}
              />
              {t("Interaction enabled")}
            </label>
          </>
        ) : null}
      </div>

      <div className="drawer-actions">
        <div className="button-row">
          <button type="button" onClick={() => void props.onTest()}>
            {t("Test")}
          </button>
          {isPitchingMachineBall ? (
            <>
              <button type="button" onClick={() => void props.onTest("same-listener-gifts")}>
                {t("Test same listener gifts")}
              </button>
              <button type="button" onClick={() => void props.onTest("multiple-listener-gifts")}>
                {t("Test multiple listeners")}
              </button>
              <button type="button" onClick={() => void props.onTest("new-listener-gift")}>
                {t("Test new listener gift")}
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => void props.onToggle()}>
            {configuration.enabled ? t("Disable") : t("Enable")}
          </button>
          <button type="button" onClick={() => void props.onDuplicate()}>
            {t("Duplicate")}
          </button>
          <button type="button" onClick={() => void props.onDelete()}>
            {t("Delete")}
          </button>
        </div>
        <pre className="json-block">{JSON.stringify(configuration, null, 2)}</pre>
      </div>
    </aside>
  );
}

const recommendedFontFamilies = ["Impact", "Arial", "Segoe UI", "Yu Gothic", "Meiryo", "BIZ UDPGothic", "Noto Sans JP", "sans-serif"];

function FontFamilyField(props: { value: string; fonts: SystemFontInfo[]; onChange: (value: string) => Promise<void> }): React.ReactElement {
  const { t } = useI18n();
  const { localFonts, systemFamilies, options } = React.useMemo(() => {
    const localFontList = props.fonts
      .filter((font) => font.source === "asset")
      .sort((left, right) => left.family.localeCompare(right.family, "ja-JP", { sensitivity: "base" }));
    const localFamilyKeys = new Set(localFontList.map((font) => font.family.toLocaleLowerCase("ja-JP")));
    const systemFamilyList = [...new Set([...recommendedFontFamilies, ...props.fonts.filter((font) => font.source === "system").map((font) => font.family)])]
      .filter((family) => !localFamilyKeys.has(family.toLocaleLowerCase("ja-JP")))
      .sort((left, right) => left.localeCompare(right, "ja-JP", { sensitivity: "base" }));
    return {
      localFonts: localFontList,
      systemFamilies: systemFamilyList,
      options: [...localFontList.map((font) => font.family), ...systemFamilyList]
    };
  }, [props.fonts]);
  const isKnown = options.includes(props.value);
  const [customValue, setCustomValue] = React.useState(props.value);

  React.useEffect(() => {
    setCustomValue(props.value);
  }, [props.value]);

  async function commitCustom(): Promise<void> {
    const next = customValue.trim();
    if (next && next !== props.value) await props.onChange(next);
  }

  return (
    <div className="font-family-field">
      <select value={isKnown ? props.value : "__custom"} onChange={(event) => void props.onChange(event.target.value === "__custom" ? customValue : event.target.value)}>
        {localFonts.length > 0 ? (
          <optgroup label={t("Local fonts")}>
            {localFonts.map((font) => (
              <option key={`local-${font.id}`} value={font.family} style={{ fontFamily: font.family }}>
                {font.family}
              </option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label={t("System fonts")}>
          {systemFamilies.map((family) => (
            <option key={family} value={family} style={{ fontFamily: family }}>
              {family}
            </option>
          ))}
        </optgroup>
        <option value="__custom">{t("Custom font")}</option>
      </select>
      <input
        value={customValue}
        placeholder={t("Enter font name")}
        onChange={(event) => setCustomValue(event.target.value)}
        onBlur={() => void commitCustom()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commitCustom();
        }}
      />
      <span className="font-family-preview" style={{ fontFamily: customValue || props.value }}>
        {t("Font preview")}
      </span>
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => Promise<void>;
}): React.ReactElement {
  return (
    <label>
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => void props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
