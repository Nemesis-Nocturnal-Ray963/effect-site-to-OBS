import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { EffectConfiguration } from "@obs-effect/shared-types";

interface EffectConfigurationFile {
  configurations: EffectConfiguration[];
}

export class EffectConfigurationJsonRepository {
  constructor(private readonly filePath: string) {}

  static fromRoot(rootDir: string): EffectConfigurationJsonRepository {
    return new EffectConfigurationJsonRepository(path.join(rootDir, "data", "effects", "configurations.json"));
  }

  async list(): Promise<EffectConfiguration[]> {
    return (await this.read()).configurations;
  }

  async saveAll(configurations: EffectConfiguration[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ configurations }, null, 2), "utf8");
  }

  private async read(): Promise<EffectConfigurationFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<EffectConfigurationFile>;
      return { configurations: Array.isArray(parsed.configurations) ? parsed.configurations : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { configurations: [] };
      }
      throw error;
    }
  }
}
