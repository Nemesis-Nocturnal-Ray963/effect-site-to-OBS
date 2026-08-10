import { createHash } from "node:crypto";

export function buildTikTokEventId(parts: Array<string | number | undefined | null>): string {
  const stable = parts.map((part) => (part === undefined || part === null ? "" : String(part))).join("|");
  const hash = createHash("sha1").update(stable).digest("hex").slice(0, 16);
  return `tiktok-${hash}`;
}
