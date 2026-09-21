import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GiftCatalogJsonRepository } from "./GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./GiftCatalogService.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("manual gift catalog records", () => {
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
