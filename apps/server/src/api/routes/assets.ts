import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AssetCatalogItem, AssetKind } from "@obs-effect/shared-types";

interface AssetCatalogFile {
  assets: AssetCatalogItem[];
}

const uploadBodyLimit = 500 * 1024 * 1024;

const fallbackAssets: AssetCatalogItem[] = [
  {
    id: "sample-test-card",
    kind: "image",
    name: "Test Pattern Card",
    description: "Local bundled image for effect and overlay testing.",
    fileName: "test-pattern-card.svg",
    contentUrl: "/asset-files/test-pattern-card.svg",
    mimeType: "image/svg+xml",
    width: 512,
    height: 512,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    source: "bundled",
    tags: ["test", "sample"]
  }
];

export async function registerAssetRoutes(app: FastifyInstance, rootDir: string): Promise<void> {
  app.addContentTypeParser(/^image\/.+$/u, { parseAs: "buffer", bodyLimit: uploadBodyLimit }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(/^video\/.+$/u, { parseAs: "buffer", bodyLimit: uploadBodyLimit }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(/^audio\/.+$/u, { parseAs: "buffer", bodyLimit: uploadBodyLimit }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(/^font\/.+$/u, { parseAs: "buffer", bodyLimit: uploadBodyLimit }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: uploadBodyLimit }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/api/v1/assets", async () => ({ assets: await loadCatalog(rootDir) }));

  app.patch("/api/v1/assets/:id", async (request, reply) => {
    const assetId = assetIdFromParams(request.params);
    const name = nameFromBody(request.body);
    if (!assetId) return reply.code(400).send({ error: "Asset id is required" });
    if (!name) return reply.code(400).send({ error: "Asset name is required" });

    const asset = await renameAsset(rootDir, assetId, name);
    if (asset === "not-found") return reply.code(404).send({ error: "Asset not found" });
    if (asset === "readonly") return reply.code(403).send({ error: "Only uploaded assets can be renamed" });

    return { asset };
  });

  app.delete("/api/v1/assets/:id", async (request, reply) => {
    const assetId = assetIdFromParams(request.params);
    if (!assetId) return reply.code(400).send({ error: "Asset id is required" });

    const deleted = await deleteAsset(rootDir, assetId);
    if (deleted === "not-found") return reply.code(404).send({ error: "Asset not found" });
    if (deleted === "readonly") return reply.code(403).send({ error: "Only uploaded assets can be deleted" });

    return { deleted: true, asset: deleted };
  });

  app.put("/api/v1/assets/upload", { bodyLimit: uploadBodyLimit }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return reply.code(400).send({ error: "Upload body must be a non-empty file" });
    }

    const fileName = filenameFromQuery(request.query);
    const mimeType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
    const kind = kindFromMimeType(mimeType) ?? kindFromFileName(fileName);

    if (!kind) {
      return reply.code(415).send({ error: "Only image, video, audio, and font assets can be uploaded" });
    }

    const asset = await saveUploadedAsset(rootDir, {
      body: request.body,
      originalFileName: fileName,
      mimeType,
      kind,
      now: new Date().toISOString()
    });

    return reply.code(201).send({ asset });
  });
}

export async function loadCatalog(rootDir: string): Promise<AssetCatalogItem[]> {
  const catalogPath = path.join(rootDir, "data", "assets", "catalog.json");
  try {
    const raw = await readFile(catalogPath, "utf8");
    const parsed = JSON.parse(stripBom(raw)) as Partial<AssetCatalogFile>;
    return Array.isArray(parsed.assets) ? parsed.assets : fallbackAssets;
  } catch {
    return fallbackAssets;
  }
}

async function writeCatalog(rootDir: string, assets: AssetCatalogItem[]): Promise<void> {
  const assetsDir = path.join(rootDir, "data", "assets");
  await mkdir(assetsDir, { recursive: true });
  const nextCatalog: AssetCatalogFile = { assets };
  await writeFile(path.join(assetsDir, "catalog.json"), `${JSON.stringify(nextCatalog, null, 2)}\n`, "utf8");
}

async function saveUploadedAsset(
  rootDir: string,
  upload: { body: Buffer; originalFileName: string; mimeType: string; kind: AssetKind; now: string }
): Promise<AssetCatalogItem> {
  const assetsDir = path.join(rootDir, "data", "assets");
  const filesDir = path.join(assetsDir, "files");
  await mkdir(filesDir, { recursive: true });

  const safeOriginalName = sanitizeFileName(upload.originalFileName);
  const extension = path.extname(safeOriginalName);
  const baseName = path.basename(safeOriginalName, extension);
  const id = `asset-${slugify(baseName)}-${Date.now().toString(36)}`;
  const storedFileName = `${id}${extension || extensionFromMimeType(upload.mimeType)}`;

  await writeFile(path.join(filesDir, storedFileName), upload.body);

  const asset: AssetCatalogItem = {
    id,
    kind: upload.kind,
    name: baseName || "Uploaded asset",
    description: "Uploaded from the control UI.",
    fileName: storedFileName,
    contentUrl: `/asset-files/${encodeURIComponent(storedFileName)}`,
    mimeType: upload.mimeType,
    sizeBytes: upload.body.length,
    createdAt: upload.now,
    updatedAt: upload.now,
    source: "local-copy",
    tags: ["uploaded"]
  };

  const catalog = await loadCatalog(rootDir);
  await writeCatalog(rootDir, [asset, ...catalog]);
  return asset;
}

async function renameAsset(rootDir: string, assetId: string, name: string): Promise<AssetCatalogItem | "not-found" | "readonly"> {
  const catalog = await loadCatalog(rootDir);
  const asset = catalog.find((item) => item.id === assetId);
  if (!asset) return "not-found";
  if (asset.source !== "local-copy") return "readonly";

  const nextAsset: AssetCatalogItem = {
    ...asset,
    name,
    updatedAt: new Date().toISOString()
  };
  await writeCatalog(
    rootDir,
    catalog.map((item) => (item.id === assetId ? nextAsset : item))
  );
  return nextAsset;
}

async function deleteAsset(rootDir: string, assetId: string): Promise<AssetCatalogItem | "not-found" | "readonly"> {
  const catalog = await loadCatalog(rootDir);
  const asset = catalog.find((item) => item.id === assetId);
  if (!asset) return "not-found";
  if (asset.source !== "local-copy") return "readonly";

  const filesDir = path.join(rootDir, "data", "assets", "files");
  const storedPath = path.join(filesDir, path.basename(asset.fileName));
  await unlink(storedPath).catch(() => undefined);
  await writeCatalog(
    rootDir,
    catalog.filter((item) => item.id !== assetId)
  );
  return asset;
}

function assetIdFromParams(params: unknown): string | null {
  if (params && typeof params === "object" && "id" in params && typeof params.id === "string") {
    return params.id;
  }
  return null;
}

function nameFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string") return null;
  const name = sanitizeDisplayName(body.name);
  return name || null;
}

function filenameFromQuery(query: unknown): string {
  if (query && typeof query === "object" && "filename" in query && typeof query.filename === "string") {
    return query.filename;
  }
  return "uploaded-asset";
}

function sanitizeFileName(fileName: string): string {
  const baseName = path
    .basename(fileName)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");
  return baseName || "uploaded-asset";
}

function sanitizeDisplayName(value: string): string {
  return value.normalize("NFC").replace(/[\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return slug || "uploaded";
}

function kindFromMimeType(mimeType: string): AssetKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("font/")) return "font";
  if (["application/font-woff", "application/x-font-ttf", "application/x-font-otf", "application/vnd.ms-fontobject"].includes(mimeType)) return "font";
  return null;
}

function kindFromFileName(fileName: string): AssetKind | null {
  const extension = path.extname(fileName).toLowerCase();
  if ([".apng", ".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(extension)) return "image";
  if ([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm", ".wmv"].includes(extension)) return "video";
  if ([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extension)) return "audio";
  if ([".otf", ".ttc", ".ttf", ".woff", ".woff2"].includes(extension)) return "font";
  return null;
}

function extensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
    "video/x-matroska": ".mkv",
    "video/x-msvideo": ".avi",
    "video/x-ms-wmv": ".wmv",
    "video/mpeg": ".mpeg",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "font/otf": ".otf",
    "font/ttf": ".ttf",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "application/font-woff": ".woff",
    "application/x-font-otf": ".otf",
    "application/x-font-ttf": ".ttf"
  };
  return extensions[mimeType] ?? "";
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
