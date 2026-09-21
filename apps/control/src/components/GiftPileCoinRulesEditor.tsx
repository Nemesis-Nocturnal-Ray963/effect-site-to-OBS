import React from "react";
import type { AssetCatalogItem } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";

interface CoinImageRule {
  coinValue: number;
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
        <strong>{t("Coin-specific gift images")}</strong>
        <p className="empty-text">
          {t("For each coin value, choose whether to replace the received gift image.")}
        </p>
      </div>
      {rules.map((rule, index) => (
        <div className="gift-pile-override-row" key={`${rule.coinValue}-${index}`}>
          <label>
            {t("Coin")}
            <input
              type="number"
              min="0"
              max="1000000"
              value={rule.coinValue}
              onChange={(event) =>
                save(
                  rules.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, coinValue: clampCoin(Number(event.target.value)) }
                      : item
                  )
                )
              }
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
        onClick={() =>
          save([
            ...rules,
            { coinValue: 1, sizePx: null, useCustomImage: false, assetId: "", imageUrl: "" }
          ])
        }
      >
        {t("Add coin rule")}
      </button>
      {images.length === 0 ? (
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
      if (typeof candidate.coinValue !== "number" || !Number.isFinite(candidate.coinValue))
        return [];
      return [
        {
          coinValue: clampCoin(candidate.coinValue),
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
