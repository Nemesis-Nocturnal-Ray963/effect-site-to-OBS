import type { NormalizedEvent } from "@obs-effect/shared-types";
import { buildTikTokEventId } from "./TikTokEventId.js";

interface LikeBucket {
  roomId?: string;
  userId?: string;
  uniqueUserId?: string;
  count: number;
  totalLikeCount?: number;
  startedAt: number;
  lastUpdatedAt: number;
}

export class TikTokLikeAggregator {
  private readonly windowMs: number;
  private buckets = new Map<string, LikeBucket>();

  constructor(windowMs = 500) {
    this.windowMs = windowMs;
  }

  add(input: {
    roomId?: string;
    userId?: string;
    uniqueUserId?: string;
    count: number;
    totalLikeCount?: number;
    timestampMs: number;
  }): NormalizedEvent | null {
    const key = `${input.roomId ?? "room"}:${input.userId ?? input.uniqueUserId ?? "anonymous"}`;
    const existing = this.buckets.get(key);

    if (!existing || input.timestampMs - existing.startedAt > this.windowMs) {
      const bucket: LikeBucket = {
        roomId: input.roomId,
        userId: input.userId,
        uniqueUserId: input.uniqueUserId,
        count: input.count,
        totalLikeCount: input.totalLikeCount,
        startedAt: input.timestampMs,
        lastUpdatedAt: input.timestampMs
      };
      this.buckets.set(key, bucket);
      return this.toEvent(bucket);
    }

    existing.count += input.count;
    existing.totalLikeCount = input.totalLikeCount ?? existing.totalLikeCount;
    existing.lastUpdatedAt = input.timestampMs;
    return this.toEvent(existing);
  }

  private toEvent(bucket: LikeBucket): NormalizedEvent {
    const timestamp = new Date(bucket.lastUpdatedAt).toISOString();
    return {
      schemaVersion: "1.0",
      eventId: buildTikTokEventId([bucket.roomId, "like-batch", bucket.userId, bucket.startedAt, bucket.count]),
      source: "tiktok-direct",
      platform: "tiktok",
      type: "like-batch",
      timestamp,
      receivedAt: timestamp,
      room: bucket.roomId ? { id: bucket.roomId } : undefined,
      user: bucket.userId || bucket.uniqueUserId ? { id: bucket.userId, uniqueId: bucket.uniqueUserId } : undefined,
      data: {
        count: bucket.count,
        totalLikeCount: bucket.totalLikeCount,
        windowMs: this.windowMs,
        uniqueUserId: bucket.uniqueUserId
      },
      metadata: {
        connector: "tiktok-live-connector",
        rawEventType: "like",
        aggregated: true
      }
    };
  }
}
