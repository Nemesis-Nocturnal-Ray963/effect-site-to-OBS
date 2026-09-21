import type { NormalizedEvent } from "@obs-effect/shared-types";
import { buildTikTokEventId } from "./TikTokEventId.js";
import { TikTokGiftStreakAggregator } from "./TikTokGiftStreakAggregator.js";
import { TikTokLikeAggregator } from "./TikTokLikeAggregator.js";

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function imageUrlsFrom(value: unknown): string[] {
  const urls = new Set<string>();

  function visit(current: unknown): void {
    if (typeof current === "string") {
      if (/^https?:\/\//iu.test(current)) urls.add(current);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(current as RawRecord)) {
      if (/^(imageUrl|iconUrl|pictureUrl|url|uri)$/iu.test(key) || /urlList|url_list|image|picture|giftPicture/iu.test(key)) {
        visit(child);
      }
    }
  }

  visit(value);
  return [...urls];
}

function nested(record: RawRecord, key: string): RawRecord {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function rawEventType(raw: RawRecord): string {
  return (
    text(raw.eventType) ??
    text(raw.type) ??
    text(raw.eventName) ??
    text(raw.name) ??
    text(raw.rawEventType) ??
    "custom"
  );
}

function timestampMs(raw: RawRecord): number {
  const fromRaw = numberValue(raw.timestamp) ?? numberValue(raw.createTime) ?? numberValue(raw.createTimeMs);
  if (!fromRaw) return Date.now();
  return fromRaw > 10_000_000_000 ? fromRaw : fromRaw * 1000;
}

function userFrom(raw: RawRecord): NormalizedEvent["user"] {
  const user = nested(raw, "user");
  const userId = text(raw.userId) ?? text(user.userId) ?? text(user.id);
  const uniqueId = text(raw.uniqueId) ?? text(user.uniqueId) ?? text(user.unique_id);
  const displayName = text(raw.nickname) ?? text(raw.displayName) ?? text(user.nickname) ?? text(user.displayName);
  const avatarUrl = text(user.avatarUrl) ?? text(user.profilePictureUrl) ?? null;

  if (!userId && !uniqueId && !displayName) return undefined;

  return {
    id: userId,
    uniqueId,
    displayName,
    avatarUrl,
    isModerator: booleanValue(user.isModerator),
    isSubscriber: booleanValue(user.isSubscriber)
  };
}

function roomFrom(raw: RawRecord): NormalizedEvent["room"] {
  const roomId = text(raw.roomId) ?? text(raw.room_id);
  return roomId ? { id: roomId } : undefined;
}

function baseEvent(raw: RawRecord, type: NormalizedEvent["type"], data: Record<string, unknown>): NormalizedEvent {
  const rawType = rawEventType(raw);
  const timestamp = new Date(timestampMs(raw)).toISOString();
  const room = roomFrom(raw);
  const user = userFrom(raw);

  return {
    schemaVersion: "1.0",
    eventId: buildTikTokEventId([
      room?.id,
      rawType,
      user?.id ?? user?.uniqueId,
      timestamp,
      text(raw.msgId) ?? text(raw.messageId) ?? text(raw.giftId),
      numberValue(raw.repeatCount) ?? numberValue(raw.repeat_count)
    ]),
    source: "tiktok-direct",
    platform: "tiktok",
    type,
    timestamp,
    receivedAt: new Date().toISOString(),
    room,
    user,
    data,
    metadata: {
      connector: isRecord(raw.tikfinityEnvelope) ? "tikfinity" : "tiktok-live-connector",
      rawEventType: rawType,
      deduplicationConfidence: text(raw.msgId) || text(raw.messageId) ? "high" : "medium"
    }
  };
}

export class TikTokEventNormalizer {
  private readonly giftStreaks = new TikTokGiftStreakAggregator();
  private readonly likes = new TikTokLikeAggregator(500);

  normalize(raw: unknown): NormalizedEvent[] {
    if (!isRecord(raw)) {
      return [];
    }

    const eventType = rawEventType(raw).toLowerCase();

    if (eventType === "chat" || eventType === "comment") {
      return [baseEvent(raw, "comment", { comment: text(raw.comment) ?? text(raw.content) ?? "" })];
    }

    if (eventType === "follow" || eventType === "social") {
      return [baseEvent(raw, "follow", { action: "follow" })];
    }

    if (eventType === "share") {
      return [baseEvent(raw, "share", { action: "share" })];
    }

    if (eventType === "member" || eventType === "member-join" || eventType === "join") {
      return [baseEvent(raw, "member-join", { action: "joined" })];
    }

    if (eventType === "streamend" || eventType === "stream-end" || eventType === "disconnected") {
      return [baseEvent(raw, "stream-end", { reason: text(raw.reason) ?? "stream-end" })];
    }

    if (eventType === "roomuser" || eventType === "viewer-count") {
      return [
        baseEvent(raw, "viewer-count", {
          viewerCount: numberValue(raw.viewerCount) ?? numberValue(raw.viewer_count) ?? numberValue(raw.count)
        })
      ];
    }

    if (eventType === "like") {
      const event = this.likes.add({
        roomId: roomFrom(raw)?.id,
        userId: userFrom(raw)?.id,
        uniqueUserId: userFrom(raw)?.uniqueId,
        count: numberValue(raw.likeCount) ?? numberValue(raw.count) ?? 1,
        totalLikeCount: numberValue(raw.totalLikeCount) ?? numberValue(raw.total),
        timestampMs: timestampMs(raw)
      });
      return event ? [event] : [];
    }

    if (eventType === "gift") {
      const repeatCount = numberValue(raw.repeatCount) ?? numberValue(raw.repeat_count) ?? 1;
      const repeatEnd = booleanValue(raw.repeatEnd) || booleanValue(raw.repeat_end);
      const streakable = repeatCount > 1 || repeatEnd;
      const giftImageUrls = [
        ...stringArray(raw.giftImageUrls),
        ...imageUrlsFrom(raw.gift),
        ...imageUrlsFrom(raw.giftPicture),
        ...imageUrlsFrom(raw.extendedGiftInfo)
      ].filter((url, index, all) => all.indexOf(url) === index);
      const primaryGiftImageUrl = text(raw.primaryGiftImageUrl) ?? giftImageUrls[0];

      if (streakable) {
        return [
          this.giftStreaks.update({
            roomId: roomFrom(raw)?.id,
            userId: userFrom(raw)?.id,
            uniqueUserId: userFrom(raw)?.uniqueId,
            giftId: text(raw.giftId) ?? text(raw.gift_id),
            giftName: text(raw.giftName) ?? text(raw.gift_name),
            repeatCount,
            diamondValuePerUnit: numberValue(raw.diamondValue) ?? numberValue(raw.diamond_value),
            giftImageUrls,
            primaryGiftImageUrl,
            repeatEnd,
            timestampMs: timestampMs(raw)
          })
        ];
      }

      return [
        baseEvent(raw, "gift", {
          giftId: text(raw.giftId) ?? text(raw.gift_id),
          giftName: text(raw.giftName) ?? text(raw.gift_name) ?? "Gift",
          repeatCount,
          diamondValue: numberValue(raw.diamondValue) ?? numberValue(raw.diamond_value),
          diamondValueTotal: numberValue(raw.diamondValueTotal) ?? numberValue(raw.diamond_value_total),
          giftImageUrls,
          primaryGiftImageUrl
        })
      ];
    }

    return [baseEvent(raw, "custom", { eventType, rawEventType: eventType })];
  }
}
