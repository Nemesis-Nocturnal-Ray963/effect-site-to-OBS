import { randomUUID } from "node:crypto";
import type {
  EffectConfiguration,
  EffectDefinition,
  EffectPlayMessage,
  NormalizedEvent,
  OverlayId
} from "@obs-effect/shared-types";

export const giftPileEffectDefinition: EffectDefinition = {
  id: "gift-pile",
  kind: "gift-pile",
  name: "ギフト積み上げ",
  description:
    "すべてのギフトを1個ずつ落として蓄積。初期寿命15分、受信時に残り15分以下なら15分追加。再読み込みで全消去。",
  version: "1.0.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsText: false,
  defaultDurationMs: 900000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      {
        key: "objectSizePx",
        label: "Gift object size (px)",
        type: "number",
        defaultValue: 44,
        min: 16,
        step: 1
      },
      {
        key: "maxObjects",
        label: "Maximum accumulated gifts",
        type: "number",
        defaultValue: 1000,
        min: 1,
        max: 2000,
        step: 1
      },
      {
        key: "giftSizeOverridesJson",
        label: "Gift-specific sizes",
        type: "string",
        defaultValue: "[]"
      },
      {
        key: "coinImageRulesJson",
        label: "Coin-specific gift images",
        type: "string",
        defaultValue: "[]"
      }
    ]
  }
};

// Streak notifications carry cumulative counts. Keep the count per receiver/configuration,
// sender and gift, including the initial plain gift emitted by older connectors.
export class GiftPileEffectService {
  private readonly counts = new Map<string, { count: number; at: number; ended: boolean }>();
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly broadcast: (overlayId: OverlayId, message: EffectPlayMessage) => void
  ) {}

  execute(
    configuration: EffectConfiguration,
    event?: NormalizedEvent,
    catalogImageUrl?: string
  ): { spawnedObjectCount: number; skipped: boolean } {
    const quantity = event ? this.quantity(configuration, event) : 1;
    if (quantity <= 0) return { spawnedObjectCount: 0, skipped: true };
    const urls = [
      event?.data.primaryGiftImageUrl,
      ...(Array.isArray(event?.data.giftImageUrls) ? event.data.giftImageUrls : [])
    ];
    const eventImageUrl = urls.find(
      (url): url is string => typeof url === "string" && /^(https?:\/\/|\/(?!\/))/u.test(url)
    );
    const imageUrl =
      resolveCoinImageUrl(configuration.visual.parameters, event) ??
      validImageUrl(catalogImageUrl) ??
      eventImageUrl;
    const objectSizePx = resolveGiftObjectSize(configuration.visual.parameters, event);
    this.broadcast(configuration.targetOverlayId, {
      type: "effect:play",
      effectId: "gift-pile",
      instanceId: randomUUID(),
      targetOverlayId: configuration.targetOverlayId,
      createdAt: new Date().toISOString(),
      parameters: { ...configuration.visual.parameters, action: "add", quantity, objectSizePx },
      media: { imageUrl },
      visual: configuration.visual
    });
    return { spawnedObjectCount: quantity, skipped: false };
  }

  clear(overlayId: OverlayId): void {
    this.broadcast(overlayId, {
      type: "effect:play",
      effectId: "gift-pile",
      instanceId: randomUUID(),
      targetOverlayId: overlayId,
      createdAt: new Date().toISOString(),
      parameters: { action: "clear" }
    });
    // Keep streak counts: clearing the screen must not replay earlier gifts in a combo.
  }

  private quantity(configuration: EffectConfiguration, event: NormalizedEvent): number {
    if (
      !["gift", "gift-streak-start", "gift-streak-update", "gift-streak-end"].includes(event.type)
    )
      return 0;
    const now = Date.now();
    for (const [key, at] of this.seen) if (now - at > 3600000) this.seen.delete(key);
    for (const [key, value] of this.counts) if (now - value.at > 3600000) this.counts.delete(key);
    const eventKey = `${configuration.id}:${event.eventId}`;
    if (this.seen.has(eventKey)) return 0;
    this.seen.set(eventKey, now);
    if (this.seen.size > 20000) this.seen.delete(this.seen.keys().next().value!);
    const value =
      event.data.normalizedGiftQuantity ?? event.data.repeatCount ?? event.data.giftCount ?? 1;
    const count =
      typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 1;
    const key = JSON.stringify([
      configuration.id,
      event.platform,
      event.room?.id,
      event.user?.id ?? event.user?.uniqueId,
      event.data.giftId ?? event.data.platformGiftId ?? event.data.giftName
    ]);
    const previous = this.counts.get(key);
    const isNew = event.type === "gift" || event.type === "gift-streak-start" || previous?.ended;
    const delta =
      event.data.normalizedGiftQuantity !== undefined || isNew
        ? count
        : Math.max(0, count - (previous?.count ?? 0));
    this.counts.set(key, {
      count: isNew ? count : Math.max(count, previous?.count ?? 0),
      at: now,
      ended: event.type === "gift-streak-end"
    });
    if (this.counts.size > 10000) this.counts.delete(this.counts.keys().next().value!);
    return delta;
  }
}

export function resolveCoinImageUrl(parameters: Record<string, unknown>, event?: NormalizedEvent): string | undefined {
  if (!event || typeof parameters.coinImageRulesJson !== "string") return undefined;
  const coinValue = giftCoinValue(event);
  try {
    const parsed = JSON.parse(parameters.coinImageRulesJson) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const match = parsed.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).useCustomImage !== false &&
        numeric((item as Record<string, unknown>).coinValue) === coinValue
    ) as Record<string, unknown> | undefined;
    const imageUrl = match?.imageUrl;
    return typeof imageUrl === "string" && /^(https?:\/\/|\/(?!\/))/u.test(imageUrl) ? imageUrl : undefined;
  } catch {
    return undefined;
  }
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function giftCoinValue(event: NormalizedEvent): number {
  const perGift = Math.max(numeric(event.data.coinValue), numeric(event.data.diamondValue));
  if (perGift >= 0) return perGift;
  const total = Math.max(numeric(event.data.coinValueTotal), numeric(event.data.diamondValueTotal));
  const count = Math.max(1, numeric(event.data.repeatCount), numeric(event.data.normalizedGiftQuantity));
  return total >= 0 ? total / count : -1;
}

export function resolveGiftObjectSize(
  parameters: Record<string, unknown>,
  event?: NormalizedEvent
): number {
  const fallback = clampSize(parameters.objectSizePx, 44);
  if (!event) return fallback;
  const coinSize = resolveCoinObjectSize(parameters, event);
  if (coinSize !== undefined) return coinSize;
  const giftId = String(event.data.giftId ?? event.data.platformGiftId ?? "").trim();
  if (!giftId || typeof parameters.giftSizeOverridesJson !== "string") return fallback;
  try {
    const parsed = JSON.parse(parameters.giftSizeOverridesJson) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const match = parsed.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String((item as Record<string, unknown>).giftId ?? "").trim() === giftId
    ) as Record<string, unknown> | undefined;
    return match ? clampSize(match.sizePx, fallback) : fallback;
  } catch {
    return fallback;
  }
}

function resolveCoinObjectSize(
  parameters: Record<string, unknown>,
  event: NormalizedEvent
): number | undefined {
  if (typeof parameters.coinImageRulesJson !== "string") return undefined;
  const coinValue = giftCoinValue(event);
  try {
    const parsed = JSON.parse(parameters.coinImageRulesJson) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const match = parsed.find(
      (item) =>
        item &&
        typeof item === "object" &&
        numeric((item as Record<string, unknown>).coinValue) === coinValue
    ) as Record<string, unknown> | undefined;
    return typeof match?.sizePx === "number" && Number.isFinite(match.sizePx)
      ? clampSize(match.sizePx, 44)
      : undefined;
  } catch {
    return undefined;
  }
}

function clampSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(16, value))
    : fallback;
}

function validImageUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^(https?:\/\/|\/(?!\/))/u.test(value) ? value : undefined;
}
