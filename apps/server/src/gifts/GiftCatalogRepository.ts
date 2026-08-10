import type { GiftCatalogPatch, GiftCatalogQuery, GiftCatalogRecord, GiftCatalogUpsertInput, GiftPlatform } from "./giftTypes.js";

export interface GiftCatalogRepository {
  list(query: GiftCatalogQuery): Promise<GiftCatalogRecord[]>;
  getById(id: string): Promise<GiftCatalogRecord | null>;
  getByPlatformGiftId(platform: GiftPlatform, platformGiftId: string): Promise<GiftCatalogRecord | null>;
  upsert(input: GiftCatalogUpsertInput): Promise<GiftCatalogRecord>;
  update(id: string, patch: GiftCatalogPatch): Promise<GiftCatalogRecord>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
