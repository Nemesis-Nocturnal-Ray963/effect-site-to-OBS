import React from "react";
import { createRoot } from "react-dom/client";
import type { EffectPlayMessage, RuntimeEffectObject, RuntimeOverlaySnapshot, ServerMessage } from "@obs-effect/shared-types";
import "./styles.css";

const CURRENT_BUILD_VERSION = ((import.meta as ImportMeta & { env?: { VITE_BUILD_VERSION?: string } }).env?.VITE_BUILD_VERSION) ?? "dev";
const RELOAD_STORAGE_KEY = "obs-effect-overlay-reload-state";
const MAX_RELOADS_PER_MINUTE = 3;

interface Flash {
  id: string;
  color: string;
  durationMs: number;
}

interface SimpleMediaPlayback {
  id: string;
  message: EffectPlayMessage;
  durationMs: number;
}

interface FallingImageBody {
  object: RuntimeEffectObject;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  scale: number;
  rotation: number;
  rotationSpeed: number;
  readyAt: number;
  expiresAt: number | null;
  hidden: boolean;
}

interface OverlayFontInfo {
  family: string;
  source: "system" | "asset";
  contentUrl?: string;
}

function makeWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function getOverlayId(): number {
  const match = window.location.pathname.match(/^\/overlay\/(\d+)$/);
  const parsed = match ? Number(match[1]) : 1;
  return parsed >= 1 && parsed <= 10 ? parsed : 1;
}

function sendOverlayHello(socket: WebSocket | null, overlayId: number): void {
  sendSocketMessage(socket, {
    type: "overlay:hello",
    overlayId,
    currentBuildVersion: CURRENT_BUILD_VERSION,
    createdAt: new Date().toISOString()
  });
}

function sendSnapshotRequest(socket: WebSocket | null, overlayId: number): void {
  sendSocketMessage(socket, {
    type: "runtime:snapshot-request",
    overlayId,
    createdAt: new Date().toISOString()
  });
}

function sendSocketMessage(socket: WebSocket | null, message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function scheduleOverlayReload(newBuildVersion: string, reloadDelayMs: number, reason: string): void {
  if (!newBuildVersion || newBuildVersion === CURRENT_BUILD_VERSION) return;
  const state = readReloadState();
  const now = Date.now();
  const recent = state.reloadTimestamps.filter((timestamp) => now - timestamp < 60_000);
  if (state.lastReloadedBuildVersion === newBuildVersion || recent.length >= MAX_RELOADS_PER_MINUTE) {
    writeReloadState({ ...state, reloadTimestamps: recent, reloadFailureCount: state.reloadFailureCount + 1 });
    return;
  }
  writeReloadState({
    lastReloadedBuildVersion: newBuildVersion,
    lastReloadReason: reason,
    reloadTimestamps: [...recent, now],
    reloadFailureCount: state.reloadFailureCount
  });
  window.setTimeout(() => window.location.reload(), Math.max(0, reloadDelayMs));
}

function readReloadState(): {
  lastReloadedBuildVersion?: string;
  lastReloadReason?: string;
  reloadTimestamps: number[];
  reloadFailureCount: number;
} {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(RELOAD_STORAGE_KEY) ?? "{}") as {
      lastReloadedBuildVersion?: string;
      lastReloadReason?: string;
      reloadTimestamps?: number[];
      reloadFailureCount?: number;
    };
    return {
      lastReloadedBuildVersion: parsed.lastReloadedBuildVersion,
      lastReloadReason: parsed.lastReloadReason,
      reloadTimestamps: Array.isArray(parsed.reloadTimestamps) ? parsed.reloadTimestamps.filter((value) => typeof value === "number") : [],
      reloadFailureCount: typeof parsed.reloadFailureCount === "number" ? parsed.reloadFailureCount : 0
    };
  } catch {
    return { reloadTimestamps: [], reloadFailureCount: 0 };
  }
}

function writeReloadState(state: ReturnType<typeof readReloadState>): void {
  window.sessionStorage.setItem(RELOAD_STORAGE_KEY, JSON.stringify(state));
}

function App(): React.ReactElement {
  const [flashes, setFlashes] = React.useState<Flash[]>([]);
  const [simpleMedia, setSimpleMedia] = React.useState<SimpleMediaPlayback[]>([]);
  const [snapshot, setSnapshot] = React.useState<RuntimeOverlaySnapshot | null>(null);
  const [connected, setConnected] = React.useState(false);
  const overlayId = React.useMemo(() => getOverlayId(), []);
  const debug = new URLSearchParams(window.location.search).get("debug") === "1";
  useUploadedFonts();

  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer = 0;
    let closedByCleanup = false;

    function connect(): void {
      ws = new WebSocket(makeWsUrl(`/ws/overlay/${overlayId}`));
      ws.addEventListener("open", () => {
        setConnected(true);
        sendOverlayHello(ws, overlayId);
        sendSnapshotRequest(ws, overlayId);
      });
      ws.addEventListener("close", () => {
        setConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 1000);
        }
      });
      ws.addEventListener("message", handleMessage);
    }

    function handleMessage(event: MessageEvent): void {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "effect:play" && message.effectId === "flash") {
        const play = message as EffectPlayMessage;
        const color = typeof play.parameters?.color === "string" ? play.parameters.color : "#ffffff";
        const durationMs =
          typeof play.parameters?.durationMs === "number" ? play.parameters.durationMs : 650;
        const flash: Flash = { id: play.instanceId, color, durationMs };
        setFlashes((current) => [...current, flash]);
        window.setTimeout(() => {
          setFlashes((current) => current.filter((item) => item.id !== flash.id));
        }, durationMs);
      } else if (message.type === "effect:play" && message.effectId === "simple-media") {
        const play = message as EffectPlayMessage;
        const durationMs = play.playback?.durationMs ?? 3000;
        const item: SimpleMediaPlayback = { id: play.instanceId, message: play, durationMs };
        setSimpleMedia((current) => [...current, item]);
        window.setTimeout(() => {
          setSimpleMedia((current) => current.filter((active) => active.id !== item.id));
        }, durationMs);
      } else if (message.type === "runtime:snapshot" && message.snapshot.overlayId === overlayId) {
        setSnapshot(message.snapshot);
      } else if (message.type === "runtime:object-created" && message.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, message.object));
      } else if (message.type === "runtime:object-updated" && message.object.overlayId === overlayId) {
        setSnapshot((current) => upsertObject(current, message.object));
      } else if (message.type === "runtime:object-destroyed" && message.object.overlayId === overlayId) {
        setSnapshot((current) => removeObject(current, message.object.objectId));
      } else if (message.type === "runtime:overlay-cleared" && message.overlayId === overlayId) {
        setSnapshot((current) => (current ? { ...current, objects: [] } : current));
      } else if (message.type === "overlay:reload-required" && message.overlayId === overlayId) {
        scheduleOverlayReload(message.newBuildVersion, message.reloadDelayMs, message.reason);
      } else if (message.type === "overlay:version" && message.overlayId === overlayId && message.buildVersion !== CURRENT_BUILD_VERSION) {
        scheduleOverlayReload(message.buildVersion, 500, "build-version-changed");
      }
    }

    connect();
    return () => {
      closedByCleanup = true;
      window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [overlayId]);

  return (
    <div className="overlay-stage" aria-hidden="true">
      {debug ? (
        <div className="debug-panel">
          <strong>Overlay {overlayId}</strong>
          <span>1920 x 1080</span>
          <span>{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</span>
        </div>
      ) : null}
      {flashes.map((flash) => (
        <div
          className="flash"
          key={flash.id}
          style={{
            backgroundColor: flash.color,
            animationDuration: `${flash.durationMs}ms`
          }}
        />
      ))}
      {simpleMedia.map((item) => (
        <SimpleMediaView key={item.id} item={item} />
      ))}
      <FallingImagePhysicsLayer objects={(snapshot?.objects ?? []).filter(isRenderableFallingImage)} />
      <PitchingMachineLayer objects={(snapshot?.objects ?? []).filter(isRenderablePitchingObject)} />
      {(snapshot?.objects ?? []).filter((object) => object.objectType === "gift-combo-text").map((object) => (
        <GiftComboTextObject key={object.objectId} object={object} />
      ))}
      {(snapshot?.objects ?? []).filter((object) => object.objectType !== "falling-image" && object.objectType !== "gift-combo-text" && !isRenderablePitchingObject(object)).map((object) => (
        <RuntimeObjectView key={object.objectId} object={object} />
      ))}
    </div>
  );
}

function FallingImagePhysicsLayer({ objects }: { objects: RuntimeEffectObject[] }): React.ReactElement {
  const [bodies, setBodies] = React.useState<FallingImageBody[]>([]);
  const bodiesRef = React.useRef<FallingImageBody[]>([]);
  const frameRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const width = window.innerWidth || 1920;
    const height = window.innerHeight || 1080;
    const current = new Map(bodiesRef.current.map((body) => [body.object.objectId, body]));
    const next = objects.map((object) => {
      const existing = current.get(object.objectId);
      if (existing && sameSpawnPosition(existing.object, object)) return { ...existing, object };
      const scale = object.spawn.scale ?? 1;
      const radius = 48 * scale;
      const expiresAt = object.expiresAt ? Date.parse(object.expiresAt) : Number.NaN;
      return {
        object,
        x: object.spawn.normalizedX * width,
        y: object.spawn.normalizedY * height,
        vx: (object.spawn.velocityX ?? 0) * width * 1.6,
        vy: (object.spawn.velocityY ?? 0) * height * 0.9,
        radius,
        scale,
        rotation: object.spawn.rotation ?? 0,
        rotationSpeed: object.spawn.rotationSpeed ?? 0,
        readyAt: performance.now(),
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        hidden: false
      };
    });
    bodiesRef.current = next;
    setBodies(next);
  }, [objects]);

  React.useEffect(() => {
    function tick(time: number): void {
      const previous = lastTimeRef.current ?? time;
      lastTimeRef.current = time;
      const dt = Math.min((time - previous) / 1000, 0.033);
      const width = window.innerWidth || 1920;
      const height = window.innerHeight || 1080;
      const next = simulateFallingBodies(bodiesRef.current, dt, width, height, time);
      bodiesRef.current = next;
      setBodies(next);
      frameRef.current = window.requestAnimationFrame(tick);
    }

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <>
      {bodies.filter((body) => !body.hidden).map((body) => (
        <div
          className="runtime-object falling-image-object"
          key={body.object.objectId}
          style={{
            left: 0,
            top: 0,
            width: `${96 * body.scale}px`,
            height: `${96 * body.scale}px`,
            transform: `translate(${body.x - body.radius}px, ${body.y - body.radius}px) rotate(${body.rotation}deg)`
          }}
          data-runtime-state={body.object.state}
        >
          <img alt="" src={body.object.asset?.contentUrl} />
          {body.object.interactive ? (
            <span className="runtime-object-hp">
              {body.object.hitPoints ?? "-"} / {body.object.maxHitPoints ?? "-"}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

function simulateFallingBodies(bodies: FallingImageBody[], dt: number, width: number, height: number, time: number): FallingImageBody[] {
  const next = bodies.map((body) => {
    const gravity = numberParam(body.object.metadata?.gravity, 3) * 1750;
    const floorBehavior = stringParam(body.object.metadata?.floorBehavior, "bounce");
    const restitution = numberParam(body.object.metadata?.bounceRestitution, 0.58);
    const floorFriction = numberParam(body.object.metadata?.floorFriction, 0.82);
    if (time < body.readyAt) return body;
    if (body.expiresAt !== null && Date.now() > body.expiresAt) return { ...body, hidden: true };

    let x = body.x + body.vx * dt;
    let y = body.y + body.vy * dt;
    let vx = body.vx;
    let vy = body.vy + gravity * dt;
    let hidden = body.hidden;

    if (x < body.radius) {
      x = body.radius;
      vx = Math.abs(vx) * restitution;
    } else if (x > width - body.radius) {
      x = width - body.radius;
      vx = -Math.abs(vx) * restitution;
    }

    if (floorBehavior === "bounce") {
      const floor = height - body.radius;
      if (y > floor) {
        y = floor;
        vy = -Math.abs(vy) * restitution;
        vx *= floorFriction;
        if (Math.abs(vy) < 42) vy = 0;
      }
    } else if (y > height + body.radius * 2) {
      hidden = true;
    }

    return {
      ...body,
      x,
      y,
      vx,
      vy,
      rotation: body.rotation + body.rotationSpeed * dt,
      hidden
    };
  });

  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]!;
      const b = next[j]!;
      if (a.hidden || b.hidden) continue;
      if (!booleanParam(a.object.metadata?.objectCollisionEnabled, true) || !booleanParam(b.object.metadata?.objectCollisionEnabled, true)) continue;
      resolveCircleCollision(a, b);
    }
  }

  return next;
}

function resolveCircleCollision(a: FallingImageBody, b: FallingImageBody): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 0.0001;
  const minDistance = a.radius + b.radius;
  if (distance >= minDistance) return;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;

  const relativeVx = b.vx - a.vx;
  const relativeVy = b.vy - a.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;
  if (velocityAlongNormal > 0) return;

  const restitution = Math.min(numberParam(a.object.metadata?.bounceRestitution, 0.58), numberParam(b.object.metadata?.bounceRestitution, 0.58));
  const impulse = (-(1 + restitution) * velocityAlongNormal) / 2;
  const ix = impulse * nx;
  const iy = impulse * ny;
  a.vx -= ix;
  a.vy -= iy;
  b.vx += ix;
  b.vy += iy;
}

function isRenderableFallingImage(object: RuntimeEffectObject): boolean {
  return object.objectType === "falling-image" && Boolean(object.asset?.contentUrl) && object.state === "active";
}

function isRenderablePitchingObject(object: RuntimeEffectObject): boolean {
  return (
    (object.objectType === "pitching-machine" || object.objectType === "pitching-ball" || object.objectType === "pitching-impact") &&
    object.state === "active"
  );
}

function sameSpawnPosition(left: RuntimeEffectObject, right: RuntimeEffectObject): boolean {
  return left.spawn.normalizedX === right.spawn.normalizedX && left.spawn.normalizedY === right.spawn.normalizedY;
}

function PitchingMachineLayer({ objects }: { objects: RuntimeEffectObject[] }): React.ReactElement {
  const [time, setTime] = React.useState(() => Date.now());
  const machineObjects = React.useMemo(() => objects.filter((object) => object.objectType === "pitching-machine"), [objects]);
  const animatedObjects = React.useMemo(() => objects.filter((object) => object.objectType !== "pitching-machine"), [objects]);

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      setTime(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      {animatedObjects.map((object) => {
        if (object.objectType === "pitching-ball") return <PitchingBallObject key={object.objectId} object={object} time={time} />;
        return <PitchingImpactObject key={object.objectId} object={object} time={time} />;
      })}
      {machineObjects.map((object) => (
        <PitchingMachineObject key={object.objectId} object={object} />
      ))}
    </>
  );
}

function PitchingMachineObject({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  const exitAt = numberParam(object.metadata?.exitAt, Number.MAX_SAFE_INTEGER);
  const [exiting, setExiting] = React.useState(() => Date.now() >= exitAt);
  const [aiming, setAiming] = React.useState(false);
  const [recoiling, setRecoiling] = React.useState(false);
  const edge = stringParam(object.metadata?.edge, "left");
  const listenerName = stringParam(object.metadata?.listenerName, "");
  const enterDurationMs = numberParam(object.metadata?.enterDurationMs, 420);
  const exitDurationMs = numberParam(object.metadata?.exitDurationMs, 520);
  const horizontalEdgeOffsetPx = numberParam(object.metadata?.horizontalEdgeOffsetPx, 0);
  const launchAt = numberParam(object.metadata?.launchAt, Date.parse(object.createdAt));
  const recoilAt = numberParam(object.metadata?.recoilAt, 0);
  const recoilIndex = numberParam(object.metadata?.recoilIndex, -1);
  const width = window.innerWidth || 1920;
  const height = window.innerHeight || 1080;
  const machineX = pitchingBallStartX(edge, object.spawn.normalizedX, width, horizontalEdgeOffsetPx);
  const machineY = object.spawn.normalizedY * height;
  const targetX = numberParam(object.metadata?.targetX, object.spawn.normalizedX) * width;
  const targetY = numberParam(object.metadata?.targetY, object.spawn.normalizedY) * height;
  const aimAngle = Math.atan2(targetY - machineY, targetX - machineX) * (180 / Math.PI);

  React.useEffect(() => {
    const delayMs = exitAt - Date.now();
    if (delayMs <= 0) {
      setExiting(true);
      return;
    }
    setExiting(false);
    const timer = window.setTimeout(() => setExiting(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [exitAt]);

  React.useEffect(() => {
    const aimDurationMs = 180;
    const delayMs = Math.max(0, Math.min(enterDurationMs, launchAt - Date.now() - aimDurationMs));
    setAiming(false);
    const timer = window.setTimeout(() => setAiming(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [enterDurationMs, launchAt]);

  React.useEffect(() => {
    if (!recoilAt) return;
    const delayMs = Math.max(0, recoilAt - Date.now());
    const startTimer = window.setTimeout(() => {
      setRecoiling(false);
      window.requestAnimationFrame(() => setRecoiling(true));
    }, delayMs);
    const endTimer = window.setTimeout(() => setRecoiling(false), delayMs + 240);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
    };
  }, [recoilAt, recoilIndex]);

  return (
    <div
      className={`pitching-machine-object edge-${edge} ${exiting ? "exiting" : ""}`}
      style={{
        left: pitchingMachineLeft(edge, object.spawn.normalizedX, horizontalEdgeOffsetPx),
        top: `${object.spawn.normalizedY * 100}%`,
        "--machine-scale": String(object.spawn.scale ?? 1),
        "--machine-rotate": `${object.spawn.rotation ?? 0}deg`,
        "--machine-enter-ms": `${enterDurationMs}ms`,
        "--machine-exit-ms": `${exitDurationMs}ms`
      } as React.CSSProperties}
    >
      {listenerName ? <div className="pitching-listener-name">{listenerName}</div> : null}
      <div className="pitching-machine-visual" style={{ transform: aiming ? pitchingMachineAimTransform(edge, aimAngle) : pitchingMachineVisualTransform(edge) }}>
        <div className={`pitching-machine-media ${recoiling ? "recoiling" : ""}`}>
          {object.asset?.contentUrl ? <img alt="" src={object.asset.contentUrl} /> : <span>PM</span>}
        </div>
      </div>
    </div>
  );
}

function PitchingBallObject({ object, time }: { object: RuntimeEffectObject; time: number }): React.ReactElement {
  const launchPlayedRef = React.useRef(false);
  const impactPlayedRef = React.useRef(false);
  const width = window.innerWidth || 1920;
  const height = window.innerHeight || 1080;
  const launchAt = numberParam(object.metadata?.launchAt, Date.parse(object.createdAt));
  const impactAt = numberParam(object.metadata?.impactAt, launchAt + numberParam(object.metadata?.travelDurationMs, 750));
  const travelDurationMs = Math.max(1, impactAt - launchAt);
  const startEdge = stringParam(object.metadata?.startEdge, "");
  const horizontalEdgeOffsetPx = numberParam(object.metadata?.horizontalEdgeOffsetPx, 0);
  const startX = pitchingBallStartX(startEdge, numberParam(object.metadata?.startX, object.spawn.normalizedX), width, horizontalEdgeOffsetPx);
  const startY = numberParam(object.metadata?.startY, object.spawn.normalizedY) * height;
  const targetX = numberParam(object.metadata?.targetX, object.spawn.normalizedX) * width;
  const targetY = numberParam(object.metadata?.targetY, object.spawn.normalizedY) * height;
  const trajectoryMode = stringParam(object.metadata?.trajectoryMode, "direct");
  const scale = object.spawn.scale ?? 1;
  let x = startX;
  let y = startY;

  React.useEffect(() => {
    if (!launchPlayedRef.current && time >= launchAt) {
      launchPlayedRef.current = true;
      playAudio(stringParam(object.metadata?.launchAudioUrl, ""), numberParam(object.metadata?.audioVolume, 0.8));
    }
    if (!impactPlayedRef.current && time >= impactAt) {
      impactPlayedRef.current = true;
      playAudio(stringParam(object.metadata?.impactAudioUrl, ""), numberParam(object.metadata?.audioVolume, 0.8));
    }
  }, [impactAt, launchAt, object.metadata, time]);

  if (time < launchAt) {
    x = startX;
    y = startY;
  } else if (time < impactAt) {
    const progress = easeInCubic((time - launchAt) / travelDurationMs);
    if (trajectoryMode === "arc") {
      const controlX = (startX + targetX) / 2;
      const controlY = (startY + targetY) / 2 - numberParam(object.metadata?.arcHeightPx, 220);
      x = quadratic(startX, controlX, targetX, progress);
      y = quadratic(startY, controlY, targetY, progress);
    } else {
      x = startX + (targetX - startX) * progress;
      y = startY + (targetY - startY) * progress;
    }
  } else {
    const dt = (time - impactAt) / 1000;
    const vx = numberParam(object.metadata?.postVelocityX, 0.28) * width;
    const initialVy = numberParam(object.metadata?.postVelocityY, -0.42) * height;
    const gravity = numberParam(object.metadata?.gravity, 3.2) * 500;
    x = targetX + vx * dt;
    y = targetY + initialVy * dt + (gravity * dt * dt) / 2;
    if (stringParam(object.metadata?.groundCollisionMode, "bounce") === "bounce") {
      const floor = height - 48 * scale;
      if (y > floor) {
        const restitution = numberParam(object.metadata?.restitution, 0.58);
        y = floor - Math.abs(Math.sin(dt * 5)) * 140 * restitution;
      }
    }
  }

  return (
    <div
      className="pitching-ball-object"
      style={{
        left: 0,
        top: 0,
        width: `${82 * scale}px`,
        height: `${82 * scale}px`,
        transform: `translate(${x - 41 * scale}px, ${y - 41 * scale}px) rotate(${(object.spawn.rotation ?? 0) + (time - launchAt) * 0.32}deg)`
      }}
    >
      {object.asset?.contentUrl ? <img alt="" src={object.asset.contentUrl} /> : <span />}
    </div>
  );
}

function playAudio(url: string, volume: number): void {
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  void audio.play().catch(() => undefined);
}

function pitchingMachineLeft(edge: string, normalizedX: number, horizontalEdgeOffsetPx: number): string {
  if (edge === "left") return `${-horizontalEdgeOffsetPx}px`;
  if (edge === "right") return `calc(100% + ${horizontalEdgeOffsetPx}px)`;
  return `${normalizedX * 100}%`;
}

function pitchingMachineVisualTransform(edge: string): string {
  if (edge === "right") return "scaleX(-1)";
  if (edge === "top") return "rotate(90deg)";
  if (edge === "bottom") return "rotate(270deg)";
  return "none";
}

function pitchingMachineAimTransform(edge: string, angleDeg: number): string {
  if (edge === "right") return `rotate(${angleDeg - 180}deg) scaleX(-1)`;
  if (edge === "top") return `rotate(${angleDeg - 90}deg)`;
  if (edge === "bottom") return `rotate(${angleDeg - 270}deg)`;
  return `rotate(${angleDeg}deg)`;
}

function pitchingBallStartX(edge: string, normalizedX: number, width: number, horizontalEdgeOffsetPx: number): number {
  if (edge === "left") return -horizontalEdgeOffsetPx;
  if (edge === "right") return width + horizontalEdgeOffsetPx;
  return normalizedX * width;
}

function PitchingImpactObject({ object, time }: { object: RuntimeEffectObject; time: number }): React.ReactElement {
  const created = Date.parse(object.createdAt);
  const duration = numberParam(object.metadata?.durationMs, 420);
  const progress = Math.min(1, Math.max(0, (time - created) / duration));
  const radius = numberParam(object.metadata?.targetRadiusPx, 72) * (1 + progress * 0.9);
  return (
    <div
      className="pitching-impact-object"
      style={{
        left: `${object.spawn.normalizedX * 100}%`,
        top: `${object.spawn.normalizedY * 100}%`,
        width: `${radius * 2}px`,
        height: `${radius * 2}px`,
        opacity: 1 - progress,
        transform: "translate(-50%, -50%)"
      }}
    />
  );
}

function quadratic(a: number, b: number, c: number, t: number): number {
  return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
}

function easeInCubic(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t;
}

function SimpleMediaView({ item }: { item: SimpleMediaPlayback }): React.ReactElement {
  const parameters = item.message.parameters ?? {};
  const visual = item.message.visual;
  const imageEnabled = booleanParam(parameters.imageEnabled, true);
  const videoEnabled = booleanParam(parameters.videoEnabled, false);
  const audioEnabled = booleanParam(parameters.audioEnabled, false);
  const textEnabled = booleanParam(parameters.textEnabled, false);
  const backgroundEnabled = booleanParam(parameters.backgroundEnabled, false);
  const padding = numberParam(parameters.backgroundPadding, 24);
  const borderRadius = numberParam(parameters.backgroundBorderRadius, 18);
  const scale = visual?.size.scale ?? 1;
  const x = visual?.position.mode === "normalized" ? visual.position.x * 100 : 50;
  const y = visual?.position.mode === "normalized" ? visual.position.y * 100 : 50;
  const width = visual?.size.width ? `${visual.size.width}${visual.size.unit === "px" ? "px" : "%"}` : "auto";
  const height = visual?.size.height ? `${visual.size.height}${visual.size.unit === "px" ? "px" : "%"}` : "auto";
  const enterTransition = stringParam(parameters.enterTransition, "fade");
  const exitTransition = stringParam(parameters.exitTransition, "fade");

  return (
    <div
      className={`simple-media simple-enter-${enterTransition} simple-exit-${exitTransition}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width,
        height,
        opacity: visual?.opacity ?? 1,
        zIndex: visual?.zIndex ?? 10,
        "--simple-scale": String(scale),
        "--simple-duration": `${item.durationMs}ms`,
        "--simple-enter-ms": `${numberParam(parameters.enterDurationMs, 250)}ms`,
        "--simple-exit-ms": `${numberParam(parameters.exitDurationMs, 250)}ms`,
        padding: backgroundEnabled ? `${padding}px` : 0,
        borderRadius: backgroundEnabled ? `${borderRadius}px` : 0,
        backgroundColor: backgroundEnabled
          ? colorWithOpacity(stringParam(parameters.backgroundColor, "#000000"), numberParam(parameters.backgroundOpacity, 0.4))
          : "transparent"
      } as React.CSSProperties}
    >
      {imageEnabled && item.message.media?.imageUrl ? (
        <img
          alt=""
          className="simple-media-image"
          src={item.message.media.imageUrl}
          style={{ objectFit: fitParam(parameters.imageFit), opacity: numberParam(parameters.imageOpacity, 1) }}
        />
      ) : null}
      {videoEnabled && item.message.media?.videoUrl ? (
        <video
          className="simple-media-video"
          src={item.message.media.videoUrl}
          autoPlay
          playsInline
          loop={booleanParam(parameters.videoLoop, false)}
          muted={booleanParam(parameters.videoMuted, false)}
          style={{ objectFit: fitParam(parameters.videoFit) }}
        />
      ) : null}
      {audioEnabled && item.message.media?.audioUrl ? (
        <audio
          src={item.message.media.audioUrl}
          autoPlay
          style={{ display: "none" }}
        />
      ) : null}
      {textEnabled ? (
        <div
          className="simple-media-text"
          style={{
            color: stringParam(parameters.textColor, "#ffffff"),
            fontFamily: comboFontFamily(stringParam(parameters.fontFamily, "system-ui, sans-serif")),
            fontSize: `${numberParam(parameters.fontSize, 48)}px`,
            fontWeight: numberParam(parameters.fontWeight, 800)
          }}
        >
          {stringParam(parameters.fixedText, "New Effect")}
        </div>
      ) : null}
    </div>
  );
}

function GiftComboTextObject({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  const [displayedCombo, setDisplayedCombo] = React.useState(0);
  const [clockNow, setClockNow] = React.useState(Date.now());
  const displayedRef = React.useRef(0);
  const accumulatorRef = React.useRef(0);
  const lastFrameRef = React.useRef(Date.now());
  const comboTextRef = React.useRef<HTMLSpanElement | null>(null);
  const targetCombo = Math.max(0, Math.round(numberParam(object.metadata?.targetCombo, 0)));
  const status = stringParam(object.metadata?.status, "counting");
  const finishAt = numberParam(object.metadata?.finishAt, Number.MAX_SAFE_INTEGER);
  const finishDurationMs = numberParam(object.metadata?.finishDurationMs, 520);
  const acceptanceDeadlineAt = numberParam(object.metadata?.acceptanceDeadlineAt, Number.MAX_SAFE_INTEGER);
  const blinkWarningMs = numberParam(object.metadata?.blinkWarningMs, 900);
  const fontFamily = stringParam(object.metadata?.fontFamily, "Impact");
  const fontUrl = stringParam(object.metadata?.fontUrl, "");

  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = Date.now();
      const dt = Math.max(0, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const current = displayedRef.current;
      if (current < targetCombo) {
        const speed = comboAddsPerSecond(object, current, targetCombo);
        accumulatorRef.current += speed * dt;
        const frameStep = accumulatorRef.current >= 1 ? 1 : 0;
        if (frameStep > 0) {
          accumulatorRef.current -= frameStep;
          const next = Math.min(targetCombo, current + frameStep);
          displayedRef.current = next;
          setDisplayedCombo(next);
          comboTextRef.current?.animate(
            [
              { opacity: 0.85, transform: "translateY(22px) scale(0.72)" },
              { opacity: 1, transform: "translateY(-5px) scale(1.16)", offset: 0.58 },
              { opacity: 1, transform: "translateY(0) scale(1)" }
            ],
            { duration: 220, easing: "cubic-bezier(0.15, 1.35, 0.28, 1)" }
          );
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [object, targetCombo]);

  React.useEffect(() => {
    if (fontUrl) registerFontFace(fontFamily, fontUrl);
  }, [fontFamily, fontUrl]);

  React.useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  const text = stringParam(object.metadata?.displayLanguage, "english") === "japanese" ? `${displayedCombo}コンボ` : `${displayedCombo} combo`;
  const exiting = status === "finishing" || clockNow >= finishAt;
  const warning = !exiting && blinkWarningMs > 0 && acceptanceDeadlineAt - clockNow <= blinkWarningMs;

  return (
    <div
      className={`gift-combo-text-object ${exiting ? "finishing" : ""} ${warning ? "deadline-warning" : ""}`}
      style={{
        left: `${numberParam(object.metadata?.xPercent, 0) + 50}%`,
        top: `${numberParam(object.metadata?.yPercent, 0) + 50}%`,
        opacity: numberParam(object.metadata?.opacity, 1),
        zIndex: numberParam(object.metadata?.zIndex, 20),
        "--combo-opacity": String(numberParam(object.metadata?.opacity, 1)),
        "--combo-scale": String(object.spawn.scale ?? 1),
        "--combo-font-family": comboFontFamily(fontFamily),
        "--combo-font-size": `${numberParam(object.metadata?.fontSizePx, 96)}px`,
        "--combo-font-weight": String(numberParam(object.metadata?.fontWeight, 900)),
        "--combo-letter-spacing": `${numberParam(object.metadata?.letterSpacingPx, 0)}px`,
        "--combo-solid-color": stringParam(object.metadata?.solidColor, "#ffffff"),
        "--combo-cyan": stringParam(object.metadata?.cyan, "#00E5FF"),
        "--combo-magenta": stringParam(object.metadata?.magenta, "#FF2BD6"),
        "--combo-yellow": stringParam(object.metadata?.yellow, "#FFE600"),
        "--combo-white": stringParam(object.metadata?.rainbowWhite, "#FFFFFF"),
        "--combo-green": stringParam(object.metadata?.rainbowGreen, "#7CFF4F"),
        "--combo-rainbow-ms": `${numberParam(object.metadata?.rainbowDurationMs, 2000)}ms`,
        "--combo-stroke-color": colorWithOpacity(stringParam(object.metadata?.strokeColor, "#000000"), numberParam(object.metadata?.strokeOpacity, 1)),
        "--combo-stroke-width": `${booleanParam(object.metadata?.strokeEnabled, true) ? numberParam(object.metadata?.strokeWidthPx, 6) : 0}px`,
        "--combo-appear-ms": `${numberParam(object.metadata?.appearDurationMs, 260)}ms`,
        "--combo-finish-ms": `${finishDurationMs}ms`
      } as React.CSSProperties}
    >
      <span ref={comboTextRef} className={stringParam(object.metadata?.colorMode, "solid") === "cmy-rainbow-loop" ? "rainbow" : ""}>
        {text}
      </span>
    </div>
  );
}

function comboAddsPerSecond(object: RuntimeEffectObject, displayedCombo: number, targetCombo: number): number {
  if (stringParam(object.metadata?.countSpeedMode, "accelerating") === "constant") {
    return Math.max(1, numberParam(object.metadata?.constantAddsPerSecond, 20));
  }
  const base = Math.max(1, numberParam(object.metadata?.acceleratingBaseAddsPerSecond, 16));
  const max = Math.max(base, numberParam(object.metadata?.acceleratingMaxAddsPerSecond, 420));
  const strength = Math.max(0.0001, numberParam(object.metadata?.accelerationStrength, 0.01));
  const normalized = 1 - Math.exp(-strength * Math.max(displayedCombo, targetCombo));
  return base + (max - base) * normalized;
}

function comboFontFamily(family: string): string {
  const families = family
    .split(",")
    .map((item) => item.replace(/"/gu, "").trim())
    .filter(Boolean);
  const quotedFamilies = (families.length ? families : ["Impact"]).map((item) => genericFontFamilies.has(item.toLowerCase()) ? item : `"${item}"`);
  return [...quotedFamilies, "\"Noto Sans JP\"", "\"Yu Gothic\"", "\"Meiryo\"", "sans-serif"].join(", ");
}

const genericFontFamilies = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

const registeredFontFaces = new Set<string>();

function useUploadedFonts(): void {
  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/system/fonts")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { fonts?: OverlayFontInfo[] } | null) => {
        if (cancelled || !Array.isArray(data?.fonts)) return;
        for (const font of data.fonts) {
          if (font.source === "asset" && font.contentUrl) {
            registerFontFace(font.family, font.contentUrl);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
}

function registerFontFace(family: string, url: string): void {
  const normalizedFamily = family.trim();
  if (!normalizedFamily || !url) return;
  const key = `${normalizedFamily}\n${url}`;
  if (registeredFontFaces.has(key)) return;
  registeredFontFaces.add(key);
  const style = document.createElement("style");
  style.dataset.uploadedFont = normalizedFamily;
  style.textContent = `@font-face{font-family:"${cssString(normalizedFamily)}";src:url("${cssUrl(url)}");font-display:swap;}`;
  document.head.appendChild(style);
}

function cssString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function cssUrl(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\)/gu, "\\)");
}

function RuntimeObjectView({ object }: { object: RuntimeEffectObject }): React.ReactElement {
  return (
    <div
      className="runtime-object"
      style={{
        left: `${object.spawn.normalizedX * 100}%`,
        top: `${object.spawn.normalizedY * 100}%`,
        "--object-rotate": `${object.spawn.rotation ?? 0}deg`,
        "--object-scale": `${object.spawn.scale ?? 1}`
      } as React.CSSProperties}
      data-runtime-state={object.state}
    >
      <span>
        {object.hitPoints ?? "-"} / {object.maxHitPoints ?? "-"}
      </span>
    </div>
  );
}
function upsertObject(snapshot: RuntimeOverlaySnapshot | null, object: RuntimeEffectObject): RuntimeOverlaySnapshot {
  const base = snapshot ?? { overlayId: object.overlayId, objects: [], generatedAt: new Date().toISOString() };
  const existingIndex = base.objects.findIndex((item) => item.objectId === object.objectId);
  if (existingIndex === -1) return { ...base, objects: [object, ...base.objects] };
  return {
    ...base,
    objects: base.objects.map((item) => (item.objectId === object.objectId ? object : item))
  };
}

function removeObject(snapshot: RuntimeOverlaySnapshot | null, objectId: string): RuntimeOverlaySnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, objects: snapshot.objects.filter((object) => object.objectId !== objectId) };
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

function fitParam(value: unknown): React.CSSProperties["objectFit"] {
  if (value === "cover" || value === "fill" || value === "none") return value;
  return "contain";
}

function colorWithOpacity(color: string, opacity: number): string {
  const normalized = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(0, 0, 0, ${Math.max(0, Math.min(1, opacity))})`;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, opacity))})`;
}

createRoot(document.getElementById("root")!).render(<App />);
