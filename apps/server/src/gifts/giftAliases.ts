const tiktokRoseGiftIds = new Set(["rose", "5655", "tiktok:rose", "tiktok:5655"]);

export function giftMatches(event: { platform: string; data: Record<string, unknown> }, giftId: string, giftName?: string): boolean {
  const idMatches = [event.data.giftId, event.data.platformGiftId].some(
    (id) => id !== undefined && samePlatformGiftId(event.platform, String(id), giftId)
  );
  const normalizeName = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
  const name = normalizeName(giftName);
  return idMatches || Boolean(name && name === normalizeName(event.data.giftName));
}

export function samePlatformGiftId(platform: string, left: string, right: string): boolean {
  const leftNormalized = normalizePlatformGiftId(platform, left);
  const rightNormalized = normalizePlatformGiftId(platform, right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  return platform === "tiktok" && tiktokRoseGiftIds.has(leftNormalized) && tiktokRoseGiftIds.has(rightNormalized);
}

export function giftIdMatchesAny(platform: string, selectedIds: Iterable<string>, eventGiftId: string): boolean {
  const eventCandidates = [eventGiftId, eventGiftId ? `${platform}:${eventGiftId}` : ""].filter(Boolean);
  for (const selectedId of selectedIds) {
    for (const eventCandidate of eventCandidates) {
      if (samePlatformGiftId(platform, selectedId, eventCandidate)) return true;
    }
  }
  return false;
}

function normalizePlatformGiftId(platform: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  return normalized.startsWith(`${platform}:`) ? normalized.slice(platform.length + 1) : normalized;
}
