import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceIndex = process.argv.indexOf("--source");
if (sourceIndex >= 0 && !process.argv[sourceIndex + 1]) throw new Error("--source requires a file path");
const sourcePath = path.resolve(root, sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "data/myselfAddAssets/https___streamtoearn.io_ja_gifts.htm");
const baseUrl = "http://127.0.0.1:3190";
const apply = process.argv.includes("--apply");
const offline = process.argv.includes("--offline");
const addOnly = process.argv.includes("--add-only");

function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code.startsWith("#")) return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[code.toLowerCase()] ?? entity;
  });
}

const raw = await readFile(sourcePath, "utf8");
// Firefox's saved view-source document wraps escaped original HTML in spans.
const html = /id=["']viewsource["']/.test(raw) ? decode(raw.replace(/<[^>]*>/g, "")) : raw;
const imported = [];
function addGift(name, imageUrl, priceText) {
  name = decode(name).replace(/<[^>]*>/g, "").trim();
  imageUrl = decode(imageUrl).trim();
  priceText = decode(priceText).replace(/<[^>]*>/g, "").trim();
  const coinValue = priceText && /^[\d,\s]+$/.test(priceText) ? Number(priceText.replace(/[,\s]/g, "")) : NaN;
  const url = imageUrl ? new URL(imageUrl, "http://localhost") : null;
  if (!name || name.length > 200 || !Number.isSafeInteger(coinValue) || coinValue < 0 ||
    !url || url.protocol !== "https:" || !/(^|\.)tiktokcdn\.com$/i.test(url.hostname) || url.username || url.password) {
    throw new Error(`Invalid gift card: ${JSON.stringify({ name, imageUrl, priceText })}`);
  }
  imported.push({ name, imageUrl, coinValue });
}
for (const match of html.matchAll(/<div\b[^>]*class=["']gift["'][^>]*>([\s\S]*?)<\/div>/gi)) {
  const block = match[1];
  addGift(
    block.match(/<p\b[^>]*class=["']gift-name["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "",
    block.match(/<img\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "",
    block.match(/<p\b[^>]*class=["']gift-price["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  );
}
// TikTok's saved picker markup has nested divs and an inline coin SVG.
const tiktokCards = [...html.matchAll(/<div\b[^>]*\bdata-e2e=["']gift-item["'][^>]*>/gi)];
for (let index = 0; index < tiktokCards.length; index++) {
  const block = html.slice(tiktokCards[index].index, tiktokCards[index + 1]?.index ?? html.length);
  const image = block.match(/<img\b[^>]*>/i)?.[0] ?? "";
  addGift(
    image.match(/\salt\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "",
    image.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "",
    block.match(/<\/svg>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
  );
}
if (!imported.length) throw new Error("No gift cards found; catalog was not changed.");

let offlineService;
if (offline) {
  let running = false;
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    running = true;
  } catch { /* No server is listening. */ }
  if (running) throw new Error("Offline import requires the app to be stopped. Use the normal API import while it is running.");
  const { GiftCatalogJsonRepository } = await import("../apps/server/dist/gifts/GiftCatalogJsonRepository.js");
  const { GiftCatalogService } = await import("../apps/server/dist/gifts/GiftCatalogService.js");
  offlineService = new GiftCatalogService({ repository: GiftCatalogJsonRepository.fromRoot(root) });
}

async function api(route, method = "GET", body) {
  if (offlineService) {
    if (method === "GET" && route.startsWith("gifts?")) {
      const query = new URL(`${baseUrl}/${route}`).searchParams;
      return { gifts: await offlineService.list({ limit: Number(query.get("limit")), offset: Number(query.get("offset")), sort: "name", order: "asc" }) };
    }
    if (method === "POST" && route === "gifts") return { gift: await offlineService.createManual(body) };
    if (method === "PATCH" && route.startsWith("gifts/")) return { gift: await offlineService.update(decodeURIComponent(route.slice(6)), body) };
    throw new Error(`Unsupported offline operation: ${method} ${route}`);
  }
  const response = await fetch(`${baseUrl}/api/v1/${route}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}`);
  return response.json();
}

const records = [];
for (let offset = 0; ; offset += 1000) {
  const { gifts } = await api(`gifts?limit=1000&offset=${offset}&sort=name&order=asc`);
  records.push(...gifts);
  if (gifts.length < 1000) break;
}
const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const plan = { source: path.relative(root, sourcePath), sourceCards: imported.length, uniqueCards: 0,
  existingBefore: records.length, additions: [], updates: [], unchanged: [], ambiguous: [] };
const seen = new Set();
for (const gift of imported) {
  const key = `${normalize(gift.name)}:${gift.coinValue}`;
  if (seen.has(key)) continue;
  seen.add(key);
  plan.uniqueCards++;
  const candidates = records.filter((record) => record.platform === "tiktok" &&
    [record.matchName, record.name, ...(record.aliases ?? [])].some((name) => normalize(name) === normalize(gift.name)));
  const matches = candidates.filter((record) => {
    const value = record.coinValue ?? record.diamondValue;
    return value == null || value === gift.coinValue;
  });
  if (candidates.length && !matches.length) {
    plan.ambiguous.push({ ...gift, reason: "Existing name has a different coin value", ids: candidates.map((record) => record.id) });
    continue;
  }
  if (matches.length) {
    // Duplicate legacy IDs may represent the same named gift; preserve each ID and its settings.
    for (const record of matches) {
      const patch = {};
      if (!record.image.primaryUrl) patch.primaryImageUrl = gift.imageUrl;
      if (!record.matchName) patch.matchName = gift.name;
      if (record.coinValue == null && record.diamondValue == null) patch.coinValue = gift.coinValue;
      if (!addOnly && Object.keys(patch).length) plan.updates.push({ id: record.id, name: record.name, patch });
      else plan.unchanged.push({ id: record.id, name: record.name });
    }
  } else {
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
    plan.additions.push({ platformGiftId: `manual-html-${hash}`, name: gift.name,
      matchName: gift.name, coinValue: gift.coinValue, primaryImageUrl: gift.imageUrl });
  }
}

const summary = () => ({ sourceCards: plan.sourceCards, uniqueCards: plan.uniqueCards, existingBefore: plan.existingBefore,
  additions: plan.additions.length, updates: plan.updates.length, unchanged: plan.unchanged.length, ambiguous: plan.ambiguous.length });
if (!apply) {
  console.log(JSON.stringify({ mode: "preview", ...summary(), sampleAdditions: plan.additions.slice(0, 4), sampleUpdates: plan.updates.slice(0, 3), ambiguous: plan.ambiguous }, null, 2));
} else {
  const reportDir = path.join(root, "data/gifts/imports", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(reportDir, { recursive: true });
  await copyFile(path.join(root, "data/gifts/catalog.json"), path.join(reportDir, "catalog.before.json"));
  await writeFile(path.join(reportDir, "plan.json"), JSON.stringify(plan, null, 2));
  const completed = { added: [], updated: [] };
  try {
    for (const item of plan.updates) {
      const { gift } = await api(`gifts/${encodeURIComponent(item.id)}`, "PATCH", item.patch);
      for (const [key, value] of Object.entries(item.patch)) {
        if ((key === "primaryImageUrl" ? gift.image.primaryUrl : gift[key]) !== value) throw new Error(`Update did not persist ${key} for ${item.id}`);
      }
      completed.updated.push(gift.id);
    }
    for (const item of plan.additions) {
      const { gift } = await api("gifts", "POST", item);
      if (gift.name !== item.name || gift.matchName !== item.matchName || gift.image.primaryUrl !== item.primaryImageUrl) throw new Error(`Creation verification failed for ${item.name}`);
      completed.added.push(gift.id);
    }
  } finally {
    await writeFile(path.join(reportDir, "completed.json"), JSON.stringify(completed, null, 2));
  }
  const disk = JSON.parse(await readFile(path.join(root, "data/gifts/catalog.json"), "utf8"));
  console.log(JSON.stringify({ mode: "applied", ...summary(), added: completed.added.length, updated: completed.updated.length,
    totalAfter: disk.records.length, withImage: disk.records.filter((gift) => gift.image.primaryUrl).length,
    reportDir: path.relative(root, reportDir) }, null, 2));
}
