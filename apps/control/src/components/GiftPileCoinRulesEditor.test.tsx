import { describe, expect, it } from "vitest";
import { parseCoinImageRules } from "./GiftPileCoinRulesEditor";

describe("coin range editor compatibility", () => {
  it("loads old exact-value settings as a single-value range without losing image settings", () => {
    expect(parseCoinImageRules(JSON.stringify([{ coinValue: 100, sizePx: 88, useCustomImage: true,
      assetId: "my-image", imageUrl: "/asset-files/my-image.png" }]))).toEqual([
      { minCoinValue: 100, maxCoinValue: 100, sizePx: 88, useCustomImage: true,
        assetId: "my-image", imageUrl: "/asset-files/my-image.png" }
    ]);
  });

  it("keeps inclusive zero-based ranges and optional image settings", () => {
    expect(parseCoinImageRules('[{"minCoinValue":0,"maxCoinValue":100,"sizePx":88,"useCustomImage":false}]')).toEqual([
      { minCoinValue: 0, maxCoinValue: 100, sizePx: 88, useCustomImage: false, assetId: "", imageUrl: "" }
    ]);
  });

  it("ignores incomplete, inverted, and nonnumeric ranges", () => {
    expect(parseCoinImageRules(JSON.stringify([
      { minCoinValue: 0, sizePx: 88 }, { minCoinValue: 100, maxCoinValue: 0, sizePx: 88 },
      { minCoinValue: -1, maxCoinValue: 100 }, { minCoinValue: "0", maxCoinValue: 100 }
    ]))).toEqual([]);
    expect(parseCoinImageRules("invalid-json")).toEqual([]);
  });
});
