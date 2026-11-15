import { describe, expect, it } from "vitest";
import type { EffectConfiguration, EffectPlayMessage, NormalizedEvent } from "@obs-effect/shared-types";
import { TetheredGiftEffectService } from "./tetheredGift.js";

const configuration = {
  id: "tethered",
  targetOverlayId: 2,
  visual: { parameters: { ropeLengthPx: 360 }, opacity: 0.8, zIndex: 12, size: { scale: 1.5 } },
  playback: { durationMs: 4200 }
} as unknown as EffectConfiguration;

function gift(type: NormalizedEvent["type"], count: number, eventId: string): NormalizedEvent {
  return {
    schemaVersion: "1.0",
    eventId,
    type,
    platform: "tiktok",
    source: "tiktok-direct",
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    user: { id: "alice" },
    data: { giftId: "rose", repeatCount: count }
  };
}

describe("tethered gift delivery", () => {
  it("sends rope, display, image, size, and quantity settings to the overlay", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new TetheredGiftEffectService((_overlayId, message) => sent.push(message));
    expect(service.execute(configuration, gift("gift", 3, "one"), "/asset-files/rose.png")).toEqual({
      spawnedObjectCount: 3,
      skipped: false
    });
    expect(sent[0]).toMatchObject({
      effectId: "tethered-gift",
      targetOverlayId: 2,
      parameters: { ropeLengthPx: 360, quantity: 3, objectSizePx: 132 },
      media: { imageUrl: "/asset-files/rose.png" },
      playback: { durationMs: 4200 }
    });
  });

  it("adds only the new gifts in a combo and ignores duplicate events", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new TetheredGiftEffectService((_overlayId, message) => sent.push(message));
    const events = [
      gift("gift-streak-start", 1, "start"),
      gift("gift-streak-update", 3, "three"),
      gift("gift-streak-end", 3, "end")
    ];
    for (const event of events) service.execute(configuration, event);
    service.execute(configuration, events[1]);
    expect(sent.map((message) => message.parameters?.quantity)).toEqual([1, 2]);
  });
});
