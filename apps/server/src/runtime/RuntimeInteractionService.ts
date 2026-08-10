import type {
  InteractionSessionStatusMessage,
  OverlayId,
  RuntimeObjectChangedMessage,
  RuntimeOverlayClearedMessage,
  RuntimeOverlaySnapshot,
  RuntimeSnapshotMessage
} from "@obs-effect/shared-types";
import type { RuntimeEffectObjectStore } from "./RuntimeEffectObjectStore.js";
import type { CreateRuntimeObjectInput } from "./RuntimeEffectObjectStore.js";

export class RuntimeInteractionService {
  private readonly sessions = new Map<OverlayId, { active: boolean; mode: "view" | "interactive" }>();

  constructor(
    private readonly store: RuntimeEffectObjectStore,
    private readonly now: () => string,
    private readonly broadcast: (overlayId: OverlayId, message: RuntimeObjectChangedMessage | RuntimeSnapshotMessage | RuntimeOverlayClearedMessage | InteractionSessionStatusMessage) => void
  ) {}

  snapshot(overlayId: OverlayId): RuntimeOverlaySnapshot {
    return this.store.snapshot(overlayId, this.now());
  }

  snapshotMessage(overlayId: OverlayId): RuntimeSnapshotMessage {
    return { type: "runtime:snapshot", snapshot: this.snapshot(overlayId), createdAt: this.now() };
  }

  stateVersion(overlayId: OverlayId): number {
    return this.store.stateVersion(overlayId);
  }

  startSession(overlayId: OverlayId, mode: "view" | "interactive"): InteractionSessionStatusMessage {
    this.sessions.set(overlayId, { active: true, mode });
    const message: InteractionSessionStatusMessage = { type: "interaction:session-status", overlayId, mode, active: true, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return message;
  }

  endSession(overlayId: OverlayId): InteractionSessionStatusMessage {
    const mode = this.sessions.get(overlayId)?.mode ?? "view";
    this.sessions.set(overlayId, { active: false, mode });
    const message: InteractionSessionStatusMessage = { type: "interaction:session-status", overlayId, mode, active: false, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return message;
  }

  createMockObject(overlayId: OverlayId) {
    const object = this.store.create({ overlayId, metadata: { label: "Mock interactive object" } }, this.now());
    const message: RuntimeObjectChangedMessage = { type: "runtime:object-created", object, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return object;
  }

  createObject(input: CreateRuntimeObjectInput) {
    const object = this.store.create(input, this.now());
    const message: RuntimeObjectChangedMessage = { type: "runtime:object-created", object, createdAt: this.now() };
    this.broadcast(object.overlayId, message);
    return object;
  }

  hit(overlayId: OverlayId, objectId: string, damage?: number) {
    const current = this.store.get(overlayId, objectId);
    const configuredDamage = damage ?? (typeof current?.metadata?.clickDamage === "number" ? current.metadata.clickDamage : 1);
    const object = this.store.hit(overlayId, objectId, configuredDamage, this.now());
    if (!object) return null;
    const message: RuntimeObjectChangedMessage = {
      type: object.state === "destroyed" ? "runtime:object-destroyed" : "runtime:object-updated",
      object,
      createdAt: this.now()
    };
    this.broadcast(overlayId, message);
    return object;
  }

  destroy(overlayId: OverlayId, objectId: string) {
    const object = this.store.destroy(overlayId, objectId, this.now());
    if (!object) return null;
    const message: RuntimeObjectChangedMessage = { type: "runtime:object-destroyed", object, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return object;
  }

  move(overlayId: OverlayId, objectId: string, normalizedX: number, normalizedY: number) {
    const object = this.store.move(overlayId, objectId, normalizedX, normalizedY, this.now());
    if (!object) return null;
    const message: RuntimeObjectChangedMessage = { type: "runtime:object-updated", object, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return object;
  }

  updateObject(overlayId: OverlayId, objectId: string, patch: { expiresAt?: string; metadata?: Record<string, unknown> }) {
    const object = this.store.update(overlayId, objectId, patch, this.now());
    if (!object) return null;
    const message: RuntimeObjectChangedMessage = { type: "runtime:object-updated", object, createdAt: this.now() };
    this.broadcast(overlayId, message);
    return object;
  }

  clear(overlayId: OverlayId, scope: "interactive" | "all"): RuntimeOverlayClearedMessage {
    this.store.clear(overlayId, scope, this.now());
    const message: RuntimeOverlayClearedMessage = { type: "runtime:overlay-cleared", overlayId, scope, createdAt: this.now() };
    this.broadcast(overlayId, message);
    this.broadcast(overlayId, this.snapshotMessage(overlayId));
    return message;
  }
}
