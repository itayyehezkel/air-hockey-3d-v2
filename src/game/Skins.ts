/**
 * Locker catalogue: cosmetic skins and which one is equipped.
 * Skins are purely visual; they never change physics or balance.
 */

import donutModelUrl from '../assets/mallet-donut.glb';
import goldModelUrl from '../assets/mallet-gold.glb';
import catModelUrl from '../assets/mallet-cat.glb';
import frogModelUrl from '../assets/mallet-frog.glb';
import iceModelUrl from '../assets/mallet-ice.glb';
import pandaModelUrl from '../assets/mallet-panda.glb';
import rainbowModelUrl from '../assets/mallet-rainbow.glb';
import watermelonModelUrl from '../assets/watermelon.glb';

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

export const MALLET_SKINS: MalletSkin[] = [
  { id: 'classic', name: 'CLASSIC', color: '#1f6bff', roughness: 0.25, glow: 0.12, unlockLevel: 1 },
  { id: 'gold', name: 'GOLD', color: '#ffc629', roughness: 0.2, glow: 0.08, unlockLevel: 3, model: goldModelUrl, metal: true },
  // Hit sparks use `color`, so it should read on the white table.
  { id: 'donut', name: 'DONUT', color: '#ff6fb5', roughness: 0.22, glow: 0.12, unlockLevel: 5, model: donutModelUrl },
  { id: 'ice', name: 'ICE', color: '#8fdcff', roughness: 0.1, glow: 0.18, unlockLevel: 8, model: iceModelUrl },
  { id: 'panda', name: 'PANDA', color: '#3a3a4a', roughness: 0.22, glow: 0.12, unlockLevel: 10, model: pandaModelUrl, yaw: Math.PI },
  { id: 'watermelon', name: 'WATERMELON', color: '#3ccf3c', roughness: 0.22, glow: 0.12, unlockLevel: 12, model: watermelonModelUrl },
  { id: 'rainbow', name: 'RAINBOW', color: '#ff4fd8', roughness: 0.18, glow: 0.12, unlockLevel: 18, model: rainbowModelUrl },
  { id: 'cat', name: 'CAT', color: '#ff8a1f', roughness: 0.22, glow: 0.12, unlockLevel: 22, model: catModelUrl, yaw: Math.PI },
  { id: 'frog', name: 'FROG', color: '#5fd13a', roughness: 0.22, glow: 0.12, unlockLevel: 24, model: frogModelUrl, yaw: Math.PI },
];

/** Table skins: the Scenario table shape, each with its own look (see Meshes.TABLE_LOOKS). */
export interface TableSkin {
  id: string;
  name: string;
  unlockLevel: number;
}

export const TABLE_SKINS: TableSkin[] = [
  { id: 'classic', name: 'CLASSIC', unlockLevel: 1 },
  { id: 'ice', name: 'ICE', unlockLevel: 6 },
];

/** Puck skins: each a Scenario puck model (see Meshes.PUCK_LOOKS). */
export interface PuckSkin {
  id: string;
  name: string;
  unlockLevel: number;
}

export const PUCK_SKINS: PuckSkin[] = [
  { id: 'star', name: 'STAR', unlockLevel: 1 },
  { id: 'macaron', name: 'MACARON', unlockLevel: 4 },
];

/**
 * Testing switch: while true every skin is open. Turn it off once player levels exist.
 * In dev builds, adding `?locked` to the URL shows the locked states without changing code.
 */
export const UNLOCK_ALL = !(import.meta.env.DEV && location.search.includes('locked'));

/** Until progression lands, the player is level 1. */
export function playerLevel(): number {
  return 1;
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
  save({ mallet: id });
}

export function equippedPuck(): PuckSkin {
  const skin = PUCK_SKINS.find((s) => s.id === load().puck);
  return skin && isUnlocked(skin) ? skin : PUCK_SKINS[0];
}

export function equipPuck(id: string): void {
  save({ puck: id });
}

export function equippedTable(): TableSkin {
  const skin = TABLE_SKINS.find((s) => s.id === load().table);
  return skin && isUnlocked(skin) ? skin : TABLE_SKINS[0];
}

export function equipTable(id: string): void {
  save({ table: id });
}
