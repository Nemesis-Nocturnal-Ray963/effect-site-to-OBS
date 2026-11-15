import { describe, expect, it } from "vitest";
import { parseGiftSizeOverrides } from "./GiftPileOverridesEditor";

describe("gift-specific appearance settings", () => {
  it("keeps old size-only rules compatible", () => {
    expect(parseGiftSizeOverrides('[{"giftId":"rose","giftName":"Rose","sizePx":88}]')).toEqual([
      {
        giftId: "rose",
        giftName: "Rose",
        sizePx: 88,
        useCustomImage: false,
        assetIds: [],
        imageUrls: []
      }
    ]);
  });

  it("loads random image pools and migrates legacy single images", () => {
    expect(parseGiftSizeOverrides(JSON.stringify([
      {
        giftId: "rose",
        sizePx: 96,
        useCustomImage: true,
        assetIds: ["rose-a", "rose-b"],
        imageUrls: ["/asset-files/rose-a.png", "/asset-files/rose-b.png"]
      },
      {
        giftId: "heart",
        sizePx: 72,
        assetId: "heart",
        imageUrl: "/asset-files/heart.png"
      }
    ]))).toEqual([
      {
        giftId: "rose",
        giftName: undefined,
        sizePx: 96,
        useCustomImage: true,
        assetIds: ["rose-a", "rose-b"],
        imageUrls: ["/asset-files/rose-a.png", "/asset-files/rose-b.png"]
      },
      {
        giftId: "heart",
        giftName: undefined,
        sizePx: 72,
        useCustomImage: true,
        assetIds: ["heart"],
        imageUrls: ["/asset-files/heart.png"]
      }
    ]);
  });
});
