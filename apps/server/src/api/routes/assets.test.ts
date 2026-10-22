import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { AssetCatalogItem } from "@obs-effect/shared-types";
import { registerAssetRoutes } from "./assets.js";

const requireFromHere = createRequire(import.meta.url);
const ffmpegPath = requireFromHere("ffmpeg-static") as string;

describe("asset MOV conversion", () => {
  it("keeps the MOV source and exposes an alpha VP9 WebM", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-assets-"));
    const inputPath = path.join(temporaryRoot, "alpha.mov");
    const app = Fastify();
    await registerAssetRoutes(app, temporaryRoot);
    await app.ready();

    try {
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi",
        "-i", "color=c=red@0.5:s=32x32:d=0.2,format=rgba",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=0.2",
        "-shortest",
        "-c:v", "prores_ks",
        "-profile:v", "4",
        "-pix_fmt", "yuva444p10le",
        "-c:a", "pcm_s16le",
        inputPath
      ]);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/assets/upload?filename=alpha.mov",
        headers: { "content-type": "video/quicktime" },
        payload: await readFile(inputPath)
      });

      expect(response.statusCode).toBe(201);
      const asset = (response.json() as { asset: AssetCatalogItem }).asset;
      expect(asset).toMatchObject({
        kind: "video",
        mimeType: "video/webm",
        hasEmbeddedAudio: true,
        conversion: { type: "mov-to-webm-alpha", videoCodec: "vp9", alphaPreserved: true }
      });
      expect(asset.fileName).toMatch(/\.webm$/u);
      expect(asset.convertedFrom?.fileName).toMatch(/\.source\.mov$/u);

      const filesDir = path.join(temporaryRoot, "data", "assets", "files");
      const webmPath = path.join(filesDir, asset.fileName);
      await expect(access(webmPath)).resolves.toBeUndefined();
      await expect(access(path.join(filesDir, asset.convertedFrom!.fileName))).resolves.toBeUndefined();

      const decodedPath = path.join(temporaryRoot, "decoded.rgba");
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-c:v", "libvpx-vp9",
        "-i", webmPath,
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        decodedPath
      ]);
      const decoded = await readFile(decodedPath);
      const alphaValues = Array.from({ length: Math.floor(decoded.length / 4) }, (_, index) => decoded[(index * 4) + 3]!);
      expect(alphaValues.some((alpha) => alpha < 250)).toBe(true);

      const deleted = await app.inject({ method: "DELETE", url: `/api/v1/assets/${asset.id}` });
      expect(deleted.statusCode).toBe(200);
      await expect(access(path.join(filesDir, asset.fileName))).rejects.toThrow();
      await expect(access(path.join(filesDir, asset.convertedFrom!.fileName))).rejects.toThrow();
    } finally {
      await app.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited with ${code}`)));
  });
}
