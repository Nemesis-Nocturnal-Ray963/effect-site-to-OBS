import { describe, expect, it } from "vitest";
import { GiftPileEngine, GIFT_LIFETIME_MS as LIFE, GIFT_FADE_MS } from "./giftPileEngine";

function createEngine(): GiftPileEngine {
  let seed = 12345;
  return new GiftPileEngine(() => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  });
}

describe("gift pile", () => {
  it("spawns one body per gift and replaces the oldest at capacity", () => {
    const engine = createEngine();
    engine.add(10, "rose", 44, 10, 0);
    for (let i = 0; i < 10; i++) engine.step(1 / 60, 1080, 1920, 0);
    expect(engine.bodies).toHaveLength(10);
    expect(engine.pendingCount).toBe(0);
    const ids = engine.bodies.map((body) => body.id);
    engine.add(1, "heart", 44, 10, 100);
    engine.step(1 / 60, 1080, 1920, 100);
    expect(engine.bodies.map((body) => body.id)).toEqual([...ids.slice(1), 11]);
    expect(engine.bodies[9]?.imageUrl).toBe("heart");
  });

  it("adds 15 minutes only to living bodies with at most 15 minutes left", () => {
    const engine = createEngine();
    engine.add(1, "rose", 44, 1000, 0);
    engine.step(1 / 60, 1080, 1920, 0);
    engine.add(1, "heart", 44, 1000, 5 * 60000);
    expect(engine.bodies[0]?.expiresAt).toBe(2 * LIFE);
    engine.add(1, "heart", 44, 1000, 6 * 60000);
    expect(engine.bodies[0]?.expiresAt).toBe(2 * LIFE);
    engine.add(1, "heart", 44, 1000, LIFE);
    expect(engine.bodies[0]?.expiresAt).toBe(3 * LIFE);
  });

  it("replaces older gifts before large objects overflow a small screen", () => {
    const engine = createEngine();
    engine.add(10, "rose", 100, 1000, 0);
    for (let i = 0; i < 10; i++) engine.step(1 / 60, 200, 200, (i * 1000) / 60);
    expect(engine.bodies.map((body) => body.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it("does not treat every existing gift as the size of one large gift", () => {
    const engine = createEngine();
    engine.add(100, "small", 40, 1000, 0);
    for (let i = 0; i < 100; i++) engine.step(1 / 60, 1080, 1920, 0);
    engine.add(1, "large", 480, 1000, 1000);
    engine.step(1 / 60, 1080, 1920, 1000);
    expect(engine.bodies).toHaveLength(101);
  });

  it("keeps configured gift sizes above the former 160px limit", () => {
    const engine = createEngine();
    engine.add(1, "large-gift", 480, 1000, 0);
    engine.step(1 / 60, 1080, 1920, 0);
    expect(engine.bodies[0]?.radius).toBe(240);
  });

  it("fades after expiry, never revives expired gifts, and clears queued gifts", () => {
    const engine = createEngine();
    engine.add(1, "rose", 44, 1000, 0);
    engine.step(1 / 60, 1080, 1920, 0);
    engine.step(0, 1080, 1920, LIFE + 100);
    expect(engine.bodies).toHaveLength(1);
    engine.step(0, 1080, 1920, LIFE + GIFT_FADE_MS);
    expect(engine.bodies).toHaveLength(0);
    engine.add(100, "rose", 44, 1000, LIFE * 2);
    engine.clear();
    engine.step(1 / 30, 1080, 1920, LIFE * 2);
    expect(engine.pendingCount).toBe(0);
    expect(engine.bodies).toHaveLength(0);
    expect(new GiftPileEngine().bodies).toHaveLength(0);
  });

  it("settles a pile against the floor without unstable coordinates", () => {
    const engine = createEngine();
    engine.add(40, "rose", 44, 1000, 0);
    for (let i = 0; i < 900; i++) engine.step(1 / 60, 300, 500, (i * 1000) / 60);
    expect(engine.bodies).toHaveLength(40);
    for (const body of engine.bodies) {
      expect(Number.isFinite(body.x + body.y + body.vx + body.vy)).toBe(true);
      expect(body.y).toBeLessThanOrEqual(500 - body.radius + 2);
      expect(Math.abs(body.vy)).toBeLessThan(55);
    }
    expect(Math.min(...engine.bodies.map((body) => body.y))).toBeLessThan(400);
  });

  it("holds 1,000 gifts in a 1080 × 1920 frame", () => {
    const engine = createEngine();
    engine.add(1000, "rose", 44, 1000, 0);
    for (let i = 0; i < 1500; i++) engine.step(1 / 60, 1080, 1920, (i * 1000) / 60);
    expect(engine.pendingCount).toBe(0);
    expect(engine.bodies).toHaveLength(1000);
    expect(
      engine.bodies.every(
        (body) => Number.isFinite(body.x + body.y) && body.y >= 0 && body.y <= 1920
      )
    ).toBe(true);
  }, 30000);
});
