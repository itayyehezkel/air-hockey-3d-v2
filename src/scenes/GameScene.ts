import { Engine, FreeCamera, Matrix, Ray, Scene, Vector3 } from '../babylon';
import type { Sound } from '../audio/Sound';
import { AI_NORMAL, AIController } from '../game/AI';
import { createStage, RAIL_T } from '../game/Meshes';
import { BIG_MALLET_SCALE, type Boosters } from '../game/Boosters';
import { clampToHalf, HALF_L, HALF_W, TABLE, type Side } from '../game/Physics';
import { Rig } from '../game/Rig';
import type { UI } from '../ui/UI';
import type { Screen } from './Screen';

export const WIN_SCORE = 5;
const PLAYER: Side = -1;
const CPU: Side = 1;
// Tuned side by side with the game mockup: a fairly wide lens close to the table, so the near
// end fills the screen width and the far end narrows (mockup perspective).
const CAMERA_TILT = 0.72; // radians away from straight top-down (enough to see the table's sides)
const CAMERA_FOV = 0.82;
const CAMERA_TARGET_Z = -0.3;
/** The camera starts straight above the table and swings down to CAMERA_TILT during "3, 2, 1". */
const INTRO_SWING = 2.1; // seconds (the countdown lasts 2.25 s: settled just before "GO!")
const INTRO_ZOOM = 0.18; // it also starts this much further out and zooms in
const SLOWMO = 0.45; // seconds of slow motion after a goal (game time runs at ~30% at its start)
const PUNCH_GAP = 0.6; // seconds between camera punches from hits

/** A damped spring (camera punches): x follows rest, overshooting a little. */
interface Spring {
  x: number;
  v: number;
  rest: number;
  k: number;
  damp: number;
}

function stepSpring(s: Spring, dt: number): void {
  // Small steps keep a stiff spring stable through a long frame.
  for (let left = dt; left > 0; left -= 1 / 120) {
    const h = Math.min(left, 1 / 120);
    s.v += (-s.k * (s.x - s.rest) - s.damp * s.v) * h;
    s.x += s.v * h;
  }
}

/** Ease-out-back (overshoots, then settles), for things popping into place. */
function popEase(t: number): number {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
}
const IDENTITY = Matrix.Identity();
const TOUCH_LEAD = 0.35; // keep the mallet slightly ahead of the finger so it stays visible

type State = 'countdown' | 'playing' | 'goal' | 'over';

export class GameScene implements Screen {
  readonly scene: Scene;
  readonly ready: Promise<void>;
  private readonly camera: FreeCamera;
  private readonly rig: Rig;
  private readonly ai = new AIController(CPU, AI_NORMAL);
  private readonly camBase = new Vector3();
  private readonly camTarget = new Vector3(0, 0, CAMERA_TARGET_Z);
  /** Current camera tilt (radians from straight down); animates in during the countdown. */
  private tilt = 0;
  /** The countdown waits until the match is on screen (see begin). */
  private begun = false;
  private baseDist = 20;
  /** Starts a little further out and zooms in with the intro swing. */
  private introZoom = 1 + INTRO_ZOOM;
  /** Camera distance offset (fraction; negative = closer). */
  private readonly zoom: Spring = { x: 0, v: 0, rest: 0, k: 170, damp: 11 };
  /** Mallet pop-in at the start (0 → 1) and the game-time scale (slow motion after a goal). */
  private readonly pop: [number, number] = [0, 0];
  private slowmo = 0;
  private bigBuzzed = false;
  /** Time left before another hit may punch the camera. */
  private punchWait = 0;
  private state: State = 'countdown';
  private stateTime = 0;
  private countStep = -1;
  /** KEEP PLAYING! was used this match (it is offered once). */
  private continued = false;
  private lastScorer: Side = PLAYER;
  private score = { player: 0, cpu: 0 };
  /** Camera shake amplitude in world units; decays smoothly. */
  private shake = 0;
  private shakeTime = 0;
  private pointerId: number | null = null;
  private _paused = false;
  private readonly canvas: HTMLCanvasElement;
  /** The canvas's place on the page, measured on start and resize (not on every touch sample: that can force layout). */
  private canvasRect: DOMRect;
  /** Reused for every touch sample (pointermove fires 60–240×/s). */
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward());

  constructor(
    private readonly engine: Engine,
    private readonly ui: UI,
    private readonly sound: Sound,
    private readonly options: { boosters?: Boosters; onEnd?: (win: boolean) => void } = {},
  ) {
    this.scene = new Scene(engine);
    createStage(this.scene);

    this.camera = new FreeCamera('cam', new Vector3(0, 14, -3), this.scene);
    this.camera.fov = CAMERA_FOV;
    this.camera.minZ = 0.5;
    this.fit();

    this.rig = new Rig(this.scene);
    this.ready = this.rig.ready.then(() => this.scene.whenReadyAsync());
    this.rig.serve(0);
    this.rig.world.puckActive = false;
    this.rig.world.paddle(PLAYER).maxSpeed = 32;
    if (options.boosters?.bigMallet) this.rig.world.paddle(PLAYER).r = TABLE.paddleRadius * BIG_MALLET_SCALE;

    this.canvas = engine.getRenderingCanvas()!;
    this.canvasRect = this.canvas.getBoundingClientRect();
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    ui.showGame();
  }

  /** Starts the countdown: called as the screen fades in, so "3" and the camera swing are seen. */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.stateTime = 0;
    this.ui.playMatchIntro();
  }

  get paused(): boolean {
    // Once the result is up and the camera's push-in has settled, the table is a still picture: stop
    // re-rendering it, so the phone spends its time on the popup's animations.
    return this._paused || (this.state === 'over' && this.stateTime > 1.2);
  }

  setPaused(paused: boolean): void {
    // Nothing to pause once the match is decided.
    if (paused === this._paused || (paused && this.state === 'over')) return;
    this._paused = paused;
    this.pointerId = null;
    this.ui.showPause(paused);
    this.sound.button();
  }

  update(dt: number): void {
    if (this._paused) return;
    dt = Math.min(dt, 0.1); // the physics runs in fixed ticks; this only guards the state timers
    this.stateTime += dt;
    const world = this.rig.world;
    const realDt = dt;
    this.punchWait -= dt;
    // Slow motion right after a goal: game time eases back from ~30% to full speed.
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - dt);
      dt *= 0.3 + 0.7 * (1 - this.slowmo / SLOWMO);
    }

    if (this.state !== 'over') this.ai.update(dt, world);

    switch (this.state) {
      case 'countdown': {
        this.popMallets();
        if (!this.begun) {
          world.step(dt);
          break;
        }
        const step = Math.floor(this.stateTime / 0.75);
        if (step !== this.countStep) {
          this.countStep = step;
          if (step < 3) {
            this.ui.showBanner(String(3 - step), '#ffffff', 'count');
            this.sound.beep();
          } else {
            this.ui.showBanner('GO!', '#ffd21f', 'count');
            this.sound.beep(true);
            this.zoom.v -= 1.3; // punch in
            this.rig.serve(0);
            this.setState('playing');
          }
        }
        world.step(dt);
        break;
      }
      case 'playing': {
        const scorer = world.step(dt);
        if (scorer !== null) this.onGoal(scorer);
        break;
      }
      case 'goal': {
        world.step(dt);
        if (this.stateTime > 1.3) {
          if (this.score.player >= WIN_SCORE || this.score.cpu >= WIN_SCORE) {
            this.endMatch();
          } else {
            // The side that conceded gets the puck.
            this.rig.serve(this.lastScorer === PLAYER ? CPU : PLAYER);
            this.setState('playing');
          }
        }
        break;
      }
      case 'over':
        world.step(dt);
        break;
    }

    this.rig.drainEvents((e) => {
      if (e.kind === 'paddle') {
        this.sound.hit(e.strength);
        if (e.side === PLAYER) this.sound.haptic(e.strength > 10 ? 'heavy' : e.strength > 5 ? 'medium' : 'light');
        // A small punch on real smashes only: the puck has to fly off fast, and not more than once
        // per PUNCH_GAP (a puck pinned against a wall takes many quick contacts in a row).
        if (e.strength > 12 && world.puckSpeed() > 12 && this.punchWait <= 0) {
          this.punchWait = PUNCH_GAP;
          this.shake = Math.max(this.shake, 0.05);
          this.zoom.v -= Math.min(0.7, e.strength * 0.035);
        }
      } else {
        this.sound.wall(e.strength);
      }
    });
    this.rig.sync(dt);
    this.updateCamera(realDt);
  }

  /** Mallets pop onto the table as the countdown starts (the player's first); Big Mallet grows on. */
  private popMallets(): void {
    const t = this.begun ? this.stateTime : 0;
    this.pop[0] = this.begun ? popEase((t - 0.4) / 0.45) : 0;
    this.pop[1] = this.begun ? popEase((t - 0.6) / 0.45) : 0;
    let big = 1;
    if (this.options.boosters?.bigMallet) {
      big = 1 + (BIG_MALLET_SCALE - 1) * popEase((t - 1.05) / 0.5);
      if (t > 1.05 && !this.bigBuzzed) {
        this.bigBuzzed = true;
        this.sound.haptic('medium');
      }
    }
    this.rig.paddleScale[0] = Math.max(0.001, this.pop[0] * big);
    this.rig.paddleScale[1] = Math.max(0.001, this.pop[1]);
  }

  resize(): void {
    this.canvasRect = this.canvas.getBoundingClientRect();
    this.fit();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.scene.dispose();
  }

  private setState(s: State): void {
    this.state = s;
    this.stateTime = 0;
  }

  private onGoal(scorer: Side): void {
    this.lastScorer = scorer;
    const playerScored = scorer === PLAYER;
    if (playerScored) this.score.player++;
    else this.score.cpu++;
    this.ui.setScore(this.score.player, this.score.cpu, playerScored ? 'player' : 'ai');
    this.ui.showBanner('GOAL!', playerScored ? '#4fa3ff' : '#ff4a55');
    this.sound.goal(playerScored);
    this.sound.hapticNotify(playerScored);
    this.rig.goal(scorer);
    this.shake = 0.2;
    this.slowmo = SLOWMO;

    // Gentle rubber band: the opponent eases off when it leads and only tries a little harder when
    // it trails (it used to speed up by +3, which made leads almost impossible to hold).
    const diff = this.score.player - this.score.cpu;
    this.ai.setLevel({ ...AI_NORMAL, speed: AI_NORMAL.speed + Math.max(-1.5, Math.min(0.8, diff * 0.3)) });
    this.setState('goal');
  }

  private endMatch(): void {
    this.setState('over');
    this.zoom.rest = -0.06; // a slow push-in behind the result
    const win = this.score.player > this.score.cpu;
    this.options.onEnd?.(win);
    this.rig.world.puckActive = false;
    if (win) this.sound.win();
    else this.sound.lose();
    this.ui.showResult(win, this.score.player, this.score.cpu, !win && !this.continued);
  }

  /** KEEP PLAYING! (after a rewarded ad): cancels the opponent's winning goal and resumes after a countdown. */
  keepPlaying(): void {
    if (this.state !== 'over' || this.continued || this.score.cpu < WIN_SCORE) return;
    this.continued = true;
    this.score.cpu--;
    this.ui.resumeMatch(this.score.player, this.score.cpu);
    this.zoom.rest = 0;
    this.rig.serve(0);
    this.rig.world.puckActive = false;
    this.countStep = -1;
    this.setState('countdown');
  }

  // ---------- Camera ----------

  /** Distance that frames the whole table (for the current screen shape). */
  private fit(): void {
    const aspect = this.engine.getAspectRatio(this.camera);
    const tanV = Math.tan(this.camera.fov / 2);
    const halfL = HALF_L + RAIL_T + 0.35;
    const halfW = HALF_W + RAIL_T + 0.25;
    // Leave extra headroom at the top for the score bar.
    const dV = (halfL / tanV) * 1.14;
    const dH = (halfW / (tanV * aspect)) * 1.06;
    this.baseDist = Math.max(dV, dH);
    this.placeCamera();
  }

  /** Camera from the tilt, the zoom spring and the shake. */
  private placeCamera(): void {
    const d = this.baseDist * this.introZoom * (1 + this.zoom.x);
    this.camBase.set(0, d * Math.cos(this.tilt), this.camTarget.z - d * Math.sin(this.tilt));
    const t = this.shakeTime;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 47) * this.shake,
      this.camBase.y + Math.sin(t * 31 + 1.3) * this.shake * 0.4,
      this.camBase.z + Math.sin(t * 39 + 2.1) * this.shake,
    );
    this.camera.setTarget(this.camTarget);
  }

  private updateCamera(dt: number): void {
    // Intro: from straight above and a little further out, the camera swings down to the play angle
    // and zooms in (ease-in-out cubic), settling just before "GO!".
    if (this.tilt < CAMERA_TILT) {
      const k = this.state !== 'countdown' ? 1 : this.begun ? Math.min(1, this.stateTime / INTRO_SWING) : 0;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.tilt = CAMERA_TILT * e;
      this.introZoom = 1 + INTRO_ZOOM * (1 - e);
    }
    // Punches (GO!, hard hits) are a spring: they overshoot a touch and settle.
    stepSpring(this.zoom, dt);
    // Smooth, decaying wobble. (A new random offset every frame reads as judder, not shake.)
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.002) this.shake = 0;
    this.shakeTime += dt;
    this.placeCamera();
  }

  // ---------- Input ----------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null && this.pointerId !== e.pointerId) return;
    this.pointerId = e.pointerId;
    this.aim(e);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    // Mouse: follow on hover too. Touch: only the finger that started the drag.
    if (e.pointerType === 'mouse' ? this.pointerId !== null && this.pointerId !== e.pointerId : this.pointerId !== e.pointerId) return;
    this.aim(e);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private aim(e: PointerEvent): void {
    if (this.state === 'over' || this._paused) return;
    const rect = this.canvasRect;
    const ray = this.ray;
    this.scene.createPickingRayToRef(e.clientX - rect.left, e.clientY - rect.top, IDENTITY, ray, this.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return;
    const x = ray.origin.x + ray.direction.x * t;
    let z = ray.origin.z + ray.direction.z * t;
    if (e.pointerType === 'touch') z += TOUCH_LEAD;
    const paddle = this.rig.world.paddle(PLAYER);
    const pos = clampToHalf(paddle, { x, z });
    paddle.targetX = pos.x;
    paddle.targetZ = pos.z;
  }
}
