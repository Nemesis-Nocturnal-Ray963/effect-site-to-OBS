import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GiftCatalogRepository } from "./GiftCatalogRepository.js";
import type { GiftCatalogPatch, GiftCatalogQuery, GiftCatalogRecord, GiftCatalogUpsertInput, GiftValueSource } from "./giftTypes.js";

interface PersistedCatalog {
  records: GiftCatalogRecord[];
}

const sourceRank: Record<GiftValueSource, number> = {
  unknown: 0,
  event: 1,
  catalog: 2,
  "extended-gift-info": 3,
  manual: 4
};

function validName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^unknown$/i.test(trimmed)) return undefined;
  return trimmed;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function mergeNullableNumber(existing: number | null, incoming: number | null | undefined): number | null {
  if (existing !== null) return existing;
  return typeof incoming === "number" && Number.isFinite(incoming) ? incoming : null;
}

function unifiedCoinValue(input: { coinValue?: number | null; diamondValue?: number | null }): number | null {
  if (typeof input.coinValue === "number" && Number.isFinite(input.coinValue)) return input.coinValue;
  if (typeof input.diamondValue === "number" && Number.isFinite(input.diamondValue)) return input.diamondValue;
  return null;
}

function normalizeValue(record: GiftCatalogRecord): void {
  const value = unifiedCoinValue(record);
  record.coinValue = value;
  record.diamondValue = value;
}

function shouldAcceptSource(existing: GiftValueSource, incoming: GiftValueSource): boolean {
  return sourceRank[incoming] >= sourceRank[existing];
}

function byQuery(records: GiftCatalogRecord[], query: GiftCatalogQuery): GiftCatalogRecord[] {
  const text = query.search?.trim().toLowerCase();
  let result = records.filter((record) => {
    if (text) {
      const searchable = [record.name, record.platformGiftId, ...record.aliases].join(" ").toLowerCase();
      if (!searchable.includes(text)) return false;
    }
    if (query.hasImage !== undefined && Boolean(record.image.primaryUrl) !== query.hasImage) return false;
    if (query.hasDiamondValue !== undefined && (record.diamondValue !== null) !== query.hasDiamondValue) return false;
    if (query.hasCoinValue !== undefined && (record.coinValue !== null) !== query.hasCoinValue) return false;
    if (query.cacheStatus && record.image.cacheStatus !== query.cacheStatus) return false;
    return true;
  });

  const sort = query.sort ?? "lastSeenAt";
  const direction = query.order === "asc" ? 1 : -1;
  result = result.sort((a, b) => {
    const av = a[sort] ?? "";
    const bv = b[sort] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });

  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(1, query.limit ?? 200), 1000);
  return result.slice(offset, offset + limit);
}

export class GiftCatalogJsonRepository implements GiftCatalogRepository {
  private records: GiftCatalogRecord[] | null = null;

  constructor(private readonly filePath: string) {}

  static fromRoot(rootDir: string): GiftCatalogJsonRepository {
    return new GiftCatalogJsonRepository(path.join(rootDir, "data", "gifts", "catalog.json"));
  }

  async list(query: GiftCatalogQuery = {}): Promise<GiftCatalogRecord[]> {
    await this.load();
    return byQuery([...(this.records ?? [])], query);
  }

  async getById(id: string): Promise<GiftCatalogRecord | null> {
    await this.load();
    return this.records?.find((record) => record.id === id) ?? null;
  }

  async getByPlatformGiftId(platform: GiftCatalogRecord["platform"], platformGiftId: string): Promise<GiftCatalogRecord | null> {
    await this.load();
    return this.records?.find((record) => record.platform === platform && record.platformGiftId === platformGiftId) ?? null;
  }

  async upsert(input: GiftCatalogUpsertInput): Promise<GiftCatalogRecord> {
    await this.load();
    const now = input.observedAt ?? new Date().toISOString();
    const records = this.records ?? [];
    const existing = records.find((record) => record.platform === input.platform && record.platformGiftId === input.platformGiftId);
    const incomingSource = input.valueSource ?? "event";
    const name = validName(input.name);
    const urls = unique([input.primaryImageUrl, ...(input.imageUrls ?? [])]);
    const inputCoinValue = unifiedCoinValue(input);

    if (!existing) {
      const record: GiftCatalogRecord = {
        id: `${input.platform}:${input.platformGiftId}`,
        platform: input.platform,
        platformGiftId: input.platformGiftId,
        name: name ?? `Gift ${input.platformGiftId}`,
        aliases: [],
        diamondValue: inputCoinValue,
        coinValue: inputCoinValue,
        valueSource: incomingSource,
        image: {
          primaryUrl: urls[0],
          urls,
          cacheStatus: urls.length > 0 ? "pending" : "not-requested"
        },
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: input.incrementSeenCount === false ? 0 : 1,
        firstSeenRawEventName: input.rawEventName,
        lastSeenRawEventName: input.rawEventName,
        isActive: true,
        isManuallyEdited: false,
        createdAt: now,
        updatedAt: now
      };
      records.push(record);
      await this.save();
      return record;
    }

    const oldName = existing.name;
    if (!existing.isManuallyEdited && name && name !== existing.name) {
      if (!validName(existing.name) || existing.name === `Gift ${existing.platformGiftId}`) {
        existing.name = name;
      } else if (!existing.aliases.includes(name)) {
        existing.aliases = [...existing.aliases, name];
      }
    } else if (name && name !== oldName && !existing.aliases.includes(name)) {
      existing.aliases = [...existing.aliases, name];
    }

    if (!existing.isManuallyEdited || shouldAcceptSource(existing.valueSource, incomingSource)) {
      const mergedValue = mergeNullableNumber(unifiedCoinValue(existing), inputCoinValue);
      existing.diamondValue = mergedValue;
      existing.coinValue = mergedValue;
      if (existing.valueSource !== "manual" && (input.diamondValue !== undefined || input.coinValue !== undefined)) {
        existing.valueSource = shouldAcceptSource(existing.valueSource, incomingSource) ? incomingSource : existing.valueSource;
      }
    }

    const mergedUrls = unique([existing.image.primaryUrl, ...existing.image.urls, ...urls]);
    existing.image = {
      ...existing.image,
      primaryUrl: existing.image.primaryUrl ?? urls[0],
      urls: mergedUrls,
      cacheStatus: existing.image.localPath ? existing.image.cacheStatus : mergedUrls.length > 0 ? "pending" : existing.image.cacheStatus
    };
    existing.lastSeenAt = now;
    existing.seenCount += input.incrementSeenCount === false ? 0 : 1;
    existing.lastSeenRawEventName = input.rawEventName ?? existing.lastSeenRawEventName;
    existing.updatedAt = now;

    await this.save();
    return existing;
  }

  async update(id: string, patch: GiftCatalogPatch): Promise<GiftCatalogRecord> {
    await this.load();
    const record = this.records?.find((item) => item.id === id);
    if (!record) throw new Error("Gift catalog record not found");
    const now = new Date().toISOString();

    if (patch.name !== undefined) {
      const name = validName(patch.name);
      if (name) record.name = name;
    }
    if (patch.diamondValue !== undefined || patch.coinValue !== undefined) {
      const value = patch.coinValue !== undefined ? patch.coinValue : patch.diamondValue;
      record.diamondValue = value ?? null;
      record.coinValue = value ?? null;
    }
    if (patch.primaryImageUrl !== undefined) {
      const primary = patch.primaryImageUrl?.trim() || undefined;
      record.image.primaryUrl = primary;
      record.image.urls = unique([primary, ...record.image.urls]);
      record.image.cacheStatus = primary && !record.image.localPath ? "pending" : record.image.cacheStatus;
    }
    if (patch.isActive !== undefined) record.isActive = patch.isActive;
    record.isManuallyEdited = true;
    record.valueSource = "manual";
    record.updatedAt = now;
    await this.save();
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.load();
    this.records = (this.records ?? []).filter((record) => record.id !== id);
    await this.save();
  }

  async count(): Promise<number> {
    await this.load();
    return this.records?.length ?? 0;
  }

  private async load(): Promise<void> {
    if (this.records) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedCatalog;
      this.records = Array.isArray(parsed.records) ? parsed.records : [];
      for (const record of this.records) normalizeValue(record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.records = [];
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify({ records: this.records ?? [] }, null, 2)}\n`, "utf8");
  }
}
