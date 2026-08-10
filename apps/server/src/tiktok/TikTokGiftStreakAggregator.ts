import type { NormalizedEvent } from "@obs-effect/shared-types";
import { buildTikTokEventId } from "./TikTokEventId.js";

interface GiftStreak {
  roomId?: string;
  userId?: string;
  uniqueUserId?: string;
  giftId?: string;
  giftName?: string;
  startedAt: number;
  lastUpdatedAt: number;
  repeatCount: number;
  diamondValuePerUnit?: number;
  giftImageUrls?: string[];
  primaryGiftImageUrl?: string;
}

export class TikTokGiftStreakAggregator {
  private streaks = new Map<string, GiftStreak>();

  update(input: {
    roomId?: string;
    userId?: string;
    uniqueUserId?: string;
    giftId?: string;
    giftName?: string;
    repeatCount: number;
    diamondValuePerUnit?: number;
    giftImageUrls?: string[];
    primaryGiftImageUrl?: string;
    repeatEnd: boolean;
    timestampMs: number;
  }): NormalizedEvent {
    const key = `${input.roomId ?? "room"}:${input.userId ?? input.uniqueUserId ?? "anonymous"}:${input.giftId ?? input.giftName ?? "gift"}`;
    const current =
      this.streaks.get(key) ??
      ({
        roomId: input.roomId,
        userId: input.userId,
        uniqueUserId: input.uniqueUserId,
        giftId: input.giftId,
        giftName: input.giftName,
        startedAt: input.timestampMs,
        lastUpdatedAt: input.timestampMs,
        repeatCount: input.repeatCount,
        diamondValuePerUnit: input.diamondValuePerUnit,
        giftImageUrls: input.giftImageUrls,
        primaryGiftImageUrl: input.primaryGiftImageUrl
      } satisfies GiftStreak);

    current.repeatCount = Math.max(current.repeatCount, input.repeatCount);
    current.lastUpdatedAt = input.timestampMs;
    current.diamondValuePerUnit = input.diamondValuePerUnit ?? current.diamondValuePerUnit;
    current.giftImageUrls = mergeUrls(current.giftImageUrls, input.giftImageUrls);
    current.primaryGiftImageUrl = input.primaryGiftImageUrl ?? current.primaryGiftImageUrl;

    if (input.repeatEnd) {
      this.streaks.delete(key);
      return this.toEvent(current, "gift-streak-end");
    }

    this.streaks.set(key, current);
    return this.toEvent(current, current.repeatCount <= 1 ? "gift-streak-start" : "gift-streak-update");
  }

  private toEvent(streak: GiftStreak, type: "gift-streak-start" | "gift-streak-update" | "gift-streak-end"): NormalizedEvent {
    const timestamp = new Date(streak.lastUpdatedAt).toISOString();
    const diamondValueTotal =
      typeof streak.diamondValuePerUnit === "number" ? streak.diamondValuePerUnit * streak.repeatCount : undefined;

    return {
      schemaVersion: "1.0",
      eventId: buildTikTokEventId([streak.roomId, type, streak.userId, streak.giftId, streak.startedAt, streak.repeatCount]),
      source: "tiktok-direct",
      platform: "tiktok",
      type,
      timestamp,
      receivedAt: timestamp,
      room: streak.roomId ? { id: streak.roomId } : undefined,
      user: streak.userId || streak.uniqueUserId ? { id: streak.userId, uniqueId: streak.uniqueUserId } : undefined,
      data: {
        giftId: streak.giftId,
        giftName: streak.giftName,
        repeatCount: streak.repeatCount,
        diamondValuePerUnit: streak.diamondValuePerUnit,
        diamondValueTotal,
        giftImageUrls: streak.giftImageUrls ?? [],
        primaryGiftImageUrl: streak.primaryGiftImageUrl
      },
      metadata: {
        connector: "tiktok-live-connector",
        rawEventType: "gift",
        giftStreak: true
      }
    };
  }
}

function mergeUrls(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  return [...new Set([...(existing ?? []), ...(incoming ?? [])])];
}
