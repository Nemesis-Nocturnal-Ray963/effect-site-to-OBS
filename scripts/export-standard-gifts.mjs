import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(path.join(root, "data/gifts/catalog.json"), "utf8"));
const gifts = catalog.records.map((record) => {
  const imageUrl = record.image?.primaryUrl;
  // Export only public gift metadata. Never distribute local files, URL credentials,
  // signed query strings, receive history, cache paths or user settings.
  const url = imageUrl ? new URL(imageUrl, "http://localhost") : null;
  if (url && (url.protocol !== "https:" || !/(^|\.)tiktokcdn\.com$/i.test(url.hostname) || url.username || url.password || url.search || url.hash)) {
    throw new Error(`Gift ${record.id} has a non-public image URL; review before exporting.`);
  }
  return {
    platform: record.platform,
    platformGiftId: record.platformGiftId,
    name: record.name,
    matchName: record.matchName ?? record.name,
    coinValue: record.coinValue ?? record.diamondValue ?? null,
    ...(imageUrl ? { imageUrl } : {})
  };
}).sort((a, b) => a.platformGiftId.localeCompare(b.platformGiftId, "en"));
const version = createHash("sha256").update(JSON.stringify(gifts)).digest("hex");
const output = path.join(root, "apps/server/catalogs/standard-gifts.json");
let previous;
let previousRaw;
try {
  previousRaw = await readFile(output, "utf8");
  previous = JSON.parse(previousRaw);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous && previous.version !== version) {
  if (!/^[a-f0-9]{64}$/.test(previous.version)) throw new Error("Invalid previous standard catalog version");
  const history = path.join(path.dirname(output), "history");
  await mkdir(history, { recursive: true });
  const historyPath = path.join(history, `${previous.version}.json`);
  try {
    await writeFile(historyPath, previousRaw, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(historyPath, "utf8") !== previousRaw) throw new Error("Existing standard gift history does not match the previous catalog");
  }
}
const previousVersion = previous?.version === version ? previous.previousVersion : previous?.version;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, version, ...(previousVersion ? { previousVersion } : {}), gifts }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ file: path.relative(root, output), gifts: gifts.length, withImage: gifts.filter((gift) => gift.imageUrl).length, version, previousVersion }, null, 2));
