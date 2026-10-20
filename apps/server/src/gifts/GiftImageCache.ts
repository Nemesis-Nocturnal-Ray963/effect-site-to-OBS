import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { link, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const maxImageBytes = 8 * 1024 * 1024;
const formats = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" } as const;
type ImageExtension = keyof typeof formats;
export interface CachedGiftImage {
  url: string;
  localPath: string;
  mimeType: string;
}

export function imageExtension(bytes: Buffer): ImageExtension {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && /avif|avis/.test(bytes.subarray(8, 32).toString("ascii"))) return "avif";
  if (bytes.subarray(0, 2).toString("ascii") === "BM") return "bmp";
  throw new Error("The response is not a supported raster image");
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a !== undefined && b !== undefined && a !== 0 && a !== 10 && a !== 127 && a < 224 &&
      !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  // Public IPv6 unicast; reject mapped IPv4 and transition ranges as well.
  const value = address.toLowerCase();
  return /^[23][0-9a-f]{3}:/.test(value) && !/^2001:(?:0{1,4}:|:)/.test(value) && !value.startsWith("2002:");
}

export async function downloadGiftImage(source: string, redirects = 0): Promise<Buffer> {
  const url = new URL(source);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid gift image URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Gift image URLs must use public network addresses");
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    // Pin the validated IP so a second DNS lookup cannot reach a private address.
    const request = (url.protocol === "https:" ? https : http).request({
      protocol: url.protocol, hostname: address.address, family: address.family,
      servername: hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: "GET",
      headers: { Host: url.host, "User-Agent": "OBS-Effect-App/1.0", Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8" }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        if (redirects >= 3) reject(new Error("Too many gift image redirects"));
        else resolve(downloadGiftImage(new URL(response.headers.location, url).href, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Gift image download returned HTTP ${response.statusCode}`));
        return;
      }
      if (Number(response.headers["content-length"]) > maxImageBytes) {
        response.destroy();
        reject(new Error("Gift image exceeds 8 MB"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxImageBytes) response.destroy(new Error("Gift image exceeds 8 MB"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const timeout = setTimeout(() => request.destroy(new Error("Gift image download timed out")), 10000);
    request.on("close", () => clearTimeout(timeout));
    request.on("error", reject);
    request.end();
  });
}

export class GiftImageCache {
  readonly directory: string;
  private readonly pending = new Map<string, Promise<CachedGiftImage | undefined>>();
  private readonly retryAfter = new Map<string, number>();
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(rootDir: string, private readonly options: {
    download?: (source: string) => Promise<Buffer>;
    onError?: (message: string) => void;
  } = {}) {
    this.directory = path.join(rootDir, "data/gifts/images");
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async resolve(source: string | undefined): Promise<string | undefined> {
    if (!source) return undefined;
    if (/^\/(?!\/)/.test(source)) return source;
    return (await this.get(source))?.url;
  }

  async get(source: string): Promise<CachedGiftImage | undefined> {
    if (!/^https?:\/\//i.test(source)) return undefined;
    const key = createHash("sha256").update(source).digest("hex");
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.load(key, source).catch((error: unknown) => {
      this.retryAfter.set(key, Date.now() + 30000);
      this.options.onError?.(`Gift image ${key.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private cached(fileName: string, extension: ImageExtension): CachedGiftImage {
    return { url: `/gift-images/${fileName}`, localPath: `data/gifts/images/${fileName}`, mimeType: formats[extension] };
  }

  private async load(key: string, source: string): Promise<CachedGiftImage | undefined> {
    await this.initialize();
    for (const extension of Object.keys(formats) as ImageExtension[]) {
      const fileName = `${key}.${extension}`;
      try {
        if ((await stat(path.join(this.directory, fileName))).size > 0) return this.cached(fileName, extension);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if ((this.retryAfter.get(key) ?? 0) > Date.now()) return undefined;
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const bytes = await (this.options.download ?? downloadGiftImage)(source);
      if (bytes.length > maxImageBytes) throw new Error("Gift image exceeds 8 MB");
      const extension = imageExtension(bytes);
      const fileName = `${key}.${extension}`;
      const temporary = path.join(this.directory, `${key}.${randomUUID()}.partial`);
      await writeFile(temporary, bytes, { flag: "wx" });
      try {
        // Never replace an image already saved by another request or server process.
        await link(temporary, path.join(this.directory, fileName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        await unlink(temporary);
      }
      this.retryAfter.delete(key);
      return this.cached(fileName, extension);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
