import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { SoundboardBoard } from "@obs-effect/shared-types";
import { createApp } from "../../app.js";

describe("soundboard routes", () => {
  it("persists a board and requires its token for remote playback", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-soundboard-"));
    const assetsDir = path.join(temporaryRoot, "data", "assets");
    await mkdir(path.join(assetsDir, "files"), { recursive: true });
    await writeFile(path.join(assetsDir, "catalog.json"), JSON.stringify({ assets: [{
      id: "alpha-video",
      kind: "video",
      name: "Alpha video",
      fileName: "alpha.webm",
      contentUrl: "/asset-files/alpha.webm",
      mimeType: "video/webm",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "local-copy",
      tags: ["alpha"],
      hasEmbeddedAudio: true
    }] }), "utf8");
    const app = await createApp({ rootDir: temporaryRoot });
    await app.ready();
    try {
      const initial = await app.inject({ method: "GET", url: "/api/v1/soundboard" });
      expect(initial.statusCode).toBe(200);
      const config = initial.json() as { board: SoundboardBoard; accessToken: string; remoteUrl: string };
      expect(config.accessToken.length).toBeGreaterThan(20);
      expect(config.remoteUrl).toContain("/control/soundboard/remote?token=");

      const pad = { ...config.board.pads[0]!, label: "Test pad", visualAssetId: "alpha-video" };
      const saved = await app.inject({
        method: "PUT",
        url: "/api/v1/soundboard",
        payload: { ...config.board, pads: [pad] }
      });
      expect(saved.statusCode).toBe(200);

      const unauthorized = await app.inject({ method: "POST", url: `/api/v1/soundboard/pads/${pad.id}/play` });
      expect(unauthorized.statusCode).toBe(401);

      const played = await app.inject({
        method: "POST",
        url: `/api/v1/soundboard/pads/${pad.id}/play`,
        headers: { "x-soundboard-token": config.accessToken }
      });
      expect(played.statusCode).toBe(200);
      expect(played.json()).toMatchObject({ accepted: true, visual: true, audio: true });
    } finally {
      await app.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
