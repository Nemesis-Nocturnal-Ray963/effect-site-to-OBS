import React from "react";
import { Link, useParams } from "react-router-dom";
import type { InteractionTool, OverlayId, RuntimeEffectObject, RuntimeOverlaySnapshot, ServerMessage } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import {
  clearRuntimeObjects,
  createMockRuntimeObject,
  deleteRuntimeObject,
  endInteractionSession,
  fetchRuntimeSnapshot,
  hitRuntimeObject,
  moveRuntimeObject,
  startInteractionSession
} from "../services/httpApi";

interface FallingImagePreviewBody {
  object: RuntimeEffectObject;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  scale: number;
  rotation: number;
  rotationSpeed: number;
  expiresAt: number;
  hidden: boolean;
}

interface DragState {
  objectId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  latestX: number;
  latestY: number;
}

function makeWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function parseOverlayId(value: string | undefined): OverlayId {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 10 ? (parsed as OverlayId) : 1;
}

export function OverlayInteractionPage(): React.ReactElement {
  const { t } = useI18n();
  const params = useParams();
  const overlayId = parseOverlayId(params.overlayId);
  const [snapshot, setSnapshot] = React.useState<RuntimeOverlaySnapshot | null>(null);
  const [mode, setMode] = React.useState<"view" | "interactive">("view");
  const [tool, setTool] = React.useState<InteractionTool>("select");
  const [selectedObject, setSelectedObject] = React.useState<RuntimeEffectObject | null>(null);
  const [message, setMessage] = React.useState("");
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const objects = snapshot?.objects ?? [];
  const fallingObjects = objects.filter(isRenderableFallingImage);
  const staticObjects = objects.filter((object) => object.objectType !== "falling-image");

  const reload = React.useCallback(async () => {
    setSnapshot(await fetchRuntimeSnapshot(overlayId));
  }, [overlayId]);

  React.useEffect(() => {
    void startInteractionSession(overlayId, "view").then(setSnapshot).catch(() => setMessage(t("Could not load runtime snapshot")));
    return () => {
      void endInteractionSession(overlayId).catch(() => undefined);
    };
  }, [overlayId]);

  React.useEffect(() => {
    const ws = new WebSocket(makeWsUrl("/ws/control"));
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "runtime:snapshot-request", overlayId, createdAt: new Date().toISOString() }));
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as ServerMessage;
      if (data.type === "runtime:snapshot" && data.snapshot.overlayId === overlayId) {
        setSnapshot(data.snapshot);
      } else if (data.type === "runtime:object-created" && data.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, data.object));
      } else if (data.type === "runtime:object-updated" && data.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, data.object));
        setSelectedObject((current) => (current?.objectId === data.object.objectId ? data.object : current));
      } else if (data.type === "runtime:object-destroyed" && data.object.overlayId === overlayId) {
        setSnapshot((current) => removeObject(current, data.object.objectId));
        setSelectedObject((current) => (current?.objectId === data.object.objectId ? data.object : current));
      } else if (data.type === "runtime:overlay-cleared" && data.overlayId === overlayId) {
        void reload();
      }
    });
    return () => ws.close();
  }, [overlayId, reload]);

  async function setInteractive(nextMode: "view" | "interactive"): Promise<void> {
    setMode(nextMode);
    setSnapshot(await startInteractionSession(overlayId, nextMode));
  }

  async function handleObjectClick(object: RuntimeEffectObject): Promise<void> {
    setSelectedObject(object);
    if (mode !== "interactive") return;
    if (tool === "attack") {
      await hitRuntimeObject(overlayId, object.objectId);
      setMessage(t("Hit sent"));
    } else if (tool === "delete") {
      await deleteRuntimeObject(overlayId, object.objectId);
      setMessage(t("Object deleted"));
    }
  }

  function getPointerPosition(event: Pick<React.PointerEvent, "clientX" | "clientY">): { normalizedX: number; normalizedY: number } | null {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      normalizedX: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      normalizedY: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function moveObjectLocally(objectId: string, normalizedX: number, normalizedY: number): void {
    setSnapshot((current) => updateObjectPosition(current, objectId, normalizedX, normalizedY));
    setSelectedObject((current) =>
      current?.objectId === objectId
        ? { ...current, spawn: { ...current.spawn, normalizedX, normalizedY, velocityX: 0, velocityY: 0 } }
        : current
    );
  }

  function handlePointerDown(event: React.PointerEvent, object: RuntimeEffectObject): void {
    setSelectedObject(object);
    if (mode !== "interactive" || tool !== "select" || !object.interactive) return;
    const pointer = getPointerPosition(event);
    if (!pointer) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      objectId: object.objectId,
      pointerId: event.pointerId,
      offsetX: object.spawn.normalizedX - pointer.normalizedX,
      offsetY: object.spawn.normalizedY - pointer.normalizedY,
      latestX: object.spawn.normalizedX,
      latestY: object.spawn.normalizedY
    };
    setMessage(t("Moving object"));
  }

  function handlePointerMove(event: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointer = getPointerPosition(event);
    if (!pointer) return;
    const normalizedX = clamp(pointer.normalizedX + drag.offsetX, 0, 1);
    const normalizedY = clamp(pointer.normalizedY + drag.offsetY, 0, 1);
    dragRef.current = { ...drag, latestX: normalizedX, latestY: normalizedY };
    moveObjectLocally(drag.objectId, normalizedX, normalizedY);
  }

  async function handlePointerUp(event: React.PointerEvent): Promise<void> {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      const object = await moveRuntimeObject(overlayId, drag.objectId, { normalizedX: drag.latestX, normalizedY: drag.latestY });
      setSnapshot((current) => upsertObject(current, object));
      setSelectedObject(object);
      setMessage(t("Object moved"));
    } catch {
      setMessage(t("Could not move object"));
      await reload();
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Overlay")} {overlayId}</p>
        <h2>{t("Interaction Mode")}</h2>
      </div>

      <div className="interaction-toolbar">
        <Link className="text-link" to="/overlays">
          {t("Back to overlays")}
        </Link>
        <button className={mode === "view" ? "active" : ""} type="button" onClick={() => void setInteractive("view")}>
          View
        </button>
        <button className={mode === "interactive" ? "active" : ""} type="button" onClick={() => void setInteractive("interactive")}>
          Interactive
        </button>
        <select value={tool} onChange={(event) => setTool(event.target.value as InteractionTool)}>
          <option value="select">{t("Move")}</option>
          <option value="inspect">{t("Inspect")}</option>
          <option value="attack">{t("Attack")}</option>
          <option value="delete">{t("Delete")}</option>
        </select>
        <button type="button" onClick={() => void createMockRuntimeObject(overlayId)}>
          {t("Add Mock Object")}
        </button>
        <button type="button" onClick={() => void clearRuntimeObjects(overlayId).then(reload)}>
          Clear
        </button>
        <span>{objects.length} {t("objects")}</span>
        <span>{message}</span>
      </div>

      <div className="interaction-layout">
        <div
          className={`interactive-viewport ${mode === "interactive" ? "interactive" : ""} ${mode === "interactive" && tool === "select" ? "move-tool" : ""}`}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => void handlePointerUp(event)}
          onPointerCancel={(event) => void handlePointerUp(event)}
          ref={viewportRef}
        >
          <FallingImageInteractionLayer objects={fallingObjects} onObjectClick={handleObjectClick} onPointerDown={handlePointerDown} />
          {staticObjects.map((object) => (
            <button
              className="runtime-object"
              key={object.objectId}
              style={{
                left: `${object.spawn.normalizedX * 100}%`,
                top: `${object.spawn.normalizedY * 100}%`,
                transform: `translate(-50%, -50%) rotate(${object.spawn.rotation ?? 0}deg) scale(${object.spawn.scale ?? 1})`
              }}
              type="button"
              onPointerDown={(event) => handlePointerDown(event, object)}
              onClick={() => void handleObjectClick(object)}
            >
              {object.asset?.contentUrl ? <img alt="" src={object.asset.contentUrl} /> : null}
              <span>{object.hitPoints ?? "-"} / {object.maxHitPoints ?? "-"}</span>
            </button>
          ))}
        </div>

        <aside className="panel runtime-inspector">
          <h3>{t("Inspector")}</h3>
          {selectedObject ? (
            <dl className="detail-list compact">
              <dt>{t("object")}</dt>
              <dd>{selectedObject.objectId}</dd>
              <dt>{t("type")}</dt>
              <dd>{selectedObject.objectType}</dd>
              <dt>HP</dt>
              <dd>
                {selectedObject.hitPoints} / {selectedObject.maxHitPoints}
              </dd>
              <dt>{t("state")}</dt>
              <dd>{selectedObject.state}</dd>
              <dt>{t("effect")}</dt>
              <dd>{selectedObject.effectConfigId}</dd>
            </dl>
          ) : (
            <p className="empty-text">{t("Select an object.")}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function FallingImageInteractionLayer({
  objects,
  onObjectClick,
  onPointerDown
}: {
  objects: RuntimeEffectObject[];
  onObjectClick: (object: RuntimeEffectObject) => Promise<void>;
  onPointerDown: (event: React.PointerEvent, object: RuntimeEffectObject) => void;
}): React.ReactElement {
  const [bodies, setBodies] = React.useState<FallingImagePreviewBody[]>([]);
  const bodiesRef = React.useRef<FallingImagePreviewBody[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const width = containerRef.current?.clientWidth ?? 960;
    const height = containerRef.current?.clientHeight ?? 560;
    const existing = new Map(bodiesRef.current.map((body) => [body.object.objectId, body]));
    bodiesRef.current = objects.map((object) => {
      const current = existing.get(object.objectId);
      if (current && sameSpawnPosition(current.object, object)) return { ...current, object };
      return createFallingPreviewBody(object, width, height);
    });
    setBodies(bodiesRef.current.filter((body) => !body.hidden));
  }, [objects]);

  React.useEffect(() => {
    const tick = (time: number) => {
      const width = containerRef.current?.clientWidth ?? 960;
      const height = containerRef.current?.clientHeight ?? 560;
      const lastTime = lastTimeRef.current ?? time;
      const dt = Math.min(0.033, Math.max(0, (time - lastTime) / 1000));
      lastTimeRef.current = time;

      bodiesRef.current = simulateFallingPreviewBodies(bodiesRef.current, dt, width, height, Date.now());
      setBodies(bodiesRef.current.filter((body) => !body.hidden));
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastTimeRef.current = null;
    };
  }, []);

  return (
    <div className="falling-preview-layer" ref={containerRef}>
      {bodies.map((body) => (
        <button
          className="runtime-object image-runtime-object"
          data-runtime-state={body.object.state}
          key={body.object.objectId}
          style={{
            left: `${body.x}px`,
            top: `${body.y}px`,
            transform: `translate(-50%, -50%) rotate(${body.rotation}deg) scale(${body.scale})`
          }}
          type="button"
          onPointerDown={(event) => onPointerDown(event, body.object)}
          onClick={() => void onObjectClick(body.object)}
        >
          <img alt="" src={body.object.asset?.contentUrl} />
          {body.object.interactive ? (
            <span>
              {body.object.hitPoints ?? "-"} / {body.object.maxHitPoints ?? "-"}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function createFallingPreviewBody(object: RuntimeEffectObject, width: number, height: number): FallingImagePreviewBody {
  const metadata = object.metadata ?? {};
  const scale = object.spawn.scale ?? 1;
  const size = numberParam(metadata.size, 96) * scale;
  return {
    object,
    x: object.spawn.normalizedX * width,
    y: object.spawn.normalizedY * height,
    vx: numberParam(metadata.drift, 0) * 70,
    vy: 0,
    radius: Math.max(16, size / 2),
    scale,
    rotation: object.spawn.rotation ?? 0,
    rotationSpeed: numberParam(metadata.rotationSpeed, 0),
    expiresAt: object.expiresAt ? new Date(object.expiresAt).getTime() : Date.now() + 8000,
    hidden: false
  };
}

function simulateFallingPreviewBodies(
  bodies: FallingImagePreviewBody[],
  dt: number,
  width: number,
  height: number,
  time: number
): FallingImagePreviewBody[] {
  const next = bodies.map((body) => {
    const metadata = body.object.metadata ?? {};
    const gravity = numberParam(metadata.gravity, 3) * 1750;
    const floorBehavior = stringParam(metadata.floorBehavior, "bounce");
    const restitution = Math.max(0, Math.min(1, numberParam(metadata.bounceRestitution, 0.58)));
    const friction = Math.max(0, Math.min(1, numberParam(metadata.floorFriction, 0.82)));
    const updated = { ...body };

    if (time >= updated.expiresAt) {
      updated.hidden = true;
      return updated;
    }

    updated.vy += gravity * dt;
    updated.x += updated.vx * dt;
    updated.y += updated.vy * dt;
    updated.rotation += updated.rotationSpeed * dt;

    if (updated.x - updated.radius < 0) {
      updated.x = updated.radius;
      updated.vx = Math.abs(updated.vx) * restitution;
    } else if (updated.x + updated.radius > width) {
      updated.x = width - updated.radius;
      updated.vx = -Math.abs(updated.vx) * restitution;
    }

    if (floorBehavior === "bounce") {
      const floor = height - updated.radius;
      if (updated.y > floor) {
        updated.y = floor;
        updated.vy = -Math.abs(updated.vy) * restitution;
        updated.vx *= friction;
        updated.rotationSpeed *= friction;
        if (Math.abs(updated.vy) < 90) updated.vy = 0;
      }
    } else if (updated.y - updated.radius > height) {
      updated.hidden = true;
    }

    return updated;
  });

  for (let index = 0; index < next.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < next.length; otherIndex += 1) {
      if (booleanParam(next[index].object.metadata?.objectCollisionEnabled, true) && booleanParam(next[otherIndex].object.metadata?.objectCollisionEnabled, true)) {
        resolvePreviewCollision(next[index], next[otherIndex]);
      }
    }
  }

  return next;
}

function resolvePreviewCollision(a: FallingImagePreviewBody, b: FallingImagePreviewBody): void {
  if (a.hidden || b.hidden) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minimumDistance = a.radius + b.radius;
  if (distance >= minimumDistance) return;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minimumDistance - distance;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;

  const relativeVelocityX = b.vx - a.vx;
  const relativeVelocityY = b.vy - a.vy;
  const velocityAlongNormal = relativeVelocityX * nx + relativeVelocityY * ny;
  if (velocityAlongNormal > 0) return;

  const restitution = Math.min(
    numberParam(a.object.metadata?.bounceRestitution, 0.58),
    numberParam(b.object.metadata?.bounceRestitution, 0.58)
  );
  const impulse = (-(1 + restitution) * velocityAlongNormal) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function isRenderableFallingImage(object: RuntimeEffectObject): boolean {
  return object.objectType === "falling-image" && Boolean(object.asset?.contentUrl) && object.state === "active";
}

function upsertObject(snapshot: RuntimeOverlaySnapshot | null, object: RuntimeEffectObject): RuntimeOverlaySnapshot {
  const base = snapshot ?? { overlayId: object.overlayId, objects: [], generatedAt: new Date().toISOString() };
  return {
    ...base,
    objects: [object, ...base.objects.filter((item) => item.objectId !== object.objectId)]
  };
}

function removeObject(snapshot: RuntimeOverlaySnapshot | null, objectId: string): RuntimeOverlaySnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, objects: snapshot.objects.filter((object) => object.objectId !== objectId) };
}

function updateObjectPosition(snapshot: RuntimeOverlaySnapshot | null, objectId: string, normalizedX: number, normalizedY: number): RuntimeOverlaySnapshot | null {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    objects: snapshot.objects.map((object) =>
      object.objectId === objectId
        ? { ...object, spawn: { ...object.spawn, normalizedX, normalizedY, velocityX: 0, velocityY: 0 } }
        : object
    )
  };
}

function sameSpawnPosition(left: RuntimeEffectObject, right: RuntimeEffectObject): boolean {
  return left.spawn.normalizedX === right.spawn.normalizedX && left.spawn.normalizedY === right.spawn.normalizedY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function booleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
