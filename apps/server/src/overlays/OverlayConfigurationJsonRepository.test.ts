import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { OverlayConfigurationJsonRepository } from "./OverlayConfigurationJsonRepository.js";

describe("dynamic overlay configurations", () => {
  it("starts with ten overlays and persists newly added overlays", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overlay-configurations-"));
    try {
      const repository = OverlayConfigurationJsonRepository.fromRoot(root);
      expect(await repository.list()).toHaveLength(10);
      const created = await repository.create("2026-11-15T00:00:00.000Z");
      expect(created).toMatchObject({ overlayId: 11, name: "Overlay 11" });
      const reloaded = OverlayConfigurationJsonRepository.fromRoot(root);
      expect((await reloaded.list()).map((overlay) => overlay.overlayId)).toEqual(
        Array.from({ length: 11 }, (_, index) => index + 1)
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
