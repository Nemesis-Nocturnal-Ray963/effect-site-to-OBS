import type { GiftCatalogRecord } from "@obs-effect/shared-types";

/** Use the app's persistent image cache rather than hotlinking the remote CDN. */
export function giftImageSrc(gift: GiftCatalogRecord | null | undefined): string | undefined {
  return gift?.image.primaryUrl
    ? `/api/v1/gifts/${encodeURIComponent(gift.id)}/image?v=${encodeURIComponent(gift.updatedAt)}`
    : undefined;
}
