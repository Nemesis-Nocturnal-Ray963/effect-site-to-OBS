import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSoundboardRemoteApp } from "./createSoundboardRemoteApp.js";

describe("soundboard remote app", () => {
  it("does not expose control pages or administration APIs", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-soundboard-remote-"));
    const app = await createSoundboardRemoteApp({ rootDir: temporaryRoot, targetBaseUrl: "http://127.0.0.1:1" });
    await app.ready();
    try {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/control/dashboard" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/assets" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/v1/http-api/key/regenerate" })).statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
