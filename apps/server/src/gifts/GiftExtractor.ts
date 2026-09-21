import type { NormalizedEvent } from "@obs-effect/shared-types";
import type { ExtractedGift } from "./giftTypes.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return undefined;
}

function imageUrlsFrom(value: unknown): string[] {
  const urls = new Set<string>();

  function visit(current: unknown): void {
    if (typeof current === "string") {
      if (/^https:\/\//i.test(current)) urls.add(current);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (/^(imageUrl|iconUrl|pictureUrl|url|uri)$/i.test(key) || /urlList|url_list|image|picture|giftPicture/i.test(key)) {
        visit(child);
      }
    }
  }

  visit(value);
  return [...urls];
}

export class GiftExtractor {
  extract(event: NormalizedEvent): ExtractedGift | null {
    if (event.platform !== "tiktok") return null;
    if (!["gift", "gift-streak-start", "gift-streak-update", "gift-streak-end"].includes(event.type)) return null;

    const data = event.data;
    const platformGiftId =
      stringId(data.giftId) ??
      stringId(data.gift_id) ??
      stringId((data.gift as Record<string, unknown> | undefined)?.id) ??
      stringId((data.gift as Record<string, unknown> | undefined)?.id_str) ??
      stringId((data.extendedGiftInfo as Record<string, unknown> | undefined)?.id) ??
      stringId(data.itemId);

    if (!platformGiftId) return null;

    const name = text(data.giftName) ?? text(data.gift_name) ?? text((data.gift as Record<string, unknown> | undefined)?.name);
    const imageUrls = [
      text(data.primaryGiftImageUrl),
      ...imageUrlsFrom(data.giftImageUrls),
      ...imageUrlsFrom(data.giftPicture),
      ...imageUrlsFrom(data.gift),
      ...imageUrlsFrom(data.extendedGiftInfo)
    ].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);

    const value = numberValue(data.coinValue) ?? numberValue(data.coin_value) ?? numberValue(data.diamondValue) ?? numberValue(data.diamond_value) ?? numberValue(data.diamondValueTotal);

    return {
      platform: "tiktok",
      platformGiftId,
      name,
      diamondValue: value,
      coinValue: value,
      valueSource: "event",
      imageUrls,
      primaryImageUrl: imageUrls[0],
      rawEventName: typeof event.metadata?.rawEventType === "string" ? event.metadata.rawEventType : event.type,
      incrementSeenCount: event.type === "gift" || event.type === "gift-streak-start"
    };
  }
}
