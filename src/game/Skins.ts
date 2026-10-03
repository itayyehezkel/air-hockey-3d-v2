/**
 * Locker catalogue: cosmetic skins and which one is equipped.
 * Skins are purely visual; they never change physics or balance.
 */

import donutModelUrl from '../assets/mallet-donut.glb';
import catModelUrl from '../assets/mallet-cat.glb';
import frogModelUrl from '../assets/mallet-frog.glb';
import iceModelUrl from '../assets/mallet-ice.glb';
import pandaModelUrl from '../assets/mallet-panda.glb';
import rainbowModelUrl from '../assets/mallet-rainbow.glb';
import strawberryModelUrl from '../assets/mallet-strawberry.glb';
import watermelonModelUrl from '../assets/watermelon.glb';
import { clearFresh, homeStats, type ItemKey } from './Stats';

export interface MalletSkin {
  id: string;
  /** Shown on the Locker card (plain text, easy to edit/translate). */
  name: string;
  /** Plastic color (sRGB hex). */
  color: string;
  /** 0 = mirror-glossy … 1 = matte. */
  roughness: number;
  /** Self-illumination (0–1): makes neon/ice skins pop. */
  glow: number;
  /** Player level that unlocks it once progression exists. */
  unlockLevel: number;
  /** Textured skins bring their own model (Scenario image → Tripo 3D); `color` then only tints effects. */
  model?: string;
  /** Real metal finish (reflective), for gold/chrome skins. */
  metal?: boolean;
  /** Turns the model (radians) so its front, e.g. a face, looks at the player. */
  yaw?: number;
}

// Locker order = theme order (see CLAUDE.md "Theme sets"). Every level-up unlocks ONE item, set by set in Locker
// order: the set's mallet, then its table, then its puck (levels 2, 3, 4 for Panda / Dim Sum / Bao Bun, and so on;
// user, 2026-10-03: the table before the puck).
export const MALLET_SKINS: MalletSkin[] = [
  { id: 'classic', name: 'CLASSIC', color: '#1f6bff', roughness: 0.25, glow: 0.12, unlockLevel: 1 },
  { id: 'panda', name: 'PANDA', color: '#3a3a4a', roughness: 0.22, glow: 0.12, unlockLevel: 2, model: pandaModelUrl, yaw: Math.PI },
  { id: 'ice', name: 'ICE', color: '#8fdcff', roughness: 0.1, glow: 0.18, unlockLevel: 5, model: iceModelUrl },
  { id: 'watermelon', name: 'WATERMELON', color: '#3ccf3c', roughness: 0.22, glow: 0.12, unlockLevel: 8, model: watermelonModelUrl },
  { id: 'frog', name: 'FROG', color: '#5fd13a', roughness: 0.22, glow: 0.12, unlockLevel: 11, model: frogModelUrl, yaw: Math.PI },
  { id: 'rainbow', name: 'RAINBOW', color: '#ff4fd8', roughness: 0.18, glow: 0.12, unlockLevel: 14, model: rainbowModelUrl },
  // Hit sparks use `color`, so it should read on the white table.
  { id: 'donut', name: 'DONUT', color: '#ff6fb5', roughness: 0.22, glow: 0.12, unlockLevel: 17, model: donutModelUrl },
  // Image asset_c4MTRPpWu2fDgLzvmjfXdynn → Tripo (detailed texture) asset_1hW4z4h2NjxnNxUM4Nxjxroi.
  { id: 'strawberry', name: 'STRAWBERRY', color: '#ff3b4a', roughness: 0.22, glow: 0.12, unlockLevel: 20, model: strawberryModelUrl },
  { id: 'cat', name: 'CAT', color: '#ff8a1f', roughness: 0.22, glow: 0.12, unlockLevel: 23, model: catModelUrl, yaw: Math.PI },
];

/** Table skins: the Scenario table shape, each with its own look (see Meshes.TABLE_LOOKS). */
export interface TableSkin {
  id: string;
  name: string;
  unlockLevel: number;
}

export const TABLE_SKINS: TableSkin[] = [
  { id: 'classic', name: 'CLASSIC', unlockLevel: 1 },
  { id: 'dimsum', name: 'DIM SUM', unlockLevel: 3 },
  { id: 'frozen', name: 'FROZEN', unlockLevel: 6 },
  { id: 'beach', name: 'BEACH', unlockLevel: 9 },
  { id: 'rainy', name: 'RAINY', unlockLevel: 12 },
  { id: 'cloudy', name: 'CLOUDY', unlockLevel: 15 },
  { id: 'icecream', name: 'ICE CREAM', unlockLevel: 18 },
  { id: 'picnic', name: 'PICNIC', unlockLevel: 21 },
  { id: 'garden', name: 'GARDEN', unlockLevel: 24 },
];

/** Puck skins: each a Scenario puck model (see Meshes.PUCK_LOOKS). */
export interface PuckSkin {
  id: string;
  name: string;
  unlockLevel: number;
}

export const PUCK_SKINS: PuckSkin[] = [
  { id: 'star', name: 'STAR', unlockLevel: 1 },
  { id: 'bao', name: 'BAO BUN', unlockLevel: 4 },
  { id: 'snowflake', name: 'SNOWFLAKE', unlockLevel: 7 },
  { id: 'beachball', name: 'BEACH BALL', unlockLevel: 10 },
  { id: 'lilypad', name: 'LILY PAD', unlockLevel: 13 },
  { id: 'sun', name: 'SUN', unlockLevel: 16 },
  { id: 'macaron', name: 'MACARON', unlockLevel: 19 },
  { id: 'cherrypie', name: 'CHERRY PIE', unlockLevel: 22 },
  { id: 'ladybug', name: 'LADYBUG', unlockLevel: 25 },
];

/** Testing switch: true opens every skin. Off now, so the Locker shows the real lock states. */
export const UNLOCK_ALL = false;

/** The player's level, from the Home stats (a placeholder until progression exists: level 1, or `?stats=` in dev). */
export function playerLevel(): number {
  return homeStats().level;
}

export type ItemKind = 'mallet' | 'puck' | 'table';

/** The item a level unlocks (null for level 1 and past the last item), with its display name for the LEVEL UP popup. */
export function unlockAt(level: number): { kind: ItemKind; id: string; name: string } | null {
  const lists: [ItemKind, { id: string; name: string; unlockLevel: number }[]][] = [
    ['mallet', MALLET_SKINS],
    ['puck', PUCK_SKINS],
    ['table', TABLE_SKINS],
  ];
  if (level <= 1) return null;
  for (const [kind, list] of lists) {
    const skin = list.find((s) => s.unlockLevel === level);
    if (skin) return { kind, id: skin.id, name: `${skin.name} ${kind.toUpperCase()}` };
  }
  return null;
}

/** Whether the item behind a "kind:id" key exists and is unlocked. */
export function isItemUnlocked(key: ItemKey): boolean {
  const [kind, id] = key.split(':');
  const list: { id: string; unlockLevel: number }[] = kind === 'mallet' ? MALLET_SKINS : kind === 'puck' ? PUCK_SKINS : TABLE_SKINS;
  const skin = list.find((s) => s.id === id);
  return !!skin && isUnlocked(skin);
}

/** Every item unlocked by going from level `from` to level `to` (the "NEW!" items of a level-up). */
export function unlocksBetween(from: number, to: number): ItemKey[] {
  const keys: ItemKey[] = [];
  for (let level = from + 1; level <= to; level++) {
    const item = unlockAt(level);
    if (item) keys.push(`${item.kind}:${item.id}`);
  }
  return keys;
}

/** Equips any kind of item (the LEVEL UP popup's EQUIP button). */
export function equipItem(kind: ItemKind, id: string): void {
  save({ [kind]: id });
  clearFresh(`${kind}:${id}`); // equipped once: no longer "NEW!"
}

export function isUnlocked(skin: { unlockLevel: number }): boolean {
  return UNLOCK_ALL || playerLevel() >= skin.unlockLevel;
}

// ---------- Equipped skin (persisted per device) ----------

const LOCKER_KEY = 'airsmash.locker';

interface LockerSave {
  mallet: string;
  puck: string;
  table: string;
}

const DEFAULT_SAVE: LockerSave = { mallet: 'classic', puck: 'star', table: 'classic' };

function load(): LockerSave {
  try {
    return { ...DEFAULT_SAVE, ...JSON.parse(localStorage.getItem(LOCKER_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

function save(change: Partial<LockerSave>): void {
  try {
    localStorage.setItem(LOCKER_KEY, JSON.stringify({ ...load(), ...change }));
  } catch {
    // Storage unavailable (private mode): the choice lasts for this session only.
  }
}

export function equippedMallet(): MalletSkin {
  const id = load().mallet;
  const skin = MALLET_SKINS.find((s) => s.id === id);
  // Fall back if the saved skin was removed or is locked again.
  return skin && isUnlocked(skin) ? skin : MALLET_SKINS[0];
}

export function equipMallet(id: string): void {
  equipItem('mallet', id);
}

export function equippedPuck(): PuckSkin {
  const skin = PUCK_SKINS.find((s) => s.id === load().puck);
  return skin && isUnlocked(skin) ? skin : PUCK_SKINS[0];
}

export function equipPuck(id: string): void {
  equipItem('puck', id);
}

export function equippedTable(): TableSkin {
  const skin = TABLE_SKINS.find((s) => s.id === load().table);
  return skin && isUnlocked(skin) ? skin : TABLE_SKINS[0];
}

export function equipTable(id: string): void {
  equipItem('table', id);
}
