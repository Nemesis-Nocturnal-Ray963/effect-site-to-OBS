import type { GiftCatalogRecord, GiftImageInfo, GiftPlatform, GiftValueSource } from "@obs-effect/shared-types";

export type { GiftCatalogRecord, GiftImageInfo, GiftPlatform, GiftValueSource };

export interface GiftCatalogQuery {
  search?: string;
  sort?: "name" | "lastSeenAt" | "firstSeenAt" | "seenCount" | "diamondValue" | "coinValue";
  order?: "asc" | "desc";
  hasImage?: boolean;
  hasDiamondValue?: boolean;
  hasCoinValue?: boolean;
  cacheStatus?: GiftImageInfo["cacheStatus"];
  limit?: number;
  offset?: number;
}

export interface GiftCatalogUpsertInput {
  platform: GiftPlatform;
  platformGiftId: string;
  name?: string;
  aliases?: string[];
  diamondValue?: number | null;
  coinValue?: number | null;
  valueSource?: GiftValueSource;
  imageUrls?: string[];
  primaryImageUrl?: string;
  rawEventName?: string;
  observedAt?: string;
  incrementSeenCount?: boolean;
}

export interface GiftCatalogPatch {
  name?: string;
  diamondValue?: number | null;
  coinValue?: number | null;
  primaryImageUrl?: string | null;
  isActive?: boolean;
}

export interface ExtractedGift {
  platform: GiftPlatform;
  platformGiftId: string;
  name?: string;
  diamondValue?: number | null;
  coinValue?: number | null;
  valueSource: GiftValueSource;
  imageUrls: string[];
  primaryImageUrl?: string;
  rawEventName?: string;
  incrementSeenCount: boolean;
}
