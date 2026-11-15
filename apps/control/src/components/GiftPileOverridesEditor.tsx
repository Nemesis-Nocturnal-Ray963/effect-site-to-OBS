import React from "react";
import type { AssetCatalogItem, GiftCatalogRecord } from "@obs-effect/shared-types";
import { giftImageSrc } from "../services/giftImages";
import { useI18n } from "../i18n/I18nProvider";
import { MediaAssetPoolEditor } from "./MediaAssetPoolEditor";

interface GiftSizeOverride {
  giftId: string;
  giftName?: string;
  sizePx: number;
  useCustomImage: boolean;
  assetIds: string[];
  imageUrls: string[];
}

export function GiftPileOverridesEditor(props: {
  gifts: GiftCatalogRecord[];
  assets: AssetCatalogItem[];
  value: unknown;
  onChange: (value: string) => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const overrides = parseGiftSizeOverrides(props.value);
  const [pickerIndex, setPickerIndex] = React.useState<number | null>(null);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<"lastSeenAt" | "coinValueAsc" | "coinValueDesc" | "name">(
    "lastSeenAt"
  );
  const [minimumCoin, setMinimumCoin] = React.useState("");
  const available = props.gifts.filter(
    (gift) => !overrides.some((override) => override.giftId === gift.platformGiftId)
  );
  const pickerGiftId = pickerIndex === null ? "" : (overrides[pickerIndex]?.giftId ?? "");
  const pickerGifts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    const minimum = minimumCoin === "" ? null : Number(minimumCoin);
    return props.gifts
      .filter(
        (gift) =>
          gift.platformGiftId === pickerGiftId ||
          !overrides.some((item) => item.giftId === gift.platformGiftId)
      )
      .filter((gift) => {
        const coin = gift.coinValue ?? gift.diamondValue;
        if (minimum !== null && (!Number.isFinite(minimum) || coin === null || coin < minimum))
          return false;
        return (
          !query ||
          [gift.name, gift.platformGiftId, ...gift.aliases].some((value) =>
            value.toLowerCase().includes(query)
          )
        );
      })
      .sort((left, right) => {
        const leftCoin = left.coinValue ?? left.diamondValue;
        const rightCoin = right.coinValue ?? right.diamondValue;
        if (sort === "name") return left.name.localeCompare(right.name);
        if (sort === "coinValueAsc")
          return (leftCoin ?? Number.MAX_SAFE_INTEGER) - (rightCoin ?? Number.MAX_SAFE_INTEGER);
        if (sort === "coinValueDesc") return (rightCoin ?? -1) - (leftCoin ?? -1);
        return new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime();
      });
  }, [minimumCoin, overrides, pickerGiftId, props.gifts, search, sort]);

  function save(next: GiftSizeOverride[]): Promise<void> {
    return props.onChange(JSON.stringify(next));
  }

  return (
    <section className="gift-pile-overrides gift-size-overrides">
      <div className="gift-random-image-intro">
        <strong>{t("Gift-specific random images")}</strong>
        <p className="empty-text">
          {t("Choose a gift and register multiple images. One image is selected at random each time that gift appears on the overlay.")}
        </p>
      </div>
      {overrides.map((override, index) => {
        const gift = props.gifts.find((item) => item.platformGiftId === override.giftId);
        return (
          <div className="gift-pile-override-row" key={`${override.giftId}-${index}`}>
            <div className="gift-pile-override-gift">
              {gift?.image.primaryUrl ? <img src={giftImageSrc(gift)} alt="" loading="lazy" /> : null}
              <span>
                <strong>{gift?.name ?? override.giftId}</strong>
                <small>
                  ID {override.giftId} / {t("Coin")} {gift?.coinValue ?? gift?.diamondValue ?? "-"}
                </small>
                <button type="button" onClick={() => setPickerIndex(index)}>
                  {t("Choose recorded gift")}
                </button>
              </span>
            </div>
            <label>
              {t("Size (px)")}
              <DeferredSizeInput
                value={override.sizePx}
                onCommit={(value) =>
                  void save(overrides.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, sizePx: clampSize(value) } : item
                  ))
                }
              />
            </label>
            <button className="gift-rule-delete"
              type="button"
              onClick={() => void save(overrides.filter((_, itemIndex) => itemIndex !== index))}
            >
              {t("Delete")}
            </button>
            <div className="gift-rule-image-settings">
              <strong>{t("Random image display")}</strong>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={override.useCustomImage}
                  onChange={(event) => void save(overrides.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, useCustomImage: event.target.checked } : item
                  ))}
                />
                {t("Show a random registered image for this gift")}
              </label>
              {override.useCustomImage ? (
                <MediaAssetPoolEditor
                  assets={props.assets}
                  kinds={["image"]}
                  selectedIds={override.assetIds}
                  title={t("Images displayed at random")}
                  summary={`${override.assetIds.length} ${t("images / one is chosen at random per gift")}`}
                  emptyMessage={t("Add images to randomly choose one for this gift.")}
                  onChange={(assetIds) => save(overrides.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          assetIds,
                          imageUrls: assetIds.flatMap((assetId) => {
                            const asset = props.assets.find((candidate) => candidate.id === assetId && candidate.kind === "image");
                            return asset ? [asset.contentUrl] : [];
                          })
                        }
                      : item
                  ))}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        disabled={available.length === 0}
        onClick={() => {
          const gift = available[0];
          if (gift) {
            const nextIndex = overrides.length;
            void save([...overrides, {
              giftId: gift.platformGiftId,
              giftName: gift.matchName ?? gift.name,
              sizePx: 88,
              useCustomImage: true,
              assetIds: [],
              imageUrls: []
            }]);
            setPickerIndex(nextIndex);
          }
        }}
      >
        {t("Add gift random image setting")}
      </button>
      {props.gifts.length === 0 ? (
        <p className="empty-text">{t("No gifts recorded yet.")}</p>
      ) : null}
      {pickerIndex !== null ? (
        <div
          className="preset-gift-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("Choose recorded gift")}
        >
          <section className="panel preset-gift-picker">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">{t("Gift picker")}</p>
                <h3>{t("Choose recorded gift")}</h3>
              </div>
              <button type="button" onClick={() => setPickerIndex(null)}>
                {t("Close")}
              </button>
            </div>
            <div className="preset-gift-picker-toolbar">
              <label>
                {t("Search")}
                <input
                  value={search}
                  placeholder={t("name or gift id")}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                {t("Sort")}
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                >
                  <option value="lastSeenAt">{t("Last Seen")}</option>
                  <option value="coinValueDesc">{t("Coin high to low")}</option>
                  <option value="coinValueAsc">{t("Coin low to high")}</option>
                  <option value="name">{t("Name")}</option>
                </select>
              </label>
              <label>
                {t("Minimum coin")}
                <input
                  type="number"
                  min="0"
                  value={minimumCoin}
                  onChange={(event) => setMinimumCoin(event.target.value)}
                />
              </label>
            </div>
            <div className="preset-gift-picker-meta">
              <span>
                {pickerGifts.length} {t("gifts")}
              </span>
            </div>
            {pickerGifts.length === 0 ? (
              <p className="empty-text">{t("No gifts recorded yet.")}</p>
            ) : (
              <div className="preset-gift-tile-grid">
                {pickerGifts.map((gift) => (
                  <button
                    key={gift.id}
                    type="button"
                    className={`preset-gift-tile ${gift.platformGiftId === pickerGiftId ? "selected" : ""}`}
                    onClick={() => {
                      void save(
                        overrides.map((item, itemIndex) =>
                          itemIndex === pickerIndex
                            ? { ...item, giftId: gift.platformGiftId, giftName: gift.matchName ?? gift.name }
                            : item
                        )
                      );
                      setPickerIndex(null);
                    }}
                  >
                    <span className="gift-tile-image">
                      {gift.image.primaryUrl ? (
                        <img src={giftImageSrc(gift)} alt="" loading="lazy" />
                      ) : (
                        <span>{t("No image")}</span>
                      )}
                    </span>
                    <strong>{gift.name}</strong>
                    <span>
                      {t("Coin")} {gift.coinValue ?? gift.diamondValue ?? "-"}
                    </span>
                    <small>ID {gift.platformGiftId}</small>
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

export function parseGiftSizeOverrides(value: unknown): GiftSizeOverride[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, GiftSizeOverride>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      const giftId = typeof candidate.giftId === "string" ? candidate.giftId.trim() : "";
      if (!giftId || typeof candidate.sizePx !== "number" || !Number.isFinite(candidate.sizePx))
        continue;
      const assetIds = Array.isArray(candidate.assetIds)
        ? candidate.assetIds.filter((value): value is string => typeof value === "string" && value.length > 0)
        : typeof candidate.assetId === "string" && candidate.assetId ? [candidate.assetId] : [];
      const imageUrls = Array.isArray(candidate.imageUrls)
        ? candidate.imageUrls.filter((value): value is string => typeof value === "string" && value.length > 0)
        : typeof candidate.imageUrl === "string" && candidate.imageUrl ? [candidate.imageUrl] : [];
      unique.set(giftId, {
        giftId,
        giftName: typeof candidate.giftName === "string" ? candidate.giftName : undefined,
        sizePx: clampSize(candidate.sizePx),
        useCustomImage: typeof candidate.useCustomImage === "boolean"
          ? candidate.useCustomImage
          : assetIds.length > 0 || imageUrls.length > 0,
        assetIds,
        imageUrls
      });
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function clampSize(value: number): number {
  return Math.round(Math.max(16, Number.isFinite(value) ? value : 88));
}

function DeferredSizeInput(props: { value: number; onCommit: (value: number) => void }): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.value));

  React.useEffect(() => setDraft(String(props.value)), [props.value]);

  function commit(): void {
    const value = Number(draft);
    props.onCommit(Number.isFinite(value) ? value : props.value);
  }

  return (
    <input
      type="number"
      step="1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
