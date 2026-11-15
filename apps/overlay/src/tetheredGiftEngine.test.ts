import { describe, expect, it } from "vitest";
import { TetheredGiftEngine, type TetheredGiftBody } from "./tetheredGiftEngine";

function body(id: number, x: number): TetheredGiftBody {
  return {
    id,
    anchorX: x,
    x,
    y: 100,
    vx: 0,
    vy: 0,
    radius: 25,
    angle: 0,
    spin: 0,
    ropeLength: 200,
    retractAt: 10_000,
    retractSpeed: 500,
    imageUrl: "gift.png",
    opacity: 1
  };
}

describe("tethered gift engine", () => {
  it("keeps a falling gift within its configured rope length", () => {
    const engine = new TetheredGiftEngine(() => 0.5);
    engine.add(1, "gift.png", 50, 120, 5000);
    for (let index = 0; index < 120; index += 1) {
      engine.step(1 / 60, 500, 800, index * 1000 / 60);
    }
    expect(engine.bodies).toHaveLength(1);
    const gift = engine.bodies[0]!;
    expect(Math.hypot(gift.x - gift.anchorX, gift.y + 12)).toBeLessThanOrEqual(120.01);
  });

  it("separates gifts when they collide", () => {
    const engine = new TetheredGiftEngine();
    engine.bodies = [body(1, 200), body(2, 210)];
    engine.step(0, 500, 800, 0);
    expect(Math.hypot(
      engine.bodies[1]!.x - engine.bodies[0]!.x,
      engine.bodies[1]!.y - engine.bodies[0]!.y
    )).toBeGreaterThanOrEqual(49.9);
  });

  it("retracts and removes a gift after its display time", () => {
    const engine = new TetheredGiftEngine(() => 0.5);
    engine.add(1, "gift.png", 50, 120, 500);
    engine.step(1 / 30, 500, 800, 0);
    engine.step(1 / 30, 500, 800, 34);
    expect(engine.bodies).toHaveLength(1);
    for (let index = 0; index < 20; index += 1) engine.step(1 / 30, 500, 800, 600 + index * 34);
    expect(engine.bodies).toHaveLength(0);
  });
});
