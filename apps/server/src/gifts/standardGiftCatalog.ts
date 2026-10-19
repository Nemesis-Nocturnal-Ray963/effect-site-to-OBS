import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GiftCatalogJsonRepository } from "./GiftCatalogJsonRepository.js";

const standardGiftSchema = z.object({
  platform: z.literal("tiktok"),
  platformGiftId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  matchName: z.string().trim().max(200),
  coinValue: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)tiktokcdn\.com$/i.test(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  }, "Standard gift images must be public TikTok CDN URLs").optional()
}).strict();

export const standardGiftCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  previousVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  gifts: z.array(standardGiftSchema).min(1)
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const gift of catalog.gifts) {
    const key = `${gift.platform}:${gift.platformGiftId}`;
    if (ids.has(key)) context.addIssue({ code: "custom", message: `Duplicate standard gift ID: ${key}` });
    ids.add(key);
  }
});

export type StandardGiftCatalog = z.infer<typeof standardGiftCatalogSchema>;

export async function importStandardGiftCatalog(rootDir: string, repository: GiftCatalogJsonRepository) {
  let raw: string;
  try {
    raw = await readFile(path.join(rootDir, "apps/server/catalogs/standard-gifts.json"), "utf8");
  } catch (error) {
    // Older distributions and isolated test roots may not contain a standard catalog.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const catalog = standardGiftCatalogSchema.parse(JSON.parse(raw));
  const installedVersion = await repository.getStandardCatalogVersion();
  const previousVersion = installedVersion === catalog.version ? catalog.version : installedVersion ?? catalog.previousVersion;
  let previousCatalog: StandardGiftCatalog | undefined;
  if (previousVersion === catalog.version) previousCatalog = catalog;
  else if (previousVersion && /^[a-f0-9]{64}$/.test(previousVersion)) {
    try {
      const previousRaw = await readFile(path.join(rootDir, "apps/server/catalogs/history", `${previousVersion}.json`), "utf8");
      previousCatalog = standardGiftCatalogSchema.parse(JSON.parse(previousRaw));
      if (previousCatalog.version !== previousVersion) throw new Error("Standard gift history version mismatch");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return repository.mergeStandardCatalog(catalog, previousCatalog);
}
