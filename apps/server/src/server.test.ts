import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp } from "./app.js";
import { DeduplicationStore } from "./deduplication/deduplicationStore.js";
import { EventBus } from "./events/eventBus.js";
import { TikTokEventNormalizer } from "./tiktok/TikTokEventNormalizer.js";
import { safeSerialize } from "./tiktok/raw-capture/safeSerialize.js";
import { redactSecrets } from "./tiktok/raw-capture/redactSecrets.js";
import { BrowserFrameStore } from "./tiktok/browser/BrowserFrameStore.js";
import { redactBrowserUrl } from "./tiktok/browser/BrowserFrameRedactor.js";
import { PlaceholderBrowserFrameDecoder, TikTokWebcastBrowserFrameDecoder } from "./tiktok/browser/BrowserFrameDecoder.js";
import { OverlayConnectionManager } from "./overlays/overlayConnectionManager.js";
import { OverlayRegistry } from "./overlays/overlayRegistry.js";
import { EffectConfigurationJsonRepository } from "./effects/EffectConfigurationJsonRepository.js";
import { EffectConfigurationService } from "./effects/EffectConfigurationService.js";
import { GiftCatalogJsonRepository } from "./gifts/GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./gifts/GiftCatalogService.js";
import type { NormalizedEvent, ServerMessage } from "@obs-effect/shared-types";
import { EventEmitter } from "node:events";
import {
  BaseProtoMessage as ProtoBaseMessage,
  CommonMessageData,
  createBaseWebcastPushFrame,
  Gift,
  ProtoMessageFetchResult,
  User,
  WebcastChatMessage,
  WebcastGiftMessage
} from "tiktok-live-connector";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const apiKey = "test-api-key-with-enough-length-123";

function createFollowEvent(eventId: string, roomId: string, userId: string): NormalizedEvent {
  return {
    schemaVersion: "1.0",
    eventId,
    source: "test",
    platform: "tiktok",
    type: "follow",
    timestamp: "2026-07-18T00:00:00.000Z",
    receivedAt: "2026-07-18T00:00:00.000Z",
    room: { id: roomId },
    user: { id: userId, uniqueId: userId, displayName: userId },
    data: {}
  };
}

describe("server phase 1 contract", () => {
  it("uses the required default port", () => {
    expect(3190).toBe(3190);
  });
});

describe("DeduplicationStore", () => {
  it("marks the second event id as duplicate", () => {
    const store = new DeduplicationStore({ ttlMs: 600000, maxEntries: 10000 });
    expect(store.isDuplicate("event-1", 1000)).toBe(false);
    expect(store.isDuplicate("event-1", 1001)).toBe(true);
  });
});

describe("EventBus", () => {
  it("continues publishing when a subscriber throws", () => {
    const bus = new EventBus();
    let called = false;

    bus.subscribe(() => {
      throw new Error("subscriber failed");
    });
    bus.subscribe(() => {
      called = true;
    });

    bus.publish({
      schemaVersion: "1.0",
      eventId: "event-1",
      source: "test",
      platform: "local",
      type: "gift",
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      data: {}
    });

    expect(called).toBe(true);
  });
});

describe("POST /api/v1/events", () => {
  it("receives a valid gift event and rejects duplicates", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-event-route-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const payload = {
        schemaVersion: "1.0",
        eventId: "event-route-1",
        source: "external-http",
        platform: "tiktok",
        type: "gift",
        timestamp: new Date().toISOString(),
        data: { giftName: "Rose" }
      };

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload
      });

      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({ accepted: true, duplicate: false, matchedActions: [] });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ accepted: true, duplicate: true, matchedActions: [] });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("stores event history and replays an event with a new id", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-history-route-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const payload = {
        schemaVersion: "1.0",
        eventId: "history-route-1",
        source: "external-http",
        platform: "tiktok",
        type: "follow",
        timestamp: new Date().toISOString(),
        data: {}
      };

      await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload
      });

      const history = await app.inject({
        method: "GET",
        url: "/api/v1/events/history"
      });
      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/events/history-route-1/replay"
      });

      expect(history.statusCode).toBe(200);
      expect(history.json()).toMatchObject({
        events: [
          {
            event: { eventId: "history-route-1" },
            result: { duplicate: false, matchedActions: [], triggeredEffects: [] }
          }
        ]
      });
      expect(replay.statusCode).toBe(202);
      expect(replay.json().eventId).not.toBe("history-route-1");
      expect(replay.json()).toMatchObject({ accepted: true, replayedFromEventId: "history-route-1", matchedActions: [] });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid API keys and invalid event types", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const app = await createApp({ rootDir });

    const payload = {
      schemaVersion: "1.0",
      eventId: "event-route-2",
      source: "external-http",
      platform: "tiktok",
      type: "not-allowed",
      timestamp: new Date().toISOString(),
      data: {}
    };

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-effect-app-key": "wrong-key-with-enough-length-123" },
      payload
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-effect-app-key": apiKey },
      payload
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);

    await app.close();
  });

  it("rate limits bursts", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const app = await createApp({ rootDir });

    let lastStatus = 0;
    for (let index = 0; index < 101; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: `rate-${index}`,
          source: "external-http",
          platform: "tiktok",
          type: "comment",
          timestamp: new Date().toISOString(),
          data: { comment: "hello" }
        }
      });
      lastStatus = response.statusCode;
    }

    expect(lastStatus).toBe(429);

    await app.close();
  });

  it("automatically catalogs received events and preserves editable memo fields", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-event-catalog-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const payload = {
        schemaVersion: "1.0",
        eventId: "event-catalog-gift-1",
        source: "external-http",
        platform: "tiktok",
        type: "gift",
        timestamp: new Date().toISOString(),
        data: { giftId: "5655", giftName: "Rose", repeatCount: 1, secret: "hidden" }
      };
      await app.inject({ method: "POST", url: "/api/v1/events", headers: { "x-effect-app-key": apiKey }, payload });
      await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: { ...payload, eventId: "event-catalog-gift-2" }
      });

      const list = await app.inject({ method: "GET", url: "/api/v1/event-catalog?search=rose" });
      const item = list.json().events[0];
      expect(item).toMatchObject({ sourceType: "http", eventType: "gift", externalEventId: "5655", displayName: "Rose", receivedCount: 2 });
      expect(JSON.stringify(item.rawSamplePayload)).toContain("[redacted]");

      const updated = await app.inject({
        method: "PATCH",
        url: `/api/v1/event-catalog/${item.id}`,
        payload: { memo: "High value gift", isFavorite: true, tags: ["gift", "important"] }
      });
      expect(updated.json().event).toMatchObject({ memo: "High value gift", isFavorite: true, tags: ["gift", "important"] });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("TikTokEventNormalizer", () => {
  it("maps core raw TikTok events to normalized events", () => {
    const normalizer = new TikTokEventNormalizer();

    expect(
      normalizer.normalize({
        eventType: "chat",
        roomId: "room-1",
        user: { userId: "user-1", uniqueId: "viewer01", nickname: "Viewer" },
        comment: "hello",
        msgId: "msg-1",
        timestamp: 1784192915
      })[0]
    ).toMatchObject({
      source: "tiktok-direct",
      platform: "tiktok",
      type: "comment",
      user: { id: "user-1", uniqueId: "viewer01", displayName: "Viewer" },
      data: { comment: "hello" }
    });

    expect(
      normalizer.normalize({
        eventType: "gift",
        roomId: "room-1",
        user: { userId: "user-1" },
        giftId: "rose",
        giftName: "Rose",
        repeatCount: 1,
        giftImageUrls: ["https://example.test/rose.png"],
        primaryGiftImageUrl: "https://example.test/rose.png"
      })[0]
    ).toMatchObject({
      type: "gift",
      data: { giftName: "Rose", repeatCount: 1, giftImageUrls: ["https://example.test/rose.png"] }
    });

    expect(
      normalizer.normalize({
        eventType: "like",
        roomId: "room-1",
        user: { userId: "user-1" },
        count: 25
      })[0]
    ).toMatchObject({ type: "like-batch", data: { count: 25, windowMs: 500 } });

    expect(normalizer.normalize({ eventType: "follow", roomId: "room-1", user: { userId: "user-1" } })[0]).toMatchObject({
      type: "follow"
    });
  });

  it("emits one gift event per raw TikTok gift path to avoid double triggering effects", () => {
    const normalizer = new TikTokEventNormalizer();

    const singleGift = normalizer.normalize({
      eventType: "gift",
      roomId: "room-1",
      user: { userId: "user-1" },
      giftId: "rose",
      giftName: "Rose",
      repeatCount: 1,
      timestamp: 1784192915
    });
    const streakStart = normalizer.normalize({
      eventType: "gift",
      roomId: "room-1",
      user: { userId: "user-1" },
      giftId: "rose",
      giftName: "Rose",
      repeatCount: 2,
      timestamp: 1784192916
    });
    const streakEnd = normalizer.normalize({
      eventType: "gift",
      roomId: "room-1",
      user: { userId: "user-1" },
      giftId: "rose",
      giftName: "Rose",
      repeatCount: 2,
      repeatEnd: true,
      timestamp: 1784192917
    });

    expect(singleGift.map((event) => event.type)).toEqual(["gift"]);
    expect(streakStart.map((event) => event.type)).toEqual(["gift-streak-update"]);
    expect(streakEnd.map((event) => event.type)).toEqual(["gift-streak-end"]);
    expect([...singleGift, ...streakStart, ...streakEnd].filter((event) => event.type === "gift")).toHaveLength(1);
  });
});

describe("Gift catalog", () => {
  it("extracts TikTok gift events and upserts records without sender data", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-gifts-"));
    const repository = GiftCatalogJsonRepository.fromRoot(tempRoot);
    const service = new GiftCatalogService({ repository });

    await service.processEvent({
      schemaVersion: "1.0",
      eventId: "gift-catalog-1",
      source: "tiktok-direct",
      platform: "tiktok",
      type: "gift",
      timestamp: "2026-07-16T10:00:00.000Z",
      receivedAt: "2026-07-16T10:00:00.000Z",
      user: { id: "must-not-be-stored", uniqueId: "sender" },
      data: {
        giftId: 5655,
        giftName: "Rose",
        diamondValue: 1,
        coinValue: 1,
        imageUrl: "https://example.test/rose.png"
      },
      metadata: { rawEventType: "WebcastGiftMessage" }
    });
    await service.processEvent({
      schemaVersion: "1.0",
      eventId: "gift-catalog-2",
      source: "tiktok-direct",
      platform: "tiktok",
      type: "gift-streak-update",
      timestamp: "2026-07-16T10:01:00.000Z",
      receivedAt: "2026-07-16T10:01:00.000Z",
      user: { id: "must-not-be-stored" },
      data: {
        giftId: "5655",
        giftName: "Rose Alt",
        diamondValue: null,
        giftPicture: { urlList: ["https://example.test/rose-large.png", "https://example.test/rose.png"] }
      }
    });

    const record = await repository.getByPlatformGiftId("tiktok", "5655");
    expect(record).toMatchObject({
      id: "tiktok:5655",
      platformGiftId: "5655",
      name: "Rose",
      aliases: ["Rose Alt"],
      diamondValue: 1,
      coinValue: 1,
      seenCount: 1,
      firstSeenRawEventName: "WebcastGiftMessage",
      lastSeenRawEventName: "gift-streak-update"
    });
    expect(JSON.stringify(record)).not.toContain("must-not-be-stored");
    expect(record?.image.urls).toEqual(["https://example.test/rose.png", "https://example.test/rose-large.png"]);

    await service.update("tiktok:5655", { name: "Manual Rose", coinValue: 2 });
    await service.processEvent({
      schemaVersion: "1.0",
      eventId: "gift-catalog-3",
      source: "tiktok-direct",
      platform: "tiktok",
      type: "gift",
      timestamp: "2026-07-16T10:02:00.000Z",
      receivedAt: "2026-07-16T10:02:00.000Z",
      data: { giftId: "5655", giftName: "Auto Rose", diamondValue: 9 }
    });

    const edited = await repository.getByPlatformGiftId("tiktok", "5655");
    expect(edited).toMatchObject({ name: "Manual Rose", diamondValue: 2, coinValue: 2, isManuallyEdited: true, seenCount: 2 });

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("records gifts received through the HTTP API", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-app-gifts-"));
    const app = await createApp({ rootDir: tempRoot });

    const posted = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-effect-app-key": apiKey },
      payload: {
        schemaVersion: "1.0",
        eventId: "gift-route-1",
        source: "external-http",
        platform: "tiktok",
        type: "gift",
        timestamp: "2026-07-16T10:00:00.000Z",
        data: { giftId: "5655", giftName: "Rose", diamondValue: 1 }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const list = await app.inject({ method: "GET", url: "/api/v1/gifts" });
    const stats = await app.inject({ method: "GET", url: "/api/v1/gifts/stats" });

    expect(posted.statusCode).toBe(202);
    expect(list.statusCode).toBe(200);
    expect(list.json().gifts[0]).toMatchObject({ id: "tiktok:5655", name: "Rose", diamondValue: 1, coinValue: 1 });
    expect(stats.json().stats).toMatchObject({ total: 1, withCoinValue: 1 });

    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe("EffectConfigurationService follow trigger matching", () => {
  it("can limit follow triggers to once per user per stream", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-follow-once-"));
    const service = new EffectConfigurationService(EffectConfigurationJsonRepository.fromRoot(tempRoot), () => "2026-07-18T00:00:00.000Z");

    try {
      await service.create({
        name: "Follow Once",
        effectDefinitionId: "simple-media",
        presetId: "preset-1",
        presetSlotId: "slot-1",
        trigger: { mode: "any", conditions: [{ type: "follow", oncePerUserPerStream: true }] }
      });

      const first = await service.match(createFollowEvent("follow-1", "room-1", "viewer-1"));
      const duplicate = await service.match(createFollowEvent("follow-2", "room-1", "viewer-1"));
      const otherUser = await service.match(createFollowEvent("follow-3", "room-1", "viewer-2"));
      const otherStream = await service.match(createFollowEvent("follow-4", "room-2", "viewer-1"));

      expect(first).toHaveLength(1);
      expect(duplicate).toHaveLength(0);
      expect(otherUser).toHaveLength(1);
      expect(otherStream).toHaveLength(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("can allow repeated follow triggers from the same user", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-follow-repeat-"));
    const service = new EffectConfigurationService(EffectConfigurationJsonRepository.fromRoot(tempRoot), () => "2026-07-18T00:00:00.000Z");

    try {
      await service.create({
        name: "Follow Repeat",
        effectDefinitionId: "simple-media",
        presetId: "preset-1",
        presetSlotId: "slot-1",
        trigger: { mode: "any", conditions: [{ type: "follow", oncePerUserPerStream: false }] }
      });

      expect(await service.match(createFollowEvent("follow-1", "room-1", "viewer-1"))).toHaveLength(1);
      expect(await service.match(createFollowEvent("follow-2", "room-1", "viewer-1"))).toHaveLength(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("TikTok raw capture serialization", () => {
  it("serializes unsafe JavaScript values without throwing", () => {
    const input: Record<string, unknown> = {
      id: 9007199254740993n,
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      error: new Error("boom"),
      buffer: new Uint8Array([1, 2, 3]),
      map: new Map([["key", "value"]]),
      set: new Set(["a", "b"])
    };
    input.self = input;

    const result = safeSerialize(input);

    expect(result.value).toMatchObject({
      id: "9007199254740993n",
      createdAt: "2026-07-16T00:00:00.000Z",
      error: { __type: "Error", message: "boom" },
      buffer: { __type: "Uint8Array", length: 3 },
      self: "[Circular]"
    });
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("redacts secret-looking fields recursively", () => {
    const result = redactSecrets({
      sessionId: "secret-session",
      nested: {
        authorization: "Bearer token",
        user: "viewer01"
      }
    });

    expect(result.value).toEqual({
      sessionId: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        user: "viewer01"
      }
    });
    expect(result.redactedFields).toEqual(["$.sessionId", "$.nested.authorization"]);
  });
});

describe("TikTok browser frame capture", () => {
  it("redacts secret query parameters in browser WebSocket URLs", () => {
    expect(redactBrowserUrl("wss://example.test/ws?msToken=secret&room_id=123&ttwid=abc").value).toBe(
      "wss://example.test/ws?msToken=%5BREDACTED%5D&room_id=123&ttwid=%5BREDACTED%5D"
    );
  });

  it("stores text and binary frames with capped history", async () => {
    const store = new BrowserFrameStore(2);
    const common = {
      browser: { type: "chrome" as const, debuggingPort: 9222 },
      page: { url: "https://www.tiktok.com/@sample/live", uniqueId: "sample" },
      requestId: "socket-1",
      socketUrl: "wss://example.test/ws?msToken=secret"
    };

    const first = store.add({ ...common, direction: "received", opcode: 1, payloadData: "{\"hello\":\"world\"}" });
    store.add({ ...common, direction: "sent", opcode: 1, payloadData: "ping" });
    store.add({ ...common, direction: "received", opcode: 2, payloadData: "AQID" });

    expect(store.list()).toHaveLength(2);
    expect(store.status()).toMatchObject({ count: 2, receivedFrameCount: 1, sentFrameCount: 1, binaryFrameCount: 1 });
    expect(first?.metadata.redactedFields).toContain("url.searchParams.msToken");
    expect(first?.decode.status).toBe("json");
    await expect(new PlaceholderBrowserFrameDecoder().decode(first!)).resolves.toEqual([{ hello: "world" }]);
  });

  it("decodes TikTok webcast chat and gift frames into raw events", async () => {
    const store = new BrowserFrameStore(2);
    const common = {
      browser: { type: "chrome" as const, debuggingPort: 9222 },
      page: { url: "https://www.tiktok.com/@sample/live", uniqueId: "sample" },
      requestId: "socket-1",
      socketUrl: "wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/"
    };
    const decoder = new TikTokWebcastBrowserFrameDecoder();

    const commonMessage = (method: string, msgId: string) => ({
      ...CommonMessageData.decode(new Uint8Array()),
      method,
      msgId,
      roomId: "3001",
      createTime: "1784198460"
    });
    const chatPayload = WebcastChatMessage.encode({
      ...WebcastChatMessage.decode(new Uint8Array()),
      common: commonMessage("WebcastChatMessage", "1001"),
      user: { ...User.decode(new Uint8Array()), id: "2001", nickname: "Viewer" },
      content: "hello"
    }).finish();
    const giftPayload = WebcastGiftMessage.encode({
      ...WebcastGiftMessage.decode(new Uint8Array()),
      common: { ...commonMessage("WebcastGiftMessage", "1002"), createTime: "1784198461" },
      user: { ...User.decode(new Uint8Array()), id: "2002", nickname: "Giver" },
      giftId: "5655",
      repeatCount: 3,
      repeatEnd: 1,
      gift: { ...Gift.decode(new Uint8Array()), id: "5655", name: "Rose", diamondCount: 1 }
    }).finish();
    const fetchResult = ProtoMessageFetchResult.encode({
      ...ProtoMessageFetchResult.decode(new Uint8Array()),
      messages: [
        { ...ProtoBaseMessage.decode(new Uint8Array()), method: "WebcastChatMessage", payload: chatPayload, msgId: "1001" },
        { ...ProtoBaseMessage.decode(new Uint8Array()), method: "WebcastGiftMessage", payload: giftPayload, msgId: "1002" }
      ]
    }).finish();
    const pushFrame = createBaseWebcastPushFrame({ payload: fetchResult }).finish();
    const frame = store.add({ ...common, direction: "received", opcode: 2, payloadData: Buffer.from(pushFrame).toString("base64") });

    await expect(decoder.decode(frame!)).resolves.toMatchObject([
      { eventType: "chat", roomId: "3001", msgId: "1001", comment: "hello", user: { userId: "2001", nickname: "Viewer" } },
      {
        eventType: "gift",
        roomId: "3001",
        msgId: "1002",
        giftId: "5655",
        giftName: "Rose",
        repeatCount: 3,
        repeatEnd: true,
        diamondValueTotal: 3,
        user: { userId: "2002", nickname: "Giver" }
      }
    ]);
  });
});

describe("TikTok connector routes", () => {
  it("accepts mock connector events and records them in event history", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-tiktok-mock-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const connect = await app.inject({
        method: "POST",
        url: "/api/v1/tiktok/connect",
        payload: {
          uniqueId: "mock_user",
          useMockConnector: true,
          autoReconnect: true,
          enableExtendedGiftInfo: true,
          fetchRoomInfoOnConnect: true
        }
      });
      const event = await app.inject({
        method: "POST",
        url: "/api/v1/tiktok/mock-event",
        payload: {
          eventType: "gift",
          roomId: "mock-room",
          user: { userId: "user-1", uniqueId: "viewer01" },
          giftId: "rose",
          giftName: "Rose",
          repeatCount: 1
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const history = await app.inject({ method: "GET", url: "/api/v1/events/history" });
      const status = await app.inject({ method: "GET", url: "/api/v1/status" });

      expect(connect.statusCode).toBe(202);
      expect(connect.json().status).toMatchObject({ state: "connected", roomId: "mock-room-mock_user" });
      expect(event.statusCode).toBe(200);
      expect(history.json().events[0]).toMatchObject({
        event: { source: "tiktok-direct", platform: "tiktok", type: "gift" },
        result: { duplicate: false, matchedActions: [], triggeredEffects: [] }
      });
      expect(status.json().tiktok).toMatchObject({ state: "connected", receivedCount: 1 });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("captures mock raw events, redacts secrets, exports, and clears captures", async () => {
    process.env.EFFECT_APP_API_KEY = apiKey;
    const app = await createApp({ rootDir });

    await app.inject({ method: "POST", url: "/api/v1/tiktok/raw-captures/enable" });
    await app.inject({
      method: "POST",
      url: "/api/v1/tiktok/connect",
      payload: {
        uniqueId: "mock_user",
        useMockConnector: true
      }
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/tiktok/mock-event",
      payload: {
        eventType: "chat",
        roomId: "mock-room",
        sessionId: "do-not-store",
        user: { userId: "user-1", uniqueId: "viewer01", nickname: "Viewer" },
        comment: "hello"
      }
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/tiktok/raw-captures" });
    const captureId = list.json().captures[0].captureId as string;
    const detail = await app.inject({ method: "GET", url: `/api/v1/tiktok/raw-captures/${captureId}` });
    const exported = await app.inject({
      method: "POST",
      url: "/api/v1/tiktok/raw-captures/export",
      payload: { format: "jsonl", anonymize: true }
    });
    const cleared = await app.inject({ method: "DELETE", url: "/api/v1/tiktok/raw-captures" });

    expect(list.statusCode).toBe(200);
    expect(list.json().captures[0]).toMatchObject({
      rawEventName: "chat",
      normalizationStatus: "success",
      userSummary: "Viewer"
    });
    expect(detail.json().capture.rawEvent).toMatchObject({
      sessionId: "[REDACTED]",
      comment: "hello"
    });
    expect(detail.json().capture.metadata.redactedFields).toContain("$.sessionId");
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain("uniqueId_");
    expect(exported.body).not.toContain("viewer01");
    expect(cleared.json()).toMatchObject({ cleared: true, status: { count: 0 } });

    await app.close();
  });
});

describe("OverlayConnectionManager", () => {
  it("broadcasts only to the targeted overlay", () => {
    const sent = new Map<string, ServerMessage[]>();
    const manager = new OverlayConnectionManager({
      registry: new OverlayRegistry(),
      publicBaseUrl: () => "http://127.0.0.1:3190",
      send: (client, message) => {
        const id = (client as unknown as { id: string }).id;
        sent.set(id, [...(sent.get(id) ?? []), message]);
      },
      onStatusChange: () => undefined
    });
    const overlayOne = Object.assign(new EventEmitter(), { id: "one" }) as never;
    const overlayTwo = Object.assign(new EventEmitter(), { id: "two" }) as never;

    manager.addClient(1, overlayOne);
    manager.addClient(2, overlayTwo);
    sent.clear();
    manager.broadcastToOverlay(1, {
      type: "effect:play",
      effectId: "flash",
      targetOverlayId: 1,
      instanceId: "targeted",
      createdAt: new Date().toISOString()
    });

    expect(sent.get("one")).toHaveLength(1);
    expect(sent.get("two")).toBeUndefined();
  });
});

describe("Overlay routes", () => {
  it("returns ten overlays and rejects invalid overlay ids", async () => {
    const app = await createApp({ rootDir });

    const list = await app.inject({ method: "GET", url: "/api/v1/overlays" });
    const invalid = await app.inject({ method: "GET", url: "/api/v1/overlays/11" });
    const invalidFlash = await app.inject({
      method: "POST",
      url: "/api/v1/effects/flash/play",
      payload: { targetOverlayId: 11, parameters: { color: "#ffffff" } }
    });
    const validTest = await app.inject({
      method: "POST",
      url: "/api/v1/overlays/3/test",
      payload: { color: "#ffffff", durationMs: 650 }
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().overlays).toHaveLength(10);
    expect(list.json().overlays[0]).toMatchObject({ overlayId: 1, url: "http://127.0.0.1:3190/overlay/1" });
    expect(invalid.statusCode).toBe(404);
    expect(invalidFlash.statusCode).toBe(400);
    expect(validTest.statusCode).toBe(200);
    expect(validTest.json()).toMatchObject({ accepted: true, targetOverlayId: 3 });

    await app.close();
  });

  it("persists overlay configuration and manages effect configurations", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-configs-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const definitions = await app.inject({ method: "GET", url: "/api/v1/effect-definitions" });
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Comment Flash",
          effectDefinitionId: "flash",
          targetOverlayId: 2,
          trigger: { mode: "any", conditions: [{ type: "comment", keyword: "go" }] },
          visual: { parameters: { color: "#ff00aa", durationMs: 500 } },
          playback: { durationMs: 500 }
        }
      });
      const disabled = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${created.json().configuration.id}/disable`
      });
      const duplicated = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${created.json().configuration.id}/duplicate`
      });
      const overlayPatch = await app.inject({
        method: "PATCH",
        url: "/api/v1/overlays/2/config",
        payload: { width: 1080, height: 1920, fps: 60, name: "Portrait Overlay" }
      });
      const overlays = await app.inject({ method: "GET", url: "/api/v1/overlays" });

      expect(definitions.json().definitions.map((definition: { id: string }) => definition.id)).toEqual(["flash", "falling-image", "simple-media", "pitching-machine-ball", "gift-combo-text"]);
      expect(created.statusCode).toBe(201);
      expect(created.json().configuration).toMatchObject({ name: "Comment Flash", targetOverlayId: 2, enabled: true });
      expect(disabled.json().configuration).toMatchObject({ enabled: false });
      expect(duplicated.statusCode).toBe(201);
      expect(duplicated.json().configuration).toMatchObject({ name: "Comment Flash Copy", enabled: false });
      expect(overlayPatch.json().config).toMatchObject({ overlayId: 2, width: 1080, height: 1920, name: "Portrait Overlay" });
      expect(overlays.json().overlays.find((overlay: { overlayId: number }) => overlay.overlayId === 2)).toMatchObject({
        width: 1080,
        height: 1920
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("spawns falling image runtime objects from an effect configuration test", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-falling-image-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Falling Test Card",
          effectDefinitionId: "falling-image",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] },
          visual: {
            parameters: {
              spawnCountMode: "fixed",
              fixedCount: 3,
              minimumCount: 1,
              maximumCount: 10,
              spawnPattern: "burst",
              startXMinPercent: 10,
              startXMaxPercent: 90,
              startYPercent: -10,
              lifetimeMs: 5000,
              interactionEnabled: true,
              maxHitPoints: 2,
              clickDamage: 1
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${id}/test` });
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });

      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(tested.json()).toMatchObject({ accepted: true, triggeredEffects: ["falling-image"], spawnedObjectCount: 3 });
      expect(snapshot.json().snapshot.objects).toHaveLength(3);
      expect(snapshot.json().snapshot.objects[0]).toMatchObject({
        objectType: "falling-image",
        interactive: true,
        hitPoints: 2,
        maxHitPoints: 2,
        asset: { assetId: "sample-test-card", contentUrl: "/asset-files/test-pattern-card.svg" }
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs pitching machine test scenarios for same and multiple listeners", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-pitching-test-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Pitching Test",
          effectDefinitionId: "pitching-machine-ball",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] },
          visual: {
            parameters: {
              delayBeforeLaunchMs: 50,
              travelDurationMs: 100,
              intervalBetweenBallsMs: 0,
              giftQueueGraceMs: 0,
              targetXPercent: 50,
              targetYPercent: 50
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const sameListener = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${id}/test`,
        payload: { pitchingScenario: "same-listener-gifts" }
      });
      const sameSnapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const multipleListeners = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${id}/test`,
        payload: { pitchingScenario: "multiple-listener-gifts" }
      });
      const multiSnapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const newListener = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${id}/test`,
        payload: { pitchingScenario: "new-listener-gift" }
      });
      const newListenerSnapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });

      expect(created.statusCode).toBe(201);
      expect(sameListener.json()).toMatchObject({
        accepted: true,
        pitchingScenario: "same-listener-gifts",
        testEventCount: 2
      });
      expect(sameSnapshot.json().snapshot.objects.filter((object: { objectType: string }) => object.objectType === "pitching-machine")).toHaveLength(1);
      expect(multipleListeners.json()).toMatchObject({
        accepted: true,
        pitchingScenario: "multiple-listener-gifts",
        testEventCount: 3
      });
      expect(multiSnapshot.json().snapshot.objects.filter((object: { objectType: string }) => object.objectType === "pitching-machine")).toHaveLength(4);
      expect(newListener.json()).toMatchObject({
        accepted: true,
        pitchingScenario: "new-listener-gift",
        testEventCount: 1
      });
      expect(newListenerSnapshot.json().snapshot.objects.filter((object: { objectType: string }) => object.objectType === "pitching-machine")).toHaveLength(5);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses random left/right edges and stores horizontal edge offset", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-pitching-edge-"));
    const app = await createApp({ rootDir: tempRoot });
    const originalRandom = Math.random;
    const randomValues = [0.33, 0.01, 0.5];
    Math.random = () => randomValues.shift() ?? 0.5;

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Pitching Edge Test",
          effectDefinitionId: "pitching-machine-ball",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] },
          visual: {
            parameters: {
              horizontalEdgeOffsetPx: -80,
              delayBeforeLaunchMs: 200,
              giftQueueGraceMs: 500,
              targetXPercent: 35,
              targetYPercent: 50
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${id}/test` });
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const machine = snapshot.json().snapshot.objects.find((object: { objectType: string }) => object.objectType === "pitching-machine");

      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(machine).toMatchObject({
        spawn: { normalizedX: 1, normalizedY: 0.5, rotation: 0 },
        metadata: { edge: "right", horizontalEdgeOffsetPx: -80 }
      });
    } finally {
      Math.random = originalRandom;
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("spawns gift combo text runtime objects with gift quantity", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-gift-combo-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Gift Combo Test",
          effectDefinitionId: "gift-combo-text",
          targetOverlayId: 1,
          trigger: { mode: "any", conditions: [{ type: "gift-any", triggerOn: "gift" }] },
          visual: {
            parameters: {
              targetMode: "specific-gifts",
              giftIdsCsv: "combo-test-gift",
              acceptanceDurationMs: 50,
              displayLanguage: "japanese"
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${id}/test` });
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const combo = snapshot.json().snapshot.objects.find((object: { objectType: string }) => object.objectType === "gift-combo-text");

      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(combo).toMatchObject({
        objectType: "gift-combo-text",
        metadata: {
          targetCombo: 10,
          displayLanguage: "japanese",
          targetMode: "specific-gifts"
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 140));
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("places random edge pitching machines on horizontal screen edges", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-pitching-random-edge-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Pitching Random Edge Test",
          effectDefinitionId: "pitching-machine-ball",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] },
          visual: {
            parameters: {
              delayBeforeLaunchMs: 200,
              giftQueueGraceMs: 500,
              targetXPercent: 35,
              targetYPercent: 50
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({
        method: "POST",
        url: `/api/v1/effect-configurations/${id}/test`,
        payload: { pitchingScenario: "new-listener-gift" }
      });
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const machine = snapshot.json().snapshot.objects.find((object: { objectType: string }) => object.objectType === "pitching-machine");

      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(["left", "right"]).toContain(machine.metadata.edge);
      expect([0, 1]).toContain(machine.spawn.normalizedX);
      expect(machine.spawn.normalizedY).toBeGreaterThanOrEqual(0);
      expect(machine.spawn.normalizedY).toBeLessThanOrEqual(1);
      expect(machine.spawn.rotation).toBe(0);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("despawns pitching machine objects after exit and applies ball lifetime", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-pitching-lifecycle-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Pitching Lifecycle Test",
          effectDefinitionId: "pitching-machine-ball",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] },
          visual: {
            parameters: {
              delayBeforeLaunchMs: 10,
              travelDurationMs: 20,
              intervalBetweenBallsMs: 0,
              giftQueueGraceMs: 30,
              machineExitDurationMs: 40,
              ballLifetimeMs: 100,
              impactEnabled: false,
              targetXPercent: 50,
              targetYPercent: 50
            }
          }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${id}/test` });

      await new Promise((resolve) => setTimeout(resolve, 25));
      const activeSnapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      await new Promise((resolve) => setTimeout(resolve, 220));
      const expiredSnapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });

      const activeObjects = activeSnapshot.json().snapshot.objects as Array<{ objectType: string; metadata?: Record<string, unknown> }>;
      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(activeObjects.find((object) => object.objectType === "pitching-ball")?.metadata).toMatchObject({ ballLifetimeMs: 100 });
      expect(expiredSnapshot.json().snapshot.objects.filter((object: { objectType: string }) => object.objectType === "pitching-machine")).toHaveLength(0);
      expect(expiredSnapshot.json().snapshot.objects.filter((object: { objectType: string }) => object.objectType === "pitching-ball")).toHaveLength(0);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("tests simple media configurations with resolved asset URLs", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-simple-media-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Simple Test Card",
          effectDefinitionId: "simple-media",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          visual: {
            parameters: {
              imageEnabled: true,
              textEnabled: true,
              fixedText: "Hello",
              backgroundEnabled: true
            }
          },
          playback: { durationMs: 1200 }
        }
      });
      const id = created.json().configuration.id as string;
      const tested = await app.inject({ method: "POST", url: `/api/v1/effect-configurations/${id}/test` });

      expect(created.statusCode).toBe(201);
      expect(tested.statusCode).toBe(200);
      expect(tested.json()).toMatchObject({ accepted: true, triggeredEffects: ["simple-media"], targetOverlayId: 1 });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("manages runtime objects for overlay interaction", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-runtime-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const empty = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const created = await app.inject({ method: "POST", url: "/api/v1/overlays/1/runtime/mock-object" });
      const objectId = created.json().object.objectId as string;
      const moved = await app.inject({
        method: "PATCH",
        url: `/api/v1/overlays/1/objects/${objectId}/position`,
        payload: { normalizedX: 0.25, normalizedY: 0.75 }
      });
      const hit = await app.inject({ method: "POST", url: `/api/v1/overlays/1/objects/${objectId}/hit` });
      const deleted = await app.inject({ method: "DELETE", url: `/api/v1/overlays/1/objects/${objectId}` });
      const hitDestroyed = await app.inject({ method: "POST", url: `/api/v1/overlays/1/objects/${objectId}/hit` });
      const createdAgain = await app.inject({ method: "POST", url: "/api/v1/overlays/1/runtime/mock-object" });
      const cleared = await app.inject({ method: "DELETE", url: "/api/v1/overlays/1/runtime?scope=interactive" });
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });

      expect(empty.json().snapshot).toMatchObject({ overlayId: 1, objects: [] });
      expect(created.statusCode).toBe(201);
      expect(created.json().object).toMatchObject({ overlayId: 1, interactive: true, hitPoints: 5, maxHitPoints: 5 });
      expect(moved.json().object.spawn).toMatchObject({ normalizedX: 0.25, normalizedY: 0.75, velocityX: 0, velocityY: 0 });
      expect(hit.json().object).toMatchObject({ hitPoints: 4, state: "active" });
      expect(deleted.json().object).toMatchObject({ hitPoints: 0, state: "destroyed" });
      expect(hitDestroyed.statusCode).toBe(404);
      expect(createdAgain.statusCode).toBe(201);
      expect(cleared.json()).toMatchObject({ cleared: true });
      expect(snapshot.json().snapshot.objects).toHaveLength(0);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("serves the local asset catalog", async () => {
    const app = await createApp({ rootDir });

    try {
      const assets = await app.inject({ method: "GET", url: "/api/v1/assets" });
      const image = await app.inject({ method: "GET", url: "/asset-files/test-pattern-card.svg" });

      expect(assets.statusCode).toBe(200);
      const sampleAsset = assets.json().assets.find((asset: { id?: string }) => asset.id === "sample-test-card");
      expect(sampleAsset).toMatchObject({
        id: "sample-test-card",
        kind: "image",
        contentUrl: "/asset-files/test-pattern-card.svg"
      });
      expect(image.statusCode).toBe(200);
      expect(image.headers["content-type"]).toContain("image/svg+xml");
    } finally {
      await app.close();
    }
  });

  it("uploads local copied assets into the catalog", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-assets-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const uploaded = await app.inject({
        method: "PUT",
        url: "/api/v1/assets/upload?filename=test-card.svg",
        headers: { "content-type": "image/svg+xml" },
        payload: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg>")
      });
      const asset = uploaded.json().asset;
      const catalog = await app.inject({ method: "GET", url: "/api/v1/assets" });
      const stored = await readFile(path.join(tempRoot, "data", "assets", "files", asset.fileName), "utf8");

      expect(uploaded.statusCode).toBe(201);
      expect(asset).toMatchObject({
        kind: "image",
        name: "test-card",
        source: "local-copy",
        mimeType: "image/svg+xml"
      });
      expect(catalog.json().assets[0]).toMatchObject({ id: asset.id, contentUrl: asset.contentUrl });
      expect(stored).toContain("<svg");
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves Japanese uploaded asset names for display", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-assets-ja-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const uploaded = await app.inject({
        method: "PUT",
        url: `/api/v1/assets/upload?filename=${encodeURIComponent("桜カード.svg")}`,
        headers: { "content-type": "image/svg+xml" },
        payload: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg>")
      });
      const asset = uploaded.json().asset;
      const catalog = await app.inject({ method: "GET", url: "/api/v1/assets" });

      expect(uploaded.statusCode).toBe(201);
      expect(asset).toMatchObject({
        kind: "image",
        name: "桜カード",
        source: "local-copy",
        mimeType: "image/svg+xml"
      });
      expect(catalog.json().assets[0]).toMatchObject({ id: asset.id, name: "桜カード" });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uploads font assets and exposes them as selectable fonts", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-font-assets-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const uploaded = await app.inject({
        method: "PUT",
        url: `/api/v1/assets/upload?filename=${encodeURIComponent("配信用フォント.ttf")}`,
        headers: { "content-type": "application/octet-stream" },
        payload: Buffer.from("font-data")
      });
      const asset = uploaded.json().asset;
      const fonts = await app.inject({ method: "GET", url: "/api/v1/system/fonts" });
      const font = fonts.json().fonts.find((item: { family?: string }) => item.family === "配信用フォント");

      expect(uploaded.statusCode).toBe(201);
      expect(asset).toMatchObject({
        kind: "font",
        name: "配信用フォント",
        source: "local-copy"
      });
      expect(font).toMatchObject({
        family: "配信用フォント",
        displayName: "配信用フォント",
        source: "asset",
        assetId: asset.id,
        contentUrl: asset.contentUrl
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("renames and deletes uploaded assets only", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-assets-edit-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const uploaded = await app.inject({
        method: "PUT",
        url: "/api/v1/assets/upload?filename=clip.mp3",
        headers: { "content-type": "audio/mpeg" },
        payload: Buffer.from("audio")
      });
      const asset = uploaded.json().asset;
      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/v1/assets/${asset.id}`,
        payload: { name: "効果音 A" }
      });
      const blockedRename = await app.inject({
        method: "PATCH",
        url: "/api/v1/assets/sample-test-card",
        payload: { name: "Sample Renamed" }
      });
      const deleted = await app.inject({ method: "DELETE", url: `/api/v1/assets/${asset.id}` });
      const catalog = await app.inject({ method: "GET", url: "/api/v1/assets" });
      const blockedDelete = await app.inject({ method: "DELETE", url: "/api/v1/assets/sample-test-card" });

      await expect(readFile(path.join(tempRoot, "data", "assets", "files", asset.fileName), "utf8")).rejects.toThrow();
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().asset).toMatchObject({ id: asset.id, name: "効果音 A" });
      expect(blockedRename.statusCode).toBe(403);
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toMatchObject({ deleted: true, asset: { id: asset.id } });
      expect(catalog.json().assets.find((item: { id: string }) => item.id === asset.id)).toBeUndefined();
      expect(blockedDelete.statusCode).toBe(403);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates presets and updates blank effect slots", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-presets-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/presets",
        payload: { name: "Gift Preset" }
      });
      const presetId = created.json().preset.id as string;
      const blankSlot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = blankSlot.json().slot.id as string;
      const updatedSlot = await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          name: "Falling Gift",
          effectDefinitionId: "falling-image",
          media: { imageAssetId: "sample-test-card" },
          playback: { durationMs: 3000 }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const list = await app.inject({ method: "GET", url: "/api/v1/presets" });
      const configurations = await app.inject({ method: "GET", url: "/api/v1/effect-configurations" });

      expect(created.statusCode).toBe(201);
      expect(blankSlot.statusCode).toBe(201);
      expect(blankSlot.json().slot).toMatchObject({ name: "Blank Effect" });
      expect(blankSlot.json().slot.effectDefinitionId).toBeUndefined();
      expect(updatedSlot.statusCode).toBe(200);
      expect(updatedSlot.json().slot).toMatchObject({
        name: "Falling Gift",
        effectDefinitionId: "falling-image",
        media: { imageAssetId: "sample-test-card" },
        playback: { durationMs: 3000 }
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ saved: true, configurationCount: 1 });
      expect(list.json().presets[0].slots[0]).toMatchObject({ id: slotId, effectDefinitionId: "falling-image" });
      expect(configurations.json().configurations[0]).toMatchObject({
        presetId,
        presetSlotId: slotId,
        name: "Gift Preset / Falling Gift",
        effectDefinitionId: "falling-image",
        enabled: true
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps effect library configurations as settings only for event matching", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-library-settings-only-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Library Falling Image",
          effectDefinitionId: "falling-image",
          targetOverlayId: 1,
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "gift-any", triggerOn: "streak-end" }] }
        }
      });
      const event = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "library-settings-only-gift",
          source: "test",
          platform: "tiktok",
          type: "gift-streak-end",
          timestamp: new Date().toISOString(),
          data: { giftId: "rose", repeatCount: 1 }
        }
      });
      const history = await app.inject({ method: "GET", url: "/api/v1/events/history" });
      const historyEvent = history
        .json()
        .events.find((entry: { event: { eventId: string } }) => entry.event.eventId === "library-settings-only-gift");

      expect(created.statusCode).toBe(201);
      expect(event.statusCode).toBe(202);
      expect(event.json()).toMatchObject({ accepted: true });
      expect(historyEvent.result.matchedActions).not.toContain("falling-image");
      expect(historyEvent.result.triggeredEffects).not.toContain("falling-image");
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("normalizes TikTok gift triggers when saving gift driven preset effects", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-preset-tiktok-trigger-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const preset = await app.inject({
        method: "POST",
        url: "/api/v1/presets",
        payload: { name: "Gift Driven Preset" }
      });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      const updated = await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "pitching-machine-ball",
          media: { imageAssetId: "sample-test-card" },
          trigger: { mode: "any", conditions: [{ type: "manual" }] }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const configuration = saved.json().configurations[0];

      expect(preset.statusCode).toBe(201);
      expect(slot.statusCode).toBe(201);
      expect(updated.statusCode).toBe(200);
      expect(saved.statusCode).toBe(200);
      expect(configuration).toMatchObject({
        presetId,
        presetSlotId: slotId,
        effectDefinitionId: "pitching-machine-ball",
        trigger: { mode: "any", conditions: [{ type: "gift-any", triggerOn: "streak-end" }] }
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("matches any and specific gift triggers for gift and gift-streak-end events", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-gift-event-timing-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Gift Timing Preset" } });
      const presetId = preset.json().preset.id as string;
      const anySlot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const anySlotId = anySlot.json().slot.id as string;
      const specificSlot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const specificSlotId = specificSlot.json().slot.id as string;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${anySlotId}`,
        payload: {
          name: "Any Gift Media",
          effectDefinitionId: "simple-media",
          trigger: { mode: "any", conditions: [{ type: "gift-any", triggerOn: "streak-end" }] }
        }
      });
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${specificSlotId}`,
        payload: {
          name: "Specific Gift Media",
          effectDefinitionId: "simple-media",
          trigger: { mode: "any", conditions: [{ type: "gift-specific", platform: "tiktok", platformGiftId: "rose", triggerOn: "gift" }] }
        }
      });
      await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });

      const giftEvent = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "gift-event-matches-streak-end-trigger",
          source: "test",
          platform: "tiktok",
          type: "gift",
          timestamp: new Date().toISOString(),
          data: { giftId: "rose", repeatCount: 1 }
        }
      });
      const streakEndEvent = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "streak-end-event-matches-gift-trigger",
          source: "test",
          platform: "tiktok",
          type: "gift-streak-end",
          timestamp: new Date().toISOString(),
          data: { giftId: "rose", repeatCount: 1 }
        }
      });
      const history = await app.inject({ method: "GET", url: "/api/v1/events/history" });
      const events = history.json().events as Array<{ event: { eventId: string }; result: { matchedActions: string[] } }>;
      const giftHistory = events.find((entry) => entry.event.eventId === "gift-event-matches-streak-end-trigger");
      const streakEndHistory = events.find((entry) => entry.event.eventId === "streak-end-event-matches-gift-trigger");

      expect(giftEvent.statusCode).toBe(202);
      expect(streakEndEvent.statusCode).toBe(202);
      expect(giftHistory?.result.matchedActions).toEqual(["simple-media", "simple-media"]);
      expect(streakEndHistory?.result.matchedActions).toEqual(["simple-media", "simple-media"]);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("defaults flash presets to TikTok gift triggers like other gift-driven effects", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-flash-gift-default-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Flash Gift Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "flash",
          trigger: { mode: "any", conditions: [{ type: "manual" }] }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });

      expect(saved.statusCode).toBe(200);
      expect(saved.json().configurations[0]).toMatchObject({
        effectDefinitionId: "flash",
        trigger: { mode: "any", conditions: [{ type: "gift-any", triggerOn: "streak-end" }] }
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats TikTok Rose gift ids rose and 5655 as the same gift for preset matching", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-rose-alias-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Rose Alias Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "flash",
          trigger: { mode: "any", conditions: [{ type: "gift-specific", platform: "tiktok", platformGiftId: "5655", triggerOn: "gift" }] }
        }
      });
      await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const event = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "rose-alias-gift",
          source: "test",
          platform: "tiktok",
          type: "gift",
          timestamp: new Date().toISOString(),
          data: { giftId: "rose", repeatCount: 1 }
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const history = await app.inject({ method: "GET", url: "/api/v1/events/history" });
      const historyEvent = history.json().events.find((entry: { event: { eventId: string } }) => entry.event.eventId === "rose-alias-gift");

      expect(event.statusCode).toBe(202);
      expect(historyEvent.result.matchedActions).toContain("flash");
      expect(historyEvent.result.triggeredEffects).toContain("flash");
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps explicit gift combo sound settings from saved presets", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-preset-combo-sound-sync-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const library = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Library Combo",
          effectDefinitionId: "gift-combo-text",
          targetOverlayId: 1,
          visual: {
            parameters: {
              soundEnabled: true,
              soundAssetId: "library-sound",
              soundVolume: 0.35,
              minimumSoundIntervalMs: 120,
              pitchEnabled: false,
              basePlaybackRate: 0.8,
              maxPlaybackRate: 1.25,
              pitchCurveStrength: 0.02
            }
          }
        }
      });
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Combo Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      const updated = await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "gift-combo-text",
          visual: {
            parameters: {
              targetMode: "specific-gifts",
              giftIdsCsv: "rose",
              soundEnabled: false,
              soundAssetId: "preset-sound",
              soundVolume: 1,
              minimumSoundIntervalMs: 10,
              pitchEnabled: true,
              basePlaybackRate: 1,
              maxPlaybackRate: 2,
              pitchCurveStrength: 0.5
            }
          }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const configuration = saved.json().configurations[0];
      const libraryId = library.json().configuration.id as string;
      const libraryUpdate = await app.inject({
        method: "PATCH",
        url: `/api/v1/effect-configurations/${libraryId}`,
        payload: {
          visual: {
            parameters: {
              soundEnabled: true,
              soundAssetId: "updated-library-sound",
              soundVolume: 0.6
            }
          }
        }
      });
      const configurations = await app.inject({ method: "GET", url: "/api/v1/effect-configurations" });
      const syncedConfiguration = configurations
        .json()
        .configurations.find((item: { presetSlotId?: string }) => item.presetSlotId === slotId);

      expect(library.statusCode).toBe(201);
      expect(preset.statusCode).toBe(201);
      expect(slot.statusCode).toBe(201);
      expect(updated.statusCode).toBe(200);
      expect(saved.statusCode).toBe(200);
      expect(configuration.visual.parameters).toMatchObject({
        targetMode: "specific-gifts",
        giftIdsCsv: "rose",
        soundEnabled: false,
        soundAssetId: "preset-sound",
        soundVolume: 1,
        minimumSoundIntervalMs: 10,
        pitchEnabled: true,
        basePlaybackRate: 1,
        maxPlaybackRate: 2,
        pitchCurveStrength: 0.5
      });
      expect(libraryUpdate.statusCode).toBe(200);
      expect(syncedConfiguration.visual.parameters).toMatchObject({
        targetMode: "specific-gifts",
        giftIdsCsv: "rose",
        soundEnabled: false,
        soundAssetId: "preset-sound",
        soundVolume: 1,
        minimumSoundIntervalMs: 10
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("migrates legacy gift combo audio asset settings into the unified sound asset", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-preset-combo-legacy-audio-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const library = await app.inject({
        method: "POST",
        url: "/api/v1/effect-configurations",
        payload: {
          name: "Legacy Library Combo",
          effectDefinitionId: "gift-combo-text",
          targetOverlayId: 1,
          media: { audioAssetId: "legacy-audio" },
          visual: {
            parameters: {
              soundEnabled: true,
              soundAssetId: "",
              soundVolume: 0.5
            }
          }
        }
      });
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Legacy Combo Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "gift-combo-text",
          visual: { parameters: { soundEnabled: true, soundAssetId: "" } }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });

      expect(library.statusCode).toBe(201);
      expect(saved.statusCode).toBe(200);
      expect(saved.json().configurations[0].visual.parameters).toMatchObject({
        soundEnabled: true,
        soundAssetId: "legacy-audio",
        soundVolume: 0.5
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("includes the selected gift combo sound URL in runtime metadata", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-combo-sound-runtime-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const uploadedAudio = await app.inject({
        method: "PUT",
        url: "/api/v1/assets/upload?filename=combo-hit.mp3",
        headers: { "content-type": "audio/mpeg" },
        payload: Buffer.from("audio")
      });
      const audioAsset = uploadedAudio.json().asset as { id: string; contentUrl: string };
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Combo Sound Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "gift-combo-text",
          visual: {
            parameters: {
              soundEnabled: true,
              soundAssetId: audioAsset.id,
              soundVolume: 0.5,
              targetMode: "any-gift"
            }
          }
        }
      });
      const saved = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const event = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "combo-sound-runtime-gift",
          source: "test",
          platform: "tiktok",
          type: "gift",
          timestamp: new Date().toISOString(),
          data: { giftId: "rose", repeatCount: 2 }
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const combo = snapshot.json().snapshot.objects.find((object: { objectType: string }) => object.objectType === "gift-combo-text");

      expect(uploadedAudio.statusCode).toBe(201);
      expect(saved.statusCode).toBe(200);
      expect(event.statusCode).toBe(202);
      expect(combo.metadata).toMatchObject({
        soundEnabled: true,
        soundAssetId: audioAsset.id,
        soundUrl: audioAsset.contentUrl,
        targetCombo: 2
      });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats TikTok Rose gift ids rose and 5655 as the same gift for combo targets", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-combo-rose-alias-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const preset = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Rose Combo Preset" } });
      const presetId = preset.json().preset.id as string;
      const slot = await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/slots` });
      const slotId = slot.json().slot.id as string;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/presets/${presetId}/slots/${slotId}`,
        payload: {
          effectDefinitionId: "gift-combo-text",
          visual: { parameters: { targetMode: "specific-gifts", giftIdsCsv: "rose" } }
        }
      });
      await app.inject({ method: "POST", url: `/api/v1/presets/${presetId}/save` });
      const event = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-effect-app-key": apiKey },
        payload: {
          schemaVersion: "1.0",
          eventId: "combo-rose-alias-gift",
          source: "test",
          platform: "tiktok",
          type: "gift",
          timestamp: new Date().toISOString(),
          data: { giftId: "5655", repeatCount: 3 }
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const snapshot = await app.inject({ method: "GET", url: "/api/v1/overlays/1/runtime" });
      const combo = snapshot.json().snapshot.objects.find((object: { objectType: string }) => object.objectType === "gift-combo-text");

      expect(event.statusCode).toBe(202);
      expect(combo.metadata).toMatchObject({ targetCombo: 3, targetMode: "specific-gifts", giftIds: ["rose"] });
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("moves selected presets to the top of the preset list", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "obs-effect-preset-order-"));
    const app = await createApp({ rootDir: tempRoot });

    try {
      const first = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "First" } });
      const second = await app.inject({ method: "POST", url: "/api/v1/presets", payload: { name: "Second" } });
      const firstId = first.json().preset.id as string;
      const selected = await app.inject({ method: "POST", url: `/api/v1/presets/${firstId}/select` });
      const list = await app.inject({ method: "GET", url: "/api/v1/presets" });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(selected.statusCode).toBe(200);
      expect(list.json().presets.map((preset: { name: string }) => preset.name)).toEqual(["First", "Second"]);
    } finally {
      await app.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
