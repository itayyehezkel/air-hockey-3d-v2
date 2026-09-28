/**
 * 2D air-hockey physics on the XZ plane.
 * Side -1 is the bottom (player) half, side +1 is the top (opponent) half.
 *
 * The simulation runs at a fixed rate (STEP) regardless of the display's frame rate, so the puck
 * behaves identically at 30, 60 or 120 fps. Renderers draw an interpolation between the last two
 * steps (see `alpha` and the `prev*` fields) so motion stays smooth between physics ticks.
 * The per-step code allocates nothing, to keep the garbage collector (and its hitches) quiet.
 */

export const TABLE = {
  width: 6,
  length: 10.5,
  goalWidth: 2.4,
  puckRadius: 0.45,
  paddleRadius: 0.65,
} as const;

export const HALF_W = TABLE.width / 2;
export const HALF_L = TABLE.length / 2;
export const GOAL_HALF = TABLE.goalWidth / 2;
/** Radius of the rounded table corners. Square corners trap the puck where no mallet can reach behind it. */
export const CORNER_R = 0.95;

/** Fixed physics tick: 240 Hz. Fast enough that nothing tunnels (the puck moves ≤ 0.1 per tick). */
const STEP = 1 / 240;
/** Longest frame we simulate in one go; longer stalls (app switch, GC) are dropped, not replayed. */
const MAX_FRAME = 0.1;
const PADDLE_RESTITUTION = 0.9;
const WALL_RESTITUTION = 0.86;
const FRICTION = 0.22; // exponential damping per second (air cushion is almost frictionless)
const MAX_PUCK_SPEED = 24;
/**
 * How quickly a finger-driven mallet catches up with the finger (1/s). Touch events arrive out of
 * step with physics ticks; following exponentially turns their jumps into a continuous velocity,
 * so hit strength matches the swipe instead of spiking. At 55/s the lag is ~18 ms.
 */
const FOLLOW_RATE = 55;

const FRICTION_PER_STEP = Math.exp(-FRICTION * STEP);
const FOLLOW_PER_STEP = 1 - Math.exp(-FOLLOW_RATE * STEP);

export type Side = -1 | 1;

export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

export interface Paddle extends Body {
  side: Side;
  targetX: number;
  targetZ: number;
  maxSpeed: number;
  /** Max acceleration (units/s²). Infinity = follow the target directly (the player's finger). */
  maxAccel: number;
  /** Fastest the puck can leave this mallet (lets an easy opponent hit softer). */
  maxShot: number;
  /** Position at the previous physics tick, for render interpolation. */
  prevX: number;
  prevZ: number;
}

export type HitEvent =
  | { kind: 'paddle'; side: Side; x: number; z: number; strength: number }
  | { kind: 'wall'; x: number; z: number; strength: number };

interface Point {
  x: number;
  z: number;
}

// Scratch objects reused by the hot path (no per-tick allocations).
const tmp: Point = { x: 0, z: 0 };

export class World {
  readonly puck: Body = { x: 0, z: 0, vx: 0, vz: 0, r: TABLE.puckRadius };
  /** Puck position at the previous physics tick, for render interpolation. */
  prevPuckX = 0;
  prevPuckZ = 0;
  readonly paddles: [Paddle, Paddle];
  /** When false the puck is frozen and ignored (countdown / after a goal). */
  puckActive = false;
  readonly events: HitEvent[] = [];
  /** How far (0–1) the display is between the previous and the current physics tick. */
  alpha = 1;
  private accumulator = 0;

  constructor() {
    this.paddles = [makePaddle(-1), makePaddle(1)];
  }

  paddle(side: Side): Paddle {
    return side === -1 ? this.paddles[0] : this.paddles[1];
  }

  resetPaddles(): void {
    for (const p of this.paddles) {
      p.x = 0;
      p.z = p.side * (HALF_L - 1.1);
      p.vx = p.vz = 0;
      p.targetX = p.x;
      p.targetZ = p.z;
    }
    this.snap();
  }

  /** Place the puck at rest on the given side (the side that conceded serves). */
  servePuck(side: Side | 0): void {
    this.puck.x = 0;
    this.puck.z = side * 1.6;
    this.puck.vx = this.puck.vz = 0;
    this.puckActive = true;
    this.snap();
  }

  puckSpeed(): number {
    return Math.hypot(this.puck.vx, this.puck.vz);
  }

  /** Render-interpolated puck position. */
  puckRenderX(): number {
    return this.prevPuckX + (this.puck.x - this.prevPuckX) * this.alpha;
  }

  puckRenderZ(): number {
    return this.prevPuckZ + (this.puck.z - this.prevPuckZ) * this.alpha;
  }

  /**
   * Advances the simulation by a frame's worth of time, in fixed ticks. Returns the side that
   * scored (the side whose paddle defends the *other* goal), or null.
   */
  step(frameDt: number): Side | null {
    if (!(frameDt > 0)) return null;
    this.accumulator += Math.min(frameDt, MAX_FRAME);
    let scored: Side | null = null;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.savePrev();
      // After a goal the puck is left alone for the rest of the frame (the game takes over).
      const s = this.tick(scored === null && this.puckActive);
      if (scored === null) scored = s;
    }
    this.alpha = this.accumulator / STEP;
    return scored;
  }

  /** Makes the interpolation start from the current state (after a teleport). */
  private snap(): void {
    this.savePrev();
    this.alpha = 1;
  }

  private savePrev(): void {
    this.prevPuckX = this.puck.x;
    this.prevPuckZ = this.puck.z;
    for (const p of this.paddles) {
      p.prevX = p.x;
      p.prevZ = p.z;
    }
  }

  private tick(simulatePuck: boolean): Side | null {
    const [a, b] = this.paddles;
    const ax = a.x, az = a.z, bx = b.x, bz = b.z;
    this.movePaddle(a);
    this.movePaddle(b);

    let scored: Side | null = null;
    if (simulatePuck) {
      const puck = this.puck;
      puck.x += puck.vx * STEP;
      puck.z += puck.vz * STEP;
      this.collidePaddle(a);
      this.collidePaddle(b);
      this.collideWalls();
      // If a wall pushed the puck back into a mallet, the puck is pinned: stop the mallet at its
      // surface instead of letting the two overlap and jitter against each other.
      this.separatePinned(a);
      this.separatePinned(b);
      scored = this.checkGoal();
      puck.vx *= FRICTION_PER_STEP;
      puck.vz *= FRICTION_PER_STEP;
    }

    // Report the motion that actually happened (a pinned mallet stopped short).
    a.vx = (a.x - ax) / STEP;
    a.vz = (a.z - az) / STEP;
    b.vx = (b.x - bx) / STEP;
    b.vz = (b.z - bz) / STEP;
    return scored;
  }

  /** One tick of mallet motion toward its target; sets the velocity the puck collision uses. */
  private movePaddle(p: Paddle): void {
    const x0 = p.x;
    const z0 = p.z;
    stepToward(p, tmp);
    clampToHalfInto(p, tmp.x, tmp.z, tmp);
    p.x = tmp.x;
    p.z = tmp.z;
    p.vx = (p.x - x0) / STEP;
    p.vz = (p.z - z0) / STEP;
  }

  private collidePaddle(p: Paddle): void {
    const puck = this.puck;
    const dx = puck.x - p.x;
    const dz = puck.z - p.z;
    const minD = puck.r + p.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD) return;

    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 0;
    const nz = d > 1e-6 ? dz / d : -p.side;

    // Push the puck out of the paddle.
    puck.x = p.x + nx * minD;
    puck.z = p.z + nz * minD;

    // Paddle is effectively infinite mass: reflect relative velocity along the normal.
    const vn = (puck.vx - p.vx) * nx + (puck.vz - p.vz) * nz;
    if (vn < 0) {
      puck.vx -= (1 + PADDLE_RESTITUTION) * vn * nx;
      puck.vz -= (1 + PADDLE_RESTITUTION) * vn * nz;
      this.clampSpeed(Math.min(p.maxShot, MAX_PUCK_SPEED));
      if (-vn > 0.4) {
        this.events.push({ kind: 'paddle', side: p.side, x: p.x + nx * p.r, z: p.z + nz * p.r, strength: -vn });
      }
    }
  }

  /** Moves a mallet out of a puck it overlaps. */
  private separatePinned(p: Paddle): void {
    const puck = this.puck;
    const dx = puck.x - p.x;
    const dz = puck.z - p.z;
    const minD = puck.r + p.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= (minD - 0.005) * (minD - 0.005)) return;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 0;
    const nz = d > 1e-6 ? dz / d : -p.side;
    clampToHalfInto(p, puck.x - nx * minD, puck.z - nz * minD, tmp);
    p.x = tmp.x;
    p.z = tmp.z;
  }

  private collideWalls(): void {
    const puck = this.puck;
    const r = puck.r;

    // Side rails.
    if (puck.x < -HALF_W + r) {
      puck.x = -HALF_W + r;
      if (puck.vx < 0) this.bounce(true, -HALF_W, puck.z);
    } else if (puck.x > HALF_W - r) {
      puck.x = HALF_W - r;
      if (puck.vx > 0) this.bounce(true, HALF_W, puck.z);
    }

    // End rails (everywhere except the goal mouth).
    this.collideEnd(-1);
    this.collideEnd(1);

    // Rounded corners: keep the puck inside a circle of radius CORNER_R at each corner.
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const cx = sx * (HALF_W - CORNER_R);
        const cz = sz * (HALF_L - CORNER_R);
        const ox = puck.x - cx;
        const oz = puck.z - cz;
        if (ox * sx <= 0 || oz * sz <= 0) continue;
        const d = Math.hypot(ox, oz);
        const lim = CORNER_R - r;
        if (d <= lim) continue;
        const nx = ox / d;
        const nz = oz / d;
        puck.x = cx + nx * lim;
        puck.z = cz + nz * lim;
        const vn = puck.vx * nx + puck.vz * nz;
        if (vn > 0) {
          puck.vx -= (1 + WALL_RESTITUTION) * vn * nx;
          puck.vz -= (1 + WALL_RESTITUTION) * vn * nz;
          if (vn > 0.8) this.events.push({ kind: 'wall', x: cx + nx * CORNER_R, z: cz + nz * CORNER_R, strength: vn });
        }
      }
    }
  }

  private collideEnd(end: -1 | 1): void {
    const puck = this.puck;
    const r = puck.r;
    const wallZ = end * HALF_L;
    const inside = end * puck.z; // distance "toward" this end
    if (Math.abs(puck.x) >= GOAL_HALF) {
      if (inside > HALF_L - r) {
        puck.z = end * (HALF_L - r);
        if (end * puck.vz > 0) this.bounce(false, puck.x, wallZ);
      }
      return;
    }
    // Goal posts are points at (±GOAL_HALF, wallZ).
    this.collidePoint(-GOAL_HALF, wallZ);
    this.collidePoint(GOAL_HALF, wallZ);
    // Inside the goal channel: keep the puck between the posts.
    if (inside > HALF_L) {
      const lim = GOAL_HALF - r;
      if (puck.x < -lim) {
        puck.x = -lim;
        if (puck.vx < 0) puck.vx = -puck.vx * WALL_RESTITUTION;
      } else if (puck.x > lim) {
        puck.x = lim;
        if (puck.vx > 0) puck.vx = -puck.vx * WALL_RESTITUTION;
      }
    }
  }

  private collidePoint(px: number, pz: number): void {
    const puck = this.puck;
    const dx = puck.x - px;
    const dz = puck.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= puck.r * puck.r || d2 < 1e-9) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    puck.x = px + nx * puck.r;
    puck.z = pz + nz * puck.r;
    const vn = puck.vx * nx + puck.vz * nz;
    if (vn < 0) {
      puck.vx -= (1 + WALL_RESTITUTION) * vn * nx;
      puck.vz -= (1 + WALL_RESTITUTION) * vn * nz;
      if (-vn > 0.8) this.events.push({ kind: 'wall', x: px, z: pz, strength: -vn });
    }
  }

  private bounce(alongX: boolean, x: number, z: number): void {
    const puck = this.puck;
    const v = alongX ? puck.vx : puck.vz;
    if (alongX) puck.vx = -v * WALL_RESTITUTION;
    else puck.vz = -v * WALL_RESTITUTION;
    if (Math.abs(v) > 0.8) this.events.push({ kind: 'wall', x, z, strength: Math.abs(v) });
  }

  private checkGoal(): Side | null {
    const z = this.puck.z;
    const past = HALF_L + this.puck.r * 1.1;
    if (z > past) return -1; // puck in the top goal → bottom side scores
    if (z < -past) return 1;
    return null;
  }

  private clampSpeed(limit: number): void {
    const s = this.puckSpeed();
    if (s > limit) {
      const k = limit / s;
      this.puck.vx *= k;
      this.puck.vz *= k;
    }
  }
}

function makePaddle(side: Side): Paddle {
  const z = side * (HALF_L - 1.1);
  return { x: 0, z, vx: 0, vz: 0, r: TABLE.paddleRadius, side, targetX: 0, targetZ: z, maxSpeed: 30, maxAccel: Infinity, maxShot: MAX_PUCK_SPEED, prevX: 0, prevZ: z };
}

/** Where the mallet wants to be after one tick; written into `out`. */
function stepToward(p: Paddle, out: Point): void {
  const dx = p.targetX - p.x;
  const dz = p.targetZ - p.z;

  if (!Number.isFinite(p.maxAccel)) {
    // Finger-driven: exponential follow, capped at the mallet's top speed.
    let sx = dx * FOLLOW_PER_STEP;
    let sz = dz * FOLLOW_PER_STEP;
    const step = Math.hypot(sx, sz);
    const maxStep = p.maxSpeed * STEP;
    if (step > maxStep) {
      sx *= maxStep / step;
      sz *= maxStep / step;
    }
    out.x = p.x + sx;
    out.z = p.z + sz;
    return;
  }

  // Steering with limited acceleration: speed up smoothly, and brake so we arrive without overshooting.
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01 && Math.hypot(p.vx, p.vz) < 0.3) {
    out.x = p.targetX;
    out.z = p.targetZ;
    return;
  }
  const arrive = Math.min(p.maxSpeed, Math.sqrt(2 * p.maxAccel * dist) * 0.85);
  const wantX = dist > 1e-6 ? (dx / dist) * arrive : 0;
  const wantZ = dist > 1e-6 ? (dz / dist) * arrive : 0;
  let ax = wantX - p.vx;
  let az = wantZ - p.vz;
  const a = Math.hypot(ax, az);
  const maxDv = p.maxAccel * STEP;
  if (a > maxDv) {
    ax *= maxDv / a;
    az *= maxDv / a;
  }
  out.x = p.x + (p.vx + ax) * STEP;
  out.z = p.z + (p.vz + az) * STEP;
}

/** Keeps a point inside the paddle's own half of the table. */
export function clampToHalf(p: { r: number; side: Side }, pos: { x: number; z: number }): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  clampToHalfInto(p, pos.x, pos.z, out);
  return out;
}

/** Allocation-free clampToHalf for the physics hot path. */
function clampToHalfInto(p: { r: number; side: Side }, px: number, pz: number, out: Point): void {
  const x = clamp(px, -HALF_W + p.r, HALF_W - p.r);
  const zNear = p.r * 0.35; // may reach slightly past its own edge of the center line
  const zFar = HALF_L - p.r;
  let z = p.side === -1 ? clamp(pz, -zFar, -zNear) : clamp(pz, zNear, zFar);
  let cx = x;
  // Respect the rounded corners at this half's back wall.
  const sgn = x < 0 ? -1 : 1;
  const ccx = sgn * (HALF_W - CORNER_R);
  const ccz = p.side * (HALF_L - CORNER_R);
  const ox = x - ccx;
  const oz = z - ccz;
  if (ox * sgn > 0 && oz * p.side > 0) {
    const d = Math.hypot(ox, oz);
    const lim = CORNER_R - p.r;
    if (d > lim) {
      cx = ccx + (ox / d) * lim;
      z = ccz + (oz / d) * lim;
    }
  }
  out.x = cx;
  out.z = z;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
