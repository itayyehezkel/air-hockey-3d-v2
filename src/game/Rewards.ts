/**
 * Match rewards and result-popup titles: every tunable number in one place (see the progression spec).
 * Only the result popup reads these for now; saving stars and coins comes with the progression system.
 */

export const REWARDS = {
  /** Stars per result. */
  stars: { loss: 1, win: 2, perfect: 3 },
  /** Coins per result (a loss gives a small consolation). */
  coins: { loss: 5, win: 25, perfect: 50 },
  /** The rewarded-ad button multiplies the match coins by this. */
  adMultiplier: 3,
};

/** Stars needed to finish a level (the progression spec's table; 10 from level 21 on). */
export function starsNeeded(level: number): number {
  if (level <= 3) return 2;
  if (level <= 6) return 4;
  if (level <= 15) return 6;
  if (level <= 20) return 8;
  return 10;
}

/** Title sprites (src/assets/ui/result/title_<id>.webp). */
export type TitleId = 'smashing' | 'victory' | 'awesome' | 'perfect' | 'soclose' | 'nicetry' | 'nexttime';

/** Win: PERFECT! when the opponent scored 0, else a random cheer. Lose: by how many goals the player scored. */
export function resultTitle(win: boolean, you: number, opp: number): TitleId {
  if (win) {
    if (opp === 0) return 'perfect';
    const cheers: TitleId[] = ['smashing', 'victory', 'awesome'];
    return cheers[Math.floor(Math.random() * cheers.length)];
  }
  if (you >= 3) return 'soclose';
  if (you >= 1) return 'nicetry';
  return 'nexttime';
}

export function matchRewards(win: boolean, opp: number): { stars: number; coins: number } {
  const kind = !win ? 'loss' : opp === 0 ? 'perfect' : 'win';
  return { stars: REWARDS.stars[kind], coins: REWARDS.coins[kind] };
}
