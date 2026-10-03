import { addCoins, addFresh, bankMatch, clearPendingLevelUp, hasFresh, homeStats, type HomeStats } from '../game/Stats';
import { REWARDS, matchRewards, resultTitle } from '../game/Rewards';
import { equipItem, unlockAt, unlocksBetween, type ItemKind } from '../game/Skins';
import { ResultPopup, type ItemView } from './ResultPopup';
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn` when the browser is idle (soon at the latest), so background work never lands in an animation frame. */
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

const FONT = '"Lilita One"';

/** The game's label shadow (`--label-shadow` in styles.css), as offsets in em, blur in px and colour. */
let labelShadowList: { x: number; y: number; blur: number; color: string }[] | null = null;
function labelShadows(): { x: number; y: number; blur: number; color: string }[] {
  if (labelShadowList) return labelShadowList;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--label-shadow');
  const re = /(-?[\d.]+)em\s+(-?[\d.]+)em\s+([\d.]+)px\s+(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+)/g;
  labelShadowList = [...css.matchAll(re)].map((m) => ({ x: +m[1], y: +m[2], blur: +m[3], color: m[4] }));
  return labelShadowList;
}

/**
 * Draws a word in the game's label style into a canvas: the same shadows as `--label-shadow` (CSS paints the first
 * one on top, so they go in reverse), then the fill. Each shadow is cast by a glyph drawn far off the canvas, so
 * only the shadow lands (otherwise later shadows would cover the earlier fills).
 */
function drawLabel(text: string, color: string, size: number): HTMLCanvasElement {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const setFont = () => {
    g.font = `400 ${size}px ${FONT}`;
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${0.02 * size}px`;
  };
  setFont();
  const width = g.measureText(text).width;
  const pad = size * 0.2; // room for the outline and the depth edge below
  const cssW = Math.ceil(width + pad * 2);
  const cssH = Math.ceil(size * 1.15 + pad * 1.5);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  c.className = 'banner-art';
  g.scale(dpr, dpr);
  setFont(); // resizing the canvas reset it
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const x = cssW / 2;
  const y = pad * 0.6 + (size * 1.15) / 2;
  const off = cssW + 2000;
  g.fillStyle = '#000';
  for (const sh of [...labelShadows()].reverse()) {
    // Shadow offsets and blur are in device pixels (the canvas scale doesn't apply to them).
    g.shadowColor = sh.color;
    g.shadowBlur = sh.blur * dpr;
    g.shadowOffsetX = (sh.x * size + off) * dpr;
    g.shadowOffsetY = sh.y * size * dpr;
    g.fillText(text, x - off, y);
  }
  g.shadowColor = 'transparent';
  g.fillStyle = color;
  g.fillText(text, x, y);
  return c;
}

/** Thin wrapper around the DOM overlay screens. */
export class UI {
  private readonly home = $('home');
  private readonly locker = $('locker');
  private readonly lockerStage = $('lockerStage');
  private readonly hud = $('hud');
  private readonly result = $('result');
  private readonly pauseMenu = $('pauseMenu');
  private readonly settingsMenu = $('settingsMenu');
  private readonly pauseBtn = $('pauseBtn');
  private readonly fadeEl = $('fade');
  private readonly banner = $('banner');
  private readonly scorePlayer = $('scorePlayer');
  private readonly scoreAi = $('scoreAi');
  private readonly soundToggle = $<HTMLInputElement>('soundToggle');
  private readonly vibrationToggle = $<HTMLInputElement>('vibrationToggle');
  private bannerAnim: Animation | null = null;
  private readonly resultPopup = new ResultPopup(this.result, {
    onStar: (i) => this.onStar(i),
    onTap: () => this.onButton(),
    onCoin: (i) => this.onCoin(i),
    onStarLand: (i) => this.onStarLand(i),
    onTick: (step) => this.onTick(step),
    onBeat: (beat, mode) => this.onBeat(beat, mode),
    setStat: (el, text) => this.setStat(el, text),
  });

  onPlay: () => void = () => {};
  onAgain: () => void = () => {};
  onBack: () => void = () => {};
  onPause: () => void = () => {};
  onResume: () => void = () => {};
  onRestart: () => void = () => {};
  onHome: () => void = () => {};
  onLocker: () => void = () => {};
  onLockerBack: () => void = () => {};
  onButton: () => void = () => {};
  /** A result-popup star lands (sound). */
  onStar: (i: number) => void = () => {};
  /** A flying coin lands in the result popup's counter (sound). */
  onCoin: (i: number) => void = () => {};
  /** A flying star lands in the result popup's star counter (sound). */
  onStarLand: (i: number) => void = () => {};
  /** The result popup's score count-up ticks (sound). */
  onTick: (step: number) => void = () => {};
  /** Result-popup haptic beats (popup lands, emblem lands, ad reward granted). */
  onBeat: (beat: 'enter' | 'emblem' | 'reward', mode: 'win' | 'lose') => void = () => {};
  /** KEEP PLAYING! on a loss (after the ad): the match cancels the opponent's winning goal and resumes. */
  onKeepPlaying: () => void = () => {};
  /** Plays a rewarded ad; resolves true if the reward was earned. */
  onWatchAd: () => Promise<boolean> = async () => true;
  /** Prepares a spinning 3D view of a Locker item (`px` = its size in CSS pixels), for the LEVEL UP popup. */
  onItemView: (kind: ItemKind, id: string, px: number) => Promise<ItemView> = () => Promise.reject(new Error('no item view'));
  /** The LEVEL UP popup opens (fanfare). */
  onLevelUp: () => void = () => {};
  onSettingsChange: (s: { sound: boolean; vibration: boolean }) => void = () => {};

  constructor() {
    // Every sprite button squashes a little when tapped.
    for (const btn of document.querySelectorAll<HTMLElement>('.sprite-btn')) {
      btn.addEventListener('click', () => {
        btn.classList.remove('pressed');
        void btn.offsetWidth; // restart the animation on quick repeat taps
        btn.classList.add('pressed');
      });
      btn.addEventListener('animationend', (e) => {
        if (e.animationName === 'press') btn.classList.remove('pressed');
      });
    }
    // Popups would cover the button instantly; wait for the press to show first.
    const afterPress = (fn: () => void) => () => setTimeout(fn, 120);

    // Buttons ignore taps while a transition is running.
    let busy = false;
    const guard = (fn: () => void) => () => {
      if (busy) return;
      busy = true;
      fn();
      setTimeout(() => (busy = false), 500);
    };
    $('playBtn').addEventListener('click', guard(() => this.onPlay()));
    $('againBtn').addEventListener('click', guard(() => this.onAgain()));
    $('backBtn').addEventListener('click', guard(() => this.onBack()));
    $('restartBtn').addEventListener('click', guard(() => this.onRestart()));
    $('homeBtn').addEventListener('click', guard(() => this.onHome()));
    $('lockerBtn').addEventListener('click', guard(() => this.onLocker()));
    $('lockerBackBtn').addEventListener('click', guard(() => this.onLockerBack()));
    // Pause/resume respond instantly; they don't start a screen transition.
    this.pauseBtn.addEventListener('click', afterPress(() => this.onPause()));
    $('resumeBtn').addEventListener('click', () => this.onResume());

    $('settingsBtn').addEventListener('click', () => {
      this.onButton();
      setTimeout(() => this.settingsMenu.classList.remove('hidden'), 120);
    });
    $('closeSettingsBtn').addEventListener('click', () => {
      this.onButton();
      this.settingsMenu.classList.add('hidden');
    });
    const changed = () => {
      this.syncSwitches();
      this.onSettingsChange({ sound: this.soundToggle.checked, vibration: this.vibrationToggle.checked });
    };
    this.soundToggle.addEventListener('change', changed);
    this.vibrationToggle.addEventListener('change', changed);
    this.prepareBanners();
  }

  setSettings(s: { sound: boolean; vibration: boolean }): void {
    this.soundToggle.checked = s.sound;
    this.vibrationToggle.checked = s.vibration;
    this.syncSwitches();
  }

  /** The sprite paints both switches ON; an overlay shows the OFF look for unchecked ones. */
  private syncSwitches(): void {
    for (const el of document.querySelectorAll<HTMLElement>('.switch-off')) {
      const input = document.getElementById(el.dataset.for!) as HTMLInputElement;
      el.classList.toggle('on', !input.checked);
    }
  }

  /** Fades out, runs the swap, then fades back in. */
  /**
   * Fades out, runs the swap, then fades back in. If the swap returns a promise (the new screen
   * still loading), the fade waits for it, up to 1.5 s, so nothing half-built is ever shown.
   */
  transition(swap: () => void | Promise<unknown>, onShown?: () => void): void {
    this.fadeEl.classList.remove('clear');
    setTimeout(() => {
      const loading = swap();
      const limit = new Promise((resolve) => setTimeout(resolve, 1500));
      Promise.race([Promise.resolve(loading).catch(() => {}), limit]).then(() =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            this.fadeEl.classList.add('clear');
            onShown?.(); // the new screen starts fading in now
          }),
        ),
      );
    }, 350);
  }

  reveal(): void {
    this.fadeEl.classList.add('clear');
  }

  /**
   * Pixel Pop Studio intro: the logo squashes in with a bounce, candy pixels burst out of it,
   * it holds for a beat, then the whole splash lifts away to reveal the game underneath.
   */
  async playSplash(ready: Promise<unknown>, onLift: () => void): Promise<void> {
    const splash = $('splash');
    const logo = $('studioLogo');
    const burst = $('splashBurst');
    // Let the sprite decode first so the pop-in never shows an empty frame.
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = getComputedStyle(logo).backgroundImage.slice(5, -2);
    });

    logo.animate(
      [
        { transform: 'scale(0.2) rotate(-8deg)', opacity: 0 },
        { transform: 'scale(1.14, 0.9) rotate(3deg)', opacity: 1, offset: 0.45 },
        { transform: 'scale(0.94, 1.06) rotate(-1deg)', offset: 0.7 },
        { transform: 'scale(1.02, 0.98)', offset: 0.85 },
        { transform: 'scale(1)' },
      ],
      { duration: 750, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'both' },
    );

    // Candy pixel burst, fired as the logo lands.
    const colors = ['#ff5fb7', '#b65cff', '#35d6ff', '#ffd23f', '#ff8ad0', '#7c6bff'];
    // Layout width, not the bounding box: the pop-in has the logo scaled down right now.
    const size = logo.offsetWidth;
    setTimeout(() => {
      for (let i = 0; i < 22; i++) {
        const bit = document.createElement('i');
        const s = size * (0.035 + Math.random() * 0.05);
        bit.style.width = bit.style.height = `${s}px`;
        bit.style.background = colors[i % colors.length];
        burst.appendChild(bit);
        const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
        const d = size * (0.55 + Math.random() * 0.4);
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d * 0.85 - size * 0.08;
        const spin = (Math.random() - 0.5) * 540;
        bit.animate(
          [
            { transform: `translate(-50%, -50%) scale(0.2)`, opacity: 1 },
            { transform: `translate(calc(-50% + ${x * 0.85}px), calc(-50% + ${y * 0.85}px)) rotate(${spin * 0.7}deg) scale(1)`, opacity: 1, offset: 0.55 },
            { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y + size * 0.12}px)) rotate(${spin}deg) scale(0.6)`, opacity: 0 },
          ],
          { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(0.15, 0.8, 0.35, 1)', fill: 'forwards' },
        );
      }
    }, 300);

    // Gentle idle bounce while holding. Stay up until the game behind is fully ready (models
    // loaded, shaders compiled, resolution settled) so nothing pops or hitches after the reveal.
    await wait(1000);
    logo.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], {
      duration: 700,
      easing: 'ease-in-out',
    });
    await Promise.all([wait(900), Promise.race([ready.then(() => wait(1100)), wait(4500)])]);
    onLift();

    // Lift away: logo zooms slightly, splash fades out over the game.
    logo.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }], { duration: 450, easing: 'ease-in', fill: 'forwards' });
    const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished;
    // Never leave the splash stuck on screen if the animation clock is paused (app backgrounded).
    await Promise.race([fade, wait(800)]);
    splash.remove();
  }

  /** True while the Locker screen is up (the Android back button leaves it). */
  get lockerOpen(): boolean {
    return !this.locker.classList.contains('hidden');
  }

  showLocker(): void {
    this.home.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');
    this.locker.classList.remove('hidden');
    this.lockerStage.classList.remove('hidden');
  }

  /** Updates the Home counters and the live level text under PLAY. */
  setHomeStats(stats: HomeStats): void {
    this.setStat($('coinCount'), stats.coins.toLocaleString('en-US'));
    // Every star ever earned (it never drops on a level-up); the stars needed for the next level will go in a tooltip
    // on the counter later.
    this.setStat($('starCount'), String(stats.totalStars));
    $('playLevel').textContent = `LEVEL ${stats.level}`;
    this.updateLockerDot();
  }

  /** The red dot on the Home Locker button: an unlocked item hasn't been equipped yet. */
  updateLockerDot(): void {
    $('lockerBtn').classList.toggle('has-new', hasFresh());
  }

  /** Sets a pill's number. The pill grows with it (see .stat-pill); past its max length the text shrinks (to 50%). */
  private setStat(el: HTMLElement, text: string): void {
    el.textContent = text;
    // Short numbers (up to 3 digits) are drawn bigger, in a shorter pill.
    const short = text.length <= 3;
    el.style.setProperty('--num-scale', short ? '1.25' : '1');
    el.parentElement!.classList.toggle('short', short);
    this.fitStat(el);
  }

  /** Shrinks a number that does not fit its pill's max length. Needs layout, so Home runs it again when shown. */
  private fitStat(el: HTMLElement): void {
    el.style.fontSize = '';
    const pill = el.parentElement!;
    const style = getComputedStyle(pill);
    const room = pill.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (room > 0 && el.offsetWidth > room) el.style.fontSize = `calc(var(--pill-h) * ${0.4 * Number(el.style.getPropertyValue('--num-scale')) * Math.max(0.5, room / el.offsetWidth)})`;
  }

  showHome(): void {
    this.locker.classList.add('hidden');
    this.lockerStage.classList.add('hidden');
    this.home.classList.remove('hidden');
    this.fitStat($('coinCount'));
    this.fitStat($('starCount'));
    this.hud.classList.add('hidden');
    this.hideResult();
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');
  }

  showGame(): void {
    this.locker.classList.add('hidden');
    this.lockerStage.classList.add('hidden');
    this.home.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.hideResult();
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');
    this.pauseBtn.classList.remove('hidden');
    this.setScore(0, 0);
  }

  /** Slides up the free-booster offer; resolves true for GET IT, false for No thanks. */
  offerBooster(): Promise<boolean> {
    const modal = $('boosterOffer');
    this.hideResult(); // from "Play again", it takes the result's place
    modal.classList.remove('hidden', 'closing');
    return new Promise((resolve) => {
      const choose = (take: boolean) => () => {
        get.removeEventListener('click', onGet);
        skip.removeEventListener('click', onSkip);
        this.onButton();
        modal.classList.add('closing');
        setTimeout(() => modal.classList.add('hidden'), 200);
        resolve(take);
      };
      const get = $('boosterGetBtn');
      const skip = $('boosterSkipBtn');
      const onGet = choose(true);
      const onSkip = choose(false);
      get.addEventListener('click', onGet);
      skip.addEventListener('click', onSkip);
    });
  }

  /** Match start: the score bar drops in with a bounce and the pause button pops in after it. */
  playMatchIntro(): void {
    const bar = this.hud.querySelector<HTMLElement>('.score-bar')!;
    bar.animate(
      [
        { transform: 'translateY(-160%)' },
        { transform: 'translateY(12%)', offset: 0.6 },
        { transform: 'translateY(-4%)', offset: 0.82 },
        { transform: 'translateY(0)' },
      ],
      { duration: 650, delay: 300, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'backwards' },
    );
    this.pauseBtn.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.15)', offset: 0.6 }, { transform: 'scale(1)' }], {
      duration: 450,
      delay: 550,
      easing: 'ease-out',
      fill: 'backwards',
    });
  }

  showPause(show: boolean): void {
    this.pauseMenu.classList.toggle('hidden', !show);
    this.pauseBtn.classList.toggle('hidden', show);
  }

  // Animations use the Web Animations API: restarting a CSS animation needs a forced layout
  // (reading offsetWidth), which stalled the frame right when a goal was scored.

  setScore(player: number, ai: number, bump?: 'player' | 'ai'): void {
    this.scorePlayer.textContent = String(player);
    this.scoreAi.textContent = String(ai);
    if (bump) {
      const el = bump === 'player' ? this.scorePlayer : this.scoreAi;
      // Animate the standalone `scale` property: animating `transform` would replace the
      // translate(-50%, -50%) that centers the number in its badge, so it jumped out of the box.
      el.animate([{ scale: '1' }, { scale: '1.4', offset: 0.4 }, { scale: '1' }], {
        duration: 600,
        easing: 'cubic-bezier(0.2, 1.6, 0.4, 1)',
      });
      // The whole bar punches too, tilting toward the side that scored.
      const tilt = bump === 'player' ? 4 : -4;
      el.parentElement!.animate(
        [{ scale: '1', rotate: '0deg' }, { scale: '1.1', rotate: `${tilt}deg`, offset: 0.3 }, { scale: '0.97', rotate: `${-tilt / 2}deg`, offset: 0.6 }, { scale: '1', rotate: '0deg' }],
        { duration: 550, easing: 'ease-out' },
      );
    }
  }

  /**
   * The banner words drawn once into images (the game's label style: white Lilita One with the navy shadow outline).
   * As live text, each new word made the browser paint 36 soft shadows on huge letters in one frame: a 50-130 ms
   * freeze on "GO!" and on goals (measured). A finished image only moves and scales, which costs nothing.
   */
  private readonly bannerArt = new Map<string, HTMLCanvasElement>();

  /** Draws the match banners ahead of time, while the Home screen idles. */
  private prepareBanners(): void {
    const words: [string, string][] = [['3', '#ffffff'], ['2', '#ffffff'], ['1', '#ffffff'], ['GO!', '#ffd21f'], ['GOAL!', '#4fa3ff'], ['GOAL!', '#ff4a55']];
    const next = () => {
      const w = words.shift();
      if (!w) return;
      this.bannerImage(w[0], w[1]);
      idle(next);
    };
    document.fonts.load(`140px ${FONT}`).then(() => idle(next), () => {});
  }

  /** The banner word as an image (cached per word, colour and size). */
  private bannerImage(text: string, color: string): HTMLCanvasElement {
    const size = Math.round(Math.min(140, Math.max(72, innerWidth * 0.24))); // .banner font-size
    const key = `${text}|${color}|${size}`;
    let art = this.bannerArt.get(key);
    if (art) return art;
    art = drawLabel(text, color, size);
    this.bannerArt.set(key, art);
    return art;
  }

  showBanner(text: string, color: string, kind: 'show' | 'count' = 'show'): void {
    const b = this.banner;
    this.bannerAnim?.cancel();
    b.replaceChildren(this.bannerImage(text, color));
    b.setAttribute('aria-label', text);
    const at = (opacity: number, scale: number, offset?: number) => ({ opacity, transform: `translateY(-50%) scale(${scale})`, offset });
    this.bannerAnim =
      kind === 'show'
        ? b.animate([at(0, 2.4), at(1, 1, 0.2), at(1, 1.05, 0.75), at(0, 0.9)], { duration: 1100, easing: 'cubic-bezier(0.2, 1.2, 0.3, 1)', fill: 'both' })
        : b.animate([at(0, 2), at(1, 1, 0.25), at(0, 0.7)], { duration: 750, easing: 'ease-out', fill: 'both' });
  }

  /** @param canContinue a loss may offer KEEP PLAYING! (once per match). */
  showResult(win: boolean, player: number, ai: number, canContinue = false): void {
    $('finalPlayer').textContent = String(player);
    $('finalAi').textContent = String(ai);
    this.pauseBtn.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    // The popup shows the score itself (and the win popup's coin counter sits where the match score bar ends).
    this.hud.classList.add('hidden');
    this.result.classList.remove('hidden', 'win', 'lose');
    this.result.classList.add(win ? 'win' : 'lose');
    void this.runResultPopup(win, player, ai, canContinue);
  }

  /** After KEEP PLAYING!: back to the match with the corrected score. */
  resumeMatch(player: number, ai: number): void {
    this.hideResult();
    this.hud.classList.remove('hidden');
    this.pauseBtn.classList.remove('hidden');
    this.setScore(player, ai);
  }

  private hideResult(): void {
    this.result.classList.add('hidden');
    this.resultPopup.clear();
  }

  private async runResultPopup(win: boolean, player: number, ai: number, canContinue: boolean): Promise<void> {
    const { stars, coins } = matchRewards(win, ai);
    const before = homeStats();
    // The match is banked (and saved) right away, so closing the app on this popup loses nothing; KEEP PLAYING! undoes
    // it (the match then counts at its real end). A level-up is saved as "unseen" until its popup has been shown.
    const banked = bankMatch(stars, coins, win, win && ai === 0);
    if (banked.up) addFresh(unlocksBetween(before.level, banked.up.to));
    // On a level-up, the unlocked item's 3D view is loaded while the popup plays (a little later, so loading the model
    // doesn't stutter the popup's entry), ready for the LEVEL UP popup.
    const next = banked.up ? unlockAt(banked.up.to) : null;
    let view = null as Promise<ItemView | null> | null; // (a cast: it is only set inside prepareView)
    // The view's size: the item box is 64% of the popup card's width (see .rp-card / .rp-unlock-item).
    const viewPx = () => Math.min(innerWidth - 12, 460, innerHeight * 0.58) * 0.64;
    const prepareView = (item: { kind: ItemKind; id: string }) =>
      (view ??= this.onItemView(item.kind, item.id, viewPx()).catch((e) => (console.warn('Item view failed', e), null)));
    const prerender = next ? window.setTimeout(() => prepareView(next), 3500) : 0;
    let choice = await this.resultPopup.show(
      win
        ? {
            mode: 'win',
            title: resultTitle(true, player, ai),
            stars,
            coins,
            wallet: before.coins,
            starWallet: before.totalStars,
            buttons: [
              { id: 'x3', color: 'gold', icon: 'video', text: `x${REWARDS.adMultiplier} COINS`, shine: true },
              { id: 'home', color: 'blue', icon: 'home', text: 'HOME', iconOnly: true },
              { id: 'next', color: 'green', text: 'CONTINUE', breathe: true },
            ],
          }
        : {
            mode: 'lose',
            title: resultTitle(false, player, ai),
            stars,
            coins,
            wallet: before.coins,
            starWallet: before.totalStars,
            buttons: [
              ...(canContinue ? [{ id: 'keep', color: 'gold', icon: 'video', text: 'KEEP PLAYING!', shine: true } as const] : []),
              { id: 'home', color: 'blue', icon: 'home', text: 'HOME', iconOnly: true },
              { id: 'next', color: 'green', text: 'PLAY AGAIN' },
            ],
          },
    );
    // The ad buttons keep the popup open until the ad is done.
    while (choice === 'x3' || choice === 'keep') {
      if (choice === 'x3') {
        this.resultPopup.disableButton('x3');
        if (await this.onWatchAd()) {
          this.resultPopup.multiplyCoins(REWARDS.adMultiplier);
          addCoins(coins * (REWARDS.adMultiplier - 1));
        }
      } else if (await this.onWatchAd()) {
        clearTimeout(prerender);
        void view?.then((v) => v?.dispose()); // no level-up yet: drop the prepared view
        banked.undo(); // the match goes on: it counts at its real end
        this.onKeepPlaying();
        return;
      }
      choice = await this.resultPopup.next();
    }
    clearTimeout(prerender);
    // A full star bar shows the LEVEL UP popup first.
    // (Then it goes where the result popup's button pointed: the next match or Home.)
    if (banked.up) await this.runLevelUp(banked.up, prepareView);
    else void view?.then((v) => v?.dispose());
    if (choice === 'next') this.onAgain();
    else if (choice === 'home') this.onBack();
  }

  /**
   * A level-up the player never saw (the app closed before its popup): shown over Home on the next launch. EQUIP
   * equips the item, CONTINUE just closes it; both stay on Home.
   */
  async showPendingLevelUp(up: { from: number; to: number }): Promise<void> {
    this.result.classList.remove('hidden', 'win', 'lose');
    const viewPx = Math.min(innerWidth - 12, 460, innerHeight * 0.58) * 0.64;
    let view = null as Promise<ItemView | null> | null;
    const prepareView = (item: { kind: ItemKind; id: string }) =>
      (view ??= this.onItemView(item.kind, item.id, viewPx).catch((e) => (console.warn('Item view failed', e), null)));
    await this.runLevelUp(up, prepareView);
    this.hideResult();
    this.updateLockerDot();
  }

  /**
   * LEVEL UP popup (after the result popup's CONTINUE / PLAY AGAIN / HOME, or on launch). EQUIP equips the new item and
   * goes on; CONTINUE goes on. "Goes on" = what the result popup's button chose (next match or Home); on launch
   * it stays on Home. Once a button is tapped, the level-up counts as seen.
   */
  private async runLevelUp(
    up: { from: number; to: number },
    prepareView: (item: { kind: ItemKind; id: string }) => Promise<ItemView | null>,
  ): Promise<void> {
    const item = unlockAt(up.to);
    // Wait for the item's 3D view (usually ready already), but never more than a few seconds.
    const pending = item ? prepareView(item) : null;
    const view = pending ? await Promise.race([pending, wait(4000).then(() => null)]) : null;
    if (pending && !view) void pending.then((v) => v?.dispose()); // too late: drop it when it arrives
    this.onLevelUp();
    const choice = await this.resultPopup.showLevelUp({
      from: up.from,
      level: up.to,
      item: item ? { name: item.name, view } : null,
      // No HOME button here (user, 2026-10-03): EQUIP or CONTINUE (one short word keeps the labels big).
      buttons: [
        ...(item ? [{ id: 'equip', color: 'green', text: 'EQUIP', breathe: true } as const] : []),
        { id: 'next', color: item ? 'blue' : 'green', text: 'CONTINUE', breathe: !item },
      ],
    });
    clearPendingLevelUp();
    if (choice === 'equip' && item) equipItem(item.kind, item.id);
  }

}
