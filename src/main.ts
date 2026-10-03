import '@fontsource/lilita-one/latin-400.css'; // the game's font: chunky cartoon lettering, closest to Scenario's words
import './styles.css';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Engine } from './babylon';
import { Sound } from './audio/Sound';
import { recordResult, takeOffer, watchRewardedAd, type Boosters } from './game/Boosters';
import { ItemSpinner } from './game/ItemShot';
import { homeStats, loadProgress, pendingLevelUp, pruneFresh } from './game/Stats';
import { isItemUnlocked } from './game/Skins';
import { GameScene } from './scenes/GameScene';
import { HomeScene } from './scenes/HomeScene';
import { LockerScene } from './scenes/LockerScene';
import type { Screen } from './scenes/Screen';
import { LockerUI } from './ui/LockerUI';
import { UI } from './ui/UI';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: false, antialias: true, powerPreference: 'high-performance' }, true);
// Render at device resolution, capped at 2x to keep mobile GPUs happy.
let renderScale = Math.min(window.devicePixelRatio || 1, 2);
engine.setHardwareScalingLevel(1 / renderScale);

const ui = new UI();
const lockerUI = new LockerUI();
const sound = new Sound();
let screen: Screen | null = null;
let perfTimer = 0;
/** Frames that missed the display's refresh in the current 2 s window (see adaptResolution). */
let missedFrames = 0;
let needsRender = false;

function setScreen(make: () => Screen): Promise<void> | undefined {
  screen?.dispose();
  const next = (screen = make());
  resetTiming();
  // Loading (models, shaders) stalls frames: judge performance only from when the new screen is ready, so those
  // stalls never count as stutter and lower the resolution for nothing.
  next.ready?.then(() => screen === next && resetTiming()).catch(() => {});
  if (import.meta.env.DEV) (window as unknown as { __screen: Screen }).__screen = screen;
  return screen.ready;
}

/** Shows Home with fresh numbers (level, stars, coins). */
let devResultShown = false;
function showHome(): void {
  ui.setHomeStats(homeStats());
  ui.showHome();
  // Dev: `?result=win,5,2` opens the result popup over Home, to check it without playing a match.
  const dev = import.meta.env.DEV && !devResultShown && /[?&]result=(win|lose),(\d+),(\d+)/.exec(location.search);
  devResultShown = true;
  if (dev) setTimeout(() => ui.showResult(dev[1] === 'win', +dev[2], +dev[3], dev[1] === 'lose'), 2500);
}

function goHome(): void {
  ui.transition(() => {
    const ready = setScreen(() => new HomeScene(engine));
    showHome();
    return ready;
  });
}

function openLocker(): void {
  sound.unlock();
  sound.button();
  ui.transition(() => {
    ui.showLocker(); // first, so the scene can measure the pedestal it stands on
    setScreen(() => new LockerScene(engine, lockerUI));
  });
}

function startGame(boosters: Boosters = {}): void {
  sound.unlock();
  sound.button();
  let game: GameScene | null = null;
  ui.transition(
    () => setScreen(() => (game = new GameScene(engine, ui, sound, { boosters, onEnd: recordResult }))),
    () => game?.begin(), // the countdown (and camera swing) starts once the match is in view
  );
}

/** PLAY / Play again: sometimes a free booster is offered first (for a rewarded ad). */
let offering = false;
function play(): void {
  if (offering) return;
  if (!takeOffer()) {
    startGame();
    return;
  }
  sound.unlock();
  sound.button();
  offering = true;
  ui.offerBooster()
    .then(async (take) => startGame(take && (await watchRewardedAd()) ? { bigMallet: true } : {}))
    .finally(() => (offering = false));
}

// ---------- Settings (persisted per device) ----------

const SETTINGS_KEY = 'airhockey.settings';
function loadSettings(): { sound: boolean; vibration: boolean } {
  try {
    return { sound: true, vibration: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { sound: true, vibration: true };
  }
}
function applySettings(s: { sound: boolean; vibration: boolean }): void {
  sound.muted = !s.sound;
  sound.vibration = s.vibration;
}
const settings = loadSettings();
applySettings(settings);
ui.setSettings(settings);
ui.onSettingsChange = (s) => {
  applySettings(s);
  sound.unlock();
  sound.button();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode); the setting still applies for this session.
  }
};
ui.onButton = () => {
  sound.unlock();
  sound.button();
  sound.haptic('light');
};
lockerUI.onButton = ui.onButton;
ui.onLocker = openLocker;
ui.onLockerBack = () => {
  sound.button();
  goHome();
};

ui.onStar = (i) => {
  sound.star(i);
  sound.haptic('medium');
};
// Result popup: the popup lands (light), the trophy thumps down on a win (heavy) or the worried puck lands (medium),
// and an ad reward is granted (success buzz).
if (import.meta.env.DEV) {
  const log: string[] = ((window as unknown as { __haptics: string[] }).__haptics = []);
  const h = sound.haptic.bind(sound);
  const n = sound.hapticNotify.bind(sound);
  sound.haptic = (style) => (log.push(style), h(style));
  sound.hapticNotify = (ok) => (log.push(ok ? 'success' : 'error'), n(ok));
}
ui.onBeat = (beat, mode) => {
  if (beat === 'enter') sound.haptic('light');
  else if (beat === 'emblem') sound.haptic(mode === 'win' ? 'heavy' : 'medium');
  else sound.hapticNotify(true);
};
ui.onTick = (step) => sound.tick(step);
ui.onStarLand = (i) => {
  sound.starLand(i);
  sound.haptic('medium');
};
ui.onCoin = (i) => {
  sound.coin(i);
  sound.haptic('light');
};
ui.onWatchAd = watchRewardedAd;
ui.onItemView = (kind, id, px) => ItemSpinner.create(kind, id, px);
ui.onLevelUp = () => {
  sound.win();
  sound.hapticNotify(true);
};
ui.onKeepPlaying = () => {
  sound.hapticNotify(true); // the second chance was granted
  if (screen instanceof GameScene) screen.keepPlaying();
};
ui.onPlay = play;
ui.onAgain = play;
ui.onBack = () => {
  sound.button();
  goHome();
};
ui.onPause = () => screen?.setPaused?.(true);
ui.onResume = () => screen?.setPaused?.(false);
ui.onRestart = () => startGame();
ui.onHome = () => {
  sound.button();
  goHome();
};

ui.reveal(); // happens under the studio splash
// The saved progress loads first (behind the splash): the Home scene's mallet, puck and table depend on the level.
const firstReady = loadProgress().then(() => {
  pruneFresh(isItemUnlocked);
  const firstHome = new HomeScene(engine);
  setScreen(() => firstHome);
  // Once the scene is ready, judge performance right away (still hidden by the splash), so any
  // resolution drop happens before the player sees the game.
  return firstHome.ready.then(() => {
    perfTimer = 0;
  });
});
/** The first Home: a level-up the player never saw (the app closed before its popup) shows now, after the intro. */
function launchHome(): void {
  showHome();
  const up = pendingLevelUp();
  const devResult = import.meta.env.DEV && /[?&]result=/.test(location.search);
  if (up && !devResult) setTimeout(() => void ui.showPendingLevelUp(up), 900);
}
// The home UI appears as the splash lifts, so its intro animations play in view.
ui.playSplash(firstReady, launchHome).catch(() => {
  document.getElementById('splash')?.remove();
  launchHome();
});

// ---------- Main loop ----------

function resetTiming(): void {
  perfTimer = -2; // let shaders compile before judging performance
  missedFrames = 0;
}

// Frame pacing. The loop runs in step with the display, but the measured frame time jitters by a
// millisecond or two, which makes the puck advance unevenly (visible judder). Estimate the display's
// refresh interval (median of recent frames, so 60/90/120 Hz all work) and snap each frame's time to
// a whole number of refreshes: motion advances in exactly even steps, and a genuinely dropped
// frame still counts as two.
const PACE_SAMPLES = 31;
const paceHistory = new Float64Array(PACE_SAMPLES).fill(1 / 60);
const paceSorted = new Float64Array(PACE_SAMPLES);
let paceIndex = 0;

function pacedDelta(raw: number): number {
  paceHistory[paceIndex] = raw;
  paceIndex = (paceIndex + 1) % PACE_SAMPLES;
  paceSorted.set(paceHistory);
  paceSorted.sort();
  const refresh = paceSorted[PACE_SAMPLES >> 1];
  return Math.max(1, Math.round(raw / refresh)) * refresh;
}

function frame(): void {
  if (!screen) return;
  if (screen.paused) {
    // Keep the last frame on screen; only redraw if a resize wiped the canvas.
    if (needsRender) screen.scene.render();
    needsRender = false;
    return;
  }
  const raw = Math.min(engine.getDeltaTime() / 1000, 0.25);
  screen.update(pacedDelta(raw));
  screen.scene.render();
  adaptResolution(raw);
}
engine.runRenderLoop(frame);

/**
 * If frames keep missing the display's refresh, render fewer pixels (never goes back up, to avoid flicker). It counts
 * real missed frames (longer than 1.5 refreshes and 20 ms) over 2 s windows: an average-fps test (< 48 fps) let a phone
 * stutter at 50-55 fps without ever getting help. Loading time (perfTimer < 0) is not counted.
 */
function adaptResolution(dt: number): void {
  perfTimer += dt;
  if (perfTimer < 0) return;
  const refresh = paceSorted[PACE_SAMPLES >> 1];
  if (dt > Math.max(refresh * 1.5, 0.02)) missedFrames++;
  if (perfTimer < 2) return;
  if (missedFrames >= 4 && renderScale > 1) {
    renderScale = Math.max(1, renderScale - 0.25);
    engine.setHardwareScalingLevel(1 / renderScale);
  }
  perfTimer = 0;
  missedFrames = 0;
}

window.addEventListener('resize', () => {
  engine.resize();
  screen?.resize();
  needsRender = true;
});

// Backgrounding the app pauses the match and stops rendering.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    screen?.setPaused?.(true);
    engine.stopRenderLoop();
    sound.suspend();
  } else {
    needsRender = true;
    engine.runRenderLoop(frame);
    sound.unlock();
  }
});

// Any tap revives audio if the system suspended it (Android does this in the background).
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true, passive: true });

function togglePause(): void {
  if (screen?.setPaused) screen.setPaused(!screen.paused);
}

// Desktop: Esc or P toggles pause.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
});

// Android back button: pause/resume in a match, leave the result screen, exit from home.
if (Capacitor.getPlatform() === 'android') {
  App.addListener('backButton', () => {
    const resultOpen = !document.getElementById('result')!.classList.contains('hidden');
    const settingsOpen = !document.getElementById('settingsMenu')!.classList.contains('hidden');
    if (offering) document.getElementById('boosterSkipBtn')!.click();
    else if (settingsOpen) document.getElementById('closeSettingsBtn')!.click();
    else if (ui.lockerOpen) ui.onLockerBack();
    else if (resultOpen) ui.onBack();
    else if (screen instanceof GameScene) togglePause();
    else App.exitApp();
  }).catch(() => {});
}
