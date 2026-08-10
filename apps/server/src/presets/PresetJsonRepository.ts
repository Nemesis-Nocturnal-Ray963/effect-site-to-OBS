import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { EffectPreset } from "@obs-effect/shared-types";

interface PresetFile {
  presets: EffectPreset[];
}

export class PresetJsonRepository {
  constructor(private readonly filePath: string) {}

  static fromRoot(rootDir: string): PresetJsonRepository {
    return new PresetJsonRepository(path.join(rootDir, "data", "presets", "presets.json"));
  }

  async list(): Promise<EffectPreset[]> {
    return (await this.read()).presets;
  }

  async saveAll(presets: EffectPreset[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ presets }, null, 2), "utf8");
  }

  private async read(): Promise<PresetFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PresetFile>;
      return { presets: Array.isArray(parsed.presets) ? parsed.presets : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { presets: [] };
      }
      throw error;
    }
  }
}
