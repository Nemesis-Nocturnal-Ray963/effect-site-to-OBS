export interface TetheredGiftBody {
  id: number;
  anchorX: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
  spin: number;
  ropeLength: number;
  retractAt: number;
  retractSpeed: number;
  imageUrl: string;
  opacity: number;
}

interface TetheredGiftBatch {
  count: number;
  imageUrl: string;
  size: number;
  ropeLength: number;
  displayDurationMs: number;
  opacity: number;
}

export class TetheredGiftEngine {
  bodies: TetheredGiftBody[] = [];
  private batches: TetheredGiftBatch[] = [];
  private sequence = 0;
  private spawnBudget = 0;

  constructor(private readonly random: () => number = Math.random) {}

  add(
    count: number,
    imageUrl: string,
    size: number,
    ropeLength: number,
    displayDurationMs: number,
    opacity = 1
  ): void {
    if (!Number.isFinite(count) || count < 1) return;
    this.batches.push({
      count: Math.min(1000, Math.floor(count)),
      imageUrl,
      size: clamp(size, 24, 320),
      ropeLength: clamp(ropeLength, 80, 1800),
      displayDurationMs: clamp(displayDurationMs, 500, 600_000),
      opacity: clamp(opacity, 0, 1)
    });
  }

  clear(): void {
    this.bodies = [];
    this.batches = [];
    this.spawnBudget = 0;
  }

  step(dt: number, width: number, height: number, now: number): void {
    dt = clamp(dt, 0, 1 / 30);
    this.spawnBudget = Math.min(4, this.spawnBudget + dt * 24);
    while (this.batches.length && this.spawnBudget >= 1) {
      const batch = this.batches[0]!;
      const radius = batch.size / 2;
      const anchorX = radius + this.random() * Math.max(0, width - radius * 2);
      this.bodies.push({
        id: ++this.sequence,
        anchorX,
        x: anchorX,
        y: -radius,
        vx: (this.random() - 0.5) * 150,
        vy: 30 + this.random() * 70,
        radius,
        angle: (this.random() - 0.5) * 0.3,
        spin: (this.random() - 0.5) * 1.4,
        ropeLength: batch.ropeLength,
        retractAt: now + batch.displayDurationMs,
        retractSpeed: Math.max(500, batch.ropeLength / 0.75),
        imageUrl: batch.imageUrl,
        opacity: batch.opacity
      });
      this.spawnBudget -= 1;
      batch.count -= 1;
      if (batch.count <= 0) this.batches.shift();
    }

    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let index = 0; index < steps; index += 1) {
      this.simulate(dt / steps, width, height, now);
    }
    this.bodies = this.bodies.filter((body) => body.ropeLength > -body.radius * 2.5);
    if (this.bodies.length > 400) this.bodies.splice(0, this.bodies.length - 400);
  }

  private simulate(dt: number, width: number, height: number, now: number): void {
    for (const body of this.bodies) {
      if (now >= body.retractAt) body.ropeLength -= body.retractSpeed * dt;
      body.vy += 1100 * dt;
      body.vx *= Math.exp(-0.35 * dt);
      body.vy *= Math.exp(-0.08 * dt);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.spin * dt;
      body.spin *= Math.exp(-0.5 * dt);
      constrainToRope(body);
      if (body.x < body.radius) {
        body.x = body.radius;
        body.vx = Math.abs(body.vx) * 0.45;
      } else if (body.x > width - body.radius) {
        body.x = width - body.radius;
        body.vx = -Math.abs(body.vx) * 0.45;
      }
      if (body.y > height + body.radius) {
        body.y = height + body.radius;
        body.vy = Math.min(0, body.vy);
      }
    }

    const cellSize = Math.max(32, ...this.bodies.map((body) => body.radius * 2));
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const grid = new Map<string, TetheredGiftBody[]>();
      for (const body of this.bodies) {
        const cellX = Math.floor(body.x / cellSize);
        const cellY = Math.floor(body.y / cellSize);
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (const other of grid.get(`${cellX + dx}:${cellY + dy}`) ?? []) collide(body, other);
          }
        }
        const key = `${cellX}:${cellY}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(body);
        else grid.set(key, [body]);
        constrainToRope(body);
      }
    }
  }
}

function constrainToRope(body: TetheredGiftBody): void {
  const attachmentY = -12;
  const dx = body.x - body.anchorX;
  const dy = body.y - attachmentY;
  const allowed = Math.max(0, body.ropeLength);
  const distance = Math.hypot(dx, dy);
  if (distance <= allowed || distance < 0.0001) return;
  const nx = dx / distance;
  const ny = dy / distance;
  body.x = body.anchorX + nx * allowed;
  body.y = attachmentY + ny * allowed;
  const outwardVelocity = body.vx * nx + body.vy * ny;
  if (outwardVelocity > 0) {
    body.vx -= outwardVelocity * nx;
    body.vy -= outwardVelocity * ny;
  }
  body.vx *= 0.995;
  body.vy *= 0.995;
}

function collide(a: TetheredGiftBody, b: TetheredGiftBody): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minimum = a.radius + b.radius;
  if (Math.abs(dx) >= minimum || Math.abs(dy) >= minimum) return;
  const distance = Math.hypot(dx, dy);
  if (distance >= minimum) return;
  const nx = distance > 0.0001 ? dx / distance : 1;
  const ny = distance > 0.0001 ? dy / distance : 0;
  const correction = (minimum - distance) * 0.5;
  a.x -= nx * correction;
  a.y -= ny * correction;
  b.x += nx * correction;
  b.y += ny * correction;
  const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relativeVelocity < 0) {
    const impulse = -relativeVelocity * 0.72;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
    a.spin -= impulse * ny * 0.002;
    b.spin += impulse * ny * 0.002;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
