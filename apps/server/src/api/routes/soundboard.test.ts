import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { SoundboardBoard } from "@obs-effect/shared-types";
import { createApp } from "../../app.js";

describe("soundboard routes", () => {
  it("persists a board and requires its token for remote playback", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-soundboard-"));
    const app = await createApp({ rootDir: temporaryRoot });
    await app.ready();
    try {
      const initial = await app.inject({ method: "GET", url: "/api/v1/soundboard" });
      expect(initial.statusCode).toBe(200);
      const config = initial.json() as { board: SoundboardBoard; accessToken: string; remoteUrl: string };
      expect(config.accessToken.length).toBeGreaterThan(20);
      expect(config.remoteUrl).toContain("/control/soundboard/remote?token=");

      const pad = { ...config.board.pads[0]!, label: "Test pad", visualAssetId: "sample-test-card" };
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
      expect(played.json()).toMatchObject({ accepted: true, visual: true, audio: false });
    } finally {
      await app.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
