import { ArcRotateCamera, Engine, Scene, Vector3 } from '../babylon';
import { AI_DEMO, AIController } from '../game/AI';
import { createStage } from '../game/Meshes';
import type { Side } from '../game/Physics';
import { Rig } from '../game/Rig';
import type { Screen } from './Screen';

/** Home background: an orbiting camera over a live AI-vs-AI rally. */
export class HomeScene implements Screen {
  readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly rig: Rig;
  private readonly ais: AIController[];
  private time = 0;
  private resetTimer = 0;
  private lastScorer: Side = 1;
  /** Models loaded and every shader compiled: the first visible frame won't hitch or pop. */
  readonly ready: Promise<void>;

  constructor(private readonly engine: Engine) {
    this.scene = new Scene(engine);
    createStage(this.scene);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.95, 19, new Vector3(0, -0.95, 0), this.scene);
    this.camera.fov = 0.8;

    this.rig = new Rig(this.scene, { streak: false });
    this.ais = [new AIController(-1, AI_DEMO), new AIController(1, AI_DEMO)];
    this.rig.serve(Math.random() < 0.5 ? -1 : 1);
    // Give the demo a lively opening shot.
    this.rig.world.puck.vx = 3;
    this.rig.world.puck.vz = 0;

    this.fit();
    this.ready = this.rig.ready.then(() => this.scene.whenReadyAsync());
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.rig.world;

    for (const ai of this.ais) ai.update(dt, w);
    const scorer = w.step(dt);
    if (scorer !== null) {
      this.rig.goal(scorer);
      this.lastScorer = scorer;
      this.resetTimer = 1.4;
    }
    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) this.rig.serve(this.lastScorer === 1 ? -1 : 1);
    }
    this.rig.drainEvents();
    this.rig.sync(dt);

    // Framed like the home mockup (centered 3/4 view); only a gentle drift to keep it alive.
    this.camera.alpha = -Math.PI / 2 + Math.sin(this.time * 0.15) * 0.05;
    this.camera.beta = 0.95 + Math.sin(this.time * 0.23) * 0.015;
  }

  resize(): void {
    this.fit();
  }

  dispose(): void {
    this.scene.dispose();
  }

  private fit(): void {
    const aspect = this.engine.getAspectRatio(this.camera);
    // Near end of the table spans the screen width in portrait (radius 19 at the mockup's 9:16).
    this.camera.radius = aspect < 1 ? 10.7 / aspect : 13;
  }
}
