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

  it("advances after the video duration plus 0.5 seconds when completion is missing", async () => {
    vi.useFakeTimers();
    try {
      const broadcasts: EffectPlayMessage[] = [];
      const queue = new SimpleMediaQueueService({ broadcast: (_overlayId, effect) => broadcasts.push(effect) });
      queue.enqueue({ instanceId: "first", targetOverlayId: 1, createMessage: () => message("first", 1) });
      queue.enqueue({ instanceId: "second", targetOverlayId: 1, createMessage: () => message("second", 1) });
      await vi.advanceTimersByTimeAsync(0);
      expect(broadcasts).toHaveLength(1);
      expect(queue.reportVideoDuration("first", 1000)).toBe(true);

      await vi.advanceTimersByTimeAsync(1499);
      expect(broadcasts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(broadcasts).toHaveLength(2);
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the server-resolved video duration without waiting for overlay metadata", async () => {
    vi.useFakeTimers();
    try {
      const broadcasts: EffectPlayMessage[] = [];
      const queue = new SimpleMediaQueueService({ broadcast: (_overlayId, effect) => broadcasts.push(effect) });
      const first = { ...message("first", 1), media: { videoUrl: "/first.webm", videoDurationMs: 1000 } };
      queue.enqueue({ instanceId: "first", targetOverlayId: 1, createMessage: () => first });
      queue.enqueue({ instanceId: "second", targetOverlayId: 1, createMessage: () => message("second", 1) });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(1499);
      expect(broadcasts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(broadcasts).toHaveLength(2);
      queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits to dispatch until the target overlay is connected", async () => {
    let connected = false;
    const broadcasts: EffectPlayMessage[] = [];
    const queue = new SimpleMediaQueueService({
      broadcast: (_overlayId, effect) => broadcasts.push(effect),
      canDispatch: () => connected
    });
    queue.enqueue({ instanceId: "waiting", targetOverlayId: 8, createMessage: () => message("waiting", 8) });
    await Promise.resolve();
    expect(broadcasts).toHaveLength(0);
    expect(queue.status()).toMatchObject({ activeInstanceId: null, waitingCount: 1 });

    connected = true;
    queue.notifyAvailabilityChanged();
    await vi.waitFor(() => expect(broadcasts).toHaveLength(1));
    expect(queue.status()).toMatchObject({ activeInstanceId: "waiting", activeTargetOverlayId: 8, waitingCount: 0 });
    queue.dispose();
  });
});
