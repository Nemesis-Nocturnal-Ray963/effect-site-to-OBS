import { describe, expect, it } from "vitest";
import { createSelectedGiftTestEvent } from "./effects.js";

describe("effect library gift tests", () => {
  it("creates a selected catalog gift with its coin value and image", () => {
    const event = createSelectedGiftTestEvent({
      platformGiftId: "5655",
      name: "Rose",
      coinValue: 1,
      imageUrl: "https://example.test/rose.png"
    });

    expect(event.type).toBe("gift");
    expect(event.data).toMatchObject({
      giftId: "5655",
      platformGiftId: "5655",
      giftName: "Rose",
      coinValue: 1,
      coinValueTotal: 1,
      giftImageUrls: ["https://example.test/rose.png"]
    });
  });

  it("creates a virtual gift when only a coin value is supplied", () => {
    const event = createSelectedGiftTestEvent({ coinValue: 250 });
    expect(event.data).toMatchObject({
      giftId: "coin-250",
      giftName: "250 Coin Gift",
      coinValue: 250,
      diamondValueTotal: 250
    });
  });
});
