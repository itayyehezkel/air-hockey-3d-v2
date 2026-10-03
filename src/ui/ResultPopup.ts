/**
 * The match-result popup, built in code from reusable parts (src/assets/ui/result/, cut from Scenario kits):
 * stretchy panel, ribbon + title word, trophy over spinning rays, 3 star slots, live score / coins, and
 * stretchy buttons with separate icons. Every text is live, so one popup serves every result and new
 * buttons need no new art. Styles: `.rp-*` in styles.css.
 */
import { Confetti } from './Confetti';
import type { TitleId } from '../game/Rewards';

const ART = import.meta.glob<string>('../assets/ui/result/*.webp', { eager: true, import: 'default', query: '?url' });
const art = (name: string): string => ART[`../assets/ui/result/${name}.webp`];
const LV_ART = import.meta.glob<string>('../assets/ui/levelup/*.webp', { eager: true, import: 'default', query: '?url' });
const lvArt = (name: string): string => LV_ART[`../assets/ui/levelup/${name}.webp`];

export type ButtonColor = 'gold' | 'green' | 'blue';
export type ButtonIcon = 'video' | 'arrow' | 'replay' | 'home';

export interface PopupButton {
  id: string;
  color: ButtonColor;
  /** Optional: a label-only button leaves the room to a bigger label. */
  icon?: ButtonIcon;
  text: string;
  /** A light sweep across the button every few seconds (the rewarded-ad button only). */
  shine?: boolean;
  /** A small round badge on the button's top-right corner (e.g. "x3"). */
  badge?: string;
  /** A coin after the label (for a coin amount like "+75"). */
  coin?: boolean;
  /** Gently pulses (grows and shrinks) after the popup settles, to say "tap here next". */
  breathe?: boolean;
  /** A small round button with just the icon; it shares a row with the button after it. */
  iconOnly?: boolean;
}

export interface ResultOptions {
  mode: 'win' | 'lose';
  title: TitleId;
  /** The match score; omitted = no score line (the win popup leaves it out). */
  score?: { you: number; opp: number; youName?: string; oppName?: string };
  /** Stars earned (0–3); the slots start empty and fill one by one. */
  stars: number;
  /** Coins earned; omitted or 0 hides the coin line. */
  coins?: number;
  /**
   * The player's coin balance before this match. When set, a coin counter (the Home one) sits at the top right and
   * the earned coins fly into it from the coin line, A to B.
   */
  wallet?: number;
  /** The player's star count before this match. When set, the Home star counter sits at the top right and the
   *  earned stars fly into it from their slots. */
  starWallet?: number;
  buttons: PopupButton[];
}

/** A live view of the unlocked item (its spinning 3D model); the popup places it, starts it and disposes it. */
export interface ItemView {
  el: HTMLElement;
  start(): void;
  dispose(): void;
}

export interface LevelUpOptions {
  /** The level before and after (the star badge flips from one to the other). */
  from: number;
  level: number;
  /** The item this level unlocks: its display name and its spinning 3D view (null when it isn't ready); null = no item. */
  item: { name: string; view: ItemView | null } | null;
  buttons: PopupButton[];
}

export interface ResultHooks {
  /** A star lands (i = 0, 1, 2). */
  onStar?: (i: number) => void;
  /** Haptic beats: the popup lands, the emblem (trophy / worried puck) lands, a reward was granted. */
  onBeat?: (beat: 'enter' | 'emblem' | 'reward', mode: 'win' | 'lose') => void;
  /** The score count-up ticks (sound). */
  onTick?: (step: number) => void;
  /** A button was tapped (sound). */
  onTap?: () => void;
  /** A flying star landed in the star counter (i = which star). */
  onStarLand?: (i: number) => void;
  /** A flying coin landed in the counter (i = its index in the stream). */
  onCoin?: (i: number) => void;
  /** Writes a counter number (the Home counters' sizing rules). */
  setStat?: (el: HTMLElement, text: string) => void;
}

const ease = {
  pop: 'cubic-bezier(0.2, 1.5, 0.4, 1)',
  out: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

/**
 * The light-ray burst, drawn once into an image. Spinning a plain image is cheap for the phone (the GPU just
 * rotates it); spinning CSS gradients with a mask made it redraw every frame.
 */
const raysUrl: Record<string, string> = {};
/** Warm gold rays for a win, calm cool-blue ones for a loss. */
function raysImage(mode: 'win' | 'lose' = 'win'): string {
  if (raysUrl[mode]) return raysUrl[mode];
  const [c0, c1, g0, g1, g2] =
    mode === 'win'
      ? ['255,240,170', '255,232,140', '255,252,225', '255,236,150', '255,225,120']
      : ['200,228,255', '170,210,255', '235,246,255', '180,215,255', '150,200,255'];
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  g.translate(r, r);
  const rays = 18;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const grad = g.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
    grad.addColorStop(0, `rgba(${c0},0.95)`);
    grad.addColorStop(0.55, `rgba(${c1},0.45)`);
    grad.addColorStop(1, `rgba(${c1},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, a - 0.13, a + 0.13);
    g.closePath();
    g.fill();
  }
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.45);
  glow.addColorStop(0, `rgba(${g0},1)`);
  glow.addColorStop(0.4, `rgba(${g1},0.75)`);
  glow.addColorStop(1, `rgba(${g2},0)`);
  g.fillStyle = glow;
  g.fillRect(-r, -r, size, size);
  raysUrl[mode] = c.toDataURL();
  return raysUrl[mode];
}

/** The soft golden glow behind the reward line, drawn once into an image. */
let glowUrl = '';
function coinGlowImage(): string {
  if (glowUrl) return glowUrl;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(128, 64);
  g.scale(2, 1);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,236,140,1)');
  grad.addColorStop(0.45, 'rgba(255,196,50,0.7)');
  grad.addColorStop(1, 'rgba(255,190,40,0)');
  g.fillStyle = grad;
  g.fillRect(-64, -64, 128, 128);
  glowUrl = c.toDataURL();
  return glowUrl;
}

function img(src: string, cls: string, parent: HTMLElement): HTMLImageElement {
  const i = el('img', cls, parent);
  i.src = src;
  i.alt = '';
  i.draggable = false;
  return i;
}

export class ResultPopup {
  private readonly confetti: Confetti;
  private card: HTMLElement | null = null;
  private coinsEl: HTMLElement | null = null;
  private timers: number[] = [];
  private coins = 0;
  private coinIcon: HTMLImageElement | null = null;
  private walletPill: HTMLElement | null = null;
  private walletNum: HTMLElement | null = null;
  /** Shown balance, and the balance once every flying coin has landed. */
  private walletShown = 0;
  private walletTarget = 0;
  private starPill: HTMLElement | null = null;
  private starNum: HTMLElement | null = null;
  private starShown = 0;
  private starTarget = 0;
  private starSlots: HTMLElement[] = [];
  private flights: { el: HTMLElement; anim: Animation }[] = [];
  /** A top-level layer for the flying coins and stars, above everything on the page (never behind the popup). */
  private readonly flyLayer: HTMLElement;
  private flightTimers: number[] = [];
  /** The LEVEL UP popup's live item view (disposed with the popup). */
  private itemView: ItemView | null = null;

  /** Resolves the current show() with the tapped button's id. */
  private choose: ((id: string) => void) | null = null;

  constructor(private readonly root: HTMLElement, private readonly hooks: ResultHooks = {}) {
    const canvas = el('canvas', 'rp-confetti', root);
    this.confetti = new Confetti(canvas);
    this.flyLayer = el('div', 'rp-fly-layer', document.body);
    // Decode every sprite (and draw the rays) ahead of time, so opening the popup doesn't stall on it.
    const warm = () => {
      raysImage('win');
      raysImage('lose');
      coinGlowImage();
      this.confetti.warmUp();
      for (const url of [...Object.values(ART), ...Object.values(LV_ART)]) {
        const i = new Image();
        i.src = url;
        i.decode().catch(() => {});
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 1500);
  }

  /** Builds and plays the popup; resolves with the id of the button the player taps. */
  show(o: ResultOptions): Promise<string> {
    this.clear();
    const perfect = o.title === 'perfect';
    const card = el('div', `rp-card rp-${o.mode}${perfect ? ' rp-perfect' : ''}`, this.root);
    this.card = card;

    // Back to front: rays, panel, emblem (trophy / worried character), ribbon + title, stars.
    const win = o.mode === 'win';
    const rays = img(raysImage(o.mode), 'rp-rays', card);
    const panel = el('div', 'rp-panel', card);
    // The loss emblem shows once its sprite exists (assets/ui/result/worried.webp); until then, no emblem.
    let trophy: HTMLElement | null = null;
    if (win) {
      // Trophy + a shine layer masked to its shape (the streak sweeps across the gold on each "ta-da").
      trophy = el('div', 'rp-emblem rp-trophy', card);
      img(art('trophy'), 'rp-trophy-art', trophy);
      el('div', 'rp-trophy-shine', trophy);
    }
    else if (art('worried')) {
      // The worried puck and its sweat drop move as one (the drop is a child, so it follows the puck's bob).
      trophy = el('div', 'rp-emblem rp-worried', card);
      img(art('worried'), 'rp-worried-art', trophy);
      img(art('sweat_drop'), 'rp-sweat', trophy);
    }
    const ribbon = el('div', 'rp-ribbon', card);
    img(art(o.mode === 'win' ? 'ribbon_gold' : 'ribbon_purple'), 'rp-ribbon-art', ribbon);
    const title = img(art(`title_${o.title}`), 'rp-title', ribbon);
    // PERFECT! gets a gold shimmer sweeping across the word (a streak masked to the word's own shape).
    if (perfect) el('div', 'rp-title-shine', ribbon);

    const starRow = el('div', 'rp-stars', card);
    const stars = [0, 1, 2].map((i) => {
      const slot = el('div', `rp-star rp-star-${i}`, starRow);
      img(art('star_empty'), 'rp-star-empty', slot);
      const fill = img(art('star_gold'), 'rp-star-fill', slot);
      fill.style.opacity = '0';
      return { slot, fill };
    });
    this.starSlots = stars.map((st) => st.slot);

    // Panel content: score, coins, buttons.
    const score = o.score ? el('div', 'rp-score', panel) : null;
    const scoreNums: { el: HTMLElement; to: number }[] = [];
    const side = (n: number, name: string, cls: string) => {
      const s = el('div', `rp-side ${cls}`, score!);
      const num = el('span', 'rp-score-num', s);
      num.textContent = num.dataset.n = '0'; // counts up to n as the score appears
      scoreNums.push({ el: num, to: n });
      el('span', 'rp-score-name', s).textContent = name;
    };
    if (o.score && score) {
      side(o.score.you, o.score.youName ?? 'YOU', 'rp-you');
      el('span', 'rp-dash', score).textContent = '-';
      side(o.score.opp, o.score.oppName ?? 'OPP', 'rp-opp');
    }

    const coinRow = this.makeCoinRow(panel, o.coins ?? 0);
    this.makeWallet(o.wallet, o.starWallet);
    const buttons = this.makeButtons(panel, o.buttons);

    // ---------- Entry animation (~1.6 s) ----------
    // A win pops in; a loss drops in heavier and wobbles like jelly.
    card.animate(
      win
        ? [{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.65 }, { transform: 'scale(1)' }]
        : [
            { opacity: 0, transform: 'translateY(-45%)' },
            { opacity: 1, transform: 'translateY(4%) scale(1.04, 0.94)', offset: 0.5 },
            { transform: 'translateY(-2%) scale(0.98, 1.03)', offset: 0.7 },
            { transform: 'translateY(0.5%) scale(1.01, 0.99)', offset: 0.85 },
            { transform: 'none' },
          ],
      { duration: win ? 420 : 620, easing: ease.out, fill: 'backwards' },
    );
    rays.animate([{ opacity: 0, scale: '0.4' }, { opacity: 1, scale: '1' }], { duration: 600, delay: 200, easing: ease.out, fill: 'backwards' });
    // The emblem jumps up, lands with a squash-and-stretch; on a win the landing also bursts sparkles and flares the rays.
    trophy?.animate(
      [
        { transform: 'translate(-50%, 40%) scale(0.2)', opacity: 0 },
        { transform: 'translate(-50%, -10%) scale(1.12)', opacity: 1, offset: 0.48 },
        { transform: 'translate(-50%, 3%) scale(1.14, 0.86)', offset: 0.66 },
        { transform: 'translate(-50%, -3%) scale(0.94, 1.07)', offset: 0.82 },
        { transform: 'translate(-50%, 0) scale(1)' },
      ],
      { duration: 700, delay: 260, easing: ease.out, fill: 'backwards' },
    );
    // The impact frame: a quick white flash over everything as the popup pops in (softer on a loss).
    const flash = el('div', 'rp-flash', this.root);
    flash.animate([{ opacity: 0 }, { opacity: win ? 0.85 : 0.35, offset: 0.25 }, { opacity: 0 }], { duration: 260, delay: 60, easing: 'ease-out', fill: 'both' }).onfinish = () => flash.remove();

    // Vibration beats: the popup lands, then the emblem lands.
    this.later(win ? 270 : 310, () => this.hooks.onBeat?.('enter', o.mode));
    if (trophy) this.later(260 + 700 * 0.66, () => this.hooks.onBeat?.('emblem', o.mode));
    if (win && trophy) {
      const cup = trophy;
      this.later(260 + 700 * 0.66, () => {
        const r = cup.getBoundingClientRect();
        this.confetti.sparkle(r.left + r.width / 2, r.top + r.height * 0.45, 18);
        rays.animate([{ scale: '1', opacity: 1 }, { scale: '1.18', opacity: 1, offset: 0.35 }, { scale: '1', opacity: 1 }], { duration: 450, easing: 'ease-out' });
      });
    }
    ribbon.animate(
      win
        ? [{ transform: 'translate(-50%, -90%) rotate(-8deg)', opacity: 0 }, { transform: 'translate(-50%, 8%) rotate(3deg)', opacity: 1, offset: 0.55 }, { transform: 'translate(-50%, -3%) rotate(-1.5deg)', offset: 0.8 }, { transform: 'translate(-50%, 0) rotate(0)' }]
        : // A loss: the ribbon lands crooked and swings itself straight.
          [
            { transform: 'translate(-50%, -60%) rotate(-14deg)', opacity: 0 },
            { transform: 'translate(-50%, 4%) rotate(-10deg)', opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%, 0) rotate(6deg)', offset: 0.5 },
            { transform: 'translate(-50%, 0) rotate(-3deg)', offset: 0.68 },
            { transform: 'translate(-50%, 0) rotate(1.5deg)', offset: 0.84 },
            { transform: 'translate(-50%, 0) rotate(0)' },
          ],
      { duration: win ? 650 : 1100, delay: 180, easing: ease.out, fill: 'backwards' },
    );
    title.animate([{ scale: '0', opacity: 0 }, { scale: '1.2', opacity: 1, offset: 0.6 }, { scale: '1' }], { duration: 420, delay: 480, easing: ease.out, fill: 'backwards' });
    stars.forEach(({ slot }, i) =>
      slot.animate([{ scale: '0', opacity: 0 }, { scale: '1.15', opacity: 1, offset: 0.7 }, { scale: '1' }], { duration: 320, delay: 420 + i * 70, easing: ease.out, fill: 'backwards' }),
    );
    score?.animate([{ scale: '0.3', opacity: 0 }, { scale: '1.12', opacity: 1, offset: 0.6 }, { scale: '1' }], { duration: 380, delay: 620, easing: ease.out, fill: 'backwards' });
    // The score counts up quickly (0 -> 5), each new digit with a little punch and a tick.
    this.later(700, () => this.countScore(scoreNums));
    // The reward line punches in: overshoots big, squashes back, settles (with a sparkle burst on the coin).
    coinRow?.animate(
      [
        { scale: '0', rotate: '-12deg', opacity: 0 },
        { scale: '1.4', rotate: '6deg', opacity: 1, offset: 0.5 },
        { scale: '0.9', rotate: '-2deg', offset: 0.75 },
        { scale: '1', rotate: '0deg' },
      ],
      { duration: 520, delay: 700, easing: ease.out, fill: 'backwards' },
    );
    if (coinRow) {
      const row = coinRow;
      this.later(700 + 260, () => {
        const r = (this.coinIcon ?? row).getBoundingClientRect();
        this.confetti.sparkle(r.left + r.width / 2, r.top + r.height / 2, 12);
      });
    }
    buttons.forEach((b, i) =>
      b.animate([{ transform: 'translateY(40%) scale(0.6)', opacity: 0 }, { transform: 'translateY(-4%) scale(1.04)', opacity: 1, offset: 0.65 }, { transform: 'none' }], { duration: 380, delay: 780 + i * 90, easing: ease.out, fill: 'backwards' }),
    );

    // Confetti is thrown out from behind the popup as it appears (desktop and phones alike: CSS px).
    this.later(120, () => {
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.32;
      if (o.mode === 'win') {
        this.confetti.burst(cx, cy, 110, -Math.PI / 2, 2.6, 1.1);
        this.later(160, () => {
          this.confetti.burst(r.left + r.width * 0.1, r.bottom - r.height * 0.15, 50, -Math.PI * 0.62, 0.7, 1.1);
          this.confetti.burst(r.right - r.width * 0.1, r.bottom - r.height * 0.15, 50, -Math.PI * 0.38, 0.7, 1.1);
        });
        // Then a gentle rain from the top keeps it going for a while.
        // ... and confetti keeps falling the whole time the popup is open (never runs out).
        this.later(900, () => this.confetti.rain(Infinity, 24));
      }
    });

    // Once the trophy has landed, it twinkles now and then (tiny sparkles on the cup).
    if (win && trophy) {
      const cup = trophy;
      const twinkle = () => {
        const r = cup.getBoundingClientRect();
        this.confetti.sparkle(r.left + r.width * (0.25 + Math.random() * 0.5), r.top + r.height * (0.1 + Math.random() * 0.4), 7);
        this.later(900 + Math.random() * 900, twinkle);
      };
      this.later(1400, twinkle);
    }

    // Stars fill one by one, then the coins count up.
    const starsStart = 950;
    for (let i = 0; i < Math.min(3, o.stars); i++) {
      this.later(starsStart + i * 330, () => {
        this.fillStar(stars[i].slot, stars[i].fill, i);
        // PERFECT: the third star lands with an extra confetti burst out of it.
        if (perfect && i === 2) {
          this.later(280, () => {
            const r = stars[2].slot.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            this.confetti.burst(cx, cy, 60, -Math.PI / 2, 2.4, 0.9);
            this.confetti.sparkle(cx, cy, 20);
          });
        }
      });
    }
    // Then the earned stars fly from their slots into the star counter, and the coins from the coin line into theirs.
    const earned = Math.min(3, o.stars);
    const starsDone = starsStart + earned * 330 + 250;
    this.later(starsDone, () => this.flyStars(earned));
    this.later(starsDone + earned * 130 + 350, () => this.flyCoins(this.coins, Math.min(12, Math.max(6, Math.round(this.coins / 3)))));
    // Then the earned stars stay alive: every few seconds they hop one after another, each with a little twinkle.
    if (earned > 0) this.later(starsDone + 1800, () => this.starsIdle(stars.slice(0, earned).map((st) => st.fill)));

    return new Promise((resolve) => (this.choose = resolve));
  }

  /**
   * The LEVEL UP popup (after the result popup): the unlocked item lands on the Locker pedestal with a NEW! tag, the
   * gold ribbon reads LEVEL UP!, and the level star flips to the new level.
   * Same panel, ribbon, rays, confetti and buttons as the win popup. Resolves with the tapped button's id.
   */
  showLevelUp(o: LevelUpOptions): Promise<string> {
    this.clear();
    const card = el('div', 'rp-card rp-levelup', this.root);
    this.card = card;

    // Back to front: rays, panel, the item on its pedestal, ribbon + title.
    const rays = img(raysImage('win'), 'rp-rays', card);
    const panel = el('div', 'rp-panel', card);
    let stage: HTMLElement | null = null;
    let pedestal: HTMLImageElement | null = null;
    let itemArt: HTMLElement | null = null;
    let badge: HTMLImageElement | null = null;
    if (o.item) {
      stage = el('div', 'rp-unlock', card);
      pedestal = img(lvArt('pedestal'), 'rp-pedestal', stage);
      // The item spins on the pedestal (its live 3D view, seen from the pedestal's own angle, standing on its top).
      const itemBox = el('div', 'rp-unlock-item', stage);
      if (o.item.view) {
        this.itemView = o.item.view;
        itemArt = o.item.view.el;
        itemArt.classList.add('rp-unlock-art');
        itemBox.appendChild(itemArt);
        o.item.view.start();
      }
      badge = img(lvArt('badge_new'), 'rp-new', stage);
    }
    const ribbon = el('div', 'rp-ribbon', card);
    img(art('ribbon_gold'), 'rp-ribbon-art', ribbon);
    const title = img(lvArt('title_levelup'), 'rp-title', ribbon);

    // Panel content: the level star (live number), the item's name, buttons.
    const level = el('div', 'rp-level', panel);
    img(coinGlowImage(), 'rp-level-glow', level); // the coin line's breathing golden glow, behind the star
    img(lvArt('star_level'), 'rp-level-star', level);
    const levelNum = el('span', 'rp-level-num', level);
    levelNum.textContent = String(o.from);
    this.fitLevelNum(levelNum);
    let name: HTMLElement | null = null;
    if (o.item) {
      name = el('div', 'rp-unlock-name', panel);
      name.textContent = o.item.name;
    }
    const buttons = this.makeButtons(panel, o.buttons);

    // ---------- Entry animation (~1.6 s) ----------
    card.animate([{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.65 }, { transform: 'scale(1)' }], {
      duration: 420,
      easing: ease.out,
      fill: 'backwards',
    });
    rays.animate([{ opacity: 0, scale: '0.4' }, { opacity: 1, scale: '1' }], { duration: 600, delay: 200, easing: ease.out, fill: 'backwards' });
    const flash = el('div', 'rp-flash', this.root);
    flash.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }], { duration: 260, delay: 60, easing: 'ease-out', fill: 'both' }).onfinish = () => flash.remove();
    this.later(270, () => this.hooks.onBeat?.('enter', 'win'));
    ribbon.animate(
      [{ transform: 'translate(-50%, -90%) rotate(-8deg)', opacity: 0 }, { transform: 'translate(-50%, 8%) rotate(3deg)', opacity: 1, offset: 0.55 }, { transform: 'translate(-50%, -3%) rotate(-1.5deg)', offset: 0.8 }, { transform: 'translate(-50%, 0) rotate(0)' }],
      { duration: 650, delay: 180, easing: ease.out, fill: 'backwards' },
    );
    title.animate([{ scale: '0', opacity: 0 }, { scale: '1.2', opacity: 1, offset: 0.6 }, { scale: '1' }], { duration: 420, delay: 480, easing: ease.out, fill: 'backwards' });

    // The pedestal pops up, then the item drops onto it and lands with a squash, a sparkle burst and a rays flare.
    pedestal?.animate([{ scale: '0', opacity: 0 }, { scale: '1.12', opacity: 1, offset: 0.6 }, { scale: '1' }], { duration: 360, delay: 240, easing: ease.out, fill: 'backwards' });
    const dropMs = 620;
    const dropDelay = 420;
    itemArt?.animate(
      [
        { transform: 'translateY(-70%) scale(0.6)', opacity: 0 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.5 },
        { transform: 'translateY(2%) scale(1.14, 0.86)', offset: 0.64 },
        { transform: 'translateY(-4%) scale(0.95, 1.06)', offset: 0.8 },
        { transform: 'none' },
      ],
      { duration: dropMs, delay: dropDelay, easing: 'cubic-bezier(0.5, 0, 0.6, 1)', fill: 'backwards' },
    );
    if (stage) {
      const box = stage;
      this.later(dropDelay + dropMs * 0.55, () => {
        this.hooks.onBeat?.('emblem', 'win');
        const r = box.getBoundingClientRect();
        this.confetti.sparkle(r.left + r.width / 2, r.top + r.height * 0.6, 18);
        rays.animate([{ scale: '1', opacity: 1 }, { scale: '1.18', opacity: 1, offset: 0.35 }, { scale: '1' }], { duration: 450, easing: 'ease-out' });
      });
      // Then it twinkles now and then.
      const twinkle = () => {
        const r = box.getBoundingClientRect();
        this.confetti.sparkle(r.left + r.width * (0.3 + Math.random() * 0.4), r.top + r.height * (0.1 + Math.random() * 0.45), 7);
        this.later(900 + Math.random() * 900, twinkle);
      };
      this.later(1600, twinkle);
    }
    badge?.animate([{ scale: '0', rotate: '-40deg', opacity: 0 }, { scale: '1.3', rotate: '12deg', opacity: 1, offset: 0.6 }, { scale: '1', rotate: '0deg' }], {
      duration: 420,
      delay: 1050,
      easing: ease.out,
      fill: 'backwards',
    });

    // The level star spins in showing the old level, then flips to the new one with a punch and a sparkle.
    level.animate([{ transform: 'scale(2.2) rotate(-160deg)', opacity: 0 }, { transform: 'scale(0.9) rotate(8deg)', opacity: 1, offset: 0.7 }, { transform: 'none' }], {
      duration: 420,
      delay: 560,
      easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)',
      fill: 'backwards',
    });
    this.later(1150, () => {
      levelNum.textContent = String(o.level);
      this.fitLevelNum(levelNum);
      levelNum.animate([{ scale: '1' }, { scale: '1.5', offset: 0.35 }, { scale: '1' }], { duration: 320, easing: 'ease-out' });
      level.animate([{ scale: '1' }, { scale: '1.15', offset: 0.35 }, { scale: '1' }], { duration: 300, easing: 'ease-out' });
      const r = level.getBoundingClientRect();
      this.confetti.sparkle(r.left + r.width / 2, r.top + r.height / 2, 16);
      this.hooks.onStar?.(2);
    });
    name?.animate([{ scale: '0.3', opacity: 0 }, { scale: '1.12', opacity: 1, offset: 0.6 }, { scale: '1' }], { duration: 380, delay: 1250, easing: ease.out, fill: 'backwards' });
    buttons.forEach((b, i) =>
      b.animate([{ transform: 'translateY(40%) scale(0.6)', opacity: 0 }, { transform: 'translateY(-4%) scale(1.04)', opacity: 1, offset: 0.65 }, { transform: 'none' }], { duration: 380, delay: 1350 + i * 90, easing: ease.out, fill: 'backwards' }),
    );

    // Confetti from behind the popup, then it keeps falling while the popup is open.
    this.later(120, () => {
      const r = card.getBoundingClientRect();
      this.confetti.burst(r.left + r.width / 2, r.top + r.height * 0.32, 110, -Math.PI / 2, 2.6, 1.1);
      this.later(160, () => {
        this.confetti.burst(r.left + r.width * 0.1, r.bottom - r.height * 0.15, 50, -Math.PI * 0.62, 0.7, 1.1);
        this.confetti.burst(r.right - r.width * 0.1, r.bottom - r.height * 0.15, 50, -Math.PI * 0.38, 0.7, 1.1);
      });
      this.later(900, () => this.confetti.rain(Infinity, 24));
    });

    return new Promise((resolve) => (this.choose = resolve));
  }

  /**
   * Sizes the level number to fit inside the star: its width (plus the outline) stays within 86% of the biggest circle
   * that fits in the star (53% of the star's width), up to the CSS size (one digit).
   */
  private fitLevelNum(num: HTMLElement): void {
    num.style.fontSize = '';
    const star = num.parentElement!;
    const size = parseFloat(getComputedStyle(num).fontSize);
    const room = star.offsetWidth * 0.532 * 0.86;
    const width = num.offsetWidth + size * 0.17; // the label outline adds ~0.085em on each side
    if (room > 0 && width > room) num.style.fontSize = `${size * (room / width)}px`;
  }

  /** The reward line (coin + "+N" on a breathing glow); none for 0 coins. */
  private makeCoinRow(panel: HTMLElement, coins: number): HTMLElement | null {
    this.coins = coins;
    if (coins <= 0) return null;
    const row = el('div', 'rp-coins', panel);
    img(coinGlowImage(), 'rp-coin-glow', row);
    this.coinIcon = img(art('coin'), 'rp-coin-icon', row);
    this.coinsEl = el('span', 'rp-coin-text', row);
    this.coinsEl.textContent = `+${coins}`;
    return row;
  }

  /** The counters the earned coins and stars fly into (same sprites and layout as the Home top bar). */
  private makeWallet(wallet: number | undefined, starWallet: number | undefined): void {
    if (wallet === undefined && starWallet === undefined) return;
    const bar = el('div', 'stat-bar rp-wallet', this.root);
    if (wallet !== undefined) {
      this.walletPill = el('div', 'stat-pill coin-pill', bar);
      this.walletNum = el('span', 'num stat-num', this.walletPill);
      this.walletShown = this.walletTarget = wallet;
      this.setWallet(wallet);
    }
    if (starWallet !== undefined) {
      this.starPill = el('div', 'stat-pill star-pill', bar);
      this.starNum = el('span', 'num stat-num', this.starPill);
      this.starShown = this.starTarget = starWallet;
      this.setStars(starWallet);
    }
  }

  /** Full-width buttons stack; an icon-only button sits in a row with the next one (e.g. [home] [CONTINUE]). */
  private makeButtons(panel: HTMLElement, list: PopupButton[]): HTMLButtonElement[] {
    const btnBox = el('div', 'rp-buttons', panel);
    const buttons: HTMLButtonElement[] = [];
    let row: HTMLElement | null = null;
    for (const b of list) {
      if (b.iconOnly) row = el('div', 'rp-btn-row', btnBox);
      buttons.push(this.makeButton(b, row ?? btnBox));
      if (!b.iconOnly) row = null;
    }
    this.fitButtons(buttons);
    return buttons;
  }

  /** Multiplies the shown coins (after a rewarded ad) with a count-up and a little confetti pop. */
  multiplyCoins(factor: number): void {
    this.hooks.onBeat?.('reward', 'win');
    const from = this.coins;
    this.coins *= factor;
    this.countCoins(from, this.coins, 650);
    this.later(250, () => this.flyCoins(this.coins - from, 16));
    const row = this.coinsEl?.parentElement;
    if (row) {
      row.animate([{ scale: '1' }, { scale: '1.35', offset: 0.4 }, { scale: '1' }], { duration: 600, easing: ease.pop });
      const r = row.getBoundingClientRect();
      this.confetti.sparkle(r.left + r.width * 0.25, r.top + r.height / 2, 16);
    }
  }

  /** Disables a button (e.g. x3 after it was used): it stays in place, greyed. */
  disableButton(id: string): void {
    const b = this.card?.querySelector<HTMLButtonElement>(`[data-id="${id}"]`);
    if (b) {
      b.disabled = true;
      b.classList.remove('rp-shine');
    }
  }

  /** Waits for the next button tap (after handling one that keeps the popup open). */
  next(): Promise<string> {
    return new Promise((resolve) => (this.choose = resolve));
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.finishCoins();
    this.root.querySelector('.rp-wallet')?.remove();
    this.walletPill = this.walletNum = this.coinIcon = this.starPill = this.starNum = null;
    this.starSlots = [];
    this.confetti.clear();
    this.itemView?.dispose();
    this.itemView = null;
    this.card?.remove();
    this.card = null;
    this.coinsEl = null;
    this.choose = null;
  }

  /**
   * Fits the labels: if any label does not fit its button (e.g. a long label beside the round home button), every
   * label in the popup shrinks by the same amount, so all buttons keep one text size.
   */
  private fitButtons(buttons: HTMLButtonElement[]): void {
    let scale = 1;
    const texts: HTMLElement[] = [];
    for (const btn of buttons) {
      const text = btn.querySelector<HTMLElement>('.rp-btn-text');
      if (!text) continue;
      text.style.fontSize = '';
      texts.push(text);
      // the content may also use 16% of the button height inside each rounded end (see .rp-btn CSS)
      const ends = btn.classList.contains('rp-btn-round') ? 0 : btn.offsetHeight * 0.32;
      const gaps = parseFloat(getComputedStyle(btn).columnGap) || 0;
      const others = [...btn.children].filter((c) => c !== text && !c.classList.contains('rp-btn-badge'));
      const room = btn.clientWidth + ends - others.reduce((w, c) => w + (c as HTMLElement).offsetWidth + gaps, 0) - 8;
      if (room > 0 && text.offsetWidth > room) scale = Math.min(scale, room / text.offsetWidth);
    }
    if (scale < 1) {
      for (const text of texts) text.style.fontSize = `${parseFloat(getComputedStyle(text).fontSize) * scale}px`;
    }
  }

  private makeButton(b: PopupButton, parent: HTMLElement): HTMLButtonElement {
    const btn = el('button', `rp-btn rp-btn-${b.color}${b.shine ? ' rp-shine' : ''}${b.iconOnly ? ' rp-btn-round' : ''}${b.breathe ? ' rp-breathe' : ''}`, parent);
    btn.dataset.id = b.id;
    btn.setAttribute('aria-label', b.text);
    // Each icon comes pre-tinted per button colour (outline + depth match the label; tools/ui/tint_icon.py).
    if (b.icon) img(art(`icon_${b.icon}_${b.color}`), 'rp-btn-icon', btn);
    if (!b.iconOnly) el('span', 'rp-btn-text', btn).textContent = b.text;
    if (b.coin) img(art('coin'), 'rp-btn-coin', btn);
    if (b.badge) el('span', 'rp-btn-badge', btn).textContent = b.badge;
    btn.addEventListener('pointerdown', () => btn.animate([{ scale: '1' }, { scale: '0.92', offset: 0.4 }, { scale: '1' }], { duration: 220, easing: 'ease-out' }));
    btn.addEventListener('click', () => {
      if (btn.disabled || !this.choose) return;
      this.hooks.onTap?.();
      this.finishCoins(); // a quick tap never loses coins or waits for them
      const choose = this.choose;
      this.choose = null;
      setTimeout(() => choose(b.id), 120); // let the press show first
    });
    return btn;
  }

  /**
   * Sends `amount` coins as `count` sprites from the coin line to the counter, each on its own arc, streaming one
   * after another. Each landing adds its share to the counter (which bumps), plus a ding.
   */
  private flyCoins(amount: number, count: number): void {
    if (!this.coinIcon || !this.walletPill || amount <= 0) return;
    this.walletTarget += amount;
    const from = this.coinIcon.getBoundingClientRect();
    const pill = this.walletPill.getBoundingClientRect();
    const sx = from.left + from.width / 2;
    const sy = from.top + from.height / 2;
    // The counter's coin icon sits on the pill's left end.
    const tx = pill.left + pill.height * 0.6;
    const ty = pill.top + pill.height / 2;
    const size = Math.min(from.width, 44); // flying coins stay small, whatever the size of the coin line
    const share = Math.floor(amount / count);
    for (let i = 0; i < count; i++) {
      const value = i === count - 1 ? amount - share * (count - 1) : share;
      this.flightTimers.push(window.setTimeout(() => this.flyOne(sx, sy, tx, ty, size, value, i), i * 70));
    }
  }

  private flyOne(sx: number, sy: number, tx: number, ty: number, size: number, value: number, i: number): void {
    this.fly(art('coin'), sx, sy, tx, ty, size, 1, () => {
      this.setWallet(this.walletShown + value);
      this.walletPill?.animate([{ scale: '1' }, { scale: '1.15', offset: 0.35 }, { scale: '1' }], { duration: 200, easing: 'ease-out' });
      this.hooks.onCoin?.(i);
    });
  }

  /** Each earned star flies from its slot to the star counter (the slot keeps its star), one after another. */
  private flyStars(count: number): void {
    if (!this.starPill || count <= 0) return;
    this.starTarget += count;
    const pill = this.starPill.getBoundingClientRect();
    const tx = pill.left + pill.height * 0.6;
    const ty = pill.top + pill.height / 2;
    for (let i = 0; i < count; i++) {
      this.flightTimers.push(
        window.setTimeout(() => {
          const slot = this.starSlots[i]?.getBoundingClientRect();
          if (!slot) return;
          this.fly(art('star_gold'), slot.left + slot.width / 2, slot.top + slot.height / 2, tx, ty, slot.width * 0.8, 0.5, () => {
            this.setStars(this.starShown + 1);
            this.starPill?.animate([{ scale: '1' }, { scale: '1.2', offset: 0.35 }, { scale: '1' }], { duration: 220, easing: 'ease-out' });
            const r = this.starPill?.getBoundingClientRect();
            if (r) this.confetti.sparkle(r.left + r.height * 0.6, r.top + r.height / 2, 8);
            this.hooks.onStarLand?.(i);
          });
        }, i * 130),
      );
    }
  }

  /**
   * Flies a sprite from (sx, sy) to (tx, ty) on a curved arc (out to one side and up, then into the target,
   * speeding up as it arrives), spinning `spin` turns; calls `onLand` when it arrives.
   */
  private fly(src: string, sx: number, sy: number, tx: number, ty: number, size: number, spin: number, onLand: () => void): void {
    const sprite = img(src, 'rp-flying-coin', this.flyLayer);
    sprite.style.width = sprite.style.height = `${size}px`;
    sprite.style.left = `${sx - size / 2}px`;
    sprite.style.top = `${sy - size / 2}px`;
    sprite.style.objectFit = 'contain';
    const side = (Math.random() - 0.5) * 2;
    const cx = sx + side * 150 + (tx - sx) * 0.25;
    const cy = Math.min(sy, ty) - 60 - Math.random() * 80;
    const frames: Keyframe[] = [];
    const steps = 14;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const e = t * t * (1.6 - 0.6 * t); // eases in: a gentle start, a fast arrival
      const x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * tx;
      const y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * ty;
      const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.7 : 1.3 - 0.75 * e;
      frames.push({ transform: `translate(${x - sx}px, ${y - sy}px) scale(${scale}) rotate(${t * 360 * side * spin}deg)` });
    }
    const anim = sprite.animate(frames, { duration: 600 + Math.random() * 150, easing: 'linear' });
    const flight = { el: sprite, anim };
    this.flights.push(flight);
    anim.onfinish = () => {
      sprite.remove();
      this.flights = this.flights.filter((f) => f !== flight);
      onLand();
    };
  }

  /** Lands every coin still in the air at once (button tapped, or the popup closes). */
  private finishCoins(): void {
    for (const t of this.flightTimers) clearTimeout(t);
    this.flightTimers = [];
    for (const f of this.flights) {
      f.anim.onfinish = null;
      f.anim.cancel();
      f.el.remove();
    }
    this.flights = [];
    if (this.walletNum && this.walletShown !== this.walletTarget) this.setWallet(this.walletTarget);
    if (this.starNum && this.starShown !== this.starTarget) this.setStars(this.starTarget);
  }

  private setStars(n: number): void {
    this.starShown = n;
    if (!this.starNum) return;
    if (this.hooks.setStat) this.hooks.setStat(this.starNum, String(n));
    else this.starNum.textContent = String(n);
  }

  private setWallet(n: number): void {
    this.walletShown = n;
    if (!this.walletNum) return;
    const text = n.toLocaleString('en-US');
    if (this.hooks.setStat) this.hooks.setStat(this.walletNum, text);
    else this.walletNum.textContent = text;
  }

  /** A hop wave across the earned stars (with a twinkle on each), repeating every ~3 s while the popup is open. */
  private starsIdle(fills: HTMLImageElement[]): void {
    fills.forEach((fill, i) =>
      this.later(i * 140, () => {
        fill.animate(
          [
            { translate: '0 0', scale: '1' },
            { translate: '0 -18%', scale: '1.12 0.92', offset: 0.35 },
            { translate: '0 -22%', scale: '0.95 1.08', offset: 0.5 },
            { translate: '0 4%', scale: '1.1 0.9', offset: 0.78 },
            { translate: '0 0', scale: '1' },
          ],
          { duration: 480, easing: 'ease-out' },
        );
        this.later(160, () => {
          const r = fill.getBoundingClientRect();
          this.confetti.sparkle(r.left + r.width * 0.68, r.top + r.height * 0.28, 5);
        });
      }),
    );
    this.later(2800 + Math.random() * 600, () => this.starsIdle(fills));
  }

  private fillStar(slot: HTMLElement, fill: HTMLImageElement, i: number): void {
    fill.style.opacity = '1';
    fill.animate(
      [{ transform: 'scale(2.6) rotate(-160deg)', opacity: 0 }, { transform: 'scale(0.85) rotate(8deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1) rotate(0)' }],
      { duration: 380, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)' },
    );
    this.later(270, () => {
      // The gold star now covers its slot for good: hide the empty star behind it, so a hop never shows it.
      const empty = slot.querySelector<HTMLElement>('.rp-star-empty');
      if (empty) empty.style.opacity = '0';
      slot.animate([{ scale: '1' }, { scale: '1.18', offset: 0.35 }, { scale: '1' }], { duration: 260, easing: 'ease-out' });
      const r = slot.getBoundingClientRect();
      this.confetti.sparkle(r.left + r.width / 2, r.top + r.height / 2);
      this.hooks.onStar?.(i);
      this.card?.animate([{ translate: '0 0' }, { translate: '0 3px', offset: 0.3 }, { translate: '0 0' }], { duration: 160 });
    });
  }

  /** Counts the score numbers up from 0 together (~70 ms a step); each change punches the digit and ticks. */
  private countScore(nums: { el: HTMLElement; to: number }[]): void {
    const top = Math.max(0, ...nums.map((n) => n.to));
    for (let step = 1; step <= top; step++) {
      this.later((step - 1) * 75, () => {
        for (const n of nums) {
          if (step > n.to) continue;
          n.el.textContent = n.el.dataset.n = String(step);
          n.el.animate([{ scale: '1' }, { scale: '1.25', offset: 0.35 }, { scale: '1' }], { duration: 160, easing: 'ease-out' });
        }
        this.hooks.onTick?.(step);
      });
    }
  }

  private countCoins(from: number, to: number, ms: number): void {
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!this.coinsEl) return;
      const k = Math.min(1, (now - t0) / ms);
      this.coinsEl.textContent = `+${Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))}`;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }
}
