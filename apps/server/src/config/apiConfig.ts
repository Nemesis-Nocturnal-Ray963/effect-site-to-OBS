import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const configSchema = z.object({
  apiKey: z.string().min(24)
});

export interface ApiConfig {
  apiKey: string;
  maskedApiKey: string;
  configPath: string;
}

function maskApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function generateApiKey(): string {
  return randomBytes(32).toString("base64url");
}

function writeConfig(configPath: string, apiKey: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ apiKey }, null, 2)}\n`, { encoding: "utf8" });
}

export function loadApiConfig(rootDir: string): ApiConfig {
  const configPath = join(rootDir, "data", "api-config.json");
  const fromEnv = process.env.EFFECT_APP_API_KEY;

  if (fromEnv && fromEnv.length >= 24) {
    return { apiKey: fromEnv, maskedApiKey: maskApiKey(fromEnv), configPath };
  }

  if (existsSync(configPath)) {
    const parsed = configSchema.safeParse(JSON.parse(readFileSync(configPath, "utf8")));
    if (parsed.success) {
      return {
        apiKey: parsed.data.apiKey,
        maskedApiKey: maskApiKey(parsed.data.apiKey),
        configPath
      };
    }
  }

  const apiKey = generateApiKey();
  writeConfig(configPath, apiKey);
  return { apiKey, maskedApiKey: maskApiKey(apiKey), configPath };
}

export function regenerateApiConfig(rootDir: string): ApiConfig {
  const configPath = join(rootDir, "data", "api-config.json");
  const apiKey = generateApiKey();
  writeConfig(configPath, apiKey);
  return { apiKey, maskedApiKey: maskApiKey(apiKey), configPath };
}
