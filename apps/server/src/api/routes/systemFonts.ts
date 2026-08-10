import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { loadCatalog } from "./assets.js";

interface SystemFontInfo {
  id: string;
  family: string;
  displayName: string;
  source: "system" | "asset";
  styles: string[];
  assetId?: string;
  contentUrl?: string;
}

let cachedSystemFonts: SystemFontInfo[] | null = null;

export async function registerSystemFontRoutes(app: FastifyInstance, rootDir: string): Promise<void> {
  app.get("/api/v1/system/fonts", async () => {
    return scanFonts(rootDir);
  });

  app.post("/api/v1/system/fonts/rescan", async () => {
    cachedSystemFonts = null;
    return scanFonts(rootDir);
  });
}

async function scanFonts(rootDir: string): Promise<{ fonts: SystemFontInfo[]; scannedAt: string; platform: NodeJS.Platform }> {
  cachedSystemFonts ??= await scanSystemFonts();
  const assetFonts = await scanAssetFonts(rootDir);
  const seen = new Set<string>();
  const fonts = [...assetFonts, ...cachedSystemFonts].filter((font) => {
    const key = font.family.toLocaleLowerCase("ja-JP");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { fonts, scannedAt: new Date().toISOString(), platform: process.platform };
}

async function scanSystemFonts(): Promise<SystemFontInfo[]> {
  const familyNames = new Set(commonFontFamilies());
  if (process.platform === "win32") {
    const fontsDir = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
    try {
      for (const entry of await readdir(fontsDir)) {
        const family = familyFromFileName(entry);
        if (family) familyNames.add(family);
      }
    } catch {
      // Keep common font fallback list if the OS font directory cannot be read.
    }
  }
  return [...familyNames].sort((left, right) => left.localeCompare(right, "ja-JP", { sensitivity: "base" })).map((family) => ({
    id: `font-family:${slug(family)}`,
    family,
    displayName: family,
    source: "system" as const,
    styles: ["Regular"]
  }));
}

async function scanAssetFonts(rootDir: string): Promise<SystemFontInfo[]> {
  const assets = await loadCatalog(rootDir);
  return assets
    .filter((asset) => asset.kind === "font")
    .map((asset) => ({
      id: `asset-font:${asset.id}`,
      family: asset.name,
      displayName: asset.name,
      source: "asset" as const,
      styles: ["Regular"],
      assetId: asset.id,
      contentUrl: asset.contentUrl
    }));
}

function commonFontFamilies(): string[] {
  return ["Impact", "Arial", "Segoe UI", "Yu Gothic", "Meiryo", "BIZ UDPGothic", "BIZ UDGothic", "Noto Sans JP", "sans-serif"];
}

function familyFromFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (![".ttf", ".otf", ".ttc", ".woff", ".woff2"].includes(extension)) return "";
  return path
    .basename(fileName, extension)
    .replace(/[_-]/gu, " ")
    .replace(/\b(bold|italic|regular|medium|light|semibold|black|thin|oblique)\b/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
