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
}
interface Batch {
  count: number;
  imageUrl: string;
  size: number;
  opacity: number;
}

export class GiftPileEngine {
  bodies: PileBody[] = [];
  private batches: Batch[] = [];
  private sequence = 0;
  private spawnBudget = 0;
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
      size: clamp(size, 16, 160),
      opacity: clamp(opacity, 0, 1)
    });
    this.trim();
  }

  clear(): void {
    this.bodies = [];
    this.batches = [];
    this.spawnBudget = 0;
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
        opacity: batch.opacity
      });
      this.spawnBudget -= 1;
      if (--batch.count <= 0) this.batches.shift();
      this.trim(width, height);
    }
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let step = 0; step < steps; step++) this.simulate(dt / steps, width, height, now);
  }

  private trim(width?: number, height?: number): void {
    let capacity = this.maxObjects;
    if (width && height && this.bodies.length) {
      const diameter = Math.max(...this.bodies.map((body) => body.radius * 2));
      const screenCapacity = Math.max(
        1,
        Math.floor(width / diameter) * Math.floor(height / (diameter * 0.9))
      );
      capacity = Math.min(capacity, screenCapacity);
    }
    if (this.bodies.length > capacity) this.bodies.splice(0, this.bodies.length - capacity);
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
            for (const other of grid.get(`${cx + dx}:${cy + dy}`) ?? []) collide(body, other);
          }
        const key = `${cx}:${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(body);
        else grid.set(key, [body]);
        if (body.x < body.radius) {
          body.x = body.radius;
          body.vx = Math.abs(body.vx) * 0.18;
        }
        if (body.x > width - body.radius) {
          body.x = width - body.radius;
          body.vx = -Math.abs(body.vx) * 0.18;
        }
        if (body.y > height - body.radius) {
          body.y = height - body.radius;
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
  const minimum = a.radius + b.radius;
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
  if (velocity >= 0) return;
  const impulse = -velocity * (Math.abs(velocity) > 55 ? 0.59 : 0.5);
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
