import { existsSync } from "node:fs";

export interface BrowserExecutable {
  type: "chrome" | "edge";
  path: string;
}

const candidates: BrowserExecutable[] = [
  { type: "chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { type: "chrome", path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" },
  { type: "edge", path: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" },
  { type: "edge", path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" }
];

export function resolveBrowserExecutable(preferred?: "chrome" | "edge" | "auto", explicitPath?: string): BrowserExecutable | null {
  if (explicitPath && existsSync(explicitPath)) {
    return { type: explicitPath.toLowerCase().includes("edge") ? "edge" : "chrome", path: explicitPath };
  }

  const filtered = preferred && preferred !== "auto" ? candidates.filter((candidate) => candidate.type === preferred) : candidates;
  return filtered.find((candidate) => existsSync(candidate.path)) ?? null;
}
