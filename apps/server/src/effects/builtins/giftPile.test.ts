import { describe, expect, it } from "vitest";
import type {
  EffectConfiguration,
  EffectPlayMessage,
  NormalizedEvent
} from "@obs-effect/shared-types";
import { GiftPileEffectService, resolveCoinImageUrl, resolveGiftObjectSize } from "./giftPile.js";

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
  it.each([[0, 88], [1, 88], [100, 88], [101, 120], [200, 120], [201, 44]])(
    "resolves an inclusive coin range for a %s-coin gift", (coinValue, size) => {
      const event = gift("gift", 1, `range-${coinValue}`);
      event.data.coinValue = coinValue;
      expect(resolveGiftObjectSize({
        objectSizePx: 44,
        coinImageRulesJson: JSON.stringify([
          { minCoinValue: 0, maxCoinValue: 100, sizePx: 88 },
          { minCoinValue: 101, maxCoinValue: 200, sizePx: 120 }
        ])
      }, event)).toBe(size);
    }
  );

  it("uses gift overrides before ranges, and the first matching size in overlapping ranges", () => {
    const event = gift("gift", 1, "range-priority");
    event.data.coinValue = 50;
    const ranges = JSON.stringify([
      { minCoinValue: 0, maxCoinValue: 100, sizePx: 88 },
      { minCoinValue: 50, maxCoinValue: 150, sizePx: 120 }
    ]);
    expect(resolveGiftObjectSize({ coinImageRulesJson: ranges }, event)).toBe(88);
    expect(resolveGiftObjectSize({ coinImageRulesJson: ranges, giftSizeOverridesJson: '[{"giftId":"rose","sizePx":160}]' }, event)).toBe(160);
  });

  it("ignores malformed ranges, unknown prices, and size-free image rules", () => {
    const event = gift("gift", 1, "range-validation");
    event.data = { giftId: "rose", coinValue: 50 };
    const parameters = { objectSizePx: 55, coinImageRulesJson: JSON.stringify([
      { minCoinValue: 0, sizePx: 500 },
      { minCoinValue: 100, maxCoinValue: 0, sizePx: 500 },
      { minCoinValue: -1, maxCoinValue: 100, sizePx: 500 },
      { minCoinValue: "0", maxCoinValue: 100, sizePx: 500 },
      { minCoinValue: 0, maxCoinValue: 100, sizePx: null, imageUrl: "/asset-files/image-only.png" },
      { minCoinValue: 0, maxCoinValue: 100, sizePx: 88 }
    ]) };
    expect(resolveGiftObjectSize(parameters, event)).toBe(88);
    event.data = { giftId: "rose", repeatCount: 1 };
    expect(resolveGiftObjectSize(parameters, event)).toBe(55);
  });

  it("uses the per-gift price instead of the combo total and can derive it from the total", () => {
    const event = gift("gift-streak-end", 10, "range-combo");
    event.data.coinValue = 100;
    event.data.coinValueTotal = 1000;
    delete event.data.diamondValueTotal;
    const parameters = { coinImageRulesJson: '[{"minCoinValue":0,"maxCoinValue":100,"sizePx":88}]' };
    expect(resolveGiftObjectSize(parameters, event)).toBe(88);
    delete event.data.coinValue;
    expect(resolveGiftObjectSize(parameters, event)).toBe(88);
  });

  it("keeps legacy exact-value rules working and supports optional images within a range", () => {
    const event = gift("gift", 1, "range-images");
    event.data.coinValue = 100;
    expect(resolveGiftObjectSize({ coinImageRulesJson: '[{"coinValue":100,"sizePx":77}]' }, event)).toBe(77);
    const parameters = { coinImageRulesJson: JSON.stringify([
      { minCoinValue: 0, maxCoinValue: 100, sizePx: 88, useCustomImage: false, imageUrl: "/asset-files/disabled.png" },
      { minCoinValue: 100, maxCoinValue: 200, useCustomImage: true, imageUrl: "/asset-files/range.png" }
    ]) };
    expect(resolveCoinImageUrl(parameters, event)).toBe("/asset-files/range.png");
    expect(resolveGiftObjectSize(parameters, event)).toBe(88);
  });

  it("sends the resolved range size to the overlay", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new GiftPileEffectService((_id, message) => sent.push(message));
    const event = gift("gift", 1, "range-overlay");
    event.data.coinValue = 100;
    service.execute({ ...configuration, visual: { ...configuration.visual,
      parameters: { coinImageRulesJson: '[{"minCoinValue":0,"maxCoinValue":100,"sizePx":88}]' }
    } }, event);
    expect(sent[0]?.parameters?.objectSizePx).toBe(88);
  });

  it("uses a configured image for the gift's per-item coin value", () => {
    const event = gift("gift-streak-end", 10, "coin-image");
    event.data.diamondValue = 2;
    event.data.diamondValueTotal = 20;
    expect(
      resolveCoinImageUrl(
        {
          coinImageRulesJson: '[{"coinValue":2,"imageUrl":"/asset-files/two-coin.png"}]'
        },
        event
      )
    ).toBe("/asset-files/two-coin.png");
    expect(
      resolveCoinImageUrl(
        {
          coinImageRulesJson:
            '[{"coinValue":2,"useCustomImage":false,"imageUrl":"/asset-files/two-coin.png"}]'
        },
        event
      )
    ).toBeUndefined();
  });

  it("uses a gift-specific size and safely falls back to the default size", () => {
    const parameters = {
      objectSizePx: 44,
      giftSizeOverridesJson: JSON.stringify([
        { giftId: "rose", sizePx: 120 },
        { giftId: "heart", sizePx: 999 }
      ])
    };
    expect(resolveGiftObjectSize(parameters, gift("gift", 1, "rose-event"))).toBe(120);
    const heart = gift("gift", 1, "heart-event");
    heart.data.giftId = "heart";
    expect(resolveGiftObjectSize(parameters, heart)).toBe(999);
    const unknown = gift("gift", 1, "unknown-event");
    unknown.data.giftId = "unknown";
    expect(resolveGiftObjectSize(parameters, unknown)).toBe(44);
    expect(
      resolveGiftObjectSize({ objectSizePx: 55, giftSizeOverridesJson: "invalid" }, unknown)
    ).toBe(55);
  });

  it("uses the exact gift size before the broader coin-specific or default size", () => {
    const event = gift("gift", 1, "coin-size");
    event.data.diamondValue = 25;
    expect(
      resolveGiftObjectSize(
        {
          objectSizePx: 44,
          giftSizeOverridesJson: '[{"giftId":"rose","sizePx":90}]',
          coinImageRulesJson: '[{"coinValue":25,"sizePx":140}]'
        },
        event
      )
    ).toBe(90);
    event.data.giftId = "another-gift";
    expect(
      resolveGiftObjectSize(
        {
          objectSizePx: 44,
          giftSizeOverridesJson: '[{"giftId":"rose","sizePx":90}]',
          coinImageRulesJson: '[{"coinValue":25,"sizePx":140}]'
        },
        event
      )
    ).toBe(140);
    event.data.giftId = "rose";
    expect(
      resolveGiftObjectSize(
        {
          objectSizePx: 44,
          giftSizeOverridesJson: '[{"giftId":"rose","sizePx":90}]',
          coinImageRulesJson: '[{"coinValue":25,"sizePx":null}]'
        },
        event
      )
    ).toBe(90);
  });

  it("sends the resolved gift-specific size to the overlay", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new GiftPileEffectService((_id, message) => sent.push(message));
    const configured = {
      ...configuration,
      visual: {
        ...configuration.visual,
        parameters: {
          objectSizePx: 44,
          giftSizeOverridesJson: '[{"giftId":"rose","sizePx":132}]'
        }
      }
    };
    service.execute(configured, gift("gift", 1, "sized"));
    expect(sent[0]?.parameters?.objectSizePx).toBe(132);
  });

  it("prefers the manually selected catalog image over event image candidates", () => {
    const sent: EffectPlayMessage[] = [];
    const service = new GiftPileEffectService((_id, message) => sent.push(message));
    const event = gift("gift", 1, "catalog-image");
    event.data.giftImageUrls = ["https://example.test/listener-avatar.png"];
    service.execute(configuration, event, "/asset-files/selected-gift.png");
    expect(sent[0]?.media?.imageUrl).toBe("/asset-files/selected-gift.png");
  });

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
