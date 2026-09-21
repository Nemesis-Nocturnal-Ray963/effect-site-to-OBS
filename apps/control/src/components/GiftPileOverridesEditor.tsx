import React from "react";
import type { GiftCatalogRecord } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";

interface GiftSizeOverride {
  giftId: string;
  sizePx: number;
}

export function GiftPileOverridesEditor(props: {
  gifts: GiftCatalogRecord[];
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

  function save(next: GiftSizeOverride[]): void {
    void props.onChange(JSON.stringify(next));
  }

  return (
    <section className="gift-pile-overrides gift-size-overrides">
      <div>
        <strong>{t("Gift-specific sizes")}</strong>
        <p className="empty-text">{t("Override the default object size for selected gifts.")}</p>
      </div>
      {overrides.map((override, index) => {
        const gift = props.gifts.find((item) => item.platformGiftId === override.giftId);
        return (
          <div className="gift-pile-override-row" key={`${override.giftId}-${index}`}>
            <div className="gift-pile-override-gift">
              {gift?.image.primaryUrl ? <img src={gift.image.primaryUrl} alt="" /> : null}
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
                  save(overrides.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, sizePx: clampSize(value) } : item
                  ))
                }
              />
            </label>
            <button
              type="button"
              onClick={() => save(overrides.filter((_, itemIndex) => itemIndex !== index))}
            >
              {t("Delete")}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={available.length === 0}
        onClick={() => {
          const gift = available[0];
          if (gift) save([...overrides, { giftId: gift.platformGiftId, sizePx: 88 }]);
        }}
      >
        {t("Add gift size rule")}
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
                      save(
                        overrides.map((item, itemIndex) =>
                          itemIndex === pickerIndex
                            ? { ...item, giftId: gift.platformGiftId }
                            : item
                        )
                      );
                      setPickerIndex(null);
                    }}
                  >
                    <span className="gift-tile-image">
                      {gift.image.primaryUrl ? (
                        <img src={gift.image.primaryUrl} alt="" loading="lazy" />
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
      unique.set(giftId, { giftId, sizePx: clampSize(candidate.sizePx) });
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
