import type { SystemFontInfo } from "../services/httpApi";

const appFontStorageKey = "obs-effect.appFontFamily";
const defaultAppFontValue = "__default";
const fallbackFontStack = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
const registeredFontFaces = new Set<string>();

export function defaultAppFontOption(): string {
  return defaultAppFontValue;
}

export function readAppFontFamily(): string {
  if (typeof window === "undefined") return defaultAppFontValue;
  return normalizeAppFontFamily(window.localStorage.getItem(appFontStorageKey));
}

export function saveAppFontFamily(value: string): string {
  const normalized = normalizeAppFontFamily(value);
  window.localStorage.setItem(appFontStorageKey, normalized);
  applyAppFontFamily(normalized);
  return normalized;
}

export function applyAppFontFamily(value: string): void {
  const normalized = normalizeAppFontFamily(value);
  if (normalized === defaultAppFontValue) {
    document.documentElement.style.removeProperty("--control-app-font-family");
    return;
  }
  document.documentElement.style.setProperty("--control-app-font-family", `${quotedFontFamily(normalized)}, ${fallbackFontStack}`);
}

export function fontFamilyCss(value: string): string {
  const normalized = normalizeAppFontFamily(value);
  return normalized === defaultAppFontValue ? fallbackFontStack : `${quotedFontFamily(normalized)}, ${fallbackFontStack}`;
}

export function registerUploadedFontFaces(fonts: SystemFontInfo[]): void {
  for (const font of fonts) {
    if (font.source === "asset" && font.contentUrl) {
      registerFontFace(font.family, font.contentUrl);
    }
  }
}

function normalizeAppFontFamily(value: string | null): string {
  const normalized = value?.trim() ?? "";
  return normalized || defaultAppFontValue;
}

function registerFontFace(family: string, url: string): void {
  const normalizedFamily = family.trim();
  if (!normalizedFamily || !url) return;
  const key = `${normalizedFamily}\n${url}`;
  if (registeredFontFaces.has(key)) return;
  registeredFontFaces.add(key);
  const style = document.createElement("style");
  style.dataset.uploadedControlFont = normalizedFamily;
  style.textContent = `@font-face{font-family:"${cssString(normalizedFamily)}";src:url("${cssUrl(url)}");font-display:swap;}`;
  document.head.appendChild(style);
}

function quotedFontFamily(value: string): string {
  const normalized = value.replace(/"/gu, "").trim();
  if (!normalized) return fallbackFontStack;
  return genericFontFamilies.has(normalized.toLocaleLowerCase("en-US")) ? normalized : `"${cssString(normalized)}"`;
}

function cssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function cssUrl(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\)/gu, "\\)");
}

const genericFontFamilies = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
