import { describe, expect, it, vi } from "vitest";
import type { EffectPlayMessage, OverlayId } from "@obs-effect/shared-types";
import { SimpleMediaQueueService } from "./SimpleMediaQueueService.js";

function message(instanceId: string, targetOverlayId: OverlayId): EffectPlayMessage {
  return {
    type: "effect:play",
    effectId: "simple-media",
    instanceId,
    targetOverlayId,
    createdAt: new Date().toISOString()
  };
}

describe("SimpleMediaQueueService", () => {
  it("plays Simple Media one at a time across different overlays", async () => {
    const broadcasts: Array<{ overlayId: OverlayId; message: EffectPlayMessage }> = [];
    const queue = new SimpleMediaQueueService({
      broadcast: (overlayId, effect) => broadcasts.push({ overlayId, message: effect })
    });

    queue.enqueue({ instanceId: "first", targetOverlayId: 1, createMessage: () => message("first", 1) });
    queue.enqueue({ instanceId: "second", targetOverlayId: 2, createMessage: () => message("second", 2) });
    await vi.waitFor(() => expect(broadcasts).toHaveLength(1));
    expect(broadcasts[0]?.overlayId).toBe(1);

    expect(queue.complete("unrelated")).toBe(false);
    expect(broadcasts).toHaveLength(1);
    expect(queue.complete("first")).toBe(true);
    await vi.waitFor(() => expect(broadcasts).toHaveLength(2));
    expect(broadcasts[1]?.overlayId).toBe(2);
    queue.dispose();
  });

  it("uses 1.1x playback when more than ten items are waiting", async () => {
    const broadcasts: EffectPlayMessage[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = new SimpleMediaQueueService({ broadcast: (_overlayId, effect) => broadcasts.push(effect) });

    queue.enqueue({
      instanceId: "item-0",
      targetOverlayId: 1,
      createMessage: async () => {
        await firstReady;
        return message("item-0", 1);
      }
    });
    for (let index = 1; index <= 12; index += 1) {
      queue.enqueue({ instanceId: `item-${index}`, targetOverlayId: 1, createMessage: () => message(`item-${index}`, 1) });
    }
    releaseFirst?.();
    await vi.waitFor(() => expect(broadcasts).toHaveLength(1));
    expect(broadcasts[0]?.runtimeData?.simpleMediaPlaybackRate).toBe(1.1);
    expect(broadcasts[0]?.runtimeData?.simpleMediaQueueWaitingCount).toBe(12);
    queue.dispose();
  });
});
