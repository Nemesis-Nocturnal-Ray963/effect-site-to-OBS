import { describe, expect, it } from "vitest";
import { chromaProgressAfterTime, chromaProgressAfterTrigger } from "./ChromaErasureLayer";

describe("chroma erasure progress", () => {
  it("advances with time and rewinds with gifts in normal mode", () => {
    const parameters = { countdownSeconds: 100, giftRecoverySeconds: 15 };
    expect(chromaProgressAfterTime(0.2, parameters, 10000, 100000)).toBeCloseTo(0.3);
    expect(chromaProgressAfterTrigger(0.3, parameters, "gift-any")).toBeCloseTo(0.15);
  });

  it("stops time and advances only with gifts in inverted mode", () => {
    const parameters = { inverted: true, giftErasePercent: 12.5 };
    expect(chromaProgressAfterTime(0.25, parameters, 60000, 100000)).toBe(0.25);
    expect(chromaProgressAfterTrigger(0.25, parameters, "gift-any")).toBe(0.375);
    expect(chromaProgressAfterTrigger(0.95, parameters, "gift-any")).toBe(1);
  });

  it("resets when manually or preset tested", () => {
    expect(chromaProgressAfterTrigger(0.8, { inverted: true }, "manual")).toBe(0);
    expect(chromaProgressAfterTrigger(0.8, { inverted: true }, "preset-test")).toBe(0);
  });
});
