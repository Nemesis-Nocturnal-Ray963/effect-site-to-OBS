import { describe, expect, it } from "vitest";
import type { AssetCatalogItem } from "@obs-effect/shared-types";
import { chooseRandomVideoAsset } from "./simpleMediaVideoPool.js";

const assets = [
  asset("image", "image"),
  asset("video-a", "video"),
  asset("video-b", "video")
];

describe("chooseRandomVideoAsset", () => {
  it("chooses one valid configured video using the supplied random value", () => {
    expect(chooseRandomVideoAsset(assets, ["video-a", "video-b"], () => 0)?.id).toBe("video-a");
    expect(chooseRandomVideoAsset(assets, ["video-a", "video-b"], () => 0.999)?.id).toBe("video-b");
  });

  it("ignores duplicates, missing assets, and non-video assets", () => {
    expect(chooseRandomVideoAsset(assets, ["missing", "image", "video-b", "video-b"], () => 0)?.id).toBe("video-b");
    expect(chooseRandomVideoAsset(assets, ["missing", "image"], () => 0)).toBeUndefined();
  });
});

function asset(id: string, kind: AssetCatalogItem["kind"]): AssetCatalogItem {
  return {
    id,
    kind,
    name: id,
    fileName: `${id}.webm`,
    contentUrl: `/asset-files/${id}.webm`,
    mimeType: kind === "video" ? "video/webm" : "image/png",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "local-copy",
    tags: []
  };
}
