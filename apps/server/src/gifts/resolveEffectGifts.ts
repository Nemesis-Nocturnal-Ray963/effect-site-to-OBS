import type { EffectConfiguration, GiftCatalogRecord } from "@obs-effect/shared-types";
import { samePlatformGiftId } from "./giftAliases.js";

/** Resolve current catalog names for both new selections and existing ID-only settings. */
export function resolveEffectGifts(configuration: EffectConfiguration, gifts: GiftCatalogRecord[]): EffectConfiguration {
  const find = (id: string, catalogId?: string) => gifts.find((gift) =>
    gift.id === catalogId || gift.id === id || samePlatformGiftId(gift.platform, gift.platformGiftId, id)
  );
  const parameters = { ...configuration.visual.parameters };
  const ids = typeof parameters.giftIdsCsv === "string" ? parameters.giftIdsCsv.split(",").map((id) => id.trim()).filter(Boolean) : [];
  let selections: Array<{ giftId: string; giftName?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(String(parameters.giftSelectionsJson ?? "[]"));
    if (Array.isArray(parsed)) selections = parsed.filter((item) => item && typeof item.giftId === "string");
  } catch { /* Retain legacy ID selections. */ }
  parameters.giftSelectionsJson = JSON.stringify(ids.map((giftId) => {
    const gift = find(giftId);
    return { giftId, giftName: gift?.matchName ?? selections.find((item) => item.giftId === giftId)?.giftName };
  }));
  if (typeof parameters.giftSizeOverridesJson === "string") {
    try {
      const overrides: unknown = JSON.parse(parameters.giftSizeOverridesJson);
      if (Array.isArray(overrides)) parameters.giftSizeOverridesJson = JSON.stringify(overrides.map((item) =>
        item && typeof item.giftId === "string" ? { ...item, giftName: find(item.giftId)?.matchName ?? item.giftName } : item
      ));
    } catch { /* Invalid overrides are handled by the effect. */ }
  }
  return {
    ...configuration,
    trigger: { ...configuration.trigger, conditions: configuration.trigger.conditions.map((condition) => {
      if (condition.type !== "gift-specific") return condition;
      const gift = find(condition.platformGiftId, condition.giftCatalogId);
      return { ...condition, giftName: condition.giftCatalogId || !condition.giftName ? gift?.matchName ?? condition.giftName : condition.giftName };
    }) },
    visual: { ...configuration.visual, parameters }
  };
}
