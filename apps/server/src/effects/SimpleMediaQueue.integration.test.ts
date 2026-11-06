import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import { createApp } from "../app.js";

it("waits for the active overlay to finish before playing Simple Media on another overlay", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "obs-effect-simple-media-queue-"));
  const app = await createApp({ rootDir });
  await app.ready();
  const overlay1 = await app.injectWS("/ws/overlay/1");
  const overlay2 = await app.injectWS("/ws/overlay/2");
  const played1: EffectPlayMessage[] = [];
  const played2: EffectPlayMessage[] = [];
  overlay1.on("message", (data) => {
    const message = JSON.parse(data.toString()) as EffectPlayMessage;
    if (message.type === "effect:play" && message.effectId === "simple-media") played1.push(message);
  });
  overlay2.on("message", (data) => {
    const message = JSON.parse(data.toString()) as EffectPlayMessage;
    if (message.type === "effect:play" && message.effectId === "simple-media") played2.push(message);
  });

  try {
    const first = (await app.inject({
      method: "POST",
      url: "/api/v1/effect-configurations",
      payload: { effectDefinitionId: "simple-media", targetOverlayId: 1 }
    })).json().configuration;
    const second = (await app.inject({
      method: "POST",
      url: "/api/v1/effect-configurations",
      payload: { effectDefinitionId: "simple-media", targetOverlayId: 2 }
    })).json().configuration;

    await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${first.id}/test` });
    await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${second.id}/test` });
    await vi.waitFor(() => expect(played1).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(played2).toHaveLength(0);

    overlay1.send(JSON.stringify({
      type: "effect:simple-media-complete",
      overlayId: 1,
      instanceId: played1[0]!.instanceId,
      createdAt: new Date().toISOString()
    }));
    await vi.waitFor(() => expect(played2).toHaveLength(1));
  } finally {
    overlay1.terminate();
    overlay2.terminate();
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
