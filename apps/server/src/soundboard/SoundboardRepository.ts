import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SoundboardBoard } from "@obs-effect/shared-types";

interface SoundboardFile {
  accessToken: string;
  board: SoundboardBoard;
}

export class SoundboardRepository {
  private readonly filePath: string;

  constructor(rootDir: string, private readonly now: () => string) {
    this.filePath = path.join(rootDir, "data", "soundboard", "config.json");
  }

  async get(): Promise<SoundboardFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SoundboardFile;
      if (parsed.accessToken && parsed.board?.pads) return parsed;
    } catch {
      // The first read creates a usable default board.
    }
    const initial = this.defaultValue();
    await this.write(initial);
    return initial;
  }

  async save(board: SoundboardBoard): Promise<SoundboardFile> {
    const current = await this.get();
    const next = { ...current, board: { ...board, updatedAt: this.now() } };
    await this.write(next);
    return next;
  }

  private defaultValue(): SoundboardFile {
    const createdAt = this.now();
    return {
      accessToken: randomBytes(18).toString("base64url"),
      board: {
        id: randomUUID(),
        name: "メインボード",
        columns: 3,
        updatedAt: createdAt,
        pads: [
          {
            id: randomUUID(),
            label: "新しいボタン",
            color: "#2563eb",
            enabled: true,
            targetOverlayId: 1,
            durationMs: 5000,
            audioVolume: 0.8,
            retriggerMode: "restart"
          }
        ]
      }
    };
  }

  private async write(value: SoundboardFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
