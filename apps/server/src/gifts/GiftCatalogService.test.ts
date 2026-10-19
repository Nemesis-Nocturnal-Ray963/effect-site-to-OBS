import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GiftCatalogJsonRepository } from "./GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./GiftCatalogService.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("manual gift catalog records", () => {
  it("includes gifts beyond the first 1,000 in lookup data and statistics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gift-catalog-pages-"));
    temporaryRoots.push(root);
    const repository = GiftCatalogJsonRepository.fromRoot(root);
    const service = new GiftCatalogService({ repository });
    const template = await service.createManual({ name: "Gift", coinValue: 1 });
    const records = Array.from({ length: 1001 }, (_, index) => ({
      ...template, id: `gift-${index}`, name: `Gift ${index}`,
      lastSeenAt: index === 1000 ? "2026-10-20T00:00:00.000Z" : "2026-10-19T00:00:00.000Z"
    }));
    const list = vi.spyOn(repository, "list").mockImplementation(async (query = {}) =>
      records.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 200))
    );
    try {
      expect(await service.listAll()).toHaveLength(1001);
      expect(await service.stats()).toMatchObject({ total: 1001, lastDiscoveredAt: "2026-10-20T00:00:00.000Z" });
    } finally {
      list.mockRestore();
    }
  });

  it("creates and persists a manually entered gift without a platform gift ID", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "manual-gift-catalog-"));
    temporaryRoots.push(root);
    const service = new GiftCatalogService({
      repository: GiftCatalogJsonRepository.fromRoot(root)
    });

    const gift = await service.createManual({
      name: "Future Gift",
      coinValue: 250,
      primaryImageUrl: "https://example.test/future-gift.png"
    });

    expect(gift.platformGiftId).toMatch(/^manual-/u);
    expect(gift).toMatchObject({
      name: "Future Gift",
      coinValue: 250,
      valueSource: "manual",
      isManuallyEdited: true,
      seenCount: 0
    });
    expect(
      JSON.parse(await readFile(path.join(root, "data", "gifts", "catalog.json"), "utf8")).records
    ).toHaveLength(1);
  });
});
