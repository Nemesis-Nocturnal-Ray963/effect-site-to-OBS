import { randomUUID } from "node:crypto";
import type {
  EffectConfiguration,
  EffectDefinition,
  EffectPlayMessage,
  NormalizedEvent,
  OverlayId
} from "@obs-effect/shared-types";

export const tetheredGiftEffectDefinition: EffectDefinition = {
  id: "tethered-gift",
  kind: "tethered-gift",
  name: "吊り下げギフト",
  description: "ギフトを糸で吊り、互いにぶつけながら表示時間の終了後に上へ巻き取ります。",
  version: "1.0.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsText: false,
  defaultDurationMs: 8000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      {
        key: "ropeLengthPx",
        label: "Rope length (px)",
        type: "number",
        defaultValue: 420,
        min: 80,
        max: 1800,
        step: 10
      }
    ]
  }
};

export class TetheredGiftEffectService {
  private readonly counts = new Map<string, { count: number; at: number; ended: boolean }>();
  private readonly seen = new Map<string, number>();

  constructor(private readonly broadcast: (overlayId: OverlayId, message: EffectPlayMessage) => void) {}

  execute(
    configuration: EffectConfiguration,
    event?: NormalizedEvent,
    imageUrl?: string | null
  ): { spawnedObjectCount: number; skipped: boolean } {
    const quantity = event ? this.quantity(configuration, event) : 1;
    if (quantity <= 0) return { spawnedObjectCount: 0, skipped: true };
    this.broadcast(configuration.targetOverlayId, {
      type: "effect:play",
      effectId: "tethered-gift",
      instanceId: randomUUID(),
      targetOverlayId: configuration.targetOverlayId,
      createdAt: new Date().toISOString(),
      parameters: {
        ...configuration.visual.parameters,
        quantity,
        objectSizePx: Math.max(24, Math.round(88 * (configuration.visual.size.scale ?? 1)))
      },
      media: { imageUrl: imageUrl ?? undefined },
      visual: configuration.visual,
      playback: configuration.playback
    });
    return { spawnedObjectCount: quantity, skipped: false };
  }

  private quantity(configuration: EffectConfiguration, event: NormalizedEvent): number {
    if (!["gift", "gift-streak-start", "gift-streak-update", "gift-streak-end"].includes(event.type)) return 0;
    const now = Date.now();
    for (const [key, at] of this.seen) if (now - at > 3_600_000) this.seen.delete(key);
    for (const [key, value] of this.counts) if (now - value.at > 3_600_000) this.counts.delete(key);
    const eventKey = `${configuration.id}:${event.eventId}`;
    if (this.seen.has(eventKey)) return 0;
    this.seen.set(eventKey, now);
    const raw = event.data.normalizedGiftQuantity ?? event.data.repeatCount ?? event.data.giftCount ?? 1;
    const count = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 1;
    const key = JSON.stringify([
      configuration.id,
      event.platform,
      event.room?.id,
      event.user?.id ?? event.user?.uniqueId,
      event.data.giftId ?? event.data.platformGiftId ?? event.data.giftName
    ]);
    const previous = this.counts.get(key);
    const isNew = event.type === "gift" || event.type === "gift-streak-start" || previous?.ended;
    const delta = event.data.normalizedGiftQuantity !== undefined || isNew
      ? count
      : Math.max(0, count - (previous?.count ?? 0));
    this.counts.set(key, {
      count: isNew ? count : Math.max(count, previous?.count ?? 0),
      at: now,
      ended: event.type === "gift-streak-end"
    });
    if (this.seen.size > 20_000) this.seen.delete(this.seen.keys().next().value!);
    if (this.counts.size > 10_000) this.counts.delete(this.counts.keys().next().value!);
    return delta;
  }
}
