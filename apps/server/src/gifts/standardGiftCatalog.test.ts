import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GiftCatalogJsonRepository } from "./GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./GiftCatalogService.js";
import { importStandardGiftCatalog, standardGiftCatalogSchema, type StandardGiftCatalog } from "./standardGiftCatalog.js";
import { createApp } from "../app.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "standard-gift-catalog-"));
  roots.push(root);
  return { root, repository: GiftCatalogJsonRepository.fromRoot(root) };
}

function catalog(version = "a".repeat(64)): StandardGiftCatalog {
  return { schemaVersion: 1, version, gifts: [{
    platform: "tiktok", platformGiftId: "123", name: "表示名", matchName: "Received Gift",
    coinValue: 10, imageUrl: "https://p16-webcast.tiktokcdn.com/img/gift.webp"
  }] };
}

describe("distributed standard gift catalog", () => {
  it("ships the complete public catalog without local settings or receive history", async () => {
    const raw = JSON.parse(await readFile(new URL("../../catalogs/standard-gifts.json", import.meta.url), "utf8"));
    const parsed = standardGiftCatalogSchema.parse(raw);
    expect(parsed.gifts.length).toBeGreaterThan(1700);
    expect(parsed.gifts.every((gift) => gift.imageUrl && gift.matchName)).toBe(true);
    expect(JSON.stringify(raw)).not.toMatch(/seenCount|firstSeenAt|lastSeenAt|localPath|cacheStatus|isManuallyEdited|rawEvent|[A-Z]:\\/);
    const { root, repository } = await setup();
    const result = await repository.mergeStandardCatalog(parsed);
    expect(result.added).toBeGreaterThan(1700);
    expect(result.backupPath).toBeUndefined();
    const records = await new GiftCatalogService({ repository }).listAll();
    expect(records.every((gift) => gift.seenCount === 0 && gift.valueSource === "catalog" && !gift.isManuallyEdited)).toBe(true);
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    expect((await reloaded.mergeStandardCatalog(parsed)).skipped).toBe(true);
  });

  it("backs up and fills missing metadata while preserving manual edits and receive history", async () => {
    const { root, repository } = await setup();
    const received = await repository.upsert({ platform: "tiktok", platformGiftId: "123", name: "Original name",
      coinValue: 20, observedAt: "2026-01-01T00:00:00.000Z" });
    await repository.update(received.id, { name: "My label", matchName: "My match name", isActive: false });
    const before = JSON.parse(await readFile(path.join(root, "data/gifts/catalog.json"), "utf8"));
    const result = await repository.mergeStandardCatalog(catalog());
    expect(result).toMatchObject({ added: 0, updated: 1, skipped: false });
    expect(result.backupPath).toBeTruthy();
    expect(JSON.parse(await readFile(result.backupPath!, "utf8"))).toEqual(before);
    expect(await repository.getById(received.id)).toMatchObject({
      id: received.id, name: "My label", matchName: "My match name", coinValue: 10,
      isActive: false, isManuallyEdited: true, valueSource: "manual", seenCount: 1,
      firstSeenAt: received.firstSeenAt, lastSeenAt: received.lastSeenAt,
      image: { primaryUrl: catalog().gifts[0]!.imageUrl }
    });
  });

  it("matches an existing manually added gift by name and price and retains its ID and image", async () => {
    const { repository } = await setup();
    const existing = await new GiftCatalogService({ repository }).createManual({ platformGiftId: "manual-user-id",
      name: "Received Gift", coinValue: 10, primaryImageUrl: "/asset-files/my-image.png" });
    const result = await repository.mergeStandardCatalog(catalog());
    expect(result).toMatchObject({ added: 0, updated: 0 });
    expect(await repository.count()).toBe(1);
    expect(await repository.getById(existing.id)).toMatchObject({ platformGiftId: "manual-user-id", image: { primaryUrl: "/asset-files/my-image.png" } });
  });

  it("applies new versions, preserves edits, and does not recreate a deleted gift on ordinary restarts", async () => {
    const { root, repository } = await setup();
    await repository.mergeStandardCatalog(catalog());
    await repository.update("tiktok:123", { name: "Edited label", primaryImageUrl: "/asset-files/edited.png" });
    const next = catalog("b".repeat(64));
    next.gifts.push({ ...next.gifts[0]!, platformGiftId: "456", name: "Another", matchName: "Another" });
    expect(await repository.mergeStandardCatalog(next)).toMatchObject({ added: 1, updated: 0 });
    expect(await repository.getById("tiktok:123")).toMatchObject({ name: "Edited label", image: { primaryUrl: "/asset-files/edited.png" } });
    await repository.delete("tiktok:456");
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    expect(await reloaded.mergeStandardCatalog(next)).toMatchObject({ skipped: true });
    expect(await reloaded.count()).toBe(1);
  });

  it("updates every unedited field on already registered gifts after reloading", async () => {
    const { root, repository } = await setup();
    await repository.mergeStandardCatalog(catalog());
    const next = catalog("b".repeat(64));
    Object.assign(next.gifts[0]!, { name: "Corrected label", matchName: "Corrected received name", coinValue: 25,
      imageUrl: "https://p16-webcast.tiktokcdn.com/img/corrected.webp" });
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    expect(await reloaded.mergeStandardCatalog(next)).toMatchObject({ added: 0, updated: 1 });
    expect(await reloaded.getById("tiktok:123")).toMatchObject({
      name: "Corrected label", matchName: "Corrected received name", coinValue: 25, diamondValue: 25,
      image: { primaryUrl: next.gifts[0]!.imageUrl }, seenCount: 0, isManuallyEdited: false
    });
  });

  it.each(["name", "matchName", "coinValue", "primaryImageUrl"] as const)("protects only the edited %s when the editor saves all fields", async (field) => {
    const { root, repository } = await setup();
    const old = catalog();
    const gift = old.gifts[0]!;
    await repository.mergeStandardCatalog(old);
    const patch = { name: gift.name, matchName: gift.matchName, coinValue: gift.coinValue, primaryImageUrl: gift.imageUrl };
    const custom = { name: "My label", matchName: "My received name", coinValue: 777, primaryImageUrl: "/asset-files/my.png" };
    Object.assign(patch, { [field]: custom[field] });
    await repository.update("tiktok:123", patch);
    const next = catalog("b".repeat(64));
    Object.assign(next.gifts[0]!, { name: "New label", matchName: "New received name", coinValue: 50,
      imageUrl: "https://p16-webcast.tiktokcdn.com/img/new.webp" });
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    await reloaded.mergeStandardCatalog(next);
    const actual = (await reloaded.getById("tiktok:123"))!;
    const expected = { name: "New label", matchName: "New received name", coinValue: 50, primaryImageUrl: next.gifts[0]!.imageUrl };
    Object.assign(expected, { [field]: custom[field] });
    expect({ name: actual.name, matchName: actual.matchName, coinValue: actual.coinValue, primaryImageUrl: actual.image.primaryUrl }).toEqual(expected);
  });

  it("keeps gifts with the same display label and coin value separate when received names differ", async () => {
    const { repository } = await setup();
    const standard = catalog();
    standard.gifts[0]!.name = "Same display label";
    standard.gifts.push({ ...standard.gifts[0]!, platformGiftId: "456", matchName: "Different received name" });
    expect(await repository.mergeStandardCatalog(standard)).toMatchObject({ added: 2 });
    expect(await repository.count()).toBe(2);
    expect((await repository.getById("tiktok:123"))?.matchName).toBe("Received Gift");
    expect((await repository.getById("tiktok:456"))?.matchName).toBe("Different received name");
  });

  it("does not treat an unchanged save or an active-flag edit as customization of standard fields", async () => {
    const { repository } = await setup();
    await repository.mergeStandardCatalog(catalog());
    const gift = catalog().gifts[0]!;
    await repository.update("tiktok:123", { name: gift.name, matchName: gift.matchName, coinValue: gift.coinValue,
      primaryImageUrl: gift.imageUrl, isActive: false });
    const next = catalog("b".repeat(64));
    next.gifts[0]!.name = "New label";
    await repository.mergeStandardCatalog(next);
    expect(await repository.getById("tiktok:123")).toMatchObject({ name: "New label", isActive: false });
  });

  it("preserves deliberately cleared fields through both standard updates and received events", async () => {
    const { root, repository } = await setup();
    await repository.mergeStandardCatalog(catalog());
    await repository.update("tiktok:123", { matchName: "", coinValue: null, primaryImageUrl: null });
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    await reloaded.mergeStandardCatalog(catalog("b".repeat(64)));
    await reloaded.upsert({ platform: "tiktok", platformGiftId: "123", name: "Received Gift", coinValue: 10,
      primaryImageUrl: "https://p16-webcast.tiktokcdn.com/img/received.webp" });
    const gift = (await reloaded.getById("tiktok:123"))!;
    expect(gift).toMatchObject({ matchName: "", coinValue: null, diamondValue: null });
    expect(gift.image.primaryUrl).toBeUndefined();
  });

  it("accepts future standard corrections again when a custom value is restored to the latest standard value", async () => {
    const { repository } = await setup();
    await repository.mergeStandardCatalog(catalog());
    await repository.update("tiktok:123", { name: "Custom" });
    const next = catalog("b".repeat(64));
    next.gifts[0]!.name = "Standard B";
    await repository.mergeStandardCatalog(next);
    expect((await repository.getById("tiktok:123"))?.name).toBe("Custom");
    await repository.update("tiktok:123", { name: "Standard B" });
    const third = catalog("c".repeat(64));
    third.gifts[0]!.name = "Standard C";
    await repository.mergeStandardCatalog(third);
    expect((await repository.getById("tiktok:123"))?.name).toBe("Standard C");
  });

  it("retains a linked local ID even when standard names and prices change", async () => {
    const { root, repository } = await setup();
    const gift = await repository.upsert({ platform: "tiktok", platformGiftId: "my-old-id", name: "Received Gift", coinValue: 10 });
    await repository.mergeStandardCatalog(catalog());
    const next = catalog("b".repeat(64));
    Object.assign(next.gifts[0]!, { name: "New label", matchName: "New name", coinValue: 50 });
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    expect(await reloaded.mergeStandardCatalog(next)).toMatchObject({ added: 0, updated: 1 });
    expect(await reloaded.count()).toBe(1);
    expect(await reloaded.getById(gift.id)).toMatchObject({ platformGiftId: "my-old-id", name: "New label", coinValue: 50 });
  });

  it.each([true, false])("migrates legacy manual flags using bundled history (installed version: %s)", async (hasVersion) => {
    const { root, repository } = await setup();
    const old = catalog();
    old.gifts.push({ ...old.gifts[0]!, platformGiftId: "456", name: "Old second label", matchName: "Second name" });
    await repository.mergeStandardCatalog(old);
    const filePath = path.join(root, "data/gifts/catalog.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    delete persisted.standardGiftState;
    delete persisted.standardMergeFormat;
    if (!hasVersion) delete persisted.standardCatalogVersion;
    for (const gift of persisted.records) gift.isManuallyEdited = true;
    persisted.records.find((gift: { id: string }) => gift.id === "tiktok:456").name = "User's own label";
    await writeFile(filePath, JSON.stringify(persisted));
    const next = catalog("b".repeat(64));
    next.previousVersion = old.version;
    next.gifts[0]!.name = "Corrected first label";
    next.gifts.push({ ...old.gifts[1]!, name: "Corrected second label", imageUrl: "https://p16-webcast.tiktokcdn.com/img/new.webp" });
    await mkdir(path.join(root, "apps/server/catalogs/history"), { recursive: true });
    await writeFile(path.join(root, "apps/server/catalogs/history", `${old.version}.json`), JSON.stringify(old));
    await writeFile(path.join(root, "apps/server/catalogs/standard-gifts.json"), JSON.stringify(next));
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    expect(await importStandardGiftCatalog(root, reloaded)).toMatchObject({ added: 0, updated: 2 });
    expect((await reloaded.getById("tiktok:123"))?.name).toBe("Corrected first label");
    expect(await reloaded.getById("tiktok:456")).toMatchObject({ name: "User's own label", image: { primaryUrl: next.gifts[1]!.imageUrl } });
  });

  it("keeps legacy edits when no old baseline can be recovered", async () => {
    const { root, repository } = await setup();
    const gift = await new GiftCatalogService({ repository }).createManual({ platformGiftId: "123", name: "Private label", coinValue: 99, primaryImageUrl: "/asset-files/local.png" });
    const filePath = path.join(root, "data/gifts/catalog.json");
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    delete persisted.standardGiftState;
    await writeFile(filePath, JSON.stringify(persisted));
    const reloaded = GiftCatalogJsonRepository.fromRoot(root);
    await reloaded.mergeStandardCatalog(catalog());
    expect(await reloaded.getById(gift.id)).toMatchObject({ name: "Private label", coinValue: 99, image: { primaryUrl: "/asset-files/local.png" } });
  });

  it("imports before serving the catalog API after an update", async () => {
    const { root } = await setup();
    await mkdir(path.join(root, "apps/server/catalogs"), { recursive: true });
    await writeFile(path.join(root, "apps/server/catalogs/standard-gifts.json"), JSON.stringify(catalog()));
    const app = await createApp({ rootDir: root });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/gifts" });
      expect(response.statusCode).toBe(200);
      expect(response.json().gifts).toHaveLength(1);
      expect(response.json().gifts[0]).toMatchObject({ name: "表示名", matchName: "Received Gift", seenCount: 0 });
    } finally {
      await app.close();
    }
  });

  it("rejects private metadata, local images and duplicate gift IDs before writing", async () => {
    const { root, repository } = await setup();
    expect(standardGiftCatalogSchema.safeParse({ ...catalog(), user: "private" }).success).toBe(false);
    const local = catalog();
    local.gifts[0]!.imageUrl = "http://localhost/image.png";
    expect(standardGiftCatalogSchema.safeParse(local).success).toBe(false);
    const duplicate = catalog();
    duplicate.gifts.push(duplicate.gifts[0]!);
    expect(standardGiftCatalogSchema.safeParse(duplicate).success).toBe(false);
    await mkdir(path.join(root, "apps/server/catalogs"), { recursive: true });
    await writeFile(path.join(root, "apps/server/catalogs/standard-gifts.json"), JSON.stringify(local));
    await expect(importStandardGiftCatalog(root, repository)).rejects.toThrow();
    expect(await repository.count()).toBe(0);
  });
});
