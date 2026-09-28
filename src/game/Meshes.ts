import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  FresnelParameters,
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
import tableModelUrl from '../assets/table-classic.glb';
import tableSurfaceUrl from '../assets/table-classic-surface.webp';
import tableIceSurfaceUrl from '../assets/table-ice-surface.webp';
import tableIceModelUrl from '../assets/table-ice.glb';
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
    if (m.material instanceof PBRMaterial) tune(m.material);
  }
  for (const m of previous) m.dispose();
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

const studioEnvs = new WeakMap<Scene, RawCubeTexture>();

/**
 * A tiny procedural reflection environment (sky-blue gradient, bright soft boxes, darker floor),
 * built once per scene. Metal needs something to reflect; loading an HDR file would add size.
 */
function studioEnvironment(scene: Scene): RawCubeTexture {
  const cached = studioEnvs.get(scene);
  if (cached) return cached;
  const N = 32;
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
  const env = new RawCubeTexture(scene, data, N);
  studioEnvs.set(scene, env);
  return env;
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
 * - `corner`: its upward-facing top is the `cap` (the Ice table's snow caps)
 * - `leg`: its lowest part is the `foot` (the Ice table's frosty tips)
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
      // The far goal frame (its mirror is the player's goal), grown sideways only: grown down or
      // out, its bottom corner would poke out of the table body.
      tripo_part_10: { role: 'goal', mirror: true, grow: [1.06, 1, 1] },
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
  // Concept asset_dPZ6CPZyCuVNJs1ssSyXfauM (cut out: asset_VsVm7MPzsMG4CcDBWa3yHeDL) → model
  // asset_ydYrkoxJqEXX5v8E8TmkkSA1. Its surface came in 7 flat pieces; the near parts (goal box,
  // near-left corner, near surface pieces) are left out and replaced by the far half's mirror.
  ice: {
    url: tableIceModelUrl,
    innerX: [-0.2404, 0.2374],
    innerZ: 0.4112,
    surfaceY: 0.149,
    capBottom: 0.2,
    footTop: -4.1,
    parts: {
      tripo_part_10: { role: 'surface', mirror: true },
      tripo_part_13: { role: 'surface', mirror: true },
      tripo_part_15: { role: 'surface', mirror: true },
      tripo_part_19: { role: 'surface', mirror: true },
      tripo_part_2: { role: 'end', mirror: true }, // far rail, far corners and far goal frame
      tripo_part_3: { role: 'rail', mirror: true },
      tripo_part_8: { role: 'rail', mirror: true },
      tripo_part_17: { role: 'cap', mirror: true },
      tripo_part_18: { role: 'cap', mirror: true },
      tripo_part_20: { role: 'cap', mirror: true },
      tripo_part_21: { role: 'cap', mirror: true },
      tripo_part_0: { role: 'snow', mirror: true },
      tripo_part_1: { role: 'body', mirror: true },
      tripo_part_4: { role: 'leg' },
      tripo_part_5: { role: 'leg' },
      tripo_part_6: { role: 'leg' },
      tripo_part_12: { role: 'leg' },
    },
  },
};

/** Surface finish of a piece: toy plastic, glossy ice (bright edges), or soft matte snow. */
type TableFinish = 'plastic' | 'ice' | 'snow';

/**
 * A table skin: its Scenario model, a playing-surface image (with a pocket-colored band past
 * each goal line) and a color (plus optional finish) per piece, measured from its concept.
 */
interface TableLook {
  model: keyof typeof TABLE_MODELS;
  surface: string;
  /** Self-light on the surface image: more is brighter and closer to the image's own colors. */
  surfaceGlow: number;
  colors: Record<Exclude<TablePiece, 'surface'>, string>;
  finish?: Partial<Record<Exclude<TablePiece, 'surface'>, TableFinish>>;
}

export const TABLE_LOOKS: Record<string, TableLook> = {
  classic: {
    model: 'classic',
    surface: tableSurfaceUrl,
    surfaceGlow: 0.32,
    colors: {
      rail: '#ee2a2e', trim: '#ee2a2e', body: '#ee2a2e', corner: '#0a78f5', cap: '#0a78f5',
      leg: '#1c3866', foot: '#1c3866', goalFar: '#ee2a2e', goalNear: '#0a78f5',
    },
  },
  // Frosted rails, crystal corners with snow caps, indigo body with snow, frosty-footed legs.
  ice: {
    model: 'ice',
    surface: tableIceSurfaceUrl,
    surfaceGlow: 0.62,
    colors: {
      rail: '#62c4f0', trim: '#f4faff', body: '#123ea6', corner: '#0f98ec', cap: '#f4faff',
      leg: '#0f2f78', foot: '#e6f4ff', goalFar: '#ff6a73', goalNear: '#0a5cf5',
    },
    finish: { rail: 'ice', corner: 'ice', trim: 'snow', cap: 'snow', foot: 'snow' },
  },
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
  return meshes;
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
  meshes[0].dispose();
  fit.dispose();
  const geometry: TableGeometry = new Map();
  for (const [key, g] of groups) {
    const count = g.pos.length / 3;
    geometry.set(key, {
      pos: new Float32Array(g.pos),
      nrm: new Float32Array(g.nrm),
      uv: new Float32Array(g.uv),
      idx: Uint32Array.from({ length: count }, (_, i) => i),
    });
  }
  return geometry;
}

/** Y of a triangle's (unnormalized) face normal: its sign tells the winding seen from above. */
function faceUp([a, b, c]: number[][]): number {
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
}

function tableMaterial(scene: Scene, key: string, look: TableLook): StandardMaterial {
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
  const piece = key as keyof TableLook['colors'];
  const color = Color3.FromHexString(look.colors[piece]);
  const finish = look.finish?.[piece] ?? 'plastic';
  if (finish === 'ice') {
    // Glossy ice: a sharp highlight and bright frosty edges where the surface turns away from the
    // camera, like light caught in ice. (The emissive fresnel scales the glow from none facing
    // the camera to full at the edges.)
    const m = mat(scene, `table_${key}`, color, new Color3(0.42, 0.52, 0.6), 1);
    m.specularPower = 96;
    const edge = new FresnelParameters();
    edge.leftColor = Color3.Black();
    edge.rightColor = Color3.White();
    edge.bias = 0;
    edge.power = 3;
    m.emissiveFresnelParameters = edge;
    return m;
  }
  if (finish === 'snow') {
    // Soft matte snow, lit a little from within so it stays white in the shade.
    return mat(scene, `table_${key}`, color, color.scale(0.4), 0.05);
  }
  return plastic(scene, `table_${key}`, color);
}

/**
 * Puck skins: Scenario models (concept image → Tripo 3.1), each 1 unit wide. `squashY` flattens a
 * model to the star puck's height (1 × 0.25), so every puck sits and plays the same.
 */
const PUCK_LOOKS: Record<string, { url: string; squashY: number; color: string }> = {
  star: { url: puckModelUrl, squashY: 0.9, color: '#ffc81f' }, // ~0.28 tall
  macaron: { url: puckMacaronModelUrl, squashY: 0.67, color: '#ff6f9c' }, // ~0.375 tall; image asset_ttbvPV1wqhs4RqgZgPDhKY2S
};

/** A puck skin's main color, for its speed trail and rail sparks. */
export function puckColor(skin: string): Color3 {
  return Color3.FromHexString((PUCK_LOOKS[skin] ?? PUCK_LOOKS.star).color);
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
