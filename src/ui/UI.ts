const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

/** Stacked shadows give banner text a thick navy outline plus a drop shadow (see --outline in styles.css). */
const BANNER_OUTLINE = [
  [4, 4], [-4, 4], [4, -4], [-4, -4], [0, 5], [0, -5], [5, 0], [-5, 0],
].map(([x, y]) => `${x}px ${y}px 0 #0d2f7a`).join(', ') + ', 0 9px 0 #0d2f7a, 0 14px 18px rgba(8,30,90,0.4)';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  transition(swap: () => void | Promise<unknown>): void {
    this.fadeEl.classList.remove('clear');
    setTimeout(() => {
      const loading = swap();
      const limit = new Promise((resolve) => setTimeout(resolve, 1500));
      Promise.race([Promise.resolve(loading).catch(() => {}), limit]).then(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => this.fadeEl.classList.add('clear'))),
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

  showHome(): void {
    this.locker.classList.add('hidden');
    this.lockerStage.classList.add('hidden');
    this.home.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.result.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');
  }

  showGame(): void {
    this.locker.classList.add('hidden');
    this.lockerStage.classList.add('hidden');
    this.home.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.result.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.settingsMenu.classList.add('hidden');
    this.pauseBtn.classList.remove('hidden');
    this.setScore(0, 0);
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
    }
  }

  showBanner(text: string, color: string, kind: 'show' | 'count' = 'show'): void {
    const b = this.banner;
    this.bannerAnim?.cancel();
    b.textContent = text;
    b.style.color = color;
    b.style.textShadow = BANNER_OUTLINE;
    const at = (opacity: number, scale: number, offset?: number) => ({ opacity, transform: `translateY(-50%) scale(${scale})`, offset });
    this.bannerAnim =
      kind === 'show'
        ? b.animate([at(0, 2.4), at(1, 1, 0.2), at(1, 1.05, 0.75), at(0, 0.9)], { duration: 1100, easing: 'cubic-bezier(0.2, 1.2, 0.3, 1)', fill: 'both' })
        : b.animate([at(0, 2), at(1, 1, 0.25), at(0, 0.7)], { duration: 750, easing: 'ease-out', fill: 'both' });
  }

  showResult(win: boolean, player: number, ai: number): void {
    $('finalPlayer').textContent = String(player);
    $('finalAi').textContent = String(ai);
    this.pauseBtn.classList.add('hidden');
    this.pauseMenu.classList.add('hidden');
    this.result.classList.remove('hidden', 'win', 'lose');
    this.result.classList.add(win ? 'win' : 'lose');
  }
}
