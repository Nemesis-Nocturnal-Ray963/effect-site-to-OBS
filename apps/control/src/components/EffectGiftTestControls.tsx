import React from "react";
import type { GiftCatalogRecord } from "@obs-effect/shared-types";
import type { EffectTestOptions } from "../services/httpApi";
import { useI18n } from "../i18n/I18nProvider";

function giftCoinValue(gift: GiftCatalogRecord): number | null {
  return gift.coinValue ?? gift.diamondValue;
}

export function EffectGiftTestControls(props: {
  gifts: GiftCatalogRecord[];
  onTest: (options: EffectTestOptions) => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const [giftId, setGiftId] = React.useState("");
  const [coinValue, setCoinValue] = React.useState(1);
  const selectedGift = props.gifts.find((gift) => gift.platformGiftId === giftId);
  const coinMatchedGift = props.gifts.find((gift) => giftCoinValue(gift) === coinValue);
  const testGift = selectedGift ?? coinMatchedGift;

  return (
    <div className="effect-gift-test-controls">
      <label>
        {t("Test gift")}
        <select
          value={giftId}
          onChange={(event) => {
            const nextId = event.target.value;
            setGiftId(nextId);
            const gift = props.gifts.find((item) => item.platformGiftId === nextId);
            const value = gift ? giftCoinValue(gift) : null;
            if (value !== null) setCoinValue(value);
          }}
        >
          <option value="">{t("Match gift by coin value")}</option>
          {props.gifts.map((gift) => (
            <option key={gift.id} value={gift.platformGiftId}>
              {gift.name} · {giftCoinValue(gift) ?? "-"} {t("coins")}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Test coin value")}
        <input
          type="number"
          min="0"
          max="1000000"
          step="1"
          value={coinValue}
          onChange={(event) => {
            setCoinValue(Math.max(0, Math.min(1_000_000, Number(event.target.value) || 0)));
            setGiftId("");
          }}
        />
      </label>
      <span className="empty-text">
        {testGift
          ? `${t("Acts as")} ${testGift.name}`
          : t("Uses a virtual gift with this coin value")}
      </span>
      <button
        type="button"
        onClick={() =>
          void props.onTest({
            gift: {
              platformGiftId: testGift?.platformGiftId,
              name: testGift?.name,
              coinValue,
              imageUrl: testGift?.image.primaryUrl
            }
          })
        }
      >
        {t("Test with gift")}
      </button>
    </div>
  );
}
