/**
 * A live, spinning 3D view of one Locker item (the LEVEL UP popup shows the unlocked item this way, so it always
 * matches the Locker and the match). It has its own small canvas and engine, so it works over any screen; the match
 * behind the popup has stopped drawing by then, so the phone only renders this one model.
 */
import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Scene, TransformNode, Vector3 } from '../babylon';
import type { Mesh } from '../babylon';
import { buildTableModel, loadPaddleModel, loadPuckModel } from './Meshes';
import { MALLET_SKINS, type ItemKind } from './Skins';

/**
 * The camera matches the pedestal sprite it stands on (assets/ui/levelup/pedestal.webp): its top oval is 0.235 as tall
 * as it is wide, so it is seen from asin(0.235) = 13.6 degrees above. The camera looks at the item's base (the middle
 * of the square view), which the popup places on the middle of that oval.
 */
const PEDESTAL_PITCH = Math.asin(0.235);
const FOV = 0.5;
/**
 * Camera distance per kind, so the item's footprint (mallet/puck 1 unit across, table 1.25 long) shows `cqw` wide on
 * screen: distance = view * footprint / (cqw * 2 tan(fov / 2)), with the view 64cqw wide (see .rp-unlock-item). The
 * pedestal top is ~58.9cqw wide (.rp-pedestal, 62cqw incl. outline): mallet ~61% of it, puck ~70% (it is flat: smaller
 * reads weak), table ~92% (its legs stand inside).
 */
const VIEW_CQW = 64;
const distance = (cqw: number, footprint: number) => (VIEW_CQW * footprint) / (cqw * 2 * Math.tan(FOV / 2));
const FRAMING: Record<ItemKind, { yaw: number; distance: number }> = {
  mallet: { yaw: -0.6, distance: distance(36, 1) },
  puck: { yaw: -0.6, distance: distance(41, 1) },
  table: { yaw: -0.35, distance: distance(54, 1.25) },
};

/** One full turn takes this long (seconds): a calm showcase spin. */
const TURN_SECONDS = 4.5;

export class ItemSpinner {
  readonly el: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly studio: TransformNode;
  private running = false;
  private disposed = false;

  private constructor(readonly kind: ItemKind) {
    this.el = document.createElement('canvas');
    this.el.className = 'rp-unlock-view';
    this.engine = new Engine(this.el, true, { alpha: true, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.skipPointerMovePicking = true;
    // Same daylight as the Locker and the table scenes.
    const hemi = new HemisphericLight('spinHemi', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.8;
    hemi.groundColor = new Color3(0.45, 0.5, 0.65);
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('spinSun', new Vector3(-0.35, -1, 0.45), this.scene);
    sun.intensity = 1.0;
    const f = FRAMING[kind];
    this.studio = new TransformNode('spinStudio', this.scene);
    this.studio.rotation.set(0, f.yaw, 0);
    const cam = new FreeCamera('spinCam', new Vector3(0, Math.sin(PEDESTAL_PITCH), -Math.cos(PEDESTAL_PITCH)).scale(f.distance), this.scene);
    cam.fov = FOV;
    cam.minZ = 0.05;
    cam.setTarget(Vector3.Zero());
  }

  /** Loads the item and compiles its shaders (call ahead of time); `px` is the view's size in CSS pixels. */
  static async create(kind: ItemKind, id: string, px: number): Promise<ItemSpinner> {
    const s = new ItemSpinner(kind);
    try {
      const side = Math.round(px * Math.min(2, devicePixelRatio || 1));
      s.engine.setSize(side, side);
      if (kind === 'mallet') {
        await loadPaddleModel(s.scene, s.studio, MALLET_SKINS.find((m) => m.id === id) ?? MALLET_SKINS[0], 1);
      } else if (kind === 'puck') {
        await loadPuckModel(s.scene, s.studio, id, 1);
      } else {
        const fit = new TransformNode('spinTableFit', s.scene);
        fit.parent = s.studio;
        fit.rotation.y = Math.PI / 2;
        fit.scaling.setAll(1.25);
        const inner = new TransformNode('spinTable', s.scene);
        inner.parent = fit;
        fitToUnit(inner, await buildTableModel(s.scene, inner, id));
      }
      await s.scene.whenReadyAsync();
      s.scene.render(); // first frame drawn now, so it shows the moment it is placed
      return s;
    } catch (e) {
      s.dispose();
      throw e;
    }
  }

  /** Starts spinning (once the canvas is on screen). */
  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.engine.runRenderLoop(() => {
      const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
      this.studio.rotation.y += (dt * Math.PI * 2) / TURN_SECONDS;
      this.scene.render();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.el.remove();
  }
}

/**
 * Scales a node holding the game-scale table so the table is one unit long, standing on y = 0
 * (its legs reach below the playing surface). Bounds are measured in the node's own space, so
 * models nested under their own fitting nodes count too.
 */
export function fitToUnit(node: TransformNode, meshes: Mesh[]): void {
  if (!meshes.length) return;
  const toNode = node.computeWorldMatrix(true).clone().invert();
  const p = new Vector3();
  let minY = Infinity;
  const min = new Vector3(Infinity, 0, Infinity);
  const max = new Vector3(-Infinity, 0, -Infinity);
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    for (const corner of m.getBoundingInfo().boundingBox.vectorsWorld) {
      Vector3.TransformCoordinatesToRef(corner, toNode, p);
      minY = Math.min(minY, p.y);
      min.x = Math.min(min.x, p.x);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.z = Math.max(max.z, p.z);
    }
  }
  const k = 1 / Math.max(max.x - min.x, max.z - min.z);
  node.scaling.scaleInPlace(k);
  node.position.y = -minY * k;
}
