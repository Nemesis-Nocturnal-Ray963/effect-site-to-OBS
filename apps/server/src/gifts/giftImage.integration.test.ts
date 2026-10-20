import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import { createApp } from "../app.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it("uses a local cached image for catalog previews and both effect test paths, including name-only lookup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gift-image-integration-"));
  roots.push(root);
  const download = vi.fn(async () => png);
  const apiKey = "gift-cache-integration-key-123456";
  vi.stubEnv("EFFECT_APP_API_KEY", apiKey);
  const app = await createApp({ rootDir: root, giftImageDownload: download });
  await app.ready();
  const socket = await app.injectWS("/ws/overlay/1");
  const messages: EffectPlayMessage[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === "effect:play") messages.push(message);
  });
  const source = "https://cdn.example.test/gift.webp";
  let giftId = "";
  let localUrl = "";
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/gifts", payload: {
      name: "Picker label", matchName: "Received name", coinValue: 100, primaryImageUrl: source
    } });
    const gift = created.json().gift;
    giftId = gift.id;
    const preview = await app.inject({ method: "GET", url: `/api/v1/gifts/${encodeURIComponent(gift.id)}/image` });
    expect(preview.statusCode).toBe(302);
    localUrl = preview.headers.location!;
    expect(localUrl).toMatch(/^\/gift-images\/[a-f0-9]{64}\.png$/);
    const image = await app.inject({ method: "GET", url: localUrl });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.rawPayload).toEqual(png);
    for (const effectDefinitionId of ["gift-pile", "simple-media"]) {
      const effect = (await app.inject({ method: "POST", url: "/api/v1/effect-configurations", payload: {
        effectDefinitionId, visual: { parameters: { imageSourceMode: "gift-image" } }
      } })).json().configuration;
      const result = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${effect.id}/test`, payload: {
        gift: { platformGiftId: "actual-platform-id", name: "Received name", coinValue: 100 }
      } });
      expect(result.statusCode).toBe(200);
    }
    await expect.poll(() => messages.length).toBe(2);
    expect(messages.map((message) => message.media?.imageUrl)).toEqual([localUrl, localUrl]);
    const preset = (await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Cached live gift" } })).json().preset;
    const slot = (await app.inject({ method: "POST", url: `/api/v1/presets/${preset.id}/slots` })).json().slot;
    await app.inject({ method: "PATCH", url: `/api/v1/presets/${preset.id}/slots/${slot.id}`, payload: {
      effectDefinitionId: "gift-pile", trigger: { mode: "any", conditions: [{
        type: "gift-specific", platform: "tiktok", platformGiftId: gift.platformGiftId, giftName: "Received name", triggerOn: "gift"
      }] }, visual: { parameters: { coinImageRulesJson: '[{"minCoinValue":0,"maxCoinValue":100,"sizePx":88}]' } }
    } });
    await app.inject({ method: "POST", url: `/api/v1/presets/${preset.id}/save` });
    await app.inject({ method: "POST", url: "/api/v1/events", headers: { "x-effect-app-key": apiKey }, payload: {
      schemaVersion: "1.0", eventId: "live-cached-image", type: "gift", platform: "tiktok", source: "test",
      timestamp: new Date().toISOString(), data: { giftId: "actual-platform-id", giftName: "Received name", repeatCount: 1 }
    } });
    await expect.poll(() => messages.length).toBe(3);
    expect(messages[2]!.media?.imageUrl).toBe(localUrl);
    expect(messages[2]!.parameters?.objectSizePx).toBe(88);
    expect(download).toHaveBeenCalledTimes(1);
    const saved = (await app.inject({ method: "GET", url: `/api/v1/gifts/${encodeURIComponent(gift.id)}` })).json().gift;
    expect(saved.image).toMatchObject({ primaryUrl: source, cacheStatus: "cached", mimeType: "image/png" });
    expect(saved.image.localPath).toMatch(/^data\/gifts\/images\//);
    const persisted = JSON.parse(await readFile(path.join(root, "data/gifts/catalog.json"), "utf8"));
    expect(persisted.records[0].image.primaryUrl).toBe(source);
  } finally {
    socket.terminate();
    await app.close();
  }
  const offline = vi.fn(async () => { throw new Error("offline"); });
  const restarted = await createApp({ rootDir: root, giftImageDownload: offline });
  try {
    const response = await restarted.inject({ method: "GET", url: `/api/v1/gifts/${encodeURIComponent(giftId)}/image` });
    expect(response.headers.location).toBe(localUrl);
    expect(offline).not.toHaveBeenCalled();
    await restarted.inject({ method: "DELETE", url: `/api/v1/gifts/${encodeURIComponent(giftId)}` });
    const filePath = path.join(root, "data/gifts/images", path.basename(localUrl));
    expect((await stat(filePath)).size).toBe(png.length);
    expect((await restarted.inject({ method: "GET", url: localUrl })).rawPayload).toEqual(png);
  } finally {
    await restarted.close();
  }
});

it("does not stop an effect when its image cannot be downloaded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gift-image-failed-"));
  roots.push(root);
  const app = await createApp({ rootDir: root, giftImageDownload: async () => { throw new Error("offline"); } });
  try {
    const effect = (await app.inject({ method: "POST", url: "/api/v1/effect-configurations", payload: { effectDefinitionId: "gift-pile" } })).json().configuration;
    const result = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${effect.id}/test`, payload: {
      gift: { coinValue: 1, imageUrl: "https://cdn.example.test/unavailable.png" }
    } });
    expect(result.json()).toMatchObject({ accepted: true, spawnedObjectCount: 1 });
  } finally {
    await app.close();
  }
});
