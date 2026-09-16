import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import { createApp } from "./app.js";

it("delivers every combo increment through a saved preset and clears only the chosen overlay", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "gift-pile-integration-"));
  vi.stubEnv("EFFECT_APP_API_KEY", "gift-pile-integration-test-key-123456");
  const app = await createApp({ rootDir });
  await app.ready();
  const socket = await app.injectWS("/ws/overlay/1");
  const otherSocket = await app.injectWS("/ws/overlay/2");
  const messages: EffectPlayMessage[] = [],
    other: EffectPlayMessage[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.effectId === "gift-pile") messages.push(message);
  });
  otherSocket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.effectId === "gift-pile") other.push(message);
  });
  try {
    const definitions = (
      await app.inject({ method: "GET", url: "/api/v1/effect-definitions" })
    ).json().definitions;
    expect(
      definitions.find((definition: { id: string }) => definition.id === "gift-pile")
    ).toBeTruthy();
    const preset = (
      await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Pile" } })
    ).json().preset;
    const base = `/api/v1/presets/${preset.id}`;
    const slot = (await app.inject({ method: "POST", url: `${base}/slots` })).json().slot;
    const updated = await app.inject({
      method: "PATCH",
      url: `${base}/slots/${slot.id}`,
      payload: { effectDefinitionId: "gift-pile" }
    });
    expect(updated.json().slot.trigger.conditions[0].type).toBe("gift-any");
    const saved = (await app.inject({ method: "POST", url: `${base}/save` })).json();
    expect(saved.configurations[0].visual.parameters.objectSizePx).toBe(44);
    for (const [index, [type, count]] of [
      ["gift", 1],
      ["gift-streak-update", 2],
      ["gift-streak-update", 10],
      ["gift-streak-end", 10]
    ].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": "gift-pile-integration-test-key-123456" },
        payload: {
          schemaVersion: "1.0",
          eventId: `combo-${index}`,
          source: "test",
          platform: "tiktok",
          type,
          timestamp: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          user: { id: "alice" },
          data: { giftId: "rose", repeatCount: count }
        }
      });
      expect(response.statusCode).toBe(202);
      // Event subscribers execute asynchronously after the HTTP acknowledgement.
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await expect.poll(() => messages.length).toBe(3);
    expect(messages.map((message) => message.parameters?.quantity)).toEqual([1, 1, 8]);
    const test = await app.inject({
      method: "POST",
      url: `/api/v1/effect-configurations/${saved.configurations[0].id}/test`
    });
    expect(test.json().spawnedObjectCount).toBe(1);
    const cleared = await app.inject({ method: "DELETE", url: "/api/v1/overlays/1/gift-pile" });
    expect(cleared.json().cleared).toBe(true);
    await expect.poll(() => messages.at(-1)?.parameters?.action).toBe("clear");
    expect(other).toHaveLength(0);
    expect(
      (await app.inject({ method: "DELETE", url: "/api/v1/overlays/99/gift-pile" })).statusCode
    ).toBe(404);
  } finally {
    socket.terminate();
    otherSocket.terminate();
    await app.close();
    vi.unstubAllEnvs();
    await rm(rootDir, { recursive: true, force: true });
  }
});
