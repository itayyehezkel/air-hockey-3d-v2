import { BaseTexture, Color3, Color4, ParticleSystem, Scene, Texture, Vector3 } from '../babylon';

/** Shortest time between two bursts (ms). */
const BURST_GAP = 200;
/** Out of sight below the table: where the load-time warm-up bits are born. */
const WARMUP_Y = -3;

/**
 * A puck skin's themed particles ("bits": stars, hearts, snowflakes…): they drift off behind a
 * fast puck and pop out like confetti on hard hits. Each sprite gets two particle systems, one
 * for the trail and one for bursts, so neither has to be switched back and forth. The sprites
 * carry their own colors (cut from Scenario sheet asset_1DXboeHCk4XrxbDxqgiATUPz).
 */
export class PuckFx {
  private readonly trails: ParticleSystem[] = [];
  private readonly bursts: ParticleSystem[] = [];
  private readonly back = new Vector3();
  private readonly hit = new Vector3();
  private hitPower = 0;
  private lastBurst = -Infinity;
  /** True while the load-time warm-up bits are out (they are born out of sight, below the table). */
  private warming = true;

  /**
   * @param from,to The puck's position last frame and now (the streak's), shared, not copied.
   * @param behind How far behind the puck's center the trail bits are born.
   * @param tint Multiplies the sprites' own colors: white bits (snowflakes) need it to show on pale tables.
   */
  constructor(scene: Scene, sprites: string[], from: Vector3, to: Vector3, behind: number, private readonly tint = Color3.White()) {
    const textures: Texture[] = [];
    for (const url of sprites) {
      const tex = new Texture(url, scene);
      tex.hasAlpha = true;
      textures.push(tex);

      // Hyper-casual style: small but readable bits (about 15–25% of the puck, which is 0.9 wide), short snappy life.
      const trail = this.system(scene, tex, to, 0.13, 0.19, 0.25, 0.45);
      // Born behind the puck along this frame's path (never on top of it), a little scattered.
      trail.startPositionFunction = (_m, pos) => {
        if (this.warming) return void pos.set(0, WARMUP_Y, 0);
        Vector3.LerpToRef(from, to, Math.random(), pos);
        to.subtractToRef(from, this.back);
        const len = this.back.length();
        if (len > 1e-6) pos.subtractInPlace(this.back.scaleInPlace(behind / len));
        pos.x += (Math.random() - 0.5) * 0.35;
        pos.z += (Math.random() - 0.5) * 0.35;
        pos.y = 0.12 + Math.random() * 0.1;
      };
      trail.startDirectionFunction = (_m, dir) => dir.set((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
      this.trails.push(trail);

      const burst = this.system(scene, tex, to, 0.15, 0.23, 0.3, 0.5);
      // From the contact point, a quick pop out all around that slows down fast (drag), then fades.
      burst.startPositionFunction = (_m, pos) => pos.set(this.hit.x, this.warming ? WARMUP_Y : 0.2, this.hit.z);
      burst.startDirectionFunction = (_m, dir) => {
        const a = Math.random() * Math.PI * 2;
        const s = 3 + Math.random() * 3 * (0.5 + this.hitPower);
        dir.set(Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s);
      };
      burst.addDragGradient(0, 0);
      burst.addDragGradient(1, 0.9);
      burst.manualEmitCount = 0;
      this.bursts.push(burst);
    }
    // Warm-up: a full-size burst from every system, out of sight while the match loads. The first themed burst of a
    // match froze the game for ~80 ms (measured; later ones took a normal frame), right on a hard hit. Done once the
    // sprites have loaded (a system draws nothing before), so that one-time cost lands in the loading fade.
    BaseTexture.WhenAllReady(textures, () => {
      for (const ps of this.trails) ps.manualEmitCount = 8;
      for (const ps of this.bursts) ps.manualEmitCount = 8;
      let frames = 0;
      const done = scene.onAfterRenderObservable.add(() => {
        if (++frames < 3) return;
        this.warming = false;
        scene.onAfterRenderObservable.remove(done);
      });
    });
  }

  private system(scene: Scene, tex: Texture, emitter: Vector3, minSize: number, maxSize: number, minLife: number, maxLife: number): ParticleSystem {
    const ps = new ParticleSystem('puckBits', 80, scene);
    ps.particleTexture = tex;
    ps.emitter = emitter;
    ps.minEmitPower = ps.maxEmitPower = 1;
    ps.gravity = new Vector3(0, -2, 0);
    ps.minLifeTime = minLife;
    ps.maxLifeTime = maxLife;
    // Pop in, then shrink away. Size gradients set the size itself (they override minSize and
    // maxSize), so each step carries the real size range.
    for (const [t, f] of [[0, 0.7], [0.15, 1], [1, 0.2]]) ps.addSizeGradient(t, minSize * f, maxSize * f);
    ps.minAngularSpeed = -4;
    ps.maxAngularSpeed = 4;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    // The sprites are already colored: keep them as painted (times the tint) and only fade them out.
    const t = this.tint;
    ps.color1 = new Color4(t.r, t.g, t.b, 1);
    ps.color2 = new Color4(t.r, t.g, t.b, 1);
    ps.colorDead = new Color4(t.r, t.g, t.b, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 1 / 60;
    ps.emitRate = 0;
    ps.start();
    return ps;
  }

  /** Trail density for the puck's speed: none when slow, a steady sprinkle on normal and fast shots. */
  trail(speed: number, on: boolean): void {
    const rate = on ? Math.max(0, Math.min(40, (speed - 4) * 5)) : 0;
    for (const ps of this.trails) ps.emitRate = rate / this.trails.length;
  }

  /**
   * A confetti pop of bits flying out from a hit, bigger for harder hits. At most one every
   * BURST_GAP: a puck pinned against a rail is hit many times a second and piled up a cloud.
   */
  burst(x: number, z: number, strength: number): void {
    const k = Math.min(strength / 14, 1);
    const now = performance.now();
    if (k < 0.25 || now - this.lastBurst < BURST_GAP) return;
    this.lastBurst = now;
    this.hit.set(x, 0, z);
    this.hitPower = k;
    const count = Math.ceil((6 + k * 8) / this.bursts.length);
    for (const ps of this.bursts) ps.manualEmitCount += count;
  }

  reset(): void {
    for (const ps of [...this.trails, ...this.bursts]) ps.reset();
  }
}
