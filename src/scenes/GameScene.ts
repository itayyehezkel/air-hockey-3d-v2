import { Engine, FreeCamera, Matrix, Ray, Scene, Vector3 } from '../babylon';
import type { Sound } from '../audio/Sound';
import { AI_NORMAL, AIController } from '../game/AI';
import { createStage, RAIL_T } from '../game/Meshes';
import { clampToHalf, HALF_L, HALF_W, type Side } from '../game/Physics';
import { Rig } from '../game/Rig';
import type { UI } from '../ui/UI';
import type { Screen } from './Screen';

export const WIN_SCORE = 7;
const PLAYER: Side = -1;
const CPU: Side = 1;
// Tuned side by side with the game mockup: a fairly wide lens close to the table, so the near
// end fills the screen width and the far end narrows (mockup perspective).
const CAMERA_TILT = 0.5; // radians away from straight top-down
const CAMERA_FOV = 0.82;
const CAMERA_TARGET_Z = -0.3;
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
  private state: State = 'countdown';
  private stateTime = 0;
  private countStep = -1;
  private lastScorer: Side = PLAYER;
  private score = { player: 0, cpu: 0 };
  /** Camera shake amplitude in world units; decays smoothly. */
  private shake = 0;
  private shakeTime = 0;
  private pointerId: number | null = null;
  private _paused = false;
  private readonly canvas: HTMLCanvasElement;
  /** Reused for every touch sample (pointermove fires 60–240×/s). */
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward());

  constructor(
    private readonly engine: Engine,
    private readonly ui: UI,
    private readonly sound: Sound,
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

    this.canvas = engine.getRenderingCanvas()!;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    ui.showGame();
  }

  get paused(): boolean {
    return this._paused;
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

    if (this.state !== 'over') this.ai.update(dt, world);

    switch (this.state) {
      case 'countdown': {
        const step = Math.floor(this.stateTime / 0.75);
        if (step !== this.countStep) {
          this.countStep = step;
          if (step < 3) {
            this.ui.showBanner(String(3 - step), '#ffffff', 'count');
            this.sound.beep();
          } else {
            this.ui.showBanner('GO!', '#ffd21f', 'count');
            this.sound.beep(true);
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
        if (e.strength > 12) this.shake = Math.max(this.shake, 0.05);
      } else {
        this.sound.wall(e.strength);
      }
    });
    this.rig.sync(dt);
    this.updateCamera(dt);
  }

  resize(): void {
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

    // Gentle rubber band: the opponent eases off when it leads and only tries a little harder when
    // it trails (it used to speed up by +3, which made leads almost impossible to hold).
    const diff = this.score.player - this.score.cpu;
    this.ai.setLevel({ ...AI_NORMAL, speed: AI_NORMAL.speed + Math.max(-1.5, Math.min(0.8, diff * 0.3)) });
    this.setState('goal');
  }

  private endMatch(): void {
    this.setState('over');
    const win = this.score.player > this.score.cpu;
    this.rig.world.puckActive = false;
    if (win) this.sound.win();
    else this.sound.lose();
    this.ui.showResult(win, this.score.player, this.score.cpu);
  }

  // ---------- Camera ----------

  private fit(): void {
    const aspect = this.engine.getAspectRatio(this.camera);
    const tanV = Math.tan(this.camera.fov / 2);
    const halfL = HALF_L + RAIL_T + 0.35;
    const halfW = HALF_W + RAIL_T + 0.25;
    // Leave extra headroom at the top for the score bar.
    const dV = (halfL / tanV) * 1.14;
    const dH = (halfW / (tanV * aspect)) * 1.06;
    const d = Math.max(dV, dH);
    this.camBase.set(0, d * Math.cos(CAMERA_TILT), CAMERA_TARGET_Z - d * Math.sin(CAMERA_TILT));
    this.camera.position.copyFrom(this.camBase);
    this.camera.setTarget(new Vector3(0, 0, CAMERA_TARGET_Z));
  }

  private updateCamera(dt: number): void {
    // Smooth, decaying wobble. (A new random offset every frame reads as judder, not shake.)
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.002) this.shake = 0;
    this.shakeTime += dt;
    const t = this.shakeTime;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 47) * this.shake,
      this.camBase.y + Math.sin(t * 31 + 1.3) * this.shake * 0.4,
      this.camBase.z + Math.sin(t * 39 + 2.1) * this.shake,
    );
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
    const rect = this.canvas.getBoundingClientRect();
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
