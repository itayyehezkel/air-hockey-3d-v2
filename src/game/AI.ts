import { clamp, GOAL_HALF, HALF_L, HALF_W, TABLE, type Side, type World } from './Physics';

export interface AILevel {
  /** Max paddle speed (units/s). */
  speed: number;
  /** Max paddle acceleration (units/s²) – lower feels heavier and more human. */
  accel: number;
  /** Seconds between decisions (reaction time). */
  reaction: number;
  /** Aim error in units. */
  error: number;
  /** Fastest puck speed this opponent's hits can produce (the player's cap is 24). */
  shotSpeed?: number;
}

// Tuned in simulated matches against a human-like stand-in (see git history / session notes):
// the player should win most games but still have to work for it.
export const AI_NORMAL: AILevel = { speed: 5.5, accel: 20, reaction: 0.32, error: 1.2, shotSpeed: 7 };
export const AI_DEMO: AILevel = { speed: 8, accel: 42, reaction: 0.09, error: 0.5 };

type Mode = 'home' | 'defend' | 'intercept' | 'strike' | 'around' | 'dig';

const R = TABLE.paddleRadius;
const r = TABLE.puckRadius;
/** Center-to-center distance at which the paddle clears the puck sideways. */
const LATERAL = R + r + 0.25;
/** Furthest the paddle can back up toward its own goal. */
const REACH_Z = HALF_L - R;

/**
 * Rule-based opponent. All reasoning happens in "local" coordinates where the
 * AI's own goal is at +HALF_L and the opponent goal at -HALF_L.
 */
export class AIController {
  private timer = 0;
  private aimX = 0;
  private errX = 0;
  private errZ = 0;
  private mode: Mode = 'home';

  constructor(
    private readonly side: Side,
    private level: AILevel,
  ) {}

  setLevel(level: AILevel): void {
    this.level = level;
  }

  update(dt: number, world: World): void {
    const paddle = world.paddle(this.side);
    paddle.maxSpeed = this.level.speed;
    paddle.maxAccel = this.level.accel;
    paddle.maxShot = this.level.shotSpeed ?? Infinity;

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.level.reaction * (0.7 + Math.random() * 0.6);

    const s = this.side;
    const puck = world.puck;
    const px = puck.x;
    const pz = puck.z * s;
    const pvx = puck.vx;
    const pvz = puck.vz * s;
    const ax = paddle.x;
    const az = paddle.z * s;

    // Occasionally re-roll aim and error so the AI isn't perfectly predictable.
    if (Math.random() < 0.12) {
      // Sloppier levels aim wider, sometimes past the posts (a missed shot).
      this.aimX = (Math.random() * 2 - 1) * GOAL_HALF * (0.8 + this.level.error * 0.9);
      this.errX = (Math.random() * 2 - 1) * this.level.error;
      this.errZ = (Math.random() * 2 - 1) * this.level.error * 0.5;
    }

    this.mode = this.chooseMode(world.puckActive, pz, pvz, az);
    const homeZ = HALF_L - 0.9;
    let tx: number;
    let tz: number;
    let sloppy = false; // whether aim error applies (never while doing precise puck work)

    switch (this.mode) {
      case 'home':
        tx = 0;
        tz = homeZ;
        break;

      case 'defend':
        // Shadow the puck in front of the goal.
        tx = clamp(px * 0.45, -GOAL_HALF, GOAL_HALF);
        tz = homeZ;
        sloppy = true;
        break;

      case 'intercept':
        // Predict where the puck crosses the defensive line (unfolding wall bounces).
        tx = clamp(predictX(px, pz, pvx, pvz, homeZ - 0.4), -GOAL_HALF - 0.3, GOAL_HALF + 0.3);
        tz = homeZ - 0.4;
        sloppy = true;
        break;

      case 'strike': {
        // Paddle is between puck and own goal: drive through the puck toward the aim point.
        const dx = this.aimX - px;
        const dz = -HALF_L - pz;
        const len = Math.hypot(dx, dz) || 1;
        const reach = Math.hypot(pvx, pvz) < 3 ? 0.9 : 0.5;
        tx = px + (dx / len) * reach;
        tz = pz + (dz / len) * reach;
        break;
      }

      case 'around': {
        // Puck is behind the paddle: step sideways first, then back, so we never plow through it.
        const side = this.aroundSide(px, ax);
        const clearSideways = side * (ax - px) > LATERAL * 0.8;
        tx = px + side * LATERAL;
        tz = clearSideways ? Math.min(pz + 0.8, REACH_Z) : Math.min(az, pz) + 0.05;
        break;
      }

      case 'dig': {
        // Puck is against our back wall where we can't get behind it. Stand on the goal side of it,
        // level with it, then sweep outward: the side wall / rounded corner kicks it back into play.
        const side = Math.sign(px) || 1;
        const lined = side * (px - ax) > R * 1.1 && Math.abs(az - Math.min(pz, REACH_Z)) < 0.45;
        if (lined) {
          tx = px + side * 0.8;
          tz = pz - 0.45;
        } else {
          tx = px - side * LATERAL;
          tz = pz - 0.05;
        }
        break;
      }
    }

    const err = sloppy ? 0.9 : 0;
    paddle.targetX = tx + this.errX * err;
    paddle.targetZ = (tz + this.errZ * err) * s;
  }

  private chooseMode(active: boolean, pz: number, pvz: number, az: number): Mode {
    if (!active) return 'home';
    // A puck sitting on the center line is fair game for both sides.
    const onMySide = pz > -0.05;
    const incomingFast = pvz > 3.5;
    if (!onMySide) return incomingFast ? 'intercept' : 'defend';
    // Just hit it away from us: fall back instead of chasing it.
    if (pvz < -3) return 'defend';
    if (incomingFast && pz < az - 0.5) return 'intercept';
    // Against the back wall: nobody can get behind it.
    if (pz > REACH_Z - 0.3) return 'dig';

    // Hysteresis between strike and around keeps the paddle from flip-flopping at the boundary.
    const behind = az - pz;
    if (this.mode === 'strike') return behind > -0.05 ? 'strike' : 'around';
    return behind > 0.3 ? 'strike' : 'around';
  }

  private aroundSide(px: number, ax: number): number {
    // Near a side wall there is only room on the inside.
    if (Math.abs(px) > HALF_W - LATERAL - 0.1) return -Math.sign(px);
    return Math.sign(ax - px) || 1;
  }
}

function predictX(x: number, z: number, vx: number, vz: number, lineZ: number): number {
  if (vz <= 0.01) return x;
  const t = (lineZ - z) / vz;
  const w = HALF_W - 0.3;
  // Reflect across side walls by folding the unbounded coordinate into [-w, w].
  let u = x + vx * t + w;
  const period = 4 * w;
  u = ((u % period) + period) % period;
  return (u <= 2 * w ? u : period - u) - w;
}
