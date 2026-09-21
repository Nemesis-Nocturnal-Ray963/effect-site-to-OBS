import type { GiftCatalogRecord, GiftCatalogStats, NormalizedEvent } from "@obs-effect/shared-types";
import type { GiftCatalogRepository } from "./GiftCatalogRepository.js";
import { GiftExtractor } from "./GiftExtractor.js";
import type { GiftCatalogPatch, GiftCatalogQuery } from "./giftTypes.js";
import { randomUUID } from "node:crypto";

interface GiftCatalogServiceOptions {
  repository: GiftCatalogRepository;
  onCreated?: (record: GiftCatalogRecord) => void;
  onUpdated?: (record: GiftCatalogRecord) => void;
  onDeleted?: (record: GiftCatalogRecord) => void;
}

export class GiftCatalogService {
  private readonly extractor = new GiftExtractor();
  private readonly repository: GiftCatalogRepository;
  private readonly onCreated?: (record: GiftCatalogRecord) => void;
  private readonly onUpdated?: (record: GiftCatalogRecord) => void;
  private readonly onDeleted?: (record: GiftCatalogRecord) => void;

  constructor(options: GiftCatalogServiceOptions) {
    this.repository = options.repository;
    this.onCreated = options.onCreated;
    this.onUpdated = options.onUpdated;
    this.onDeleted = options.onDeleted;
  }

  async processEvent(event: NormalizedEvent): Promise<GiftCatalogRecord | null> {
    const extracted = this.extractor.extract(event);
    if (!extracted) return null;
    const existing = await this.repository.getByPlatformGiftId(extracted.platform, extracted.platformGiftId);
    const record = await this.repository.upsert({
      ...extracted,
      observedAt: event.timestamp
    });
    if (existing) {
      this.onUpdated?.(record);
    } else {
      this.onCreated?.(record);
    }
    return record;
  }

  list(query: GiftCatalogQuery): Promise<GiftCatalogRecord[]> {
    return this.repository.list(query);
  }

  get(id: string): Promise<GiftCatalogRecord | null> {
    return this.repository.getById(id);
  }

  getByPlatformGiftId(platformGiftId: string): Promise<GiftCatalogRecord | null> {
    return this.repository.getByPlatformGiftId("tiktok", platformGiftId);
  }

  async createManual(input: { platformGiftId?: string; name: string; coinValue?: number | null; primaryImageUrl?: string | null }): Promise<GiftCatalogRecord> {
    const platformGiftId = input.platformGiftId?.trim() || `manual-${randomUUID()}`;
    const existing = await this.repository.getByPlatformGiftId("tiktok", platformGiftId);
    if (existing) throw new Error("Gift ID already exists");
    const created = await this.repository.upsert({
      platform: "tiktok",
      platformGiftId,
      name: input.name,
      coinValue: input.coinValue,
      diamondValue: input.coinValue,
      primaryImageUrl: input.primaryImageUrl ?? undefined,
      valueSource: "manual",
      observedAt: new Date().toISOString(),
      incrementSeenCount: false
    });
    const record = await this.repository.update(created.id, {
      name: input.name,
      coinValue: input.coinValue,
      diamondValue: input.coinValue,
      primaryImageUrl: input.primaryImageUrl
    });
    this.onCreated?.(record);
    return record;
  }

  async update(id: string, patch: GiftCatalogPatch): Promise<GiftCatalogRecord> {
    const record = await this.repository.update(id, patch);
    this.onUpdated?.(record);
    return record;
  }

  async delete(id: string): Promise<void> {
    const record = await this.repository.getById(id);
    await this.repository.delete(id);
    if (record) this.onDeleted?.(record);
  }

  async stats(): Promise<GiftCatalogStats> {
    const records = await this.repository.list({ limit: 1000, sort: "lastSeenAt", order: "desc" });
    return {
      total: records.length,
      withImage: records.filter((record) => Boolean(record.image.primaryUrl)).length,
      withDiamondValue: records.filter((record) => record.coinValue !== null || record.diamondValue !== null).length,
      withCoinValue: records.filter((record) => record.coinValue !== null || record.diamondValue !== null).length,
      missingValue: records.filter((record) => record.diamondValue === null && record.coinValue === null).length,
      imageCacheFailed: records.filter((record) => record.image.cacheStatus === "failed").length,
      lastDiscoveredAt: records[0]?.lastSeenAt ?? null
    };
  }
}
