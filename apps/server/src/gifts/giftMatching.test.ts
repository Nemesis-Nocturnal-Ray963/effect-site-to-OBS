import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "@obs-effect/shared-types";
import { GiftCatalogJsonRepository } from "./GiftCatalogJsonRepository.js";
import { GiftCatalogService } from "./GiftCatalogService.js";
import { EffectConfigurationJsonRepository } from "../effects/EffectConfigurationJsonRepository.js";
import { EffectConfigurationService } from "../effects/EffectConfigurationService.js";
import { effectDefinitions } from "../effects/effectDefinitions.js";
import { giftMatches } from "./giftAliases.js";
import { resolveGiftObjectSize } from "../effects/builtins/giftPile.js";
import { GiftComboTextEffectService } from "../effects/builtins/giftComboText.js";
import { RuntimeInteractionService } from "../runtime/RuntimeInteractionService.js";
import { RuntimeEffectObjectStore } from "../runtime/RuntimeEffectObjectStore.js";

const roots: string[] = [];
const now = () => "2026-10-19T00:00:00.000Z";
function event(data: Record<string, unknown>): NormalizedEvent {
  return { schemaVersion: "1.0", eventId: "gift-test", type: "gift", platform: "tiktok", source: "test", timestamp: now(), receivedAt: now(), data };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "gift-name-matching-"));
  roots.push(root);
  const catalog = new GiftCatalogService({ repository: GiftCatalogJsonRepository.fromRoot(root) });
  const gift = await catalog.createManual({ name: "表示専用の名前", matchName: "Rainbow Gift" });
  const effects = new EffectConfigurationService(EffectConfigurationJsonRepository.fromRoot(root), now, () => catalog.list({}));
  return { root, catalog, gift, effects };
}

describe("gift identity matching", () => {
  it("matches either ID or received name, excludes blank and partial names", () => {
    expect(giftMatches(event({ giftId: "123", giftName: "Other" }), "123", "Rainbow Gift")).toBe(true);
    expect(giftMatches(event({ giftId: "456", giftName: " Rainbow Gift " }), "123", "Rainbow Gift")).toBe(true);
    expect(giftMatches(event({ giftName: "Ｒａｉｎｂｏｗ Gift" }), "123", "rainbow gift")).toBe(true);
    expect(giftMatches(event({ platformGiftId: "123" }), "tiktok:123")).toBe(true);
    expect(giftMatches(event({ giftId: "456", giftName: "Rainbow" }), "123", "Rainbow Gift")).toBe(false);
    expect(giftMatches(event({}), "", "")).toBe(false);
  });

  it("matches all effect definitions by ID or name, including existing ID-only selections", async () => {
    const { effects, gift } = await setup();
    for (const definition of effectDefinitions) {
      await effects.create({ effectDefinitionId: definition.id, presetId: "preset", trigger: {
        mode: "any", conditions: [{ type: "gift-specific", platform: "tiktok", platformGiftId: gift.platformGiftId, triggerOn: "gift" }]
      } });
    }
    expect(await effects.match(event({ giftId: "new-platform-id", giftName: "Rainbow Gift" }))).toHaveLength(effectDefinitions.length);
    expect(await effects.match(event({ giftId: gift.platformGiftId, giftName: "Other" }))).toHaveLength(effectDefinitions.length);
    expect(await effects.match(event({ giftName: "Rainbow Gift" }))).toHaveLength(effectDefinitions.length);
    expect(await effects.match(event({ giftName: gift.name }))).toHaveLength(0);
    expect(await effects.match({ ...event({ giftName: "Rainbow Gift" }), platform: "youtube" })).toHaveLength(0);
    expect(await effects.match({ ...event({ giftName: "Rainbow Gift" }), type: "comment" })).toHaveLength(0);
  });

  it("preserves display and matching names independently across updates and reloads", async () => {
    const { root, catalog, gift } = await setup();
    await catalog.update(gift.id, { name: "New display name" });
    await catalog.processEvent(event({ giftId: gift.platformGiftId, giftName: "Different observed name" }));
    const reloaded = await GiftCatalogJsonRepository.fromRoot(root).getById(gift.id);
    expect(reloaded).toMatchObject({ name: "New display name", matchName: "Rainbow Gift" });
    await catalog.update(gift.id, { matchName: "New received name" });
    expect(await catalog.get(gift.id)).toMatchObject({ name: "New display name", matchName: "New received name" });
  });

  it("loads old catalogs and uses catalog name corrections without reselecting a gift", async () => {
    const { root, effects, gift } = await setup();
    const legacy = { ...gift };
    delete legacy.matchName;
    await writeFile(path.join(root, "data", "gifts", "catalog.json"), JSON.stringify({ records: [legacy] }));
    const reloaded = new GiftCatalogService({ repository: GiftCatalogJsonRepository.fromRoot(root) });
    expect((await reloaded.get(gift.id))?.matchName).toBe(gift.name);
    const configuration = await effects.create({ effectDefinitionId: "flash", presetId: "preset", trigger: {
      mode: "any", conditions: [{ type: "gift-specific", platform: "tiktok", giftCatalogId: gift.id,
        platformGiftId: gift.platformGiftId, giftName: "Rainbow Gift", triggerOn: "gift" }]
    } });
    const service = new EffectConfigurationService(EffectConfigurationJsonRepository.fromRoot(root), now, () => reloaded.list({}));
    await reloaded.update(gift.id, { matchName: "Correct received name" });
    expect((await service.match(event({ giftName: "Correct received name" })))[0]?.id).toBe(configuration.id);
    expect(await service.match(event({ giftName: "Rainbow Gift" }))).toHaveLength(0);
  });

  it("uses the catalog name for combo targets and gift-specific pile sizes", async () => {
    const { effects, gift, root } = await setup();
    const configuration = await effects.create({ effectDefinitionId: "gift-combo-text", visual: { parameters: {
      targetMode: "specific-gifts", giftIdsCsv: gift.id,
      giftSizeOverridesJson: JSON.stringify([{ giftId: gift.platformGiftId, sizePx: 120 }])
    } } });
    const resolved = await effects.resolveGifts(configuration);
    const received = event({ giftId: "actual-id", giftName: "Rainbow Gift", repeatCount: 3 });
    expect(resolveGiftObjectSize(resolved.visual.parameters, received)).toBe(120);
    const runtime = new RuntimeInteractionService(new RuntimeEffectObjectStore(), now, () => {});
    const combo = new GiftComboTextEffectService(root, runtime);
    vi.useFakeTimers();
    const result = await combo.execute(resolved, received);
    expect(result.skipped).toBe(false);
    expect(runtime.snapshot(1).objects[0]?.metadata?.targetCombo).toBe(3);
    expect((await combo.execute(resolved, event({ giftName: "Unrelated gift" }))).skipped).toBe(true);
    vi.clearAllTimers();
  });
});
