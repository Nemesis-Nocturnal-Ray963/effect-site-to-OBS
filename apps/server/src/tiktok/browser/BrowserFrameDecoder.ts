import type { BrowserWebSocketFrameCapture } from "@obs-effect/shared-types";
import { deserializeWebSocketMessage } from "tiktok-live-connector";

export interface BrowserFrameDecoder {
  canDecode(frame: BrowserWebSocketFrameCapture): boolean;
  decode(frame: BrowserWebSocketFrameCapture): Promise<unknown[]>;
}

export class PlaceholderBrowserFrameDecoder implements BrowserFrameDecoder {
  canDecode(frame: BrowserWebSocketFrameCapture): boolean {
    return frame.decode.status === "json";
  }

  async decode(frame: BrowserWebSocketFrameCapture): Promise<unknown[]> {
    if (!this.canDecode(frame) || !frame.decode.json) return [];
    return [frame.decode.json];
  }
}

export class TikTokWebcastBrowserFrameDecoder implements BrowserFrameDecoder {
  canDecode(frame: BrowserWebSocketFrameCapture): boolean {
    return frame.direction === "received" && frame.opcode === 2 && frame.frame.payloadEncoding === "base64";
  }

  async decode(frame: BrowserWebSocketFrameCapture): Promise<Record<string, unknown>[]> {
    if (!this.canDecode(frame)) return [];
    try {
      const decoded = await deserializeWebSocketMessage(Buffer.from(frame.frame.payloadData, "base64"));
      const messages = decoded.protoMessageFetchResult?.messages ?? [];
      return messages.flatMap((message) => this.toRawEvent(message, frame));
    } catch {
      return [];
    }
  }

  private toRawEvent(message: unknown, frame: BrowserWebSocketFrameCapture): Record<string, unknown>[] {
    const protoMessage = asRecord(message);
    const decodedData = asRecord(protoMessage.decodedData);
    const method = text(decodedData.type) ?? text(protoMessage.method);
    const data = asRecord(decodedData.data);
    if (method === "WebcastChatMessage") return [this.toChatEvent(data, protoMessage, frame)];
    if (method === "WebcastGiftMessage") return [this.toGiftEvent(data, protoMessage, frame)];
    if (method) return [this.toGenericEvent(method, data, protoMessage, frame)];
    return [];
  }

  private toChatEvent(data: Record<string, unknown>, protoMessage: Record<string, unknown>, frame: BrowserWebSocketFrameCapture): Record<string, unknown> {
    const common = asRecord(data.common);
    return {
      eventType: "chat",
      rawEventType: "WebcastChatMessage",
      roomId: text(common.roomId),
      msgId: text(common.msgId) ?? text(protoMessage.msgId),
      timestamp: numberValue(common.createTime),
      comment: text(data.content),
      user: mapUser(data.user),
      sourceFrameCaptureId: frame.captureId
    };
  }

  private toGiftEvent(data: Record<string, unknown>, protoMessage: Record<string, unknown>, frame: BrowserWebSocketFrameCapture): Record<string, unknown> {
    const common = asRecord(data.common);
    const gift = asRecord(data.gift);
    const repeatCount = numberValue(data.repeatCount) ?? 1;
    const diamondValue = numberValue(gift.diamondCount);
    const giftImageUrls = imageUrlsFrom(gift);
    return {
      eventType: "gift",
      rawEventType: "WebcastGiftMessage",
      roomId: text(common.roomId),
      msgId: text(common.msgId) ?? text(protoMessage.msgId),
      timestamp: numberValue(common.createTime),
      giftId: text(data.giftId) ?? text(gift.id),
      giftName: text(gift.name),
      repeatCount,
      repeatEnd: booleanValue(data.repeatEnd),
      diamondValue,
      diamondValueTotal: typeof diamondValue === "number" ? diamondValue * repeatCount : undefined,
      giftImageUrls,
      primaryGiftImageUrl: giftImageUrls[0],
      user: mapUser(data.user),
      sourceFrameCaptureId: frame.captureId
    };
  }

  private toGenericEvent(
    method: string,
    data: Record<string, unknown>,
    protoMessage: Record<string, unknown>,
    frame: BrowserWebSocketFrameCapture
  ): Record<string, unknown> {
    const common = asRecord(data.common);
    return {
      eventType: normalizeWebcastMethod(method),
      rawEventType: method,
      roomId: text(common.roomId),
      msgId: text(common.msgId) ?? text(protoMessage.msgId),
      timestamp: numberValue(common.createTime),
      user: mapUser(data.user),
      payload: data,
      sourceFrameCaptureId: frame.captureId
    };
  }
}

function normalizeWebcastMethod(method: string): string {
  return method.replace(/^Webcast/u, "").replace(/Message$/u, "").replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase() || "custom";
}

function mapUser(value: unknown): Record<string, unknown> {
  const user = asRecord(value);
  const userId = text(user.id) ?? text(user.userId);
  const nickname = text(user.nickname) ?? text(user.displayName);
  return {
    userId,
    id: userId,
    uniqueId: text(user.uniqueId) ?? text(user.displayId) ?? text(user.secUid),
    nickname,
    displayName: nickname,
    avatarUrl: firstImageUrl(user.avatarThumb) ?? firstImageUrl(user.avatarMedium) ?? firstImageUrl(user.avatarLarge)
  };
}

function firstImageUrl(value: unknown): string | undefined {
  const image = asRecord(value);
  const urls = Array.isArray(image.urlList) ? image.urlList : Array.isArray(image.url_list) ? image.url_list : [];
  return urls.map(text).find((item): item is string => typeof item === "string" && item.length > 0);
}

function imageUrlsFrom(value: unknown): string[] {
  const urls = new Set<string>();

  function visit(current: unknown, keyHint = ""): void {
    if (typeof current === "string") {
      if (/^https:\/\//i.test(current)) urls.add(current);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, keyHint);
      return;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const imageLikeKey = /^(imageUrl|iconUrl|pictureUrl|url|uri)$/i.test(key) || /urlList|url_list|image|icon|picture|giftPicture/i.test(key);
      if (imageLikeKey || /image|icon|picture|giftPicture/i.test(keyHint)) {
        visit(child, key);
      }
    }
  }

  visit(value);
  return [...urls];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return undefined;
}
