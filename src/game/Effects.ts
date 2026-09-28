import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Vector3,
} from '../babylon';

interface Ring {
  mesh: Mesh;
  mat: StandardMaterial;
  active: boolean;
  age: number;
  life: number;
  maxScale: number;
}

/** Enough for a goal (2) plus a flurry of hits; the oldest ring is recycled if they're all busy. */
const RING_POOL = 8;
/** Hidden below the table, used to compile shaders at load instead of on the first hit/goal. */
const WARMUP_Y = -3;

/** Pooled bursts: sparks on hits, shockwave rings, and a big goal explosion. */
export class Effects {
  private readonly sparks: ParticleSystem;
  private readonly embers: ParticleSystem;
  private readonly rings: Ring[] = [];
  private warmup = 0.5;

  constructor(scene: Scene) {
    const tex = makeFlareTexture(scene);

    this.sparks = new ParticleSystem('sparks', 600, scene);
    this.sparks.particleTexture = tex;
    this.sparks.emitter = Vector3.Zero();
    this.sparks.createHemisphericEmitter(0.08, 0);
    this.sparks.emitRate = 0;
    this.sparks.minLifeTime = 0.18;
    this.sparks.maxLifeTime = 0.55;
    this.sparks.minSize = 0.05;
    this.sparks.maxSize = 0.16;
    this.sparks.minEmitPower = 2.5;
    this.sparks.maxEmitPower = 7;
    this.sparks.gravity = new Vector3(0, -14, 0);
    this.sparks.updateSpeed = 1 / 60;
    // Alpha-blended so sparks read as bright confetti bits on the white table (additive would wash out).
    this.sparks.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.sparks.colorDead = new Color4(0, 0, 0, 0);
    this.sparks.start();

    this.embers = new ParticleSystem('embers', 900, scene);
    this.embers.particleTexture = tex;
    this.embers.emitter = Vector3.Zero();
    this.embers.createSphereEmitter(0.3, 0.5);
    this.embers.emitRate = 0;
    this.embers.minLifeTime = 0.5;
    this.embers.maxLifeTime = 1.3;
    this.embers.minSize = 0.08;
    this.embers.maxSize = 0.32;
    this.embers.minEmitPower = 3;
    this.embers.maxEmitPower = 11;
    this.embers.gravity = new Vector3(0, -6, 0);
    this.embers.updateSpeed = 1 / 60;
    this.embers.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.embers.colorDead = new Color4(0, 0, 0, 0);
    this.embers.addSizeGradient(0, 1);
    this.embers.addSizeGradient(1, 0.1);
    this.embers.start();

    // Shockwave rings are pooled: building a mesh + material per hit caused a frame hitch every time.
    const template = MeshBuilder.CreateTorus('ring', { diameter: 1, thickness: 0.06, tessellation: 40 }, scene);
    for (let i = 0; i < RING_POOL; i++) {
      const mesh = i === 0 ? template : template.clone('ring');
      const mat = new StandardMaterial('ringMat', scene);
      mat.disableLighting = true;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.rings.push({ mesh, mat, active: false, age: 0, life: 1, maxScale: 1 });
    }

    // Warm-up: draw one ring and a couple of particles out of sight for the first moments, so every
    // shader compiles during loading rather than on the first goal.
    const warm = this.rings[0];
    warm.mesh.position.set(0, WARMUP_Y, 0);
    warm.mat.alpha = 0.01;
    warm.mesh.setEnabled(true);
    this.burst(this.sparks, new Vector3(0, WARMUP_Y, 0), Color3.White(), 2, 0);
    this.burst(this.embers, new Vector3(0, WARMUP_Y, 0), Color3.White(), 2, 0);
  }

  /** Burst at a paddle/puck contact. strength is the impact speed. */
  hit(x: number, z: number, color: Color3, strength: number): void {
    const k = Math.min(strength / 14, 1);
    this.burst(this.sparks, new Vector3(x, 0.12, z), color, Math.round(14 + k * 60), 1 + k);
    this.ring(x, z, color, 0.8 + k * 1.4, 0.35);
  }

  /** Smaller burst for rail bounces. */
  wall(x: number, z: number, color: Color3, strength: number): void {
    const k = Math.min(strength / 14, 1);
    this.burst(this.sparks, new Vector3(x, 0.15, z), color, Math.round(6 + k * 20), 0.8 + k * 0.5);
  }

  goal(x: number, z: number, color: Color3): void {
    const pos = new Vector3(x, 0.3, z);
    this.burst(this.embers, pos, color, 140, 1.2);
    this.burst(this.sparks, pos, Color3.FromHexString('#ffc81f'), 80, 2);
    this.ring(x, z, color, 5, 0.7);
    this.ring(x, z, Color3.FromHexString('#ffc81f'), 3, 0.5);
  }

  update(dt: number): void {
    if (this.warmup > 0) {
      this.warmup -= dt;
      if (this.warmup <= 0 && !this.rings[0].active) this.rings[0].mesh.setEnabled(false);
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.setEnabled(false);
        continue;
      }
      const ease = 1 - Math.pow(1 - t, 3);
      const s = 0.2 + ease * r.maxScale;
      r.mesh.scaling.set(s, 1, s);
      r.mat.alpha = 1 - t;
    }
  }

  private burst(ps: ParticleSystem, pos: Vector3, color: Color3, count: number, power: number): void {
    ps.emitter = pos;
    const bright = Color4.FromColor3(Color3.Lerp(color, Color3.White(), 0.25), 1);
    ps.color1 = bright;
    ps.color2 = Color4.FromColor3(color, 1);
    ps.minEmitPower = 2.5 * power;
    ps.maxEmitPower = 7 * power;
    ps.manualEmitCount = (ps.manualEmitCount > 0 ? ps.manualEmitCount : 0) + count;
  }

  private ring(x: number, z: number, color: Color3, maxScale: number, life: number): void {
    // Take a free ring, or recycle the one closest to finishing.
    let r = this.rings.find((q) => !q.active);
    if (!r) r = this.rings.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    r.active = true;
    r.age = 0;
    r.life = life;
    r.maxScale = maxScale;
    r.mesh.position.set(x, 0.04, z);
    r.mesh.scaling.set(0.2, 1, 0.2);
    r.mat.emissiveColor.copyFrom(color);
    r.mat.alpha = 1;
    r.mesh.setEnabled(true);
  }
}

export function makeFlareTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture('flare', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}
