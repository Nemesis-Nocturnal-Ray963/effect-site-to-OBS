import { describe, expect, it } from "vitest";
import type {
  EffectConfiguration,
  EffectPlayMessage,
  NormalizedEvent
} from "@obs-effect/shared-types";
import { GiftPileEffectService } from "./giftPile.js";

const configuration = {
  id: "pile",
  targetOverlayId: 1,
  visual: { parameters: {}, opacity: 1, zIndex: 10 }
} as EffectConfiguration;
function gift(type: NormalizedEvent["type"], count: number, id: string): NormalizedEvent {
  return {
    schemaVersion: "1.0",
    eventId: id,
    type,
    platform: "tiktok",
    source: "tiktok-direct",
    timestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    user: { id: "alice" },
    data: { giftId: "rose", repeatCount: count, diamondValueTotal: 99999 }
  };
}

describe("gift pile delivery", () => {
  it("counts a 1 → 2 → 10 → end combo exactly once, independently of coin value", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new GiftPileEffectService((_id, message) => sent.push(message));
    const events = [
      gift("gift", 1, "1"),
      gift("gift-streak-update", 2, "2"),
      gift("gift-streak-update", 10, "3"),
      gift("gift-streak-end", 10, "4")
    ];
    for (const event of events) service.execute(configuration, event);
    service.execute(configuration, events[2]);
    expect(sent.map((message) => message.parameters?.quantity)).toEqual([1, 1, 8]);
    service.execute(configuration, gift("gift", 1, "new"));
    service.execute(configuration, gift("gift-streak-end", 3, "next-end"));
    expect(sent.slice(-2).map((message) => message.parameters?.quantity)).toEqual([1, 2]);
  });

  it("handles bulk gifts, separate senders, missing images and clear commands", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new GiftPileEffectService((_id, message) => sent.push(message));
    const event = gift("gift-streak-end", 10, "ten");
    event.data.primaryGiftImageUrl = "https://example.com/rose.png";
    expect(service.execute(configuration, event).spawnedObjectCount).toBe(10);
    expect(sent[0]?.media?.imageUrl).toBe("https://example.com/rose.png");
    const other = gift("gift-streak-update", 5, "bob");
    other.user = { id: "bob" };
    expect(service.execute(configuration, other).spawnedObjectCount).toBe(5);
    expect(sent[1]?.media?.imageUrl).toBeUndefined();
    service.clear(1);
    expect(sent[2]?.parameters?.action).toBe("clear");
    const end = gift("gift-streak-end", 5, "bob-end");
    end.user = { id: "bob" };
    expect(service.execute(configuration, end).spawnedObjectCount).toBe(0);
    expect(service.execute(configuration, gift("follow", 1, "follow")).spawnedObjectCount).toBe(0);
  });
});
