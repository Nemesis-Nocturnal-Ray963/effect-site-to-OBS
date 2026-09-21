export const GIFT_LIFETIME_MS = 15 * 60 * 1000;
export const GIFT_FADE_MS = 1200;

export interface PileBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  spin: number;
  imageUrl: string;
  expiresAt: number;
  opacity: number;
  collisionProfile: readonly number[];
}
interface Batch {
  count: number;
  imageUrl: string;
  size: number;
  opacity: number;
}

const COLLISION_PROFILE_STEPS = 64;
const FULL_COLLISION_PROFILE = Array.from({ length: COLLISION_PROFILE_STEPS }, () => 1);

export class GiftPileEngine {
  bodies: PileBody[] = [];
  private batches: Batch[] = [];
  private sequence = 0;
  private spawnBudget = 0;
  private readonly collisionProfiles = new Map<string, readonly number[]>();
  maxObjects = 1000;
  constructor(private readonly random: () => number = Math.random) {}

  add(
    count: number,
    imageUrl: string,
    size: number,
    maxObjects: number,
    now: number,
    opacity = 1
  ): void {
    if (!Number.isFinite(count) || count < 1) return;
    this.maxObjects = Math.round(clamp(maxObjects, 1, 2000));
    this.bodies = this.bodies.filter((body) => body.expiresAt > now);
    for (const body of this.bodies) {
      if (body.expiresAt - now <= GIFT_LIFETIME_MS) body.expiresAt += GIFT_LIFETIME_MS;
    }
    this.batches.push({
      count: Math.floor(count),
      imageUrl,
      size: minimum(size, 16),
      opacity: clamp(opacity, 0, 1)
    });
    this.trim();
  }

  clear(): void {
    this.bodies = [];
    this.batches = [];
    this.spawnBudget = 0;
  }

  setImageCollisionProfile(imageUrl: string, profile: readonly number[]): void {
    if (profile.length !== COLLISION_PROFILE_STEPS) return;
    const normalized = profile.map((value) => clamp(value, 0.08, 1));
    this.collisionProfiles.set(imageUrl, normalized);
    for (const body of this.bodies)
      if (body.imageUrl === imageUrl) body.collisionProfile = normalized;
  }
  get pendingCount(): number {
    return this.batches.reduce((sum, batch) => sum + batch.count, 0);
  }

  step(dt: number, width: number, height: number, now: number): void {
    dt = clamp(dt, 0, 1 / 30);
    this.bodies = this.bodies.filter((body) => body.expiresAt + GIFT_FADE_MS > now);
    this.spawnBudget = Math.min(4, this.spawnBudget + dt * 60);
    while (this.batches.length && this.spawnBudget >= 1) {
      const batch = this.batches[0]!;
      const radius = Math.min(batch.size / 2, width / 2);
      this.bodies.push({
        id: ++this.sequence,
        x: radius + this.random() * Math.max(0, width - radius * 2),
        y: -radius,
        vx: (this.random() - 0.5) * 100,
        vy: 40,
        radius,
        angle: this.random() * Math.PI * 2,
        spin: (this.random() - 0.5) * 2,
        imageUrl: batch.imageUrl,
        expiresAt: now + GIFT_LIFETIME_MS,
        opacity: batch.opacity,
        collisionProfile: this.collisionProfiles.get(batch.imageUrl) ?? FULL_COLLISION_PROFILE
      });
      this.spawnBudget -= 1;
      if (--batch.count <= 0) this.batches.shift();
      this.trim();
    }
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let step = 0; step < steps; step++) this.simulate(dt / steps, width, height, now);
  }

  private trim(): void {
    if (this.bodies.length > this.maxObjects)
      this.bodies.splice(0, this.bodies.length - this.maxObjects);
  }

  private simulate(dt: number, width: number, height: number, now: number): void {
    const active = this.bodies.filter((body) => body.expiresAt > now);
    const previous = active.map((body) => ({ x: body.x, y: body.y }));
    for (const body of active) {
      body.vy = Math.min(900, body.vy + 1000 * dt);
      body.vx *= Math.exp(-0.7 * dt);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.spin * dt;
      body.spin *= Math.exp(-0.6 * dt);
    }
    // Spatial buckets avoid comparing all 1,000 gifts with every other gift.
    const cell = Math.max(16, ...active.map((body) => body.radius * 2));
    for (let iteration = 0; iteration < 6; iteration++) {
      const grid = new Map<string, PileBody[]>();
      for (const body of active) {
        const cx = Math.floor(body.x / cell),
          cy = Math.floor(body.y / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            for (const other of grid.get(`${cx + dx}:${cy + dy}`) ?? [])
              collide(body, other);
          }
        const key = `${cx}:${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(body);
        else grid.set(key, [body]);
        const leftRadius = supportRadius(body, Math.PI);
        const rightRadius = supportRadius(body, 0);
        const floorRadius = supportRadius(body, Math.PI / 2);
        if (body.x < leftRadius) {
          body.x = leftRadius;
          body.vx = Math.abs(body.vx) * 0.18;
        }
        if (body.x > width - rightRadius) {
          body.x = width - rightRadius;
          body.vx = -Math.abs(body.vx) * 0.18;
        }
        if (body.y > height - floorRadius) {
          body.y = height - floorRadius;
          body.vy = body.vy > 55 ? -body.vy * 0.18 : Math.min(body.vy, 0);
          body.vx *= 0.88;
          body.spin = body.vx / body.radius;
        }
      }
    }
    // Contact corrections arrest falling velocity once a body is supported. Without
    // this, gravity keeps building pressure in deep piles even when positions settle.
    if (dt > 0)
      for (let index = 0; index < active.length; index++) {
        const body = active[index]!,
          before = previous[index]!;
        if (body.vy > 0) body.vy = Math.min(body.vy, Math.max(0, (body.y - before.y) / dt));
        if (Math.hypot(body.x - before.x, body.y - before.y) < 0.08) {
          body.vx *= 0.5;
          body.vy *= 0.5;
          body.spin *= 0.5;
        }
      }
  }
}

function collide(a: PileBody, b: PileBody): void {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const broadMinimum = a.radius + b.radius;
  if (Math.abs(dx) >= broadMinimum || Math.abs(dy) >= broadMinimum) return;
  const angle = Math.atan2(dy, dx);
  const minimum = supportRadius(a, angle) + supportRadius(b, angle + Math.PI);
  if (Math.abs(dx) >= minimum || Math.abs(dy) >= minimum) return;
  const distance = Math.hypot(dx, dy);
  if (distance >= minimum) return;
  const nx = distance > 0.0001 ? dx / distance : 1;
  const ny = distance > 0.0001 ? dy / distance : 0;
  const correction = Math.max(0, minimum - distance - 0.04) * 0.5;
  a.x -= nx * correction;
  a.y -= ny * correction;
  b.x += nx * correction;
  b.y += ny * correction;
  const velocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const impactImpulse = velocity < 0 ? -velocity * (Math.abs(velocity) > 55 ? 0.62 : 0.52) : 0;
  // A small overlap impulse lets gifts gently push one another aside instead of
  // behaving like a rigid stack. The cap prevents deep piles from becoming unstable.
  const separationImpulse = correction > 0.25 ? Math.min(6, correction * 0.35) : 0;
  const impulse = impactImpulse + separationImpulse;
  if (impulse <= 0) return;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
  const tangent = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
  const friction = clamp(tangent * 0.15, -impulse * 0.35, impulse * 0.35);
  a.vx -= ny * friction;
  a.vy += nx * friction;
  b.vx += ny * friction;
  b.vy -= nx * friction;
  a.spin *= 0.9;
  b.spin *= 0.9;
}

function supportRadius(
  body: PileBody,
  worldAngle: number
): number {
  const profile = body.collisionProfile;
  const turn = ((worldAngle - body.angle) / (Math.PI * 2) + 1) % 1;
  return body.radius * (profile[Math.round(turn * profile.length) % profile.length] ?? 1);
}

export function alphaCollisionProfile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): number[] {
  const profile = Array.from({ length: COLLISION_PROFILE_STEPS }, () => 0);
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return FULL_COLLISION_PROFILE.slice();
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const halfSize = Math.max(width, height) / 2;
  let opaque = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! < 24) continue;
      opaque = true;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.min(1, Math.hypot(dx, dy) / halfSize);
      const turn = ((Math.atan2(dy, dx) / (Math.PI * 2)) + 1) % 1;
      const index = Math.round(turn * COLLISION_PROFILE_STEPS) % COLLISION_PROFILE_STEPS;
      profile[index] = Math.max(profile[index]!, distance);
    }
  }
  if (!opaque) return FULL_COLLISION_PROFILE.slice();
  // Fill narrow angular gaps caused by sampling while preserving broad transparent areas.
  return profile.map((value, index) =>
    Math.max(
      value,
      profile[(index + profile.length - 1) % profile.length]! * 0.96,
      profile[(index + 1) % profile.length]! * 0.96,
      0.08
    )
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function minimum(value: number, min: number): number {
  return Math.max(min, Number.isFinite(value) ? value : min);
}
