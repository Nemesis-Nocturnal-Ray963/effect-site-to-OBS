import type { AssetCatalogItem } from "@obs-effect/shared-types";

export function chooseRandomVideoAsset(
  assets: AssetCatalogItem[],
  configuredIds: string[],
  random: () => number = Math.random
): AssetCatalogItem | undefined {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const videos = [...new Set(configuredIds)]
    .map((id) => byId.get(id))
    .filter((asset): asset is AssetCatalogItem => asset?.kind === "video");
  if (videos.length === 0) return undefined;
  const index = Math.min(videos.length - 1, Math.max(0, Math.floor(random() * videos.length)));
  return videos[index];
}
