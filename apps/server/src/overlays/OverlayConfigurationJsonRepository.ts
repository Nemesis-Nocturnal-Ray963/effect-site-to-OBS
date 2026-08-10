import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { OverlayConfiguration, OverlayId } from "@obs-effect/shared-types";
import { overlayIds } from "./overlayTypes.js";

interface OverlayConfigurationFile {
  overlays: OverlayConfiguration[];
}

export class OverlayConfigurationJsonRepository {
  constructor(private readonly filePath: string) {}

  static fromRoot(rootDir: string): OverlayConfigurationJsonRepository {
    return new OverlayConfigurationJsonRepository(path.join(rootDir, "data", "overlays", "configurations.json"));
  }

  async list(): Promise<OverlayConfiguration[]> {
    const stored = new Map((await this.read()).overlays.map((overlay) => [overlay.overlayId, overlay]));
    return overlayIds.map((overlayId) => stored.get(overlayId) ?? defaultOverlayConfiguration(overlayId));
  }

  async get(overlayId: OverlayId): Promise<OverlayConfiguration> {
    return (await this.list()).find((overlay) => overlay.overlayId === overlayId)!;
  }

  async update(
    overlayId: OverlayId,
    patch: Partial<Omit<OverlayConfiguration, "overlayId" | "updatedAt">>,
    now: string
  ): Promise<OverlayConfiguration> {
    const overlays = await this.list();
    const index = overlays.findIndex((overlay) => overlay.overlayId === overlayId);
    const current = overlays[index]!;
    const updated: OverlayConfiguration = {
      ...current,
      ...patch,
      name: patch.name?.trim() || current.name,
      width: clampInt(patch.width ?? current.width, 320, 7680),
      height: clampInt(patch.height ?? current.height, 240, 4320),
      fps: clampInt(patch.fps ?? current.fps, 1, 120),
      scaleMode: patch.scaleMode ?? current.scaleMode,
      safeAreaEnabled: patch.safeAreaEnabled ?? current.safeAreaEnabled,
      updatedAt: now
    };
    overlays[index] = updated;
    await this.saveAll(overlays);
    return updated;
  }

  private async saveAll(overlays: OverlayConfiguration[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ overlays }, null, 2), "utf8");
  }

  private async read(): Promise<OverlayConfigurationFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<OverlayConfigurationFile>;
      return { overlays: Array.isArray(parsed.overlays) ? parsed.overlays : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { overlays: [] };
      }
      throw error;
    }
  }
}

export function defaultOverlayConfiguration(overlayId: OverlayId): OverlayConfiguration {
  return {
    overlayId,
    name: `Overlay ${overlayId}`,
    width: 1920,
    height: 1080,
    fps: 60,
    scaleMode: "fit",
    safeAreaEnabled: true,
    updatedAt: new Date(0).toISOString()
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)));
}
