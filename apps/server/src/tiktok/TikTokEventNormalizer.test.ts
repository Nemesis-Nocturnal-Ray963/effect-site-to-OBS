import { describe, expect, it } from "vitest";
import { TikTokEventNormalizer } from "./TikTokEventNormalizer.js";

describe("TikTok gift image normalization", () => {
  it("keeps gift artwork and excludes the sender avatar", () => {
    const [event] = new TikTokEventNormalizer().normalize({
      eventType: "gift",
      giftId: "5655",
      giftName: "Rose",
      gift: { image: { urlList: ["https://example.test/rose.png"] } },
      user: { id: "viewer", avatarThumb: { urlList: ["https://example.test/viewer.png"] } }
    });

    expect(event?.data.giftImageUrls).toEqual(["https://example.test/rose.png"]);
    expect(event?.data.primaryGiftImageUrl).toBe("https://example.test/rose.png");
  });
});
