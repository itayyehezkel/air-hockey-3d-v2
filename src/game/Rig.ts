import { Color3, Color4, ParticleSystem, Scene, TransformNode, Vector3 } from '../babylon';
import { Effects, makeFlareTexture } from './Effects';
import { COLORS, createPaddle, createPuck, createTable, loadPaddleModel, loadPuckModel, loadTableModel, OPPONENT_MALLET, puckColor, type TableParts } from './Meshes';
import { equippedMallet, equippedPuck, equippedTable } from './Skins';
import { GOAL_HALF, HALF_L, World, type HitEvent, type Side } from './Physics';

// Goal-strip colors, precomputed so the per-frame flash update allocates nothing.
const GOAL_BASE = { bottom: COLORS.player.scale(0.55), top: COLORS.ai.scale(0.55) };
const WHITE = Color3.White();

/** Visual representation of a physics World, plus hit/goal effects. */
export class Rig {
  readonly world = new World();
  readonly table: TableParts;
  readonly effects: Effects;
  private readonly paddleNodes: [TransformNode, TransformNode];
  private readonly puckNode: TransformNode;
  /** Glowing speed streak behind the puck. */
  private readonly streak: ParticleSystem;
  private readonly streakPrev = new Vector3();
  private readonly streakCur = new Vector3();
  private readonly streakEnabled: boolean;
  private spin = 0;
  private falling = false;
  /** 0→1 pop-in progress of a freshly served puck. */
  private spawn = 1;
  private fallVel = { x: 0, y: 0, z: 0 };
  private goalFlash = { bottom: 0, top: 0 };
  /** Hit sparks and goal bursts on the player's side take the equipped skin's color. */
  private readonly playerColor: Color3;
  /** The speed trail and rail sparks take the equipped puck's color. */
  private readonly puckColor: Color3;
  /** Resolves once the mallet and puck models have loaded (or failed and kept their stand-ins). */
  readonly ready: Promise<void>;

  /**
   * @param streak Glowing speed streak behind the puck. Designed for the near-top-down game
   *   camera; from low angles the sprites clip into the table, so the home scene turns it off.
   */
  constructor(scene: Scene, { streak = true } = {}) {
    this.table = createTable(scene);
    // The player's mallet wears the skin equipped in the Locker; the opponent stays red.
    const playerLook = equippedMallet();
    this.playerColor = Color3.FromHexString(playerLook.color);
    this.paddleNodes = [
      createPaddle(scene, 'playerPaddle', Color3.FromHexString(playerLook.color)),
      createPaddle(scene, 'aiPaddle', COLORS.ai),
    ];
    this.puckNode = createPuck(scene);
    // `?codetable` (dev only) keeps the procedural table, for comparing with the model.
    const codeTable = import.meta.env.DEV && location.search.includes('codetable');
    const loads = [
      codeTable ? Promise.resolve() : loadTableModel(scene, this.table, equippedTable().id).catch((e) => console.warn('Table model failed to load, using fallback', e)),
      loadPuckModel(scene, this.puckNode, equippedPuck().id).catch((e) => console.warn('Puck model failed to load, using fallback', e)),
      ...this.paddleNodes.map((node, i) =>
        loadPaddleModel(scene, node, i === 0 ? playerLook : OPPONENT_MALLET).catch((e) => console.warn('Mallet model failed to load, using fallback', e)),
      ),
    ];
    this.ready = Promise.all(loads).then(() => undefined);

    this.puckColor = puckColor(equippedPuck().id);
    this.streak = this.createStreak(scene);
    this.streakEnabled = streak;

    this.effects = new Effects(scene);
    this.world.resetPaddles();
    this.sync(0);
  }

  serve(side: Side | 0): void {
    this.falling = false;
    this.spawn = 0;
    this.world.servePuck(side);
    this.puckNode.setEnabled(true);
    this.sync(0);
    this.streakPrev.copyFrom(this.streakCur);
    this.streak.reset();
  }

  /** Called when a goal is scored: the puck drops into the pocket. */
  goal(scorer: Side): void {
    const p = this.world.puck;
    this.world.puckActive = false;
    this.falling = true;
    this.fallVel = { x: p.vx * 0.5, y: 0, z: p.vz * 0.5 };
    // The table model's goal pockets are shallow: the puck vanishes into the goal instead of dropping.
    if (this.table.solidGoals) this.puckNode.setEnabled(false);
    const defended = scorer === -1 ? 'top' : 'bottom';
    this.goalFlash[defended] = 1;
    this.effects.goal(p.x, p.z, scorer === -1 ? this.playerColor : COLORS.ai);
  }

  /** Spawn effects for queued physics events and hand them to an optional listener. */
  drainEvents(listener?: (e: HitEvent) => void): void {
    for (const e of this.world.events) {
      if (e.kind === 'paddle') {
        this.effects.hit(e.x, e.z, e.side === -1 ? this.playerColor : COLORS.ai, e.strength);
      } else {
        this.effects.wall(e.x, e.z, this.puckColor, e.strength);
      }
      listener?.(e);
    }
    this.world.events.length = 0;
  }

  sync(dt: number): void {
    const w = this.world;
    // Draw between the last two physics ticks (w.alpha) so motion is smooth at any frame rate.
    const a = w.alpha;
    w.paddles.forEach((p, i) => {
      const node = this.paddleNodes[i];
      node.position.set(p.prevX + (p.x - p.prevX) * a, 0, p.prevZ + (p.z - p.prevZ) * a);
      // Lean into the direction of motion for a bit of weight.
      const lean = 0.012;
      const tx = Math.max(-0.25, Math.min(0.25, p.vz * lean));
      const tz = Math.max(-0.25, Math.min(0.25, -p.vx * lean));
      const k = dt > 0 ? Math.min(1, dt * 12) : 1;
      node.rotation.x += (tx - node.rotation.x) * k;
      node.rotation.z += (tz - node.rotation.z) * k;
    });

    const speed = w.puckSpeed();
    if (this.falling) {
      // (On the model table the puck is already hidden: see goal().)
      this.fallVel.y -= 18 * dt;
      const n = this.puckNode.position;
      n.x += this.fallVel.x * dt;
      n.y += this.fallVel.y * dt;
      n.z += this.fallVel.z * dt;
      if (n.y < -1.2) this.puckNode.setEnabled(false);
    } else {
      const x = w.puckRenderX();
      const z = w.puckRenderZ();
      this.puckNode.position.set(x, 0.005, z);
      // The model table's goal pockets are shallow: a puck deep in the mouth would show through
      // the back of the goal before the goal counts, so it vanishes once it is in.
      if (this.table.solidGoals) {
        const inGoal = Math.abs(z) > HALF_L + 0.15 && Math.abs(x) < GOAL_HALF;
        if (inGoal === this.puckNode.isEnabled()) this.puckNode.setEnabled(!inGoal);
      }
    }
    // A served puck pops in (slight overshoot) instead of teleporting onto the table.
    if (this.spawn < 1) {
      this.spawn = Math.min(1, this.spawn + dt / 0.3);
      const t = this.spawn - 1;
      const k = 1 + 2.2 * t * t * t + 1.2 * t * t; // ease-out-back
      this.puckNode.scaling.setAll(Math.max(0.001, k));
    }
    this.spin += (w.puck.vx * 0.6 + w.puck.vz * 0.35) * dt;
    this.puckNode.rotation.y = this.spin;

    // Streak: emit along the path travelled this frame, denser the faster the puck goes.
    this.streakPrev.copyFrom(this.streakCur);
    this.streakCur.set(w.puckRenderX(), 0.08, w.puckRenderZ());
    this.streak.emitRate = this.falling || !this.streakEnabled ? 0 : Math.max(0, Math.min(320, (speed - 4) * 16));

    // Goal strips flash after a goal.
    for (const key of ['bottom', 'top'] as const) {
      const f = this.goalFlash[key];
      const base = key === 'bottom' ? GOAL_BASE.bottom : GOAL_BASE.top;
      Color3.LerpToRef(base, WHITE, f * (0.5 + 0.5 * Math.sin(f * 40)), this.table.goalGlow[key].emissiveColor);
      this.goalFlash[key] = Math.max(0, f - dt * 0.8);
    }

    this.effects.update(dt);
  }

  private createStreak(scene: Scene): ParticleSystem {
    const ps = new ParticleSystem('puckStreak', 500, scene);
    ps.particleTexture = makeFlareTexture(scene);
    ps.emitter = this.streakCur;
    // Spread spawns along the segment travelled since last frame so fast shots don't leave gaps.
    ps.startPositionFunction = (_m, pos) => {
      Vector3.LerpToRef(this.streakPrev, this.streakCur, Math.random(), pos);
    };
    ps.minEmitPower = ps.maxEmitPower = 0;
    ps.minLifeTime = 0.16;
    ps.maxLifeTime = 0.3;
    ps.minSize = 0.34;
    ps.maxSize = 0.46;
    ps.addSizeGradient(0, 1);
    ps.addSizeGradient(1, 0.15);
    // Additive blending vanishes on the white table: use a soft alpha-blended yellow trail.
    // In the puck's color: a bright head, a deeper tail, fading out pale.
    const c = this.puckColor;
    const light = Color3.Lerp(c, Color3.White(), 0.25);
    const pale = Color3.Lerp(c, Color3.White(), 0.6);
    ps.color1 = new Color4(light.r, light.g, light.b, 0.55);
    ps.color2 = new Color4(c.r * 0.95, c.g * 0.85, c.b * 0.85, 0.45);
    ps.colorDead = new Color4(pale.r, pale.g, pale.b, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = Vector3.Zero();
    ps.updateSpeed = 1 / 60;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }
}
