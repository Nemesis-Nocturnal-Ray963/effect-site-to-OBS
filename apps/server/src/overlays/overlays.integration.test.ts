import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("dynamic overlay API", () => {
  it("adds overlay 11 and exposes its page and status", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "dynamic-overlay-"));
    roots.push(rootDir);
    const overlayDist = path.join(rootDir, "apps", "overlay", "dist");
    await mkdir(overlayDist, { recursive: true });
    await writeFile(
      path.join(overlayDist, "index.html"),
      '<!doctype html><html><head><script type="module" src="/overlay/assets/index-new.js"></script></head><body></body></html>',
      "utf8"
    );
    const app = await createApp({ rootDir });
    try {
      const created = await app.inject({ method: "POST", url: "/api/v1/overlays" });
      expect(created.statusCode).toBe(201);
      expect(created.json().overlay).toMatchObject({ overlayId: 11, name: "Overlay 11", isInUse: false });

      const listed = await app.inject({ method: "GET", url: "/api/v1/overlays" });
      expect(listed.json().overlays).toHaveLength(11);
      expect((await app.inject({ method: "GET", url: "/api/v1/overlays/11" })).statusCode).toBe(200);
      const document = await app.inject({ method: "GET", url: "/overlay/11" });
      expect(document.statusCode).toBe(200);
      expect(document.headers["cache-control"]).toContain("no-store");
      expect(document.headers.pragma).toBe("no-cache");
      expect(document.body).toMatch(/meta name="obs-effect-overlay-version" content="[a-f0-9]{16}"/u);
    } finally {
      await app.close();
    }
  });
});
