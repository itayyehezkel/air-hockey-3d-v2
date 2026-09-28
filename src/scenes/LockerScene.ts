import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Matrix, Scene, TransformNode, Vector3 } from '../babylon';
import { CreateScreenshotUsingRenderTargetAsync } from '@babylonjs/core/Misc/screenshotTools';
import { applyMalletLook, buildTableModel, loadPaddleModel, loadPuckModel } from '../game/Meshes';
import type { Mesh } from '../babylon';
import {
  equipMallet,
  equippedMallet,
  equippedPuck,
  equippedTable,
  equipPuck,
  equipTable,
  MALLET_SKINS,
  PUCK_SKINS,
  TABLE_SKINS,
  type MalletSkin,
} from '../game/Skins';
import type { LockerKind, LockerTab, LockerUI } from '../ui/LockerUI';
import type { Screen } from './Screen';

/** Card thumbnails are rendered from the 3D models once per session, then reused. */
const thumbCache: Record<LockerKind, Map<string, string>> = { mallets: new Map(), pucks: new Map(), tables: new Map() };

/** Where the thumbnail studio sits: far off to the side, never inside the preview camera's view. */
const THUMB_SPOT = new Vector3(200, 0, 0);

/** How much of the pedestal's width each preview spans. */
const ON_PEDESTAL = { mallets: 0.58, pucks: 0.5, tables: 0.82 };

/**
 * Locker: the equipped item of the open tab (mallet, puck, or a small copy of the table) stands on
 * the pedestal (a sprite behind the transparent canvas) and can be dragged left/right to spin it;
 * the cards below equip a skin with one tap.
 */
export class LockerScene implements Screen {
  readonly scene: Scene;
  private readonly camera: FreeCamera;
  /** Rotated by dragging; sits on the pedestal's top surface. */
  private readonly pivot: TransformNode;
  /** The puck and table previews, rotated like the mallet (shown on their own tabs instead). */
  private readonly puckPivot: TransformNode;
  private readonly tablePivot: TransformNode;
  /** Turns the table side-on; holds the table model, scaled down to one unit long. */
  private readonly tableFit: TransformNode;
  /** Guards against an older table build finishing after a newer one (fast card taps). */
  private tableToken = 0;
  private readonly canvas: HTMLCanvasElement;
  private yaw = -0.6;
  private spin = 0; // yaw velocity (rad/s) left over from a flick
  private idle = 0; // seconds since the last drag
  private drag: { id: number; x: number; t: number } | null = null;
  private disposed = false;
  /** The skin on the pedestal (decides whether a switch can recolor or must swap models). */
  private shown: MalletSkin;

  constructor(
    private readonly engine: Engine,
    private readonly ui: LockerUI,
  ) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;

    // Same daylight as the table scenes, so a skin looks identical here and in a match.
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.8;
    hemi.groundColor = new Color3(0.45, 0.5, 0.65);
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.45), this.scene);
    sun.intensity = 1.0;

    // Looking down ~27°, like the mockup's mallet on its pedestal.
    this.camera = new FreeCamera('lockerCam', new Vector3(0, 2.7, -4.6), this.scene);
    this.camera.fov = 0.55;
    this.camera.setTarget(new Vector3(0, 0.35, 0));

    this.pivot = new TransformNode('malletPivot', this.scene);
    const skin = equippedMallet();
    this.shown = skin;
    loadPaddleModel(this.scene, this.pivot, skin, 1).catch((e) => console.warn('Locker mallet failed to load', e));

    this.puckPivot = new TransformNode('puckPivot', this.scene);
    loadPuckModel(this.scene, this.puckPivot, equippedPuck().id, 1).catch((e) => console.warn('Locker puck failed to load', e));

    this.tablePivot = new TransformNode('tablePivot', this.scene);
    this.tableFit = new TransformNode('tableFit', this.scene);
    this.tableFit.parent = this.tablePivot;
    this.tableFit.rotation.y = Math.PI / 2; // long side facing the camera: it reads as a table
    this.showTable(equippedTable().id);

    this.canvas = engine.getRenderingCanvas()!;
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    ui.onSelect = (kind, id) => (kind === 'tables' ? this.selectTable(id) : kind === 'pucks' ? this.selectPuck(id) : this.select(id));
    ui.onTab = (tab) => this.showTab(tab);
    ui.render('mallets', MALLET_SKINS, skin.id, thumbCache.mallets);
    ui.render('pucks', PUCK_SKINS, equippedPuck().id, thumbCache.pucks);
    ui.render('tables', TABLE_SKINS, equippedTable().id, thumbCache.tables);
    this.showTab(ui.tab);
    this.fit();
    void this.renderThumbnails()
      .then(() => this.renderPuckThumbnails())
      .then(() => this.renderTableThumbnails());
  }

  /** Each tab shows its own item on the pedestal. */
  private showTab(tab: LockerTab): void {
    this.pivot.setEnabled(tab === 'mallets');
    this.puckPivot.setEnabled(tab === 'pucks');
    this.tablePivot.setEnabled(tab === 'tables');
    this.spin += 5; // a little hop so the switch registers
    this.idle = 0;
  }

  update(dt: number): void {
    if (!this.drag) {
      this.idle += dt;
      // A flick keeps spinning and slows down; after a moment of rest a slow showcase spin takes over.
      this.spin *= Math.exp(-2.5 * dt);
      const showcase = this.idle > 2 ? Math.min(1, (this.idle - 2) / 1.5) * 0.45 : 0;
      this.yaw += (this.spin + showcase) * dt;
    }
    this.pivot.rotation.set(0, this.yaw, 0);
    this.puckPivot.rotation.set(0, this.yaw, 0);
    this.tablePivot.rotation.set(0, this.yaw, 0);
  }

  resize(): void {
    this.fit();
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.ui.onSelect = () => {};
    this.ui.onTab = () => {};
    this.scene.dispose();
  }

  private select(id: string): void {
    const skin = MALLET_SKINS.find((s) => s.id === id);
    if (!skin) return;
    equipMallet(id);
    // Color skins share one model (instant recolor); textured skins bring their own model.
    if (skin.model || this.shown.model) {
      loadPaddleModel(this.scene, this.pivot, skin, 1).catch((e) => console.warn('Skin model failed to load', e));
    } else {
      applyMalletLook(this.pivot, skin);
    }
    this.shown = skin;
    // A little hop so the change registers.
    this.spin += 5;
    this.idle = 0;
    this.ui.render('mallets', MALLET_SKINS, id, thumbCache.mallets);
  }

  private selectPuck(id: string): void {
    if (!PUCK_SKINS.some((s) => s.id === id)) return;
    equipPuck(id);
    loadPuckModel(this.scene, this.puckPivot, id, 1).catch((e) => console.warn('Puck model failed to load', e));
    this.spin += 5;
    this.idle = 0;
    this.ui.render('pucks', PUCK_SKINS, id, thumbCache.pucks);
  }

  private selectTable(id: string): void {
    if (!TABLE_SKINS.some((s) => s.id === id)) return;
    equipTable(id);
    this.showTable(id);
    this.spin += 5;
    this.idle = 0;
    this.ui.render('tables', TABLE_SKINS, id, thumbCache.tables);
  }

  /** Builds the table skin's model on the pedestal, replacing the one shown once it is ready. */
  private showTable(id: string): void {
    const token = ++this.tableToken;
    const node = new TransformNode('lockerTable', this.scene);
    node.parent = this.tableFit;
    buildTableModel(this.scene, node, id)
      .then((meshes) => {
        if (token !== this.tableToken) {
          node.dispose(false, true);
          return;
        }
        fitToUnit(node, meshes);
        for (const old of this.tableFit.getChildren()) if (old !== node) old.dispose(false, true); // with its materials
      })
      .catch((e) => console.warn('Locker table failed to load', e));
  }

  /** Stand the mallet on the pedestal sprite: its top-surface center, at ~58% of its width. */
  private fit(): void {
    const ped = this.ui.pedestalRect();
    if (!ped) return;
    const scene = this.scene;
    scene.setTransformMatrix(this.camera.getViewMatrix(true), this.camera.getProjectionMatrix(true));
    const ray = scene.createPickingRay(ped.left + ped.width / 2, ped.top + ped.height * 0.32, null, this.camera);
    const t = -ray.origin.y / ray.direction.y;
    const base = ray.origin.add(ray.direction.scale(t));
    for (const node of [this.pivot, this.puckPivot, this.tablePivot]) node.position.copyFrom(base);

    // World units → CSS pixels at that spot, to size the model to the pedestal.
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const vp = this.camera.viewport.toGlobal(w, h);
    const a = Vector3.Project(base, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    const b = Vector3.Project(base.add(new Vector3(1, 0, 0)), Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    const cssPerRender = this.canvas.clientWidth / w;
    const unitCss = Math.abs(b.x - a.x) * cssPerRender;
    if (unitCss > 0) {
      this.pivot.scaling.setAll((ped.width * ON_PEDESTAL.mallets) / unitCss);
      this.puckPivot.scaling.setAll((ped.width * ON_PEDESTAL.pucks) / unitCss);
      this.tablePivot.scaling.setAll((ped.width * ON_PEDESTAL.tables) / unitCss);
    }
  }

  /** Renders a transparent snapshot of each skin for the cards (once per session). */
  private async renderThumbnails(): Promise<void> {
    if (MALLET_SKINS.every((s) => thumbCache.mallets.has(s.id))) return;
    const studio = new TransformNode('thumbStudio', this.scene);
    studio.position.copyFrom(THUMB_SPOT);
    studio.rotation.set(0, -0.6, 0);
    const cam = new FreeCamera('thumbCam', THUMB_SPOT.add(new Vector3(0, 1.75, -2.6)), this.scene);
    cam.fov = 0.5;
    cam.setTarget(THUMB_SPOT.add(new Vector3(0, 0.36, 0)));
    try {
      let loaded: MalletSkin | null = null;
      for (const skin of MALLET_SKINS as MalletSkin[]) {
        if (this.disposed) return;
        if (thumbCache.mallets.has(skin.id)) continue;
        if (!loaded || skin.model || loaded.model) await loadPaddleModel(this.scene, studio, skin, 1);
        else applyMalletLook(studio, skin);
        loaded = skin;
        await this.scene.whenReadyAsync();
        const url = await CreateScreenshotUsingRenderTargetAsync(this.engine, cam, { width: 256, height: 256 }, 'image/png', 4, true);
        thumbCache.mallets.set(skin.id, url);
        this.ui.setThumb('mallets', skin.id, url);
      }
    } finally {
      if (!this.disposed) {
        studio.dispose();
        cam.dispose();
      }
    }
  }

  /** Card picture for each puck, seen from above at an angle so its top design shows. */
  private async renderPuckThumbnails(): Promise<void> {
    if (this.disposed || PUCK_SKINS.every((s) => thumbCache.pucks.has(s.id))) return;
    const studio = new TransformNode('puckThumbStudio', this.scene);
    studio.position.copyFrom(THUMB_SPOT);
    studio.rotation.set(0, -0.6, 0);
    const cam = new FreeCamera('puckThumbCam', THUMB_SPOT.add(new Vector3(0, 1.9, -1.9)), this.scene);
    cam.fov = 0.5;
    cam.setTarget(THUMB_SPOT.add(new Vector3(0, 0.1, 0)));
    try {
      for (const skin of PUCK_SKINS) {
        if (this.disposed) return;
        if (thumbCache.pucks.has(skin.id)) continue;
        await loadPuckModel(this.scene, studio, skin.id, 1);
        await this.scene.whenReadyAsync();
        const url = await CreateScreenshotUsingRenderTargetAsync(this.engine, cam, { width: 256, height: 256 }, 'image/png', 4, true);
        thumbCache.pucks.set(skin.id, url);
        this.ui.setThumb('pucks', skin.id, url);
      }
    } finally {
      if (!this.disposed) {
        studio.dispose();
        cam.dispose();
      }
    }
  }

  /** Card picture for each table: the same model as the preview, at a three-quarter angle. */
  private async renderTableThumbnails(): Promise<void> {
    if (this.disposed || TABLE_SKINS.every((s) => thumbCache.tables.has(s.id))) return;
    const studio = new TransformNode('tableThumbStudio', this.scene);
    studio.position.copyFrom(THUMB_SPOT);
    studio.rotation.set(0, -0.35, 0);
    const fit = new TransformNode('tableThumbFit', this.scene);
    fit.parent = studio;
    fit.rotation.y = Math.PI / 2;
    fit.scaling.setAll(1.25); // about as wide in the card as a mallet
    const cam = new FreeCamera('tableThumbCam', THUMB_SPOT.add(new Vector3(0, 1.75, -2.6)), this.scene);
    cam.fov = 0.5;
    cam.setTarget(THUMB_SPOT.add(new Vector3(0, 0.3, 0)));
    try {
      for (const skin of TABLE_SKINS) {
        if (this.disposed) return;
        if (thumbCache.tables.has(skin.id)) continue;
        const inner = new TransformNode('tableThumbModel', this.scene);
        inner.parent = fit;
        fitToUnit(inner, await buildTableModel(this.scene, inner, skin.id));
        await this.scene.whenReadyAsync();
        const url = await CreateScreenshotUsingRenderTargetAsync(this.engine, cam, { width: 256, height: 256 }, 'image/png', 4, true);
        inner.dispose(false, true);
        thumbCache.tables.set(skin.id, url);
        this.ui.setThumb('tables', skin.id, url);
      }
    } finally {
      if (!this.disposed) {
        studio.dispose();
        cam.dispose();
      }
    }
  }

  // ---------- Drag left/right to spin ----------

  private readonly onDown = (e: PointerEvent): void => {
    if (this.drag) return;
    this.drag = { id: e.pointerId, x: e.clientX, t: performance.now() };
    this.spin = 0;
    this.idle = 0;
  };

  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    const dx = e.clientX - d.x;
    // Negative: the side facing the camera follows the finger (drag right → it turns right).
    const step = -dx * 0.012;
    this.yaw += step;
    // Remember the swipe speed for the flick when the finger lifts.
    const dt = Math.max(1, now - d.t) / 1000;
    this.spin = this.spin * 0.5 + (step / dt) * 0.5;
    d.x = e.clientX;
    d.t = now;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    // A finger that stopped before lifting shouldn't fling.
    if (performance.now() - this.drag.t > 80) this.spin = 0;
    this.spin = Math.max(-12, Math.min(12, this.spin));
    this.drag = null;
  };
}

/**
 * Scales a node holding the game-scale table so the table is one unit long, standing on y = 0
 * (its legs reach below the playing surface).
 */
function fitToUnit(node: TransformNode, meshes: Mesh[]): void {
  if (!meshes.length) return;
  let minY = Infinity;
  let span = 0;
  for (const m of meshes) {
    const { minimum, maximum } = m.getBoundingInfo().boundingBox;
    minY = Math.min(minY, minimum.y);
    span = Math.max(span, maximum.x - minimum.x, maximum.z - minimum.z);
  }
  const k = 1 / span;
  node.scaling.scaleInPlace(k);
  node.position.y = -minY * k;
}
