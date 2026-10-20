import React from "react";
import type { AssetCatalogItem } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";

interface CoinImageRule {
  minCoinValue: number;
  maxCoinValue: number;
  sizePx: number | null;
  useCustomImage: boolean;
  assetId: string;
  imageUrl: string;
}

export function GiftPileCoinRulesEditor(props: {
  assets: AssetCatalogItem[];
  value: unknown;
  onChange: (value: string) => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const rules = parseCoinImageRules(props.value);
  const images = props.assets.filter((asset) => asset.kind === "image");

  function save(next: CoinImageRule[]): void {
    void props.onChange(JSON.stringify(next));
  }

  return (
    <section className="gift-pile-overrides coin-image-rules">
      <div>
        <strong>{t("Coin-range sizes and images")}</strong>
        <p className="empty-text">
          {t("Set a size for each inclusive coin range. Gift-specific sizes take priority; overlapping ranges use the first matching size condition.")}
        </p>
      </div>
      {rules.map((rule, index) => (
        <div className="gift-pile-override-row" key={index}>
          <label>
            {t("Minimum coin (inclusive)")}
            <DeferredCoinInput
              value={rule.minCoinValue}
              onCommit={(minCoinValue) =>
                save(
                  rules.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, minCoinValue, maxCoinValue: Math.max(minCoinValue, item.maxCoinValue) }
                      : item
                  )
                )
              }
            />
          </label>
          <label>
            {t("Maximum coin (inclusive)")}
            <DeferredCoinInput
              value={rule.maxCoinValue}
              onCommit={(maxCoinValue) => save(rules.map((item, itemIndex) =>
                itemIndex === index ? { ...item, maxCoinValue, minCoinValue: Math.min(item.minCoinValue, maxCoinValue) } : item
              ))}
            />
          </label>
          <label>
            {t("Size (px, blank uses default)")}
            <DeferredOptionalSizeInput
              value={rule.sizePx ?? ""}
              placeholder={t("Default")}
              onCommit={(value) =>
                save(
                  rules.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          sizePx: value === null ? null : clampSize(value)
                        }
                      : item
                  )
                )
              }
            />
          </label>
          <div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rule.useCustomImage}
                onChange={(event) =>
                  save(
                    rules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, useCustomImage: event.target.checked } : item
                    )
                  )
                }
              />
              {t("Use specified image")}
            </label>
            {rule.useCustomImage ? (
              <label>
                {t("Gift image")}
                <select
                  value={rule.assetId}
                  onChange={(event) => {
                    const asset = images.find((item) => item.id === event.target.value);
                    save(
                      rules.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, assetId: asset?.id ?? "", imageUrl: asset?.contentUrl ?? "" }
                          : item
                      )
                    );
                  }}
                >
                  <option value="">{t("Choose image")}</option>
                  {images.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => save(rules.filter((_, itemIndex) => itemIndex !== index))}
          >
            {t("Delete")}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const minCoinValue = rules.length ? clampCoin(rules[rules.length - 1]!.maxCoinValue + 1) : 0;
          const maxCoinValue = rules.length ? clampCoin(minCoinValue + 99) : 100;
          save([
            ...rules,
            { minCoinValue, maxCoinValue, sizePx: 88, useCustomImage: false, assetId: "", imageUrl: "" }
          ]);
        }}
      >
        {t("Add coin range condition")}
      </button>
      {images.length === 0 && rules.some((rule) => rule.useCustomImage) ? (
        <p className="empty-text">{t("Add an image to Assets first.")}</p>
      ) : null}
    </section>
  );
}

export function parseCoinImageRules(value: unknown): CoinImageRule[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const hasRange = candidate.minCoinValue !== undefined || candidate.maxCoinValue !== undefined;
      const min = hasRange ? candidate.minCoinValue : candidate.coinValue;
      const max = hasRange ? candidate.maxCoinValue : candidate.coinValue;
      if (typeof min !== "number" || !Number.isFinite(min) || typeof max !== "number" || !Number.isFinite(max) || min < 0 || max < min) return [];
      return [
        {
          minCoinValue: clampCoin(min),
          maxCoinValue: clampCoin(max),
          sizePx:
            typeof candidate.sizePx === "number" && Number.isFinite(candidate.sizePx)
              ? clampSize(candidate.sizePx)
              : null,
          useCustomImage:
            typeof candidate.useCustomImage === "boolean" ? candidate.useCustomImage : true,
          assetId: typeof candidate.assetId === "string" ? candidate.assetId : "",
          imageUrl: typeof candidate.imageUrl === "string" ? candidate.imageUrl : ""
        }
      ];
    });
  } catch {
    return [];
  }
}

function clampCoin(value: number): number {
  return Math.round(Math.max(0, Math.min(1_000_000, Number.isFinite(value) ? value : 0)));
}

function clampSize(value: number): number {
  return Math.round(Math.max(16, Number.isFinite(value) ? value : 44));
}

function DeferredCoinInput(props: { value: number; onCommit: (value: number) => void }): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.value));
  React.useEffect(() => setDraft(String(props.value)), [props.value]);
  function commit(): void {
    const value = Number(draft);
    if (!draft.trim() || !Number.isFinite(value)) {
      setDraft(String(props.value));
      return;
    }
    const normalized = clampCoin(value);
    setDraft(String(normalized));
    if (normalized !== props.value) props.onCommit(normalized);
  }
  return <input type="number" min="0" max="1000000" step="1" value={draft}
    onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function DeferredOptionalSizeInput(props: {
  value: number | "";
  placeholder: string;
  onCommit: (value: number | null) => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.value));

  React.useEffect(() => setDraft(String(props.value)), [props.value]);

  function commit(): void {
    if (draft.trim() === "") {
      props.onCommit(null);
      return;
    }
    const value = Number(draft);
    props.onCommit(Number.isFinite(value) ? value : null);
  }

  return (
    <input
      type="number"
      step="1"
      value={draft}
      placeholder={props.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
