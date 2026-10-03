/**
 * The player's saved progress: level, stars toward the next level, coins, items not yet equipped ("NEW!"), a level-up
 * the player hasn't seen yet, and a few counters. Saved with Capacitor Preferences (Android's native storage; browser
 * storage on the web), mirrored to localStorage, under `airsmash.progress`. Loaded once at startup (`loadProgress`,
 * behind the splash); every change saves at once.
 *
 * Unlocked items are not stored: they follow from the level (Skins.ts `unlockLevel`), so items added later unlock for
 * players already past their level.
 *
 * Dev: `?stats=LEVEL,STARS,NEEDED,COINS` (e.g. `?stats=5,3,4,1250`) plays with those numbers and never saves;
 * `?resetprogress` starts from a fresh save.
 */
import { Preferences } from '@capacitor/preferences';
import { starsNeeded } from './Rewards';

export interface HomeStats {
  level: number;
  /** Stars earned inside the current level. */
  stars: number;
  /** Stars needed to finish the current level. */
  starsNeeded: number;
  /** Every star ever earned (the Home star counter: it only goes up, like coins). */
  totalStars: number;
  coins: number;
}

/** "kind:id" of an item, e.g. "mallet:panda" (ids repeat across kinds: "classic"). */
export type ItemKey = `${'mallet' | 'puck' | 'table'}:${string}`;

interface Progress {
  v: 1;
  level: number;
  stars: number;
  /** Every star ever earned (never spent: levelling up doesn't take stars away from it). */
  totalStars: number;
  coins: number;
  /** Unlocked items the player hasn't equipped yet: they wear "NEW!" and light the Locker button's dot. */
  fresh: ItemKey[];
  /** A level-up whose LEVEL UP popup hasn't been seen (the app closed first): it shows on the next launch. */
  pendingLevelUp: { from: number; to: number } | null;
  matches: number;
  wins: number;
  perfects: number;
}

const KEY = 'airsmash.progress';

const freshSave = (): Progress => ({ v: 1, level: 1, stars: 0, totalStars: 0, coins: 0, fresh: [], pendingLevelUp: null, matches: 0, wins: 0, perfects: 0 });

let progress: Progress = freshSave();
/** Off while dev numbers (?stats=) are in use: testing never touches the real save. */
let persist = true;
/** Dev (?stats=): the "stars needed" number given for the starting level. */
let devNeeded: { level: number; needed: number } | null = null;

const int = (v: unknown, min: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback);

/** Accepts a saved record field by field: anything missing or broken falls back to the fresh value. */
function sanitize(raw: unknown): Progress {
  const p = freshSave();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  p.level = int(r.level, 1, 1);
  p.stars = int(r.stars, 0, 0);
  p.coins = int(r.coins, 0, 0);
  p.matches = int(r.matches, 0, 0);
  p.wins = int(r.wins, 0, 0);
  p.perfects = int(r.perfects, 0, 0);
  if (Array.isArray(r.fresh)) p.fresh = r.fresh.filter((k): k is ItemKey => typeof k === 'string' && /^(mallet|puck|table):[a-z0-9]+$/.test(k));
  const up = r.pendingLevelUp as { from?: unknown; to?: unknown } | null | undefined;
  if (up && typeof up === 'object') {
    const from = int(up.from, 1, 0);
    const to = int(up.to, 2, 0);
    if (from && to > from) p.pendingLevelUp = { from, to };
  }
  // Stars past the bar (e.g. after the star table changed): level up now, so the bar is never over-full.
  while (p.stars >= starsNeeded(p.level)) {
    p.stars -= starsNeeded(p.level);
    p.level++;
  }
  // Saves from before the total existed: at least every star the levels reached took, plus this level's.
  p.totalStars = Math.max(int(r.totalStars, 0, 0), starsToReach(p.level) + p.stars);
  return p;
}

/** Stars it takes to get from level 1 to `level`. */
function starsToReach(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += starsNeeded(l);
  return sum;
}

/** Reads the save (once at startup, before Home shows). Never throws: a broken save starts fresh. */
export async function loadProgress(): Promise<void> {
  if (import.meta.env.DEV) {
    const m = /[?&]stats=(\d+),(\d+),(\d+),(\d+)/.exec(location.search);
    if (m) {
      persist = false;
      progress = { ...freshSave(), level: +m[1], stars: +m[2], totalStars: starsToReach(+m[1]) + +m[2], coins: +m[4] };
      devNeeded = { level: +m[1], needed: +m[3] };
      return;
    }
    if (location.search.includes('resetprogress')) {
      progress = freshSave();
      save();
      return;
    }
  }
  // The native copy first, then the browser copy: the first one that reads as JSON wins.
  const copies: (string | null)[] = [];
  try {
    copies.push((await Preferences.get({ key: KEY })).value);
  } catch {
    // The native store failed: the browser copy may still have it.
  }
  try {
    copies.push(localStorage.getItem(KEY));
  } catch {
    // No browser storage (private mode).
  }
  for (const text of copies) {
    if (!text) continue;
    try {
      progress = sanitize(JSON.parse(text));
      return;
    } catch {
      // Unreadable copy: try the next one.
    }
  }
  progress = freshSave();
}

function save(): void {
  if (!persist) return;
  const text = JSON.stringify(progress);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // Browser storage unavailable: the native copy below still saves.
  }
  Preferences.set({ key: KEY, value: text }).catch(() => {});
}

export function homeStats(): HomeStats {
  const needed = devNeeded?.level === progress.level ? devNeeded.needed : starsNeeded(progress.level);
  return { level: progress.level, stars: progress.stars, starsNeeded: needed, totalStars: progress.totalStars, coins: progress.coins };
}

/**
 * Banks a finished match: stars (a full bar levels up; extra stars carry over), coins and counters, and remembers the
 * level-up for its popup. Saved at once, so closing the app on the result popup loses nothing. Returns the level-up
 * (or null) and an undo (KEEP PLAYING! reopens the match, which then counts at its real end).
 */
export function bankMatch(stars: number, coins: number, win: boolean, perfect: boolean): { up: { from: number; to: number } | null; undo: () => void } {
  const before = structuredClone(progress);
  const from = progress.level;
  let needed = homeStats().starsNeeded;
  progress.coins += coins;
  progress.stars += stars;
  progress.totalStars += stars;
  progress.matches++;
  if (win) progress.wins++;
  if (perfect) progress.perfects++;
  while (progress.stars >= needed) {
    progress.stars -= needed;
    progress.level++;
    needed = starsNeeded(progress.level);
  }
  // An older unseen level-up merges in (its popup then shows the whole jump).
  const up = progress.level > from ? { from: progress.pendingLevelUp?.from ?? from, to: progress.level } : null;
  if (up) progress.pendingLevelUp = up;
  save();
  return {
    up,
    undo: () => {
      progress = before;
      save();
    },
  };
}

/** Extra coins (the x3 rewarded ad). */
export function addCoins(coins: number): void {
  progress.coins += coins;
  save();
}

/** The level-up whose popup hasn't been seen yet (shown on the next launch), if any. */
export function pendingLevelUp(): { from: number; to: number } | null {
  return progress.pendingLevelUp;
}

/** The LEVEL UP popup was seen: forget it. */
export function clearPendingLevelUp(): void {
  if (!progress.pendingLevelUp) return;
  progress.pendingLevelUp = null;
  save();
}

/** Marks newly unlocked items as not yet equipped ("NEW!" + the Locker dot). */
export function addFresh(keys: ItemKey[]): void {
  const add = keys.filter((k) => !progress.fresh.includes(k));
  if (!add.length) return;
  progress.fresh.push(...add);
  save();
}

/** The player equipped this item: it is no longer new. */
export function clearFresh(key: ItemKey): void {
  const i = progress.fresh.indexOf(key);
  if (i < 0) return;
  progress.fresh.splice(i, 1);
  save();
}

export function isFresh(key: ItemKey): boolean {
  return progress.fresh.includes(key);
}

/** Drops "NEW!" marks for items that aren't unlocked (only a damaged save can have them); saves if anything changed. */
export function pruneFresh(unlocked: (key: ItemKey) => boolean): void {
  const keep = progress.fresh.filter(unlocked);
  if (keep.length === progress.fresh.length) return;
  progress.fresh = keep;
  save();
}

/** Any item (of one kind, or of any) still waiting to be equipped. */
export function hasFresh(kind?: 'mallet' | 'puck' | 'table'): boolean {
  return kind ? progress.fresh.some((k) => k.startsWith(`${kind}:`)) : progress.fresh.length > 0;
}
