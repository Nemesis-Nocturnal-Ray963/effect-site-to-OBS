import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const smallString = z.string().max(200);
const mediumString = z.string().max(500);
const safeRecord = z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 12000, {
  message: "Object is too large"
});

export const normalizedEventSchema = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  eventId: z.string().min(1).max(200),
  source: z.enum(["external-http", "control-ui", "test", "tiktok-direct", "unknown"]),
  platform: z.enum(["tiktok", "youtube", "twitch", "local", "external"]),
  type: z.enum([
    "connect",
    "disconnect",
    "stream-start",
    "stream-end",
    "comment",
    "like",
    "like-batch",
    "follow",
    "share",
    "gift",
    "gift-streak-start",
    "gift-streak-update",
    "gift-streak-end",
    "subscribe",
    "member-join",
    "viewer-count",
    "custom"
  ]),
  timestamp: isoDateTime,
  room: z
    .object({
      id: smallString.optional(),
      uniqueId: smallString.optional()
    })
    .optional(),
  user: z
    .object({
      id: smallString.optional(),
      uniqueId: smallString.optional(),
      displayName: mediumString.optional(),
      avatarUrl: z.string().url().max(1000).nullable().optional(),
      isModerator: z.boolean().optional(),
      isSubscriber: z.boolean().optional()
    })
    .optional(),
  data: safeRecord,
  metadata: safeRecord.optional()
});
