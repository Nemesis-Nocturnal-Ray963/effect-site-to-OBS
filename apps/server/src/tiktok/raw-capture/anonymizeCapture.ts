import type { TikTokRawEventCapture } from "@obs-effect/shared-types";

const anonymizeKeys = new Set(["userid", "uniqueid", "nickname", "displayname", "avatarurl", "roomid"]);

export function anonymizeCapture(capture: TikTokRawEventCapture): TikTokRawEventCapture {
  const replacements = new Map<string, string>();
  let counter = 1;

  function replacement(value: string, prefix: string): string {
    if (!replacements.has(value)) {
      replacements.set(value, `${prefix}_${String(counter).padStart(3, "0")}`);
      counter += 1;
    }
    return replacements.get(value)!;
  }

  function shouldAnonymize(key: string, path: string): boolean {
    const normalizedKey = key.toLowerCase();
    return anonymizeKeys.has(normalizedKey) || (normalizedKey === "id" && (path.endsWith(".user") || path.endsWith(".room")));
  }

  function walk(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${path}[${index}]`));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && shouldAnonymize(key, path)) {
        output[key] = replacement(item, key);
      } else {
        output[key] = walk(item, `${path}.${key}`);
      }
    }
    return output;
  }

  return walk(capture, "$") as TikTokRawEventCapture;
}
