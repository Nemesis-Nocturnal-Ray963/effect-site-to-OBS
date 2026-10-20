import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GiftCatalogRepository } from "./GiftCatalogRepository.js";
import type { GiftCatalogPatch, GiftCatalogQuery, GiftCatalogRecord, GiftCatalogUpsertInput, GiftValueSource } from "./giftTypes.js";
import type { StandardGiftCatalog } from "./standardGiftCatalog.js";

interface PersistedCatalog {
  records: GiftCatalogRecord[];
  standardCatalogVersion?: string;
  standardMergeFormat?: number;
  standardGiftState?: Record<string, StandardGiftState>;
}

const standardFields = ["name", "matchName", "coinValue", "primaryImageUrl"] as const;
type StandardGiftField = typeof standardFields[number];
interface StandardGiftValues {
  name: string;
  matchName: string;
  coinValue: number | null;
  primaryImageUrl: string | null;
}
interface StandardGiftState {
  standardGiftId?: string;
  baseline?: StandardGiftValues;
  overrides: StandardGiftField[];
}

function recordValues(record: GiftCatalogRecord): StandardGiftValues {
  return { name: record.name, matchName: record.matchName ?? "", coinValue: unifiedCoinValue(record), primaryImageUrl: record.image.primaryUrl ?? null };
}

function standardValues(gift: StandardGiftCatalog["gifts"][number]): StandardGiftValues {
  return { name: gift.name, matchName: gift.matchName, coinValue: gift.coinValue, primaryImageUrl: gift.imageUrl ?? null };
}

function setPrimaryImage(record: GiftCatalogRecord, primary: string | null): void {
  if ((record.image.primaryUrl ?? null) === primary) return;
  record.image = { primaryUrl: primary ?? undefined, urls: unique([primary ?? undefined, ...record.image.urls]),
    cacheStatus: primary ? "pending" : "not-requested" };
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
      const searchable = [record.name, record.matchName, record.platformGiftId, ...record.aliases].join(" ").toLowerCase();
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
  private standardCatalogVersion?: string;
  private standardMergeFormat?: number;
  private standardGiftState: Record<string, StandardGiftState> = {};
  private saveQueue: Promise<void> = Promise.resolve();

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
        matchName: name ?? "",
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
      if (incomingSource === "manual") {
        const overrides: StandardGiftField[] = [];
        if (input.name !== undefined) overrides.push("name", "matchName");
        if (input.coinValue !== undefined || input.diamondValue !== undefined) overrides.push("coinValue");
        if (input.primaryImageUrl !== undefined) overrides.push("primaryImageUrl");
        this.standardGiftState[record.id] = { overrides };
      }
      await this.save();
      return record;
    }

    const oldName = existing.name;
    const overrides = this.standardGiftState[existing.id]?.overrides ?? [];
    if (!overrides.includes("matchName") && !existing.matchName && name) existing.matchName = name;
    if (!existing.isManuallyEdited && name && name !== existing.name) {
      if (!validName(existing.name) || existing.name === `Gift ${existing.platformGiftId}`) {
        existing.name = name;
      } else if (!existing.aliases.includes(name)) {
        existing.aliases = [...existing.aliases, name];
      }
    } else if (name && name !== oldName && !existing.aliases.includes(name)) {
      existing.aliases = [...existing.aliases, name];
    }

    if (!overrides.includes("coinValue") && (!existing.isManuallyEdited || shouldAcceptSource(existing.valueSource, incomingSource))) {
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
      primaryUrl: overrides.includes("primaryImageUrl") ? existing.image.primaryUrl : existing.image.primaryUrl ?? urls[0],
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

    const before = recordValues(record);

    if (patch.name !== undefined) {
      const name = validName(patch.name);
      if (name) record.name = name;
    }
    if (patch.matchName !== undefined) record.matchName = patch.matchName.trim();
    if (patch.diamondValue !== undefined || patch.coinValue !== undefined) {
      const value = patch.coinValue !== undefined ? patch.coinValue : patch.diamondValue;
      record.diamondValue = value ?? null;
      record.coinValue = value ?? null;
    }
    if (patch.primaryImageUrl !== undefined) {
      setPrimaryImage(record, patch.primaryImageUrl?.trim() || null);
    }
    if (patch.isActive !== undefined) record.isActive = patch.isActive;
    const state = this.standardGiftState[record.id] ?? { overrides: record.isManuallyEdited ? [...standardFields] : [] };
    const after = recordValues(record);
    const overrides = new Set(state.overrides);
    for (const field of standardFields) {
      // The editor sends all fields on Save. Protect only actual changes.
      if (before[field] !== after[field]) {
        if (state.baseline && state.baseline[field] === after[field]) overrides.delete(field);
        else overrides.add(field);
      }
    }
    this.standardGiftState[record.id] = { ...state, overrides: [...overrides] };
    record.isManuallyEdited = true;
    record.valueSource = "manual";
    record.updatedAt = now;
    await this.save();
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.load();
    this.records = (this.records ?? []).filter((record) => record.id !== id);
    delete this.standardGiftState[id];
    await this.save();
  }

  async count(): Promise<number> {
    await this.load();
    return this.records?.length ?? 0;
  }

  async updateImageCache(id: string, sourceUrl: string, patch: { localPath?: string; mimeType?: string; cacheStatus: "cached" | "failed" }): Promise<GiftCatalogRecord | null> {
    await this.load();
    const record = this.records?.find((item) => item.id === id);
    if (!record || record.image.primaryUrl !== sourceUrl) return null;
    if (record.image.cacheStatus === patch.cacheStatus && record.image.localPath === patch.localPath) return record;
    record.image = { ...record.image, ...patch, cachedAt: patch.cacheStatus === "cached" ? new Date().toISOString() : record.image.cachedAt };
    // Cache bookkeeping must not affect standard-field customization protection.
    await this.save();
    return record;
  }

  async getStandardCatalogVersion(): Promise<string | undefined> {
    await this.load();
    return this.standardCatalogVersion;
  }

  async mergeStandardCatalog(catalog: StandardGiftCatalog, previousCatalog?: StandardGiftCatalog): Promise<{ added: number; updated: number; skipped: boolean; backupPath?: string }> {
    await this.load();
    if (this.standardCatalogVersion === catalog.version && this.standardMergeFormat === 2) return { added: 0, updated: 0, skipped: true };

    const records = structuredClone(this.records ?? []);
    const states = structuredClone(this.standardGiftState);
    const previousById = new Map(previousCatalog?.gifts.map((gift) => [`${gift.platform}:${gift.platformGiftId}`, gift]));
    const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
    const byId = new Map(records.map((record) => [`${record.platform}:${record.platformGiftId}`, record]));
    for (const record of records) {
      const standardId = states[record.id]?.standardGiftId;
      if (standardId && !byId.has(standardId)) byId.set(standardId, record);
    }
    const byName = new Map<string, GiftCatalogRecord[]>();
    const indexNames = (record: GiftCatalogRecord) => {
      for (const name of new Set([record.name, record.matchName ?? "", ...record.aliases].map(normalize).filter(Boolean))) {
        const key = `${record.platform}:${name}`;
        const matches = byName.get(key) ?? [];
        if (!matches.includes(record)) matches.push(record);
        byName.set(key, matches);
      }
    };
    records.forEach(indexNames);
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;

    for (const gift of catalog.gifts) {
      const key = `${gift.platform}:${gift.platformGiftId}`;
      const previous = previousById.get(key);
      let existing = byId.get(key);
      if (!existing) {
        // Display labels can deliberately be identical for unrelated gifts.
        const names = (gift.matchName ? [gift.matchName, previous?.matchName] : [gift.name, previous?.name])
          .filter((name): name is string => Boolean(name));
        const identityNames = new Set(names.map(normalize));
        const candidates = new Set(names.flatMap((name) => byName.get(`${gift.platform}:${normalize(name)}`) ?? []));
        const matches = [...candidates].filter((record) => {
          if (![record.matchName || record.name, ...record.aliases].some((name) => identityNames.has(normalize(name)))) return false;
          const value = record.coinValue ?? record.diamondValue;
          return value === null || gift.coinValue === null || value === gift.coinValue || (previous && value === previous.coinValue);
        });
        if (matches.length === 1) existing = matches[0];
      }
      if (existing) {
        const current = recordValues(existing);
        const incoming = standardValues(gift);
        const state = states[existing.id];
        const baseline = state?.baseline ?? (previous ? standardValues(previous) : undefined);
        const overrides = new Set(state?.overrides ?? []);
        if (baseline) {
          for (const field of standardFields) if (current[field] !== baseline[field]) overrides.add(field);
        } else if (!state && existing.isManuallyEdited) {
          // Legacy data with no comparison baseline cannot be safely attributed.
          standardFields.forEach((field) => overrides.add(field));
        }
        const next = { ...current };
        for (const field of standardFields) {
          if (!overrides.has(field)) Object.assign(next, { [field]: incoming[field] });
        }
        const changed = standardFields.some((field) => next[field] !== current[field]);
        existing.name = next.name;
        existing.matchName = next.matchName;
        existing.coinValue = existing.diamondValue = next.coinValue;
        setPrimaryImage(existing, next.primaryImageUrl);
        states[existing.id] = { standardGiftId: key, baseline: incoming, overrides: [...overrides] };
        // Keep IDs used by effects, manual edits, active flags and receive history.
        if (changed) {
          existing.updatedAt = now;
          updated++;
          indexNames(existing);
        }
        byId.set(key, existing);
        continue;
      }
      const record: GiftCatalogRecord = {
        id: key, platform: gift.platform, platformGiftId: gift.platformGiftId,
        name: gift.name, matchName: gift.matchName, aliases: [],
        coinValue: gift.coinValue, diamondValue: gift.coinValue, valueSource: "catalog",
        image: { primaryUrl: gift.imageUrl, urls: gift.imageUrl ? [gift.imageUrl] : [],
          cacheStatus: gift.imageUrl ? "pending" : "not-requested" },
        firstSeenAt: now, lastSeenAt: now, seenCount: 0,
        isActive: true, isManuallyEdited: false, createdAt: now, updatedAt: now
      };
      records.push(record);
      states[record.id] = { standardGiftId: key, baseline: standardValues(gift), overrides: [] };
      byId.set(key, record);
      indexNames(record);
      added++;
    }

    let backupPath: string | undefined;
    try {
      const folder = path.join(path.dirname(this.filePath), "backups");
      await mkdir(folder, { recursive: true });
      backupPath = path.join(folder, `before-standard-${now.replace(/[:.]/g, "-")}-${randomUUID()}.json`);
      await copyFile(this.filePath, backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      backupPath = undefined;
    }
    this.records = records;
    this.standardCatalogVersion = catalog.version;
    this.standardMergeFormat = 2;
    this.standardGiftState = states;
    await this.save();
    return { added, updated, skipped: false, backupPath };
  }

  private async load(): Promise<void> {
    if (this.records) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedCatalog;
      this.records = Array.isArray(parsed.records) ? parsed.records : [];
      this.standardCatalogVersion = parsed.standardCatalogVersion;
      this.standardMergeFormat = parsed.standardMergeFormat;
      this.standardGiftState = parsed.standardGiftState ?? {};
      for (const record of this.records) {
        normalizeValue(record);
        record.matchName ??= record.name === `Gift ${record.platformGiftId}` ? "" : record.name;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.records = [];
    }
  }

  private save(): Promise<void> {
    // Image previews finish concurrently. An older write must not overwrite a
    // later gift registration or a user's edit while cache statuses are saved.
    const task = this.saveQueue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify({ standardCatalogVersion: this.standardCatalogVersion, standardMergeFormat: this.standardMergeFormat,
        standardGiftState: this.standardGiftState, records: this.records ?? [] }, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    this.saveQueue = task;
    return task;
  }
}
