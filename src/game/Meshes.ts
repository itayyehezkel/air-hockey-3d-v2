import {
  BaseTexture,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  ImportMeshAsync,
  PBRMaterial,
  RawCubeTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '../babylon';
import malletModelUrl from '../assets/mallet.glb';
import puckModelUrl from '../assets/puck-star.glb';
import puckMacaronModelUrl from '../assets/puck-macaron.glb';
import puckSnowflakeModelUrl from '../assets/puck-snowflake.glb';
import puckSunModelUrl from '../assets/puck-sun.glb';
import vfxSunUrl from '../assets/vfx/sun.png';
import vfxLadybugUrl from '../assets/vfx/ladybug.png';
import vfxBeachBallUrl from '../assets/vfx/beachball.png';
import vfxCherryUrl from '../assets/vfx/cherry.png';
import vfxBaoUrl from '../assets/vfx/bao.png';
import vfxSteamUrl from '../assets/vfx/steam.png';
import vfxLeafUrl from '../assets/vfx/leaf.png';
import vfxRainDropUrl from '../assets/vfx/raindrop.png';
import vfxGoldSparkleUrl from '../assets/vfx/goldsparkle.png';
import puckLadybugModelUrl from '../assets/puck-ladybug.glb';
import vfxRedDotUrl from '../assets/vfx/reddot.png';
import puckBeachBallModelUrl from '../assets/puck-beachball.glb';
import vfxYellowDotUrl from '../assets/vfx/yellowdot.png';
import puckCherryPieModelUrl from '../assets/puck-cherrypie.glb';
import vfxCrustDotUrl from '../assets/vfx/crustdot.png';
import puckBaoModelUrl from '../assets/puck-bao.glb';
import puckLilyPadModelUrl from '../assets/puck-lilypad.glb';
import vfxStarUrl from '../assets/vfx/star.png';
import vfxTwinkleUrl from '../assets/vfx/twinkle.png';
import vfxHeartUrl from '../assets/vfx/heart.png';
import vfxSprinklesUrl from '../assets/vfx/sprinkles.png';
import vfxSnowflakeUrl from '../assets/vfx/snowflake.png';
import vfxFrostUrl from '../assets/vfx/frost.png';
import tableModelUrl from '../assets/table-classic.glb';
import tableSurfaceUrl from '../assets/table-classic-surface.webp';
import tableGardenModelUrl from '../assets/table-garden.glb';
import tableCloudyModelUrl from '../assets/table-cloudy.glb';
import tablePicnicModelUrl from '../assets/table-picnic.glb';
import tableBeachModelUrl from '../assets/table-beach.glb';
import tableIceCreamModelUrl from '../assets/table-icecream.glb';
import tableFrozenModelUrl from '../assets/table-frozen.glb';
import tableDimSumModelUrl from '../assets/table-dimsum.glb';
import tableRainyModelUrl from '../assets/table-rainy.glb';
import goalModelUrl from '../assets/goal.glb';
import { CORNER_R, GOAL_HALF, HALF_L, HALF_W, TABLE } from './Physics';

export const COLORS = {
  player: Color3.FromHexString('#1f6bff'),
  ai: Color3.FromHexString('#f0303c'),
  puck: Color3.FromHexString('#ffc81f'),
  rail: Color3.FromHexString('#ec2c38'),
  corner: Color3.FromHexString('#1f63f0'),
};

/** Rail thickness: the rails are round tubes of radius RAIL_T / 2 whose inner edge is the physics wall. */
export const RAIL_T = 0.56;
const RAIL_R = RAIL_T / 2;

/** Bright daylight lighting, shared by both table scenes. */
export function createStage(scene: Scene): void {
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor = new Color3(0.35, 0.38, 0.45);
  // Input is handled with our own ray cast; skip Babylon's per-pointer-event mesh picking.
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;
  // The whole table is always in view: skip the per-mesh visibility tests every frame.
  scene.skipFrustumClipping = true;

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;
  hemi.groundColor = new Color3(0.45, 0.5, 0.65);
  hemi.specular = Color3.Black(); // a top-down camera would see the whole table as one highlight

  const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.45), scene);
  sun.position = new Vector3(6, 16, -8);
  sun.intensity = 1.0;
  sun.specular = new Color3(0.9, 0.9, 0.9);
}

function mat(scene: Scene, name: string, diffuse: Color3, emissive = Color3.Black(), spec = 0.3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  m.emissiveColor = emissive;
  m.specularColor = new Color3(spec, spec, spec);
  return m;
}

/** Glossy toy plastic: saturated diffuse, a little self-light so shadows stay colorful, a tight highlight. */
function plastic(scene: Scene, name: string, color: Color3): StandardMaterial {
  const m = mat(scene, name, color, color.scale(0.22), 0.9);
  m.specularPower = 64;
  return m;
}

export interface TableParts {
  root: TransformNode;
  /** Glow strips inside each goal mouth, keyed by the side that defends it. */
  goalGlow: { bottom: StandardMaterial; top: StandardMaterial };
  /** The procedural table (surface, rails, goals, cabinet): the stand-in until the model loads. */
  stand: Mesh[];
  /** True once the table model is in: its goals are slots the puck can't drop through. */
  solidGoals: boolean;
}

export function createTable(scene: Scene): TableParts {
  const root = new TransformNode('table', scene);
  const W = TABLE.width;
  const L = TABLE.length;

  // Playing surface: white with air holes and light-blue markings, all drawn in code to match the physics.
  const texW = 512;
  const texH = Math.round((texW * L) / W);
  const surfaceTex = new DynamicTexture('surfaceTex', { width: texW, height: texH }, scene, true);
  drawSurface(surfaceTex, texW, texH);

  const surface = MeshBuilder.CreateGround('surface', { width: W, height: L }, scene);
  const surfaceMat = mat(scene, 'surfaceMat', Color3.White(), new Color3(0.3, 0.32, 0.36), 0.12);
  surfaceMat.diffuseTexture = surfaceTex;
  surfaceMat.specularPower = 64;
  surface.material = surfaceMat;
  surface.parent = root;

  // Cabinet: red body with a blue skirt, on short navy legs. Rounded to follow the corner rails.
  const body = createRoundedSlab(scene, 'body', 0, 0.7, plastic(scene, 'bodyMat', COLORS.rail.scale(0.85)));
  body.position.y = -0.37;
  body.parent = root;
  const skirt = createRoundedSlab(scene, 'skirt', 0.04, 0.16, plastic(scene, 'skirtMat', COLORS.corner));
  skirt.position.y = -0.7;
  skirt.parent = root;

  const legMat = plastic(scene, 'legMat', Color3.FromHexString('#16307a'));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = MeshBuilder.CreateCylinder('leg', { diameter: 0.5, height: 1.6, tessellation: 20 }, scene);
      leg.position.set(sx * (HALF_W - 0.2), -1.55, sz * (HALF_L - 0.5));
      leg.material = legMat;
      leg.parent = root;
    }
  }

  // Rails: chunky round tubes. Red straights, blue rounded corners.
  const railMat = plastic(scene, 'railMat', COLORS.rail);
  const cornerMat = plastic(scene, 'cornerMat', COLORS.corner);
  const addRail = (length: number, x: number, z: number, alongX: boolean) => {
    // A capsule's height includes its two end caps.
    const rail = MeshBuilder.CreateCapsule('rail', { radius: RAIL_R, height: length + RAIL_T, tessellation: 24, capSubdivisions: 8 }, scene);
    rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    rail.position.set(x, RAIL_R, z);
    rail.material = railMat;
    rail.parent = root;
  };
  // Side rails run between the corner arcs.
  for (const sx of [-1, 1]) addRail(L - CORNER_R * 2, sx * (HALF_W + RAIL_R), 0, false);
  // End rails run from each goal post to the corner arc. The rounded cap at the post end
  // touches the physics post point (±GOAL_HALF, ±HALF_L).
  const endLen = HALF_W - CORNER_R - GOAL_HALF;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) addRail(endLen, sx * (GOAL_HALF + endLen / 2), sz * (HALF_L + RAIL_R), true);
  }

  // Rounded corners (matching the physics): blue tube elbows.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (HALF_W - CORNER_R);
      const cz = sz * (HALF_L - CORNER_R);
      const path: Vector3[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * (Math.PI / 2);
        path.push(new Vector3(cx + sx * (CORNER_R + RAIL_R) * Math.cos(a), RAIL_R, cz + sz * (CORNER_R + RAIL_R) * Math.sin(a)));
      }
      const elbow = MeshBuilder.CreateTube('cornerRail', { path, radius: RAIL_R * 1.1, tessellation: 24, cap: Mesh.CAP_ALL }, scene);
      elbow.material = cornerMat;
      elbow.parent = root;
      // Pipe-fitting collars where the blue elbow meets the red straights.
      for (const [a, b] of [[path[0], path[1]], [path[20], path[19]]]) {
        const collar = MeshBuilder.CreateTorus('collar', { diameter: RAIL_T * 1.12, thickness: RAIL_T * 0.26, tessellation: 24 }, scene);
        collar.position.copyFrom(a);
        const dir = a.subtract(b).normalize();
        // Torus axis is +Y; tilt it to lie along the rail direction.
        collar.rotation.set(dir.z !== 0 ? Math.PI / 2 : 0, 0, dir.x !== 0 ? Math.PI / 2 : 0);
        collar.material = cornerMat;
        collar.parent = root;
      }
    }
  }

  // Goal mouths: a dark pocket inside a chunky U-shaped frame (red at the CPU end, blue at the
  // player end, as in the mockups), with a strip in the defender's color that flashes on goals.
  const pocketMat = mat(scene, 'pocketMat', Color3.FromHexString('#0b1c4a'), Color3.Black(), 0);
  const makeGoal = (sz: number, color: Color3, frameColor: Color3): StandardMaterial => {
    const frameMat = plastic(scene, 'goalFrameMat', frameColor);
    const pocket = MeshBuilder.CreateBox('pocket', { width: TABLE.goalWidth, depth: RAIL_T, height: 0.06 }, scene);
    pocket.position.set(0, -0.03, sz * (HALF_L + RAIL_R));
    pocket.material = pocketMat;
    pocket.parent = root;
    const H = RAIL_T * 1.25;
    const cheekW = 0.24;
    const parts: [number, number, number, number, number, number][] = [
      // [width, height, depth, x, y, z]
      [TABLE.goalWidth + cheekW * 2, H, 0.18, 0, H / 2 - 0.02, sz * (HALF_L + RAIL_T + 0.05)], // back
      [cheekW, H, RAIL_T + 0.2, -(GOAL_HALF + cheekW / 2), H / 2 - 0.02, sz * (HALF_L + RAIL_R + 0.05)], // cheeks
      [cheekW, H, RAIL_T + 0.2, GOAL_HALF + cheekW / 2, H / 2 - 0.02, sz * (HALF_L + RAIL_R + 0.05)],
    ];
    // The far (CPU) goal gets a roof, so from the camera it reads as a red mouth; the near goal
    // stays open so you look down into its dark slot through the blue frame.
    if (sz > 0) parts.push([TABLE.goalWidth + cheekW * 2, 0.16, RAIL_T + 0.2, 0, H - 0.08, sz * (HALF_L + RAIL_R + 0.05)]);
    for (const [w, h, d, x, y, z] of parts) {
      const part = MeshBuilder.CreateBox('goalFrame', { width: w, height: h, depth: d }, scene);
      part.position.set(x, y, z);
      part.material = frameMat;
      part.parent = root;
    }
    const glowMat = mat(scene, 'goalGlow', Color3.Black(), color.scale(0.55));
    glowMat.disableLighting = true;
    const strip = MeshBuilder.CreateBox('goalStrip', { width: TABLE.goalWidth, depth: 0.06, height: 0.1 }, scene);
    strip.position.set(0, 0.05, sz * (HALF_L + RAIL_T - 0.05));
    strip.material = glowMat;
    strip.parent = root;
    return glowMat;
  };

  const goalGlow = { bottom: makeGoal(-1, COLORS.player, COLORS.corner), top: makeGoal(1, COLORS.ai, COLORS.rail) };
  const strips = root.getChildMeshes(true).filter((m) => m.name === 'goalStrip') as Mesh[];
  const merged = mergeStatic(root, [surface, ...strips]);
  return { root, goalGlow, stand: [...merged, surface, ...strips], solidGoals: false };
}

/**
 * The table never moves: merge its parts into one mesh per material (dozens of draw calls → a
 * handful), freeze their world matrices and materials so Babylon skips per-frame work on them.
 * `keep` meshes stay separate (the surface's texture is its own; the goal strips animate).
 * Returns the merged meshes.
 */
function mergeStatic(root: TransformNode, keep: Mesh[]): Mesh[] {
  const result: Mesh[] = [];
  const groups = new Map<unknown, Mesh[]>();
  for (const m of root.getChildMeshes(true)) {
    if (!(m instanceof Mesh) || keep.includes(m)) continue;
    const list = groups.get(m.material) ?? [];
    list.push(m);
    groups.set(m.material, list);
  }
  for (const list of groups.values()) {
    const mat = list[0].material;
    for (const m of list) m.computeWorldMatrix(true);
    const merged = list.length > 1 ? Mesh.MergeMeshes(list, true, true) : list[0];
    if (!merged) continue;
    merged.parent = root;
    merged.isPickable = false;
    merged.freezeWorldMatrix();
    merged.doNotSyncBoundingInfo = true;
    mat?.freeze();
    result.push(merged);
  }
  for (const m of keep) m.freezeWorldMatrix();
  keep[0].material?.freeze(); // the surface (its texture is drawn once at load)
  return result;
}

/**
 * A slab covering the table plus rails, with corners rounded concentric to the corner rails:
 * a cross of two boxes plus a cylinder in each corner, merged into one mesh.
 */
function createRoundedSlab(scene: Scene, name: string, grow: number, height: number, material: StandardMaterial): Mesh {
  const r = CORNER_R + RAIL_T - 0.02 + grow;
  const cx = HALF_W - CORNER_R;
  const cz = HALF_L - CORNER_R;
  const parts: Mesh[] = [
    MeshBuilder.CreateBox(`${name}A`, { width: cx * 2 + r * 2, depth: cz * 2, height }, scene),
    MeshBuilder.CreateBox(`${name}B`, { width: cx * 2, depth: cz * 2 + r * 2, height }, scene),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const c = MeshBuilder.CreateCylinder(`${name}C`, { diameter: r * 2, height, tessellation: 32 }, scene);
      c.position.set(sx * cx, 0, sz * cz);
      parts.push(c);
    }
  }
  const slab = Mesh.MergeMeshes(parts, true)!;
  slab.name = name;
  slab.material = material;
  return slab;
}

function drawSurface(tex: DynamicTexture, w: number, h: number): void {
  const c = tex.getContext() as CanvasRenderingContext2D;
  // Faint vertical sheen so the white surface doesn't read as flat paper.
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#e9f1fa');
  g.addColorStop(0.5, '#fbfdff');
  g.addColorStop(1, '#e9f1fa');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  // Soft contact shadow from the rails, painted in once (they no longer cast real-time shadows).
  // Offset to match the sun: light travels toward -x and +z (+z is the top of the texture).
  const unit = w / TABLE.width;
  const rr = CORNER_R * unit;
  const tableOutline = () => {
    c.moveTo(rr, 0);
    c.arcTo(w, 0, w, h, rr);
    c.arcTo(w, h, 0, h, rr);
    c.arcTo(0, h, 0, 0, rr);
    c.arcTo(0, 0, w, 0, rr);
    c.closePath();
  };
  c.save();
  c.beginPath();
  tableOutline();
  c.clip();
  c.shadowColor = 'rgba(25, 45, 100, 0.42)';
  c.shadowBlur = unit * 0.3;
  c.shadowOffsetX = -unit * 0.07;
  c.shadowOffsetY = -unit * 0.09;
  c.fillStyle = '#000';
  c.beginPath();
  c.rect(-w, -h, w * 3, h * 3);
  tableOutline();
  c.fill('evenodd'); // the frame itself lies outside the clip; only its shadow falls inside
  c.restore();

  // Air holes.
  c.fillStyle = 'rgba(85, 105, 145, 0.5)';
  const step = 27;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      c.beginPath();
      c.arc(x, y, 2.2, 0, Math.PI * 2);
      c.fill();
    }
  }
  drawMarkings(c, w, h);
  tex.update();
}

function drawMarkings(c: CanvasRenderingContext2D, w: number, h: number): void {
  const line = (width: number, draw: () => void) => {
    c.strokeStyle = '#4aa6f2';
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    draw();
    c.stroke();
  };
  const cx = w / 2;
  const cy = h / 2;
  const unit = w / TABLE.width;
  // Canvas top maps to +z (opponent side).
  line(6, () => {
    c.moveTo(0, cy);
    c.lineTo(w, cy);
  });
  line(6, () => c.arc(cx, cy, unit * 1.0, 0, Math.PI * 2));
  // Creases: an ellipse around each goal area, broken at the top and bottom like "( )".
  const creaseRx = unit * 1.75;
  const creaseRy = unit * 0.95;
  const gap = 0.55; // radians left open around the vertical axis
  for (const cyE of [unit * 1.45, h - unit * 1.45]) {
    line(6, () => c.ellipse(cx, cyE, creaseRx, creaseRy, 0, -Math.PI / 2 + gap, Math.PI / 2 - gap));
    line(6, () => c.ellipse(cx, cyE, creaseRx, creaseRy, 0, Math.PI / 2 + gap, (3 * Math.PI) / 2 - gap));
  }
}

/** Procedural stand-in, shown until the mallet model has loaded (or if it fails to). */
export function createPaddle(scene: Scene, name: string, color: Color3): TransformNode {
  const root = new TransformNode(name, scene);
  const R = TABLE.paddleRadius;
  const shell = plastic(scene, `${name}Shell`, color);

  const base = MeshBuilder.CreateTorus(`${name}Base`, { diameter: R * 2 - 0.16, thickness: 0.16, tessellation: 48 }, scene);
  base.position.y = 0.08;
  const floor = MeshBuilder.CreateCylinder(`${name}Floor`, { diameter: R * 1.7, height: 0.06, tessellation: 48 }, scene);
  floor.position.y = 0.03;
  const neck = MeshBuilder.CreateCylinder(`${name}Neck`, { diameterTop: 0.26, diameterBottom: 0.4, height: 0.32, tessellation: 32 }, scene);
  neck.position.y = 0.22;
  const knob = MeshBuilder.CreateSphere(`${name}Knob`, { diameter: 0.46, segments: 24 }, scene);
  knob.position.y = 0.52;

  for (const m of [base, floor, neck, knob]) {
    m.material = shell;
    m.parent = root;
  }
  return root;
}

/** Procedural stand-in, shown until the puck model has loaded (or if it fails to). */
export function createPuck(scene: Scene): TransformNode {
  const root = new TransformNode('puck', scene);
  const body = MeshBuilder.CreateCylinder('puckBody', { diameter: TABLE.puckRadius * 2, height: 0.1, tessellation: 40 }, scene);
  body.position.y = 0.05;
  body.material = plastic(scene, 'puckBody', COLORS.puck);
  body.parent = root;
  return root;
}

/**
 * Loads a Scenario-generated GLB (GPT Image 2.5 concept → Tripo 3.1) under `parent`, scaled so
 * its 1-unit-wide model is `size` wide and resting on the table, and replaces the procedural stand-in.
 */
let loadCounter = 0;

/**
 * Loads a Scenario-generated GLB under `parent`, auto-fitted from its own bounds: `size` wide,
 * resting on y = 0 (optionally flattened by squashY), replacing whatever model was there. If a
 * newer load for the same parent starts meanwhile (fast skin switching), the older one is dropped.
 */
async function loadModel(
  scene: Scene,
  parent: TransformNode,
  url: string,
  size: number,
  squashY: number,
  tune: (m: PBRMaterial) => void,
  yaw = 0,
): Promise<void> {
  const token = ++loadCounter;
  parent.metadata = { ...parent.metadata, loadToken: token };
  const { meshes } = await ImportMeshAsync(url, scene, { pluginExtension: '.glb' });
  const root = meshes[0];
  if (parent.isDisposed() || parent.metadata?.loadToken !== token) {
    root.dispose();
    return;
  }
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const scale = size / Math.max(max.x - min.x, max.z - min.z);
  const previous = parent.getChildMeshes();
  root.parent = parent;
  root.scaling.scaleInPlace(scale);
  root.scaling.y *= squashY;
  root.position.y = -min.y * scale * squashY; // rest the model's underside on the table
  if (yaw) root.addRotation(0, yaw, 0);
  for (const m of meshes) {
    m.isPickable = false;
    if (m.material instanceof PBRMaterial) {
      tune(m.material);
      freezeWhenReady(m.material);
    }
  }
  // The stand-in (or the previous skin) goes, with its materials.
  const oldMaterials = new Set(previous.map((m) => m.material).filter((m) => m !== null));
  for (const m of previous) m.dispose();
  for (const m of oldMaterials) m.dispose(false, true);
}

/**
 * A skin's material never changes after it is set up, so it is frozen (no per-frame checks), but only
 * once all its textures are ready and it has been drawn: frozen earlier, it would stay without them
 * (the gold mallet lost its shine, frozen before its reflection texture was ready).
 */
function freezeWhenReady(m: PBRMaterial): void {
  const scene = m.getScene();
  BaseTexture.WhenAllReady(m.getActiveTextures(), () => {
    scene.onAfterRenderObservable.addOnce(() => {
      if (!m.isFrozen) m.freeze();
    });
  });
}

/**
 * The generated materials are fully metallic, which renders almost black without an environment
 * map. Turn them into glossy plastic lit by the scene lights.
 */
function toPlastic(m: PBRMaterial): void {
  m.metallic = 0;
  m.roughness = 0.3;
  m.metallicTexture = null;
  m.directIntensity = 1.5;
}

/**
 * How a mallet looks: a Locker skin, or the opponent's plain red. Color skins recolor the base
 * mallet model; skins with their own `model` (e.g. watermelon) keep its painted texture.
 */
export interface MalletLook {
  color: string;
  roughness: number;
  glow: number;
  model?: string;
  /** Real metal (gold/chrome): reflects a small studio environment instead of looking like plastic. */
  metal?: boolean;
  /** Model turn (radians) so its front faces the player. */
  yaw?: number;
}

export const OPPONENT_MALLET: MalletLook = { color: '#f0303c', roughness: 0.25, glow: 0.12 };

/** Recolors a loaded color-skin mallet in place (no reload). */
export function applyMalletLook(root: TransformNode, look: MalletLook): void {
  for (const mesh of root.getChildMeshes()) {
    if (mesh.material instanceof PBRMaterial) paintMallet(mesh.material, look);
  }
}

function paintMallet(m: PBRMaterial, look: MalletLook): void {
  toPlastic(m);
  // PBR colors are linear; a gamma-space hex color would render washed out.
  const linear = Color3.FromHexString(look.color).toLinearSpace();
  m.albedoTexture = null;
  m.albedoColor = linear;
  m.emissiveColor = linear.scale(look.glow);
  m.roughness = look.roughness;
  m.directIntensity = 1.2;
}

/** Textured skins: glossy plastic that keeps the painted pattern (lit by the scene, not metallic). */
function texturedMallet(m: PBRMaterial, look: MalletLook): void {
  toPlastic(m);
  m.roughness = look.roughness;
  m.emissiveTexture = m.albedoTexture;
  m.emissiveColor = new Color3(look.glow, look.glow, look.glow);
  m.directIntensity = 1.2;
  if (look.metal) {
    // Metal: the skin color is the reflectance tint (a painted texture reads brown once metallic),
    // and the neutral studio environment supplies the shine.
    m.albedoTexture = null;
    m.albedoColor = Color3.FromHexString(look.color).toLinearSpace();
    m.emissiveTexture = null;
    m.emissiveColor = Color3.FromHexString(look.color).toLinearSpace().scale(look.glow);
    m.metallic = 1;
    m.reflectionTexture = studioEnvironment(m.getScene());
    m.environmentIntensity = 1.6;
  }
}

const STUDIO_SIZE = 32;
let studioPixels: Uint8Array[] | null = null;

/**
 * A tiny procedural reflection environment (sky-blue gradient, bright soft boxes, darker floor).
 * Metal needs something to reflect; loading an HDR file would add size. Each material gets its own
 * texture (32x32 per face, so cheap): a model is disposed with its textures, and a shared one would
 * be pulled out from under other metal skins (the Locker's card renders did that to its pedestal).
 */
function studioEnvironment(scene: Scene): RawCubeTexture {
  studioPixels ??= studioFaces();
  return new RawCubeTexture(scene, studioPixels, STUDIO_SIZE);
}

function studioFaces(): Uint8Array[] {
  const N = STUDIO_SIZE;
  // Babylon cube face order: +x, -x, +y, -y, +z, -z.
  const faces: [number, number, number][][] = [
    [[0, 0, -1], [0, -1, 0], [1, 0, 0]],
    [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
    [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
    [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
  ];
  const softboxes: [number, number, number, number][] = [
    [-0.5, 0.75, -0.45, 1.6], // key light, upper left front (matches the sun)
    [0.7, 0.5, 0.5, 0.9], // rim light, back right
  ];
  const data = faces.map(([u, v, n]) => {
    const px = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = ((i + 0.5) / N) * 2 - 1;
        const b = ((j + 0.5) / N) * 2 - 1;
        let x = n[0] + u[0] * a + v[0] * b;
        let y = n[1] + u[1] * a + v[1] * b;
        let z = n[2] + u[2] * a + v[2] * b;
        const len = Math.hypot(x, y, z);
        x /= len;
        y /= len;
        z /= len;
        // Neutral studio: bright white-gray above, a soft gray floor below (a colored sky would
        // tint the metal; the skin color should set the tint).
        const t = Math.max(-1, Math.min(1, y));
        let r = t > 0 ? 0.78 + 0.22 * t : 0.3 + 0.35 * (1 + t);
        let g = r;
        let bl = t > 0 ? 0.8 + 0.2 * t : 0.32 + 0.35 * (1 + t);
        for (const [sx, sy, sz, k] of softboxes) {
          const d = (x * sx + y * sy + z * sz) / Math.hypot(sx, sy, sz);
          const spot = Math.max(0, d - 0.82) / 0.18;
          r += spot * k;
          g += spot * k;
          bl += spot * k;
        }
        const o = (j * N + i) * 4;
        px[o] = Math.min(255, r * 255);
        px[o + 1] = Math.min(255, g * 255);
        px[o + 2] = Math.min(255, bl * 255);
        px[o + 3] = 255;
      }
    }
    return px;
  });
  return data;
}

/**
 * Loads a mallet model for a look under `paddle`. `size` overrides the in-game footprint
 * (the Locker shows it bigger).
 */
export function loadPaddleModel(
  scene: Scene,
  paddle: TransformNode,
  look: MalletLook,
  size = TABLE.paddleRadius * 2,
): Promise<void> {
  const url = look.model ?? malletModelUrl;
  return loadModel(scene, paddle, url, size, 1, (m) => (look.model ? texturedMallet(m, look) : paintMallet(m, look)), look.yaw);
}

/**
 * What each part of a Scenario table model is. Tripo splits models differently, so some roles
 * are sorted further by position/height/facing (see `pieceOf`):
 * - `frame`: rails and body in one, split by height at the model's `frameSplit` (rail / trim / body)
 * - `end`: an end rail with its corners and goal frame in one, split by position
 * - `corner`: its upward-facing top is the `cap`
 * - `leg`: its lowest part is the `foot`
 */
type TableRole = 'surface' | 'frame' | 'end' | 'rail' | 'corner' | 'cap' | 'snow' | 'body' | 'leg' | 'goal';
type TablePiece = 'surface' | 'rail' | 'trim' | 'body' | 'corner' | 'cap' | 'leg' | 'foot' | 'goalFar' | 'goalNear';

/**
 * How a part is used. `mirror`: only its far half, plus a mirror copy for the near half (Tripo
 * rebuilds the player's goal as a closed box, while the far goal comes out open like the
 * concepts). `mirrorX`: also mirrored across the long axis. `grow` [x, y, z]: enlarged about its
 * center to overlap its neighbors, hiding ragged, gappy cut edges where Tripo split the parts.
 */
interface TablePart {
  role: TableRole;
  mirror?: boolean;
  mirrorX?: boolean;
  grow?: [number, number, number];
}

/**
 * A Scenario table model (concept → Tripo 3.1 "generate parts", untextured), measured in its own
 * units: the rails' inner edges (x from…to, z ±) and the playing surface's height; plus heights,
 * in game units, where its parts change look.
 */
interface TableModel {
  url: string;
  innerX: [number, number];
  innerZ: number;
  surfaceY: number;
  frameSplit?: [number, number]; // frame: rail above the first, trim above the second, body below
  capBottom: number;
  footTop: number;
  parts: Record<string, TablePart>;
}

const TABLE_MODELS: Record<string, TableModel> = {
  // Concept asset_btUiBNMgQaukFQ22VU3xdumV → model asset_Z3gTMKR19zAe72UjYLsmCpQn.
  classic: {
    url: tableModelUrl,
    innerX: [-0.2442, 0.2399],
    innerZ: 0.426,
    surfaceY: 0.1627,
    frameSplit: [-0.65, -0.95],
    capBottom: 0.2,
    footTop: -4.1,
    parts: {
      tripo_part_0: { role: 'surface', mirror: true },
      // Rails and body: the far-right quarter, mirrored both ways (the left rail's cut edges are
      // ragged where a mirror would show them).
      tripo_part_1: { role: 'frame', mirror: true, mirrorX: true },
      // Its own goal frame (tripo_part_10) is left out: every table uses the shared goal (buildGoals).
      // Corners as modeled (the far ones' outer ends are torn, which a mirror would show); the
      // near-left one's end is torn too, so it is the near-right one mirrored.
      tripo_part_2: { role: 'corner', grow: [1.06, 1.06, 1.06] },
      tripo_part_7: { role: 'corner', grow: [1.06, 1.06, 1.06], mirrorX: true },
      tripo_part_9: { role: 'corner', grow: [1.06, 1.06, 1.06] },
      tripo_part_3: { role: 'leg' },
      tripo_part_4: { role: 'leg' },
      tripo_part_5: { role: 'leg' },
      tripo_part_6: { role: 'leg' },
    },
  },
};

/**
 * A table built from a parts model: a playing-surface image (with a pocket-colored band past each
 * goal line) and a color per piece, measured from its concept.
 */
interface PartsLook {
  kind: 'parts';
  model: keyof typeof TABLE_MODELS;
  surface: string;
  /** Self-light on the surface image: more is brighter and closer to the image's own colors. */
  surfaceGlow: number;
  colors: Record<Exclude<TablePiece, 'surface'>, string>;
}

/**
 * A table that is one fully textured Scenario model (multi-view concept → Tripo 3.1 Multi View),
 * used as modeled. Measured in its own units: the rails' inner edges and the playing surface.
 */
interface TexturedLook {
  kind: 'textured';
  url: string;
  innerX: [number, number];
  innerZ: number;
  surfaceY: number;
  /** Stretches everything below the playing surface (body, legs) to match the classic table's height. */
  stretchBelow?: number;
  /**
   * The texture already has the concept's painted light and shading (made with Tripo's "delight"
   * off): shown as painted, unlit, so the colors are exactly the concept's.
   */
  unlit?: boolean;
}

type TableLook = PartsLook | TexturedLook;

export const TABLE_LOOKS: Record<string, TableLook> = {
  classic: {
    kind: 'parts',
    model: 'classic',
    surface: tableSurfaceUrl,
    surfaceGlow: 0.32,
    colors: {
      rail: '#ee2a2e', trim: '#ee2a2e', body: '#ee2a2e', corner: '#0a78f5', cap: '#0a78f5',
      leg: '#1c3866', foot: '#1c3866', goalFar: '#ee2a2e', goalNear: '#0a78f5',
    },
  },
  // The Classic table's own shape (goals included), painted with a theme: a concept sheet drawn over
  // the Classic reference views, projected onto the Classic geometry exported from the game
  // (tools/table-pipeline). Already in game units, so it fits 1:1.
  // Concept asset_fVLLAFSX5FZ2AKxtAnwGRQtv (Cosy Garden, for the Cat mallet).
  garden: { kind: 'textured', url: tableGardenModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_U25M8r6HiVUq4LebQ6g3vgw7 (Cloudy, for the Rainbow mallet).
  cloudy: { kind: 'textured', url: tableCloudyModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_txdQLNJPr5TwbGY3YD9N9YZW (Picnic, for the Watermelon mallet).
  picnic: { kind: 'textured', url: tablePicnicModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_FUmbQ9dgmCX5XwDmxt1kLjKy (Beach), surface redrawn without the shells.
  beach: { kind: 'textured', url: tableBeachModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_7ZGH2ApjJWE93s7svcR3WB85 (Ice Cream: waffle rails, chocolate body).
  icecream: { kind: 'textured', url: tableIceCreamModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_4THRMSEvGfH97HHDH23hEoXf (Frozen: snow rails, ice-brick body).
  frozen: { kind: 'textured', url: tableFrozenModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_DZGCwTfwbeQ216tPczHpo3dW (Dim Sum steamer, for the Panda mallet).
  dimsum: { kind: 'textured', url: tableDimSumModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
  // Same method, concept asset_bxXfXczSvy5voeskPTRLgc3j (Rainy day, for the Frog mallet).
  rainy: { kind: 'textured', url: tableRainyModelUrl, innerX: [-HALF_W, HALF_W], innerZ: HALF_L, surfaceY: 0, unlit: true },
};

/** The surface image has a pocket-colored band past each goal line, this deep (world units). */
const SURFACE_PAD = 0.797;

/**
 * Loads the equipped table skin's Scenario model in place of the procedural table (which is only
 * the loading stand-in).
 */
export async function loadTableModel(scene: Scene, table: TableParts, skin: string): Promise<void> {
  const meshes = await buildTableModel(scene, table.root, skin);
  if (!meshes.length) return;
  for (const m of meshes) m.freezeWorldMatrix(); // the game table never moves
  for (const m of table.stand) m.dispose();
  table.stand.length = 0;
  table.solidGoals = true;
}

/**
 * Builds a table skin under `parent`, at game scale (playing surface at y = 0). Also used for the
 * Locker's pedestal preview and card pictures. Returns no meshes if `parent` went away.
 */
export async function buildTableModel(scene: Scene, parent: TransformNode, skin: string): Promise<Mesh[]> {
  const look = TABLE_LOOKS[skin] ?? TABLE_LOOKS.classic;
  if (look.kind === 'textured') return buildTexturedTable(scene, parent, look);
  const geometry = await prepareTableGeometry(scene, look.model);
  if (parent.isDisposed()) return [];
  const meshes: Mesh[] = [];
  for (const [key, g] of geometry) {
    const mesh = new Mesh(`table_${key}`, scene);
    const data = new VertexData();
    data.positions = g.pos;
    data.normals = g.nrm;
    data.indices = g.idx;
    if (g.uv.length) data.uvs = g.uv;
    data.applyToMesh(mesh);
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.material = tableMaterial(scene, key, look);
    mesh.material.freeze();
    meshes.push(mesh);
  }
  meshes.push(...(await buildGoals(scene, parent, look.colors.goalNear, look.colors.goalFar)));
  return meshes;
}

/** A fully textured table model, fitted to the physics walls, with its own painted materials. */
async function buildTexturedTable(scene: Scene, parent: TransformNode, look: TexturedLook): Promise<Mesh[]> {
  const { meshes } = await ImportMeshAsync(look.url, scene, { pluginExtension: '.glb' });
  if (parent.isDisposed()) {
    meshes[0].dispose(false, true); // with its materials and textures
    return [];
  }
  fitTexturedModel(scene, parent, meshes[0], look);
  const result: Mesh[] = [];
  for (const m of meshes) {
    m.isPickable = false;
    const mat = m.material;
    if (mat instanceof PBRMaterial) {
      if (look.unlit) {
        mat.unlit = true;
      } else {
        toPlastic(mat);
        mat.emissiveTexture = mat.albedoTexture;
        mat.emissiveColor = new Color3(0.05, 0.05, 0.05);
        mat.directIntensity = 1.2;
      }
      // Seen at a slant: without anisotropic filtering the dots and lines smear.
      for (const t of mat.getActiveTextures()) t.anisotropicFilteringLevel = 8;
      mat.freeze();
    }
    if (m instanceof Mesh && m.getTotalVertices() > 0) result.push(m);
  }
  return result;
}

/**
 * Fits a model in the textured table's own units (the table itself, or a piece cut out of it)
 * under `parent`: scaled so its rails meet the physics walls, playing surface at y = 0, and
 * stretched below the surface if the look asks for it.
 */
function fitTexturedModel(scene: Scene, parent: TransformNode, root: TransformNode, look: TexturedLook): void {
  const [x0, x1] = look.innerX;
  const sx = (2 * HALF_W) / (x1 - x0);
  const sz = HALF_L / look.innerZ;
  const sy = (sx + sz) / 2;
  const fit = new TransformNode('tableFit', scene);
  fit.parent = parent;
  fit.scaling.set(sx, sy, sz);
  fit.position.set((-(x0 + x1) / 2) * sx, -look.surfaceY * sy, 0);
  root.parent = fit;
  if (!look.stretchBelow) return;
  for (const m of root.getChildMeshes()) {
    if (m instanceof Mesh && m.getTotalVertices() > 0) stretchBelowSurface(m, sy, fit.position.y, look.stretchBelow);
  }
}

/**
 * goal.glb is in the units of the Tripo Ice table it was cut from (the table itself is gone):
 * this fits it to the game the way that table was fitted.
 */
const GOAL_FIT: TexturedLook = {
  kind: 'textured',
  url: goalModelUrl,
  innerX: [-0.2451, 0.2413],
  innerZ: 0.4154,
  surfaceY: 0.1102,
  stretchBelow: 1.27,
};

/**
 * Every table's goals share one shape: the old Ice table's player goal, cut out of its model with
 * its dark pocket (goal.glb). Painted in the table's goal colors: `near` at the player's end, `far`
 * (turned around) at the opponent's.
 */
async function buildGoals(scene: Scene, parent: TransformNode, near: string, far: string): Promise<Mesh[]> {
  const fit = GOAL_FIT;
  const result: Mesh[] = [];
  for (const [color, turn] of [[near, 0], [far, Math.PI]] as const) {
    const { meshes } = await ImportMeshAsync(goalModelUrl, scene, { pluginExtension: '.glb' });
    if (parent.isDisposed()) {
      meshes[0].dispose(false, true); // with its materials and textures
      return result;
    }
    const holder = new TransformNode('goal', scene);
    holder.parent = parent;
    holder.rotation.y = turn;
    fitTexturedModel(scene, holder, meshes[0], fit);
    for (const m of meshes) {
      if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
      m.isPickable = false;
      const pocket = m.material?.name === 'pocket';
      m.material?.dispose(); // the file's placeholder material
      m.material = pocket ? mat(scene, 'goalPocket', GOAL_POCKET, GOAL_POCKET.scale(0.3), 0) : plastic(scene, 'goalFrame', Color3.FromHexString(color));
      m.material.freeze();
      result.push(m);
    }
  }
  return result;
}

const GOAL_POCKET = Color3.FromHexString('#10254f');

/**
 * Stretches a textured table model's vertices below the playing surface by `k` (in game units).
 * The model's own node transforms only turn it about y, so a vertex's game height is simply
 * `localY * scaleY + offsetY`.
 */
function stretchBelowSurface(mesh: Mesh, scaleY: number, offsetY: number, k: number): void {
  const pos = mesh.getVerticesData('position');
  if (!pos) return;
  for (let i = 1; i < pos.length; i += 3) {
    const y = pos[i] * scaleY + offsetY;
    if (y < 0) pos[i] = (y * k - offsetY) / scaleY;
  }
  mesh.setVerticesData('position', pos);
  mesh.refreshBoundingInfo();
}

type TableGeometry = Map<string, { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array }>;
const tableGeometry = new Map<string, Promise<TableGeometry>>();

/**
 * Each table model is loaded and prepared once per session; every scene then builds its table
 * from the result in a moment (no stand-in flashing when switching screens).
 */
function prepareTableGeometry(scene: Scene, model: string): Promise<TableGeometry> {
  let geometry = tableGeometry.get(model);
  if (!geometry) {
    geometry = extractTableGeometry(scene, TABLE_MODELS[model]).catch((e) => {
      tableGeometry.delete(model); // e.g. the loading scene was closed: the next scene tries again
      throw e;
    });
    tableGeometry.set(model, geometry);
  }
  return geometry;
}

/**
 * What piece a triangle is, from its part's role and where it sits (game units); null for bits
 * that are dropped.
 */
function pieceOf(role: TableRole, model: TableModel, x: number, y: number, z: number, up: number): TablePiece | null {
  switch (role) {
    case 'surface':
      // Past the goal lines it was the old goal mouth's floor: the shared goal has its own, and
      // this one is wider, so it would show around it.
      return Math.abs(z) > HALF_L + 0.05 ? null : role;
    case 'rail':
    case 'body':
    case 'cap':
      return role;
    case 'snow':
      return 'trim';
    case 'goal':
      return z > 0 ? 'goalFar' : 'goalNear';
    case 'leg':
      return y < model.footTop ? 'foot' : 'leg';
    case 'corner':
      return up > 0.5 && y > model.capBottom ? 'cap' : 'corner';
    case 'frame': {
      const [rail, trim] = model.frameSplit!;
      return y > rail ? 'rail' : y > trim ? 'trim' : 'body';
    }
    case 'end': {
      const ax = Math.abs(x);
      // Low bits over the playing area are a modeled goal-crease line: the surface image draws it.
      if (y < 0.5 && Math.abs(z) < HALF_L - 0.1 && ax < HALF_W - 0.2) return null;
      if (ax < GOAL_HALF + 0.5) return z > 0 ? 'goalFar' : 'goalNear';
      if (ax > HALF_W - CORNER_R) return up > 0.5 && y > model.capBottom ? 'cap' : 'corner';
      return 'rail';
    }
  }
}

async function extractTableGeometry(scene: Scene, model: TableModel): Promise<TableGeometry> {
  const { meshes } = await ImportMeshAsync(model.url, scene, { pluginExtension: '.glb' });
  const [x0, x1] = model.innerX;
  const sx = (2 * HALF_W) / (x1 - x0);
  const sz = HALF_L / model.innerZ;
  const sy = (sx + sz) / 2;
  const fit = new TransformNode('tableFit', scene);
  fit.scaling.set(sx, sy, sz);
  fit.position.set((-(x0 + x1) / 2) * sx, -model.surfaceY * sy, 0);
  meshes[0].parent = fit;
  fit.computeWorldMatrix(true);

  const groups = new Map<string, { pos: number[]; nrm: number[]; uv: number[] }>();
  const group = (key: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { pos: [], nrm: [], uv: [] }));
    return g;
  };
  const p = new Vector3();
  const n = new Vector3();
  for (const mesh of meshes) {
    const part = model.parts[mesh.name];
    if (!part || !(mesh instanceof Mesh)) continue;
    mesh.computeWorldMatrix(true);
    const wm = mesh.getWorldMatrix();
    const pos = mesh.getVerticesData('position')!;
    const nrm = mesh.getVerticesData('normal')!;
    const idx = mesh.getIndices()!;
    const isSurface = part.role === 'surface';
    const tris: number[][][] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const tri: number[][] = [];
      for (let k = 0; k < 3; k++) {
        const o = idx[t + k] * 3;
        Vector3.TransformCoordinatesFromFloatsToRef(pos[o], pos[o + 1], pos[o + 2], wm, p);
        Vector3.TransformNormalFromFloatsToRef(nrm[o], nrm[o + 1], nrm[o + 2], wm, n);
        n.normalize();
        tri.push([p.x, p.y, p.z, n.x, n.y, n.z]);
      }
      // Mirrored parts: only the half (or quarter) that gets mirrored, cut exactly at the axis so
      // the copies meet it seamlessly.
      if (part.mirror) {
        if (tri.every((v) => v[2] <= 0)) continue;
        for (const v of tri) v[2] = Math.max(0, v[2]);
      }
      if (part.mirrorX && part.mirror) {
        if (tri.every((v) => v[0] <= 0)) continue;
        for (const v of tri) v[0] = Math.max(0, v[0]);
      }
      tris.push(tri);
    }
    if (part.grow && tris.length) {
      const c = [0, 1, 2].map((a) => {
        const vals = tris.flatMap((tri) => tri.map((v) => v[a]));
        return (Math.min(...vals) + Math.max(...vals)) / 2;
      });
      const k = part.grow;
      for (const tri of tris) for (const v of tri) for (const a of [0, 1, 2]) v[a] = c[a] + (v[a] - c[a]) * k[a];
    }
    // Winding (the sign of the face normal's y) of the surface's upward faces, before flattening.
    const upWinding = isSurface ? Math.sign(tris.filter((tri) => tri.every((v) => v[4] > 0.9)).reduce((s, tri) => s + Math.sign(faceUp(tri)), 0)) : 0;
    for (const tri of tris) {
      if (isSurface) {
        // Laid perfectly flat (the modeled air holes are tiny dents). Their walls and floors are
        // kept (dropping them leaves pinholes) and turned to face up like the rest.
        if (tri[0][4] + tri[1][4] + tri[2][4] < -0.9) continue; // the underside
        for (const v of tri) {
          v[1] = 0;
          v[3] = 0;
          v[4] = 1;
          v[5] = 0;
        }
        if (Math.sign(faceUp(tri)) === -upWinding) [tri[1], tri[2]] = [tri[2], tri[1]];
      }
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      const up = (tri[0][4] + tri[1][4] + tri[2][4]) / 3;
      // The part as modeled, plus its mirror copies across the center line (z) and long axis (x).
      const copies: [number, number][] = [[1, 1]];
      if (part.mirror) copies.push([1, -1]);
      if (part.mirrorX) copies.push([-1, 1]);
      if (part.mirrorX && part.mirror) copies.push([-1, -1]);
      for (const [fx, fz] of copies) {
        const piece = pieceOf(part.role, model, cx * fx, cy, cz * fz, up);
        if (!piece) continue;
        const g = group(piece);
        const order = fx * fz < 0 ? [0, 2, 1] : [0, 1, 2]; // a mirror flips the winding
        for (const k of order) {
          const [x, y, z, nx, ny, nz] = tri[k];
          g.pos.push(x * fx, y, z * fz);
          g.nrm.push(nx * fx, ny, nz * fz);
          // Past the goal lines the image turns pocket-navy: the inside of each goal.
          if (piece === 'surface') g.uv.push((x * fx + HALF_W) / (2 * HALF_W), (z * fz + HALF_L + SURFACE_PAD) / (2 * (HALF_L + SURFACE_PAD)));
        }
      }
    }
  }
  meshes[0].dispose(false, true); // with its materials and textures
  fit.dispose();
  fillGoalOpenings(groups.get('rail'));
  const geometry: TableGeometry = new Map();
  for (const [key, g] of groups) geometry.set(key, weld(g.pos, g.nrm, g.uv));
  return geometry;
}

/**
 * Triangles come out with three vertices each; corners they share are merged (same position,
 * normal and uv), which cuts the vertex count ~3x for the GPU with the look unchanged.
 */
function weld(pos: number[], nrm: number[], uv: number[]): { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array } {
  const count = pos.length / 3;
  const hasUv = uv.length > 0;
  const seen = new Map<string, number>();
  const idx = new Uint32Array(count);
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const q = (v: number, s: number) => Math.round(v * s);
  for (let i = 0; i < count; i++) {
    const k =
      `${q(pos[3 * i], 1e4)},${q(pos[3 * i + 1], 1e4)},${q(pos[3 * i + 2], 1e4)},` +
      `${q(nrm[3 * i], 1e3)},${q(nrm[3 * i + 1], 1e3)},${q(nrm[3 * i + 2], 1e3)}` +
      (hasUv ? `,${q(uv[2 * i], 1e5)},${q(uv[2 * i + 1], 1e5)}` : '');
    let j = seen.get(k);
    if (j === undefined) {
      j = P.length / 3;
      seen.set(k, j);
      P.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      N.push(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]);
      if (hasUv) U.push(uv[2 * i], uv[2 * i + 1]);
    }
    idx[i] = j;
  }
  return { pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx };
}

/**
 * The end rails are cut open (|x| < 1.46) for the model's own goal, which is wider than the shared
 * one. Cuts each end rail at |x| = CUT (a straight stretch, past the opening's rounded edges) and
 * bridges the two cuts with the rail's own cross-section there, extruded straight across, so the
 * rail runs on unbroken with a watertight seam: all of it below the goal, and above only where
 * the goal's posts hide it (not up through the pocket).
 */
function fillGoalOpenings(rail: { pos: number[]; nrm: number[] } | undefined): void {
  if (!rail) return;
  const CUT = 1.85; // between the opening (1.46) and the corner (2.05)
  const POSTS = 1.34; // the goal's posts, inside |x| of the opening
  const BELOW = -0.09; // the goal's underside
  type V = number[]; // x, y, z, nx, ny, nz
  const lerp = (a: V, b: V, t: number): V => a.map((v, i) => v + (b[i] - v) * t);
  const pos: number[] = [];
  const nrm: number[] = [];
  const emit = (vs: V[]) => {
    for (const v of vs) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(v[3], v[4], v[5]);
    }
  };
  // Which way a triangle faces relative to its vertex normals (the model's winding convention).
  const facing = (a: V, b: V, c: V) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    return Math.sign(n[0] * (a[3] + b[3] + c[3]) + n[1] * (a[4] + b[4] + c[4]) + n[2] * (a[5] + b[5] + c[5]));
  };
  const profile: [V, V, number][] = []; // cross-section segments at x = CUT, with their facing
  for (let t = 0; t < rail.pos.length; t += 9) {
    const tri: V[] = [0, 3, 6].map((k) => [...rail.pos.slice(t + k, t + k + 3), ...rail.nrm.slice(t + k, t + k + 3)]);
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
    if (Math.abs(cz) < HALF_L - 0.1 || Math.abs(cx) > CUT + 0.3) {
      emit(tri);
      continue;
    }
    // Keep only the part outside |x| = CUT (Sutherland–Hodgman against one plane).
    const s = cx >= 0 ? 1 : -1;
    const d = (v: V) => s * v[0] - CUT;
    const kept: V[] = [];
    const cut: V[] = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      if (d(a) >= 0) kept.push(a);
      if (d(a) >= 0 !== d(b) >= 0) {
        const p = lerp(a, b, d(a) / (d(a) - d(b)));
        kept.push(p);
        cut.push(p);
      }
    }
    for (let i = 1; i + 1 < kept.length; i++) emit([kept[0], kept[i], kept[i + 1]]);
    if (s > 0 && cut.length === 2) profile.push([cut[0], cut[1], facing(tri[0], tri[1], tri[2])]);
  }
  // Bridge -CUT..CUT with each profile segment, split at the goal's underside.
  const quad = (p: V, q: V, x0: number, x1: number, face: number) => {
    const at = (v: V, x: number): V => [x, v[1], v[2], 0, v[4], v[5]];
    const [a, b, c, e] = [at(p, x0), at(p, x1), at(q, x1), at(q, x0)];
    const f = facing(a, b, c) || face;
    emit(f === face ? [a, b, c, a, c, e] : [a, c, b, a, e, c]);
  };
  for (const [p, q, face] of profile) {
    const pieces: [V, V][] = [];
    const lowP = p[1] <= BELOW;
    const lowQ = q[1] <= BELOW;
    if (lowP === lowQ) pieces.push([p, q]);
    else {
      const m = lerp(p, q, (BELOW - p[1]) / (q[1] - p[1]));
      pieces.push([p, m], [m, q]);
    }
    for (const [a, b] of pieces) {
      if (Math.max(a[1], b[1]) <= BELOW + 1e-6) quad(a, b, -CUT, CUT, face);
      else {
        quad(a, b, -CUT, -POSTS, face);
        quad(a, b, POSTS, CUT, face);
      }
    }
  }
  rail.pos = pos;
  rail.nrm = nrm;
}

/** Y of a triangle's (unnormalized) face normal: its sign tells the winding seen from above. */
function faceUp([a, b, c]: number[][]): number {
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
}

function tableMaterial(scene: Scene, key: string, look: PartsLook): StandardMaterial {
  if (key === 'surface') {
    const g = look.surfaceGlow;
    const m = mat(scene, 'tableSurface', Color3.White(), new Color3(g * 0.94, g, g * 1.12), 0.12);
    const tex = new Texture(look.surface, scene, false, true);
    tex.anisotropicFilteringLevel = 8; // seen at a slant: keeps the dots crisp
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE; // under the rails, keep the edge colors
    m.diffuseTexture = tex;
    m.specularPower = 64;
    return m;
  }
  const color = Color3.FromHexString(look.colors[key as keyof PartsLook['colors']]);
  return plastic(scene, `table_${key}`, color);
}

/**
 * Puck skins: Scenario models (concept image → Tripo 3.1), each 1 unit wide. `squashY` flattens a
 * model to the star puck's height (1 × 0.25), so every puck sits and plays the same.
 */
const PUCK_LOOKS: Record<string, { url: string; squashY: number; color: string; trail?: [string, string]; bits: string[]; bitsTint?: string }> = {
  star: { url: puckModelUrl, squashY: 0.9, color: '#ffc81f', bits: [vfxStarUrl, vfxTwinkleUrl] }, // ~0.28 tall
  // ~0.375 tall; image asset_ttbvPV1wqhs4RqgZgPDhKY2S
  macaron: { url: puckMacaronModelUrl, squashY: 0.67, color: '#ff6f9c', bits: [vfxHeartUrl, vfxSprinklesUrl] },
  // ~0.278 tall. Image asset_yDhfgexuhH1XCudHEst834cC → Tripo asset_zTFnYKj3q9Q8UrrxWxLWToFn.
  // Its own icy-cyan trail: the usual darkened tail of its blue reads as a murky smear on pale tables.
  snowflake: { url: puckSnowflakeModelUrl, squashY: 0.9, color: '#5cb8ff', trail: ['#9ee6ff', '#38c6ff'], bits: [vfxSnowflakeUrl, vfxFrostUrl], bitsTint: '#4cb8ff' },
  // ~0.29 tall. Image asset_m3BQTXPwVz1PLwBFXgnjPPdu → Tripo asset_zB9ezhDvCZo5hCzJCgy6gnnb (made for the Cloudy table).
  sun: { url: puckSunModelUrl, squashY: 0.87, color: '#ff9a1f', bits: [vfxSunUrl, vfxGoldSparkleUrl] },
  // ~0.304 tall. Image asset_Y8JVBxM84diG8GXbgN7AEf7p → Tripo asset_CrXc3E5NcN74unAFwHFQpEeb (made for the
  // Garden table). Bits: a mini ladybug + red dots.
  ladybug: { url: puckLadybugModelUrl, squashY: 0.83, color: '#e8242a', bits: [vfxLadybugUrl, vfxRedDotUrl] },
  // ~0.295 tall. Image asset_2TbAVFNt3sXJjAghywRGjtuw → Tripo asset_NJfQZKdxbicT57He3sSYZmUA (made for the
  // Beach table). Bits: a mini beach ball + yellow dots.
  beachball: { url: puckBeachBallModelUrl, squashY: 0.85, color: '#1e8cff', bits: [vfxBeachBallUrl, vfxYellowDotUrl] },
  // ~0.283 tall. Image asset_1G5Asr58tX5bNC6xwZJYP3Xk → Tripo asset_C5Kgb3NknL7PTZVRwaDpv2y8 (made for the
  // Picnic table). Bits: cherries + golden crust crumbs.
  cherrypie: { url: puckCherryPieModelUrl, squashY: 0.89, color: '#e8a046', bits: [vfxCherryUrl, vfxCrustDotUrl] },
  // ~0.396 tall (domed bun): squashed so its RIM matches the other pucks (~0.24), the bun stands a bit
  // above it. Squashing the whole height to the star's made the rim look thin. Image asset_wbTjdLjhUrJgLn23ku2vxxDK → Tripo asset_xRbrXZvwJ3bGZsA7JdwBTY4N (made for
  // the Dim Sum table). Bits: mini bao buns + steam swirls.
  bao: { url: puckBaoModelUrl, squashY: 0.89, color: '#e2a948', bits: [vfxBaoUrl, vfxSteamUrl] },
  // ~0.298 tall. Image asset_Pd25uE328Z5egtAF2mYNjCrn → Tripo asset_axRscQ6LzxjXhfU1Qe4McbSK (made for the
  // Rainy table and the Frog mallet). Bits: leaves + raindrops.
  lilypad: { url: puckLilyPadModelUrl, squashY: 0.85, color: '#5cc62a', bits: [vfxLeafUrl, vfxRainDropUrl] },
};

/** A puck skin's themed particle sprites (see PuckFx), and their tint (white bits need one to show on pale tables). */
export function puckBits(skin: string): { sprites: string[]; tint: Color3 } {
  const look = PUCK_LOOKS[skin] ?? PUCK_LOOKS.star;
  return { sprites: look.bits, tint: Color3.FromHexString(look.bitsTint ?? '#ffffff') };
}

/** A puck skin's main color, for its speed trail and rail sparks. */
export function puckColor(skin: string): Color3 {
  return Color3.FromHexString((PUCK_LOOKS[skin] ?? PUCK_LOOKS.star).color);
}

/** A puck skin's own speed-trail colors (head, tail), if it has them; otherwise the trail comes from its color. */
export function puckTrail(skin: string): [Color3, Color3] | undefined {
  const trail = (PUCK_LOOKS[skin] ?? PUCK_LOOKS.star).trail;
  return trail && [Color3.FromHexString(trail[0]), Color3.FromHexString(trail[1])];
}

/**
 * Loads a puck skin's model under `puck` (keeping its painted texture). `size` overrides the
 * in-game footprint (the Locker shows it bigger).
 */
export function loadPuckModel(scene: Scene, puck: TransformNode, skin: string, size = TABLE.puckRadius * 2): Promise<void> {
  const look = PUCK_LOOKS[skin] ?? PUCK_LOOKS.star;
  return loadModel(scene, puck, look.url, size, look.squashY, (m) => {
    toPlastic(m);
    m.emissiveTexture = m.albedoTexture;
    m.emissiveColor = new Color3(0.08, 0.07, 0.05);
    m.directIntensity = 1.1;
  });
}
