import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GiftImageCache, downloadGiftImage } from "./GiftImageCache.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "persistent-gift-image-"));
  roots.push(root);
  return root;
}

describe("persistent gift image downloads", () => {
  it("deduplicates simultaneous downloads and reuses the file offline after restart", async () => {
    const root = await setup();
    const download = vi.fn(async () => png);
    const cache = new GiftImageCache(root, { download });
    const urls = await Promise.all(Array.from({ length: 12 }, () => cache.resolve("https://cdn.example.test/rose.webp")));
    expect(download).toHaveBeenCalledTimes(1);
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toMatch(/^\/gift-images\/[a-f0-9]{64}\.png$/);
    const files = await readdir(cache.directory);
    expect(files).toHaveLength(1);
    expect(await readFile(path.join(cache.directory, files[0]!))).toEqual(png);
    const offlineDownload = vi.fn(async () => { throw new Error("offline"); });
    const restarted = new GiftImageCache(root, { download: offlineDownload });
    expect(await restarted.resolve("https://cdn.example.test/rose.webp")).toBe(urls[0]);
    expect(offlineDownload).not.toHaveBeenCalled();
  });

  it("retains old images when the source URL changes and leaves local assets alone", async () => {
    const root = await setup();
    const download = vi.fn(async () => png);
    const cache = new GiftImageCache(root, { download });
    const old = await cache.resolve("https://cdn.example.test/old.png");
    const next = await cache.resolve("https://cdn.example.test/new.png");
    expect(old).not.toBe(next);
    expect(await readdir(cache.directory)).toHaveLength(2);
    expect(await cache.resolve("/asset-files/custom.png")).toBe("/asset-files/custom.png");
    expect(await cache.resolve("data:image/png;base64,invalid")).toBeUndefined();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("rejects non-images, bounds file size, and avoids retrying a failed URL on each event", async () => {
    const root = await setup();
    const download = vi.fn(async () => Buffer.from("<html>Access denied</html>"));
    const errors = vi.fn();
    const cache = new GiftImageCache(root, { download, onError: errors });
    expect(await cache.resolve("https://cdn.example.test/not-an-image")).toBeUndefined();
    expect(await cache.resolve("https://cdn.example.test/not-an-image")).toBeUndefined();
    expect(download).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(await readdir(cache.directory)).toHaveLength(0);
    const oversized = new GiftImageCache(root, { download: async () => Buffer.alloc(9 * 1024 * 1024) });
    expect(await oversized.resolve("https://cdn.example.test/oversized")).toBeUndefined();
    expect(await readdir(cache.directory)).toHaveLength(0);
  });

  it("caps simultaneous downloads at four", async () => {
    const root = await setup();
    let active = 0;
    let maximum = 0;
    const cache = new GiftImageCache(root, { download: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return png;
    } });
    const urls = await Promise.all(Array.from({ length: 12 }, (_, index) => cache.resolve(`https://cdn.example.test/${index}.png`)));
    expect(urls.every(Boolean)).toBe(true);
    expect(maximum).toBe(4);
  });

  it("refuses private-network URLs and non-HTTP protocols before opening a connection", async () => {
    for (const url of ["http://127.0.0.1/secret", "http://169.254.169.254/metadata", "http://[::1]/", "file:///etc/passwd", "https://user:password@example.com/image.png"]) {
      await expect(downloadGiftImage(url)).rejects.toThrow();
    }
  });
});
