import React from "react";
import { GiftPileControls } from "../components/GiftPileControls";
import { GiftPileOverridesEditor } from "../components/GiftPileOverridesEditor";
import { GiftPileCoinRulesEditor } from "../components/GiftPileCoinRulesEditor";
import type {
  AssetCatalogItem,
  EffectConfiguration,
  EffectDefinition,
  EffectPreset,
  EffectPresetSlot,
  EffectTriggerCondition,
  GiftCatalogRecord,
  OverlayId,
  OverlayStatus
} from "@obs-effect/shared-types";
import {
  addPresetSlot,
  createPreset,
  deletePreset,
  deletePresetSlot,
  fetchAssets,
  fetchEffectDefinitions,
  fetchEffectConfigurations,
  fetchGifts,
  fetchOverlays,
  fetchPresets,
  fetchSystemFonts,
  savePreset,
  selectPreset,
  testPreset,
  updatePreset,
  updatePresetSlot,
  type EffectPresetSlotDraft,
  type SystemFontInfo
} from "../services/httpApi";
import { useI18n } from "../i18n/I18nProvider";
import { CoordinatePicker } from "../components/CoordinatePicker";
import { MediaAssetPoolEditor } from "../components/MediaAssetPoolEditor";

const triggerOptions: Array<{ value: EffectTriggerCondition["type"]; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "comment", label: "Comment" },
  { value: "gift-any", label: "Any gift" },
  { value: "gift-specific", label: "Specific gift" },
  { value: "gift-value", label: "Gift value" },
  { value: "follow", label: "Follow" },
  { value: "share", label: "Share" },
  { value: "member-join", label: "Member join" },
  { value: "like-batch", label: "Like batch" }
];

const pitchingCustomParameterKeys = new Set(["ballAssetId", "launchAudioAssetId", "impactAudioAssetId", "audioVolume", "targetXPercent", "targetYPercent"]);
const ballRevealCustomParameterKeys = new Set(["ballAssetId", "mediaAssetIdsCsv", "targetXPercent", "targetYPercent"]);
const giftComboSoundParameterKeys = new Set([
  "soundEnabled",
  "soundAssetId",
  "soundVolume",
  "minimumSoundIntervalMs",
  "pitchEnabled",
  "basePlaybackRate",
  "maxPlaybackRate",
  "pitchCurveStrength"
]);

export function PresetsPage(): React.ReactElement {
  const { t } = useI18n();
  const [presets, setPresets] = React.useState<EffectPreset[]>([]);
  const [definitions, setDefinitions] = React.useState<EffectDefinition[]>([]);
  const [libraryConfigurations, setLibraryConfigurations] = React.useState<EffectConfiguration[]>([]);
  const [activePresetIds, setActivePresetIds] = React.useState<Set<string>>(new Set());
  const [assets, setAssets] = React.useState<AssetCatalogItem[]>([]);
  const [gifts, setGifts] = React.useState<GiftCatalogRecord[]>([]);
  const [fonts, setFonts] = React.useState<SystemFontInfo[]>([]);
  const [overlays, setOverlays] = React.useState<Array<Pick<OverlayStatus, "overlayId" | "width" | "height">>>([]);
  const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0] ?? null;
  const selectedSlot = selectedPreset?.slots.find((slot) => slot.id === selectedSlotId) ?? selectedPreset?.slots[0] ?? null;
  const selectedPresetInUse = selectedPreset ? activePresetIds.has(selectedPreset.id) : false;

  const reload = React.useCallback(async (): Promise<void> => {
    const [nextPresets, nextDefinitions, nextConfigurations, nextAssets, nextOverlays, nextGifts, nextFonts] = await Promise.all([
      fetchPresets(),
      fetchEffectDefinitions(),
      fetchEffectConfigurations(),
      fetchAssets(),
      fetchOverlays(),
      fetchGifts({ sort: "lastSeenAt", order: "desc", limit: 300 }),
      fetchSystemFonts()
    ]);
    setPresets(nextPresets);
    setDefinitions(nextDefinitions);
    setLibraryConfigurations(nextConfigurations.filter((configuration) => !configuration.presetId && !configuration.presetSlotId));
    setActivePresetIds(new Set(nextPresets.filter((preset) => preset.enabled).map((preset) => preset.id)));
    setAssets(nextAssets);
    setOverlays(nextOverlays);
    setGifts(nextGifts);
    setFonts(nextFonts);
    setSelectedPresetId((current) => current ?? nextPresets[0]?.id ?? null);
  }, []);

  React.useEffect(() => {
    void reload().catch(() => setMessage(t("Could not load presets")));
  }, [reload, t]);

  async function handleCreatePreset(): Promise<void> {
    const preset = await createPreset({ name: `${t("Presets")} ${presets.length + 1}`, enabled: false });
    await reload();
    setSelectedPresetId(preset.id);
    setSelectedSlotId(null);
    setMessage(t("Preset created"));
  }

  async function handleAddBlankSlot(): Promise<void> {
    if (!selectedPreset) return;
    const slot = await addPresetSlot(selectedPreset.id);
    await reload();
    setSelectedPresetId(selectedPreset.id);
    setSelectedSlotId(slot.id);
    setMessage(t("Blank effect added"));
  }

  async function handleSavePreset(): Promise<void> {
    if (!selectedPreset) return;
    try {
      const result = await savePreset(selectedPreset.id);
      await reload();
      setSelectedPresetId(selectedPreset.id);
      setMessage(`${t("Preset saved")}: ${result.configurationCount} ${t("active effects")}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not save preset"));
    }
  }

  async function handleUsePreset(): Promise<void> {
    if (!selectedPreset) return;
    try {
      for (const preset of presets) {
        if (preset.id === selectedPreset.id) continue;
        if (preset.enabled || activePresetIds.has(preset.id)) {
          await updatePreset(preset.id, { enabled: false });
          await savePreset(preset.id);
        }
      }
      if (!selectedPreset.enabled) {
        await updatePreset(selectedPreset.id, { enabled: true });
      }
      const result = await savePreset(selectedPreset.id);
      await selectPreset(selectedPreset.id);
      await reload();
      setSelectedPresetId(selectedPreset.id);
      setSelectedSlotId(selectedPreset.slots[0]?.id ?? null);
      setMessage(`${t("Preset is now in use")}: ${result.configurationCount} ${t("active effects")}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Could not save preset"));
    }
  }

  async function handleSelectPreset(preset: EffectPreset): Promise<void> {
    setSelectedPresetId(preset.id);
    setSelectedSlotId(preset.slots[0]?.id ?? null);
    setPresets((current) => [preset, ...current.filter((item) => item.id !== preset.id)]);
    try {
      await selectPreset(preset.id);
    } catch {
      setMessage(t("Could not reorder preset"));
    }
  }

  async function patchPreset(patch: Partial<Pick<EffectPreset, "name" | "description" | "enabled">>): Promise<void> {
    if (!selectedPreset) return;
    await updatePreset(selectedPreset.id, patch);
    await reload();
    setSelectedPresetId(selectedPreset.id);
    setMessage(t("Preset saved"));
  }

  async function patchSlot(patch: EffectPresetSlotDraft): Promise<void> {
    if (!selectedPreset || !selectedSlot) return;
    await updatePresetSlot(selectedPreset.id, selectedSlot.id, patch);
    await reload();
    setSelectedPresetId(selectedPreset.id);
    setSelectedSlotId(selectedSlot.id);
    setMessage(t("Effect saved"));
  }

  async function removePreset(): Promise<void> {
    if (!selectedPreset) return;
    await deletePreset(selectedPreset.id);
    setSelectedPresetId(null);
    setSelectedSlotId(null);
    await reload();
    setMessage(t("Preset deleted"));
  }

  async function removeSlot(): Promise<void> {
    if (!selectedPreset || !selectedSlot) return;
    await deletePresetSlot(selectedPreset.id, selectedSlot.id);
    setSelectedSlotId(null);
    await reload();
    setSelectedPresetId(selectedPreset.id);
    setMessage(t("Effect removed"));
  }

  return (
    <section className="page-stack">
      <div className="page-heading preset-page-heading">
        <div>
          <p className="eyebrow">{t("Presets")}</p>
          <h2>{t("Preset Builder")}</h2>
        </div>
        <div className="preset-heading-actions">
          <button type="button" onClick={() => void handleCreatePreset()}>
            {t("+ New Preset")}
          </button>
          <button type="button" onClick={() => void handleSavePreset()} disabled={!selectedPreset}>
            {t("Save")}
          </button>
        </div>
      </div>

      <div className="table-meta">
        <span>{presets.length} {t("presets")}</span>
        <span>{message}</span>
      </div>

      <section className="preset-layout">
        <aside className="panel preset-list">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-list-item ${preset.id === selectedPreset?.id ? "selected" : ""}`}
              onClick={() => void handleSelectPreset(preset)}
            >
              <strong>{preset.name}</strong>
              <span>{activePresetIds.has(preset.id) ? t("Using") : `${preset.slots.length} ${t("effects")}`}</span>
            </button>
          ))}
          {presets.length === 0 ? <p className="empty-text">{t("Create a preset to start.")}</p> : null}
        </aside>

        {selectedPreset ? (
          <section className="page-stack">
            <div className="action-panel">
              <div>
                <button type="button" className={`preset-use-button ${selectedPresetInUse ? "active" : ""}`} onClick={() => void handleUsePreset()}>
                  {selectedPresetInUse ? t("Using") : t("Use preset")}
                </button>
                <h3>{selectedPreset.name}</h3>
                <p className="empty-text">{selectedPreset.description || t("Build a reusable set of effect slots.")}</p>
              </div>
              <div className="control-row">
                <button type="button" onClick={() => void handleAddBlankSlot()}>
                  {t("+ Blank Effect")}
                </button>
                <button type="button" onClick={() => void removePreset()}>
                  {t("Delete")}
                </button>
              </div>
            </div>

            <div className="preset-editor">
              <section className="panel preset-slots">
                <div className="form-grid preset-meta-form">
                  <label>
                    {t("Preset name")}
                    <DeferredTextInput value={selectedPreset.name} onCommit={(value) => patchPreset({ name: value })} />
                  </label>
                  <label>
                    {t("Description")}
                    <DeferredTextInput value={selectedPreset.description ?? ""} onCommit={(value) => patchPreset({ description: value })} />
                  </label>
                </div>

                <div className="effect-config-list">
                  {selectedPreset.slots.map((slot) => {
                    const definition = definitions.find((item) => item.id === slot.effectDefinitionId);
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        className={`preset-slot-row ${slot.id === selectedSlot?.id ? "selected" : ""}`}
                        onClick={() => setSelectedSlotId(slot.id)}
                      >
                        <span>
                          <strong>{slot.name}</strong>
                          <small>{definition?.name ?? t("Blank effect")}</small>
                        </span>
                        <span className={`overlay-status ${slot.enabled ? "active" : ""}`}>{slot.enabled ? t("enabled") : t("disabled")}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {selectedSlot ? (
                <SlotEditor
                  slot={selectedSlot}
                  definitions={definitions}
                  libraryConfigurations={libraryConfigurations}
                  assets={assets}
                  gifts={gifts}
                  fonts={fonts}
                  overlays={overlays.length ? overlays : Array.from({ length: 10 }, (_, index) => ({ overlayId: (index + 1) as OverlayId, width: 1920, height: 1080 }))}
                  onPatch={patchSlot}
                  onDelete={removeSlot}
                />
              ) : (
                <section className="panel">
                  <p className="empty-text">{t("Add a blank effect, then choose an effect type and settings.")}</p>
                </section>
              )}
            </div>
            <PresetTestPanel
              preset={selectedPreset}
              gifts={gifts}
              onMessage={setMessage}
            />
          </section>
        ) : null}
      </section>
    </section>
  );
}

function PresetTestPanel(props: {
  preset: EffectPreset;
  gifts: GiftCatalogRecord[];
  onMessage: (message: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [selectedGiftId, setSelectedGiftId] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<"lastSeenAt" | "coinValueAsc" | "coinValueDesc" | "name">("lastSeenAt");
  const [minimumCoin, setMinimumCoin] = React.useState("");
  const selectedGift = props.gifts.find((gift) => gift.platformGiftId === selectedGiftId);
  const filteredGifts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    const minimum = minimumCoin === "" ? null : Number(minimumCoin);
    return [...props.gifts]
      .filter((gift) => {
        const coin = giftCoinValue(gift);
        if (minimum !== null && (!Number.isFinite(minimum) || coin === null || coin < minimum)) return false;
        return !query || [gift.name, gift.platformGiftId, ...gift.aliases].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name);
        if (sort === "coinValueAsc") return (giftCoinValue(left) ?? Number.MAX_SAFE_INTEGER) - (giftCoinValue(right) ?? Number.MAX_SAFE_INTEGER);
        if (sort === "coinValueDesc") return (giftCoinValue(right) ?? -1) - (giftCoinValue(left) ?? -1);
        return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
      });
  }, [minimumCoin, props.gifts, search, sort]);

  async function runTest(): Promise<void> {
    if (!selectedGift) return;
    try {
      const result = await testPreset(props.preset.id, {
        platformGiftId: selectedGift.platformGiftId,
        name: selectedGift.name,
        coinValue: giftCoinValue(selectedGift) ?? 0,
        imageUrl: selectedGift.image.primaryUrl
      });
      props.onMessage(`${t("Preset test sent")}: ${result.testedEffectCount} ${t("effects")}`);
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : t("Preset test failed"));
    }
  }

  return (
    <section className="panel preset-test-panel">
      <div>
        <p className="eyebrow">{t("Test details")}</p>
        <h3>{t("Preset effect test")}</h3>
        <p className="empty-text">{t("Choose a gift and test every enabled effect in this preset.")}</p>
      </div>
      <div className={`preset-selected-gift ${selectedGift ? "" : "empty"}`}>
        {selectedGift ? (
          <><GiftImage gift={selectedGift} /><span><strong>{selectedGift.name}</strong><small>{t("Gift ID")} {selectedGift.platformGiftId} / {t("Coin")} {giftCoinText(selectedGift)}</small></span></>
        ) : <span><strong>{t("No recorded gift selected")}</strong><small>{t("Choose a gift from the gift picker.")}</small></span>}
      </div>
      <div className="button-row">
        <button type="button" onClick={() => setPickerOpen(true)}>{t("Choose recorded gift")}</button>
        <button type="button" disabled={!selectedGift} onClick={() => void runTest()}>{t("Test preset with gift")}</button>
      </div>
      {pickerOpen ? (
        <div className="preset-gift-picker-backdrop" role="dialog" aria-modal="true" aria-label={t("Choose recorded gift")}>
          <section className="panel preset-gift-picker">
            <div className="drawer-header"><div><p className="eyebrow">{t("Gift picker")}</p><h3>{t("Choose recorded gift")}</h3></div><button type="button" onClick={() => setPickerOpen(false)}>{t("Close")}</button></div>
            <div className="preset-gift-picker-toolbar">
              <label>{t("Search")}<input value={search} placeholder={t("name or gift id")} onChange={(event) => setSearch(event.target.value)} /></label>
              <label>{t("Sort")}<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="lastSeenAt">{t("Last Seen")}</option><option value="coinValueDesc">{t("Coin high to low")}</option><option value="coinValueAsc">{t("Coin low to high")}</option><option value="name">{t("Name")}</option></select></label>
              <label>{t("Minimum coin")}<input type="number" min="0" value={minimumCoin} onChange={(event) => setMinimumCoin(event.target.value)} /></label>
            </div>
            <div className="preset-gift-picker-meta"><span>{filteredGifts.length} {t("gifts")}</span></div>
            {filteredGifts.length === 0 ? <p className="empty-text">{t("No gifts recorded yet.")}</p> : (
              <div className="preset-gift-tile-grid">
                {filteredGifts.map((gift) => (
                  <button key={gift.id} type="button" className={`preset-gift-tile ${gift.platformGiftId === selectedGiftId ? "selected" : ""}`} onClick={() => { setSelectedGiftId(gift.platformGiftId); setPickerOpen(false); }}>
                    <GiftImage gift={gift} /><strong>{gift.name}</strong><span>{t("Coin")} {giftCoinText(gift)}</span><small>ID {gift.platformGiftId}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SlotEditor(props: {
  slot: EffectPresetSlot;
  definitions: EffectDefinition[];
  libraryConfigurations: EffectConfiguration[];
  assets: AssetCatalogItem[];
  gifts: GiftCatalogRecord[];
  fonts: SystemFontInfo[];
  overlays: Array<Pick<OverlayStatus, "overlayId" | "width" | "height">>;
  onPatch: (patch: EffectPresetSlotDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const definition = props.definitions.find((item) => item.id === props.slot.effectDefinitionId);
  const condition = props.slot.trigger.conditions[0] ?? { type: "manual" as const };
  const imageAssets = props.assets.filter((asset) => asset.kind === "image");
  const videoAssets = props.assets.filter((asset) => asset.kind === "video");
  const audioAssets = props.assets.filter((asset) => asset.kind === "audio");
  const isPitchingMachineBall = props.slot.effectDefinitionId === "pitching-machine-ball";
  const isBallReveal = props.slot.effectDefinitionId === "ball-reveal";
  const isGiftComboText = props.slot.effectDefinitionId === "gift-combo-text";
  const isGiftPile = props.slot.effectDefinitionId === "gift-pile";
  const selectedOverlay = props.overlays.find((overlay) => overlay.overlayId === props.slot.targetOverlayId);
  const [giftPickerOpen, setGiftPickerOpen] = React.useState(false);
  const [giftSearch, setGiftSearch] = React.useState("");
  const [giftSort, setGiftSort] = React.useState<"lastSeenAt" | "coinValueAsc" | "coinValueDesc" | "name">("lastSeenAt");
  const [giftMinCoin, setGiftMinCoin] = React.useState("");
  const selectedGift = condition.type === "gift-specific"
    ? props.gifts.find((gift) => gift.platformGiftId === condition.platformGiftId)
    : null;
  const filteredGifts = React.useMemo(() => {
    const query = giftSearch.trim().toLowerCase();
    const minimumCoin = giftMinCoin === "" ? null : Number(giftMinCoin);
    return props.gifts
      .filter((gift) => {
        const coin = giftCoinValue(gift);
        if (minimumCoin !== null && (!Number.isFinite(minimumCoin) || coin === null || coin < minimumCoin)) return false;
        if (!query) return true;
        return [gift.name, gift.platformGiftId, ...gift.aliases].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (giftSort === "name") return left.name.localeCompare(right.name);
        if (giftSort === "coinValueAsc") return (giftCoinValue(left) ?? Number.MAX_SAFE_INTEGER) - (giftCoinValue(right) ?? Number.MAX_SAFE_INTEGER);
        if (giftSort === "coinValueDesc") return (giftCoinValue(right) ?? -1) - (giftCoinValue(left) ?? -1);
        return new Date(right.lastSeenAt ?? right.firstSeenAt ?? 0).getTime() - new Date(left.lastSeenAt ?? left.firstSeenAt ?? 0).getTime();
      });
  }, [giftMinCoin, giftSearch, giftSort, props.gifts]);

  function patchParameter(key: string, value: unknown): Promise<void> {
    return props.onPatch({ visual: { parameters: { ...props.slot.visual.parameters, [key]: value } } });
  }

  function patchCondition(next: EffectTriggerCondition): Promise<void> {
    return props.onPatch({ trigger: { ...props.slot.trigger, conditions: [next] } });
  }

  function patchEffectDefinition(effectDefinitionId: string): Promise<void> {
    const nextDefinition = props.definitions.find((item) => item.id === effectDefinitionId);
    const libraryConfiguration = props.libraryConfigurations.find((configuration) => configuration.effectDefinitionId === effectDefinitionId);
    if (!effectDefinitionId) {
      return props.onPatch({
        effectDefinitionId: undefined,
        name: t("Blank effect")
      });
    }
    return props.onPatch({
      effectDefinitionId,
      name: nextDefinition?.name ?? props.slot.name,
      targetOverlayId: libraryConfiguration?.targetOverlayId ?? nextDefinition?.defaultOverlayId ?? props.slot.targetOverlayId,
      trigger: normalizePresetEffectTrigger(effectDefinitionId, libraryConfiguration?.trigger),
      visual: libraryConfiguration?.visual ?? {
        ...props.slot.visual,
        parameters: Object.fromEntries(nextDefinition?.parameterSchema.fields.map((field) => [field.key, field.defaultValue]) ?? [])
      },
      media: libraryConfiguration?.media ?? {},
      playback: libraryConfiguration?.playback ?? { ...props.slot.playback, durationMs: nextDefinition?.defaultDurationMs ?? props.slot.playback.durationMs }
    });
  }

  return (
    <section className="panel preset-slot-detail">
      {props.slot.effectDefinitionId === "gift-pile" ? <GiftPileControls overlayId={props.slot.targetOverlayId} /> : null}
      <div className="drawer-header">
        <div>
          <p className="eyebrow">{t("Preset Effect")}</p>
          <h3>{props.slot.name}</h3>
        </div>
        <button type="button" onClick={() => void props.onDelete()}>
          {t("Delete")}
        </button>
      </div>

      <div className="form-grid">
        <label>
          {t("Slot name")}
          <DeferredTextInput value={props.slot.name} onCommit={(value) => props.onPatch({ name: value })} />
        </label>
        <label>
          {t("Effect")}
          <select
            value={props.slot.effectDefinitionId ?? ""}
            onChange={(event) => void patchEffectDefinition(event.target.value)}
          >
            <option value="">{t("Blank")}</option>
            {props.definitions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Overlay")}
          <select value={props.slot.targetOverlayId} onChange={(event) => void props.onPatch({ targetOverlayId: Number(event.target.value) as OverlayId })}>
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
          <label>
            {t("Keyword")}
            <input value={condition.keyword ?? ""} onChange={(event) => void patchCondition({ ...condition, keyword: event.target.value })} />
          </label>
        ) : null}
        {condition.type === "like-batch" ? (
          <NumberField label={t("Like count")} value={condition.minimumCount} min={1} onChange={(value) => patchCondition({ ...condition, minimumCount: value })} />
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
        {condition.type === "gift-specific" ? (
          <>
            <section className="preset-gift-field">
              <span>{t("Recorded gift")}</span>
              <div className={`preset-selected-gift ${selectedGift ? "" : "empty"}`}>
                {selectedGift ? (
                  <>
                    <GiftImage gift={selectedGift} />
                    <span>
                      <strong>{selectedGift.name}</strong>
                      <small>
                        {t("Gift ID")} {selectedGift.platformGiftId} / {t("Coin")} {giftCoinText(selectedGift)}
                      </small>
                    </span>
                  </>
                ) : (
                  <span>
                    <strong>{condition.platformGiftId || t("No recorded gift selected")}</strong>
                    <small>{t("Choose a recorded gift or enter an ID manually.")}</small>
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setGiftPickerOpen(true)}>
                {t("Choose recorded gift")}
              </button>
            </section>
            <label>
              {t("Gift ID")}
              <input
                value={condition.platformGiftId}
                placeholder={t("Enter gift ID manually")}
                onChange={(event) => void patchCondition({ ...condition, platformGiftId: event.target.value })}
              />
            </label>
            {giftPickerOpen ? (
              <div className="preset-gift-picker-backdrop" role="dialog" aria-modal="true" aria-label={t("Choose recorded gift")}>
                <section className="panel preset-gift-picker">
                  <div className="drawer-header">
                    <div>
                      <p className="eyebrow">{t("Recorded gift")}</p>
                      <h3>{t("Choose recorded gift")}</h3>
                    </div>
                    <button type="button" onClick={() => setGiftPickerOpen(false)}>
                      {t("Close")}
                    </button>
                  </div>
                  <div className="preset-gift-picker-toolbar">
                    <label>
                      {t("Search")}
                      <input value={giftSearch} placeholder={t("name or gift id")} onChange={(event) => setGiftSearch(event.target.value)} />
                    </label>
                    <label>
                      {t("Sort")}
                      <select value={giftSort} onChange={(event) => setGiftSort(event.target.value as typeof giftSort)}>
                        <option value="lastSeenAt">{t("Last Seen")}</option>
                        <option value="coinValueDesc">{t("Coin high to low")}</option>
                        <option value="coinValueAsc">{t("Coin low to high")}</option>
                        <option value="name">{t("Name")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Minimum coin")}
                      <input type="number" min="0" value={giftMinCoin} onChange={(event) => setGiftMinCoin(event.target.value)} />
                    </label>
                  </div>
                  <div className="preset-gift-picker-meta">
                    <span>
                      {filteredGifts.length} {t("gifts")}
                    </span>
                    <span>{condition.platformGiftId ? `${t("Selected")}: ${condition.platformGiftId}` : t("No gift selected")}</span>
                  </div>
                  {filteredGifts.length === 0 ? (
                    <p className="empty-text">{t("No gifts recorded yet.")}</p>
                  ) : (
                    <div className="preset-gift-tile-grid">
                      {filteredGifts.map((gift) => (
                        <button
                          key={gift.id}
                          type="button"
                          className={`preset-gift-tile ${gift.platformGiftId === condition.platformGiftId ? "selected" : ""}`}
                          onClick={() => {
                            void patchCondition({ ...condition, platformGiftId: gift.platformGiftId });
                            setGiftPickerOpen(false);
                          }}
                        >
                          <GiftImage gift={gift} />
                          <strong>{gift.name}</strong>
                          <span>{t("Coin")} {giftCoinText(gift)}</span>
                          <small>ID {gift.platformGiftId}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </>
        ) : null}
        {condition.type === "gift-value" ? (
          <NumberField
            label={t("Minimum coin")}
            value={condition.minimumCoinValue}
            min={1}
            onChange={(value) => patchCondition({ ...condition, minimumCoinValue: value })}
          />
        ) : null}
        <NumberField
          label={t("Duration ms")}
          value={props.slot.playback.durationMs}
          min={50}
          step={50}
          onChange={(value) => props.onPatch({ playback: { durationMs: value } })}
        />
        <NumberField
          label={t("Start delay ms")}
          value={props.slot.playback.startDelayMs}
          min={0}
          step={50}
          onChange={(value) => props.onPatch({ playback: { startDelayMs: value } })}
        />
        <NumberField
          label={t("Cooldown ms")}
          value={props.slot.playback.cooldownMs}
          min={0}
          step={100}
          onChange={(value) => props.onPatch({ playback: { cooldownMs: value } })}
        />
        <NumberField
          label={t("Max concurrent")}
          value={props.slot.playback.maxConcurrent}
          min={1}
          onChange={(value) => props.onPatch({ playback: { maxConcurrent: value } })}
        />
        <NumberField
          label={t("Opacity")}
          value={props.slot.visual.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => props.onPatch({ visual: { opacity: value } })}
        />
        <NumberField label={t("Z index")} value={props.slot.visual.zIndex} min={0} onChange={(value) => props.onPatch({ visual: { zIndex: value } })} />
        <NumberField
          label={t("Scale")}
          value={props.slot.visual.size.scale ?? 1}
          min={0.1}
          step={0.05}
          onChange={(value) => props.onPatch({ visual: { size: { ...props.slot.visual.size, scale: value } } })}
        />
        <label>
          {t("Position anchor")}
          <select
            value={props.slot.visual.position.anchor}
            onChange={(event) =>
              void props.onPatch({ visual: { position: { ...props.slot.visual.position, anchor: event.target.value as EffectPresetSlot["visual"]["position"]["anchor"] } } })
            }
          >
            <option value="top-left">{t("Top left")}</option>
            <option value="top-center">{t("Top center")}</option>
            <option value="top-right">{t("Top right")}</option>
            <option value="center-left">{t("Center left")}</option>
            <option value="center">{t("Center")}</option>
            <option value="center-right">{t("Center right")}</option>
            <option value="bottom-left">{t("Bottom left")}</option>
            <option value="bottom-center">{t("Bottom center")}</option>
            <option value="bottom-right">{t("Bottom right")}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={props.slot.enabled} onChange={(event) => void props.onPatch({ enabled: event.target.checked })} />
          {t("Enabled")}
        </label>
        {isBallReveal ? (
          <>
            <MediaAssetPoolEditor
              assets={props.assets}
              selectedIds={String(props.slot.visual.parameters.mediaAssetIdsCsv ?? "").split(",").map((item) => item.trim()).filter(Boolean)}
              title={t("Random image / video list")}
              onChange={(ids) => patchParameter("mediaAssetIdsCsv", ids.join(","))}
            />
            <label className="preset-asset-field">
              {t("Ball asset")}
              <select value={String(props.slot.visual.parameters.ballAssetId ?? "")} onChange={(event) => void patchParameter("ballAssetId", event.target.value)}>
                <option value="">{t("Use bundled ball image")}</option>
                {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </label>
            <CoordinatePicker
              label={t("Reveal center")}
              xPercent={numberParameter(props.slot.visual.parameters.targetXPercent, 50)}
              yPercent={numberParameter(props.slot.visual.parameters.targetYPercent, 50)}
              overlay={selectedOverlay}
              onChange={(point) => props.onPatch({ visual: { parameters: { ...props.slot.visual.parameters, targetXPercent: point.xPercent, targetYPercent: point.yPercent } } })}
            />
          </>
        ) : null}
        {definition?.supportsImage && !isBallReveal ? (
          <label className="preset-asset-field">
            {isPitchingMachineBall ? t("Machine asset") : t("Image asset")}
            <select value={props.slot.media.imageAssetId ?? ""} onChange={(event) => void props.onPatch({ media: { ...props.slot.media, imageAssetId: event.target.value || undefined } })}>
              <option value="">{t("None")}</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {definition?.supportsVideo && !isBallReveal ? (
          <label className="preset-asset-field">
            {t("Video asset")}
            <select value={props.slot.media.videoAssetId ?? ""} onChange={(event) => void props.onPatch({ media: { ...props.slot.media, videoAssetId: event.target.value || undefined } })}>
              <option value="">{t("None")}</option>
              {videoAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {definition?.supportsAudio && !isPitchingMachineBall && !isGiftComboText ? (
          <label className="preset-asset-field">
            {t("Audio asset")}
            <select value={props.slot.media.audioAssetId ?? ""} onChange={(event) => void props.onPatch({ media: { ...props.slot.media, audioAssetId: event.target.value || undefined } })}>
              <option value="">{t("None")}</option>
              {audioAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isPitchingMachineBall ? (
          <>
            <label className="preset-asset-field">
              {t("Ball asset")}
              <select
                value={String(props.slot.visual.parameters.ballAssetId ?? "")}
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
            <label className="preset-asset-field">
              {t("Launch sound")}
              <select
                value={String(props.slot.visual.parameters.launchAudioAssetId ?? "")}
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
            <label className="preset-asset-field">
              {t("Impact sound")}
              <select
                value={String(props.slot.visual.parameters.impactAudioAssetId ?? "")}
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
              xPercent={numberParameter(props.slot.visual.parameters.targetXPercent, 50)}
              yPercent={numberParameter(props.slot.visual.parameters.targetYPercent, 50)}
              overlay={selectedOverlay}
              onChange={(point) =>
                props.onPatch({
                  visual: {
                    parameters: {
                      ...props.slot.visual.parameters,
                      targetXPercent: point.xPercent,
                      targetYPercent: point.yPercent
                    }
                  }
                })
              }
            />
            <NumberField
              label={t("Audio volume")}
              value={numberParameter(props.slot.visual.parameters.audioVolume, 0.8)}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => patchParameter("audioVolume", value)}
            />
          </>
        ) : null}
      </div>

      {isGiftComboText ? (
        <section className="combo-sound-settings">
          <div className="combo-sound-header">
            <h3>{t("Combo sound")}</h3>
            <label className="checkbox-row">
              <input type="checkbox" checked={Boolean(props.slot.visual.parameters.soundEnabled)} onChange={(event) => void patchParameter("soundEnabled", event.target.checked)} />
              {t("Sound enabled")}
            </label>
          </div>
          <div className="combo-sound-grid">
            <label className="combo-sound-asset-field">
              {t("Sound asset")}
              <select value={String(props.slot.visual.parameters.soundAssetId ?? props.slot.media.audioAssetId ?? "")} onChange={(event) => void patchParameter("soundAssetId", event.target.value)}>
                <option value="">{t("None")}</option>
                {audioAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label={t("Sound volume")} value={numberParameter(props.slot.visual.parameters.soundVolume, 0.5)} min={0} max={1} step={0.05} onChange={(value) => patchParameter("soundVolume", value)} />
            <NumberField label={t("Sound interval ms")} value={numberParameter(props.slot.visual.parameters.minimumSoundIntervalMs, 40)} min={0} max={10000} step={10} onChange={(value) => patchParameter("minimumSoundIntervalMs", value)} />
            <label className="checkbox-row">
              <input type="checkbox" checked={props.slot.visual.parameters.pitchEnabled !== false} onChange={(event) => void patchParameter("pitchEnabled", event.target.checked)} />
              {t("Pitch enabled")}
            </label>
            <NumberField label={t("Base pitch")} value={numberParameter(props.slot.visual.parameters.basePlaybackRate, 1)} min={0.1} max={4} step={0.05} onChange={(value) => patchParameter("basePlaybackRate", value)} />
            <NumberField label={t("Max pitch")} value={numberParameter(props.slot.visual.parameters.maxPlaybackRate, 1.8)} min={0.1} max={4} step={0.05} onChange={(value) => patchParameter("maxPlaybackRate", value)} />
            <NumberField label={t("Pitch curve strength")} value={numberParameter(props.slot.visual.parameters.pitchCurveStrength, 0.01)} min={0.0001} max={1} step={0.001} onChange={(value) => patchParameter("pitchCurveStrength", value)} />
          </div>
        </section>
      ) : null}

      {definition ? (
        <section className="preset-parameters">
          <h3>{t("Effect parameters")}</h3>
          {isGiftPile ? (
            <>
              <GiftPileOverridesEditor
                gifts={props.gifts}
                value={props.slot.visual.parameters.giftSizeOverridesJson}
                onChange={(value) => patchParameter("giftSizeOverridesJson", value)}
              />
              <GiftPileCoinRulesEditor
                assets={props.assets}
                value={props.slot.visual.parameters.coinImageRulesJson}
                onChange={(value) => patchParameter("coinImageRulesJson", value)}
              />
            </>
          ) : null}
          <div className="form-grid">
            {definition.parameterSchema.fields
              .filter((field) => !isPitchingMachineBall || !pitchingCustomParameterKeys.has(field.key))
              .filter((field) => !isBallReveal || !ballRevealCustomParameterKeys.has(field.key))
              .filter((field) => !isGiftComboText || !giftComboSoundParameterKeys.has(field.key))
              .filter((field) => !isGiftPile || field.key !== "giftSizeOverridesJson")
              .filter((field) => !isGiftPile || field.key !== "coinImageRulesJson")
              .map((field) => (
              <ParameterField
                key={field.key}
                field={field}
                value={props.slot.visual.parameters[field.key] ?? field.defaultValue}
                fonts={props.fonts}
                onChange={(value) => patchParameter(field.key, value)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function numberParameter(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ParameterField(props: {
  field: EffectDefinition["parameterSchema"]["fields"][number];
  value: unknown;
  fonts: SystemFontInfo[];
  onChange: (value: unknown) => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const label = t(props.field.label);
  if (props.field.type === "boolean") {
    return (
      <label className="checkbox-row">
        <input type="checkbox" checked={Boolean(props.value)} onChange={(event) => void props.onChange(event.target.checked)} />
        {label}
      </label>
    );
  }
  if (props.field.type === "number") {
    return (
      <NumberField
        label={label}
        value={typeof props.value === "number" ? props.value : Number(props.field.defaultValue ?? 0)}
        min={props.field.min}
        max={props.field.max}
        step={props.field.step}
        onChange={props.onChange}
      />
    );
  }
  if (props.field.type === "color") {
    return (
      <label>
        {label}
        <input type="color" value={String(props.value ?? props.field.defaultValue ?? "#ffffff")} onChange={(event) => void props.onChange(event.target.value)} />
      </label>
    );
  }
  if (props.field.type === "select") {
    return (
      <label>
        {label}
        <select value={String(props.value ?? props.field.defaultValue ?? "")} onChange={(event) => void props.onChange(event.target.value)}>
          {props.field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (props.field.key === "fontFamily") {
    return (
      <label>
        {label}
        <FontFamilyField
          value={String(props.value ?? props.field.defaultValue ?? "Impact")}
          fonts={props.fonts}
          onChange={(value) => props.onChange(value)}
        />
      </label>
    );
  }
  return (
    <label>
      {label}
      <input value={String(props.value ?? "")} onChange={(event) => void props.onChange(event.target.value)} />
    </label>
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

function GiftImage({ gift }: { gift: GiftCatalogRecord }): React.ReactElement {
  return (
    <span className="preset-gift-image">
      {gift.image.primaryUrl ? <img src={gift.image.primaryUrl} alt="" loading="lazy" /> : <span>No image</span>}
    </span>
  );
}

function giftCoinValue(gift: GiftCatalogRecord): number | null {
  return gift.coinValue ?? gift.diamondValue;
}

function giftCoinText(gift: GiftCatalogRecord): string {
  const value = giftCoinValue(gift);
  return value === null ? "-" : String(value);
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

function DeferredTextInput(props: { value: string; onCommit: (value: string) => Promise<void> }): React.ReactElement {
  const [draft, setDraft] = React.useState(props.value);
  const composingRef = React.useRef(false);

  React.useEffect(() => {
    if (!composingRef.current) setDraft(props.value);
  }, [props.value]);

  async function commit(): Promise<void> {
    const next = draft.trim();
    if (next !== props.value) await props.onCommit(next);
  }

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        setDraft(event.currentTarget.value);
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function newCondition(type: EffectTriggerCondition["type"]): EffectTriggerCondition {
  if (type === "comment") return { type, keyword: "", matchMode: "contains" };
  if (type === "gift-any") return { type, triggerOn: "streak-end" };
  if (type === "gift-specific") return { type, platform: "tiktok", platformGiftId: "", minimumRepeatCount: 1, triggerOn: "streak-end" };
  if (type === "gift-value") return { type, minimumCoinValue: 1, triggerOn: "streak-end" };
  if (type === "like-batch") return { type, minimumCount: 1 };
  if (type === "external-event") return { type, eventType: "" };
  if (type === "follow") return { type, oncePerUserPerStream: true };
  return { type } as EffectTriggerCondition;
}

function normalizePresetEffectTrigger(effectDefinitionId: string, trigger: EffectConfiguration["trigger"] | undefined): EffectConfiguration["trigger"] {
  if (!usesTikTokGiftTrigger(effectDefinitionId)) return trigger ?? { mode: "any", conditions: [{ type: "manual" }] };
  const hasTikTokGiftCondition = trigger?.conditions.some((condition) =>
    condition.type === "gift-any" || condition.type === "gift-specific" || condition.type === "gift-value"
  );
  if (trigger && hasTikTokGiftCondition) return trigger;
  return {
    mode: "any",
    conditions: [{ type: "gift-any", triggerOn: ["gift-combo-text", "gift-pile"].includes(effectDefinitionId ?? "") ? "gift" : "streak-end" }]
  };
}

function usesTikTokGiftTrigger(effectDefinitionId: string | undefined): boolean {
  return !!effectDefinitionId && ["flash", "simple-media", "ball-reveal", "gift-combo-text", "pitching-machine-ball", "falling-image", "puyo-game", "gift-pile"].includes(effectDefinitionId);
}
