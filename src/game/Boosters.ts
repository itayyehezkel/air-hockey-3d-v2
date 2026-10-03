/**
 * Boosters: a free booster is offered (for a rewarded ad) before some matches. For now the only
 * booster is the Big Mallet.
 */

export interface Boosters {
  /** The player's mallet is BIG_MALLET_SCALE times its size for the whole match. */
  bigMallet?: boolean;
}

export const BIG_MALLET_SCALE = 1.5;

/** Offer after a lost match, and otherwise every OFFER_EVERY-th match. */
const OFFER_EVERY = 3;
const KEY = 'airsmash.boosters';

interface OfferState {
  /** Matches started since the last offer. */
  since: number;
  lostLast: boolean;
}

function load(): OfferState {
  try {
    return { since: 0, lostLast: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { since: 0, lostLast: false };
  }
}

function save(s: OfferState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); offers then just follow this session.
  }
}

/** The free-booster offer before matches is switched off for now (user, 2026-10-03: boosters come later). */
const OFFERS_ON = false;

/** Whether to offer a booster before the match about to start. Counts the match either way. */
export function takeOffer(): boolean {
  // `?booster` (dev only) still offers before every match, for working on boosters later.
  if (!OFFERS_ON && !(import.meta.env.DEV && location.search.includes('booster'))) return false;
  const s = load();
  s.since++;
  // `?booster` (dev only) offers before every match, for testing.
  const force = import.meta.env.DEV && location.search.includes('booster');
  const offer = force || s.lostLast || s.since >= OFFER_EVERY;
  if (offer) {
    s.since = 0;
    s.lostLast = false;
  }
  save(s);
  return offer;
}

export function recordResult(win: boolean): void {
  save({ ...load(), lostLast: !win });
}

/**
 * Plays a rewarded ad; resolves true if the player earned the reward. No ad network is wired in
 * yet, so the reward is always granted. Connect the real SDK (e.g. AdMob rewarded ads) here.
 */
export async function watchRewardedAd(): Promise<boolean> {
  return true;
}
