import '@fontsource/fredoka/700.css';
import './styles.css';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Engine } from './babylon';
import { Sound } from './audio/Sound';
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
let needsRender = false;

function setScreen(make: () => Screen): Promise<void> | undefined {
  screen?.dispose();
  screen = make();
  resetTiming();
  if (import.meta.env.DEV) (window as unknown as { __screen: Screen }).__screen = screen;
  return screen.ready;
}

function goHome(): void {
  ui.transition(() => {
    const ready = setScreen(() => new HomeScene(engine));
    ui.showHome();
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

function startGame(): void {
  sound.unlock();
  sound.button();
  ui.transition(() => setScreen(() => new GameScene(engine, ui, sound)));
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
};
lockerUI.onButton = ui.onButton;
ui.onLocker = openLocker;
ui.onLockerBack = () => {
  sound.button();
  goHome();
};

ui.onPlay = startGame;
ui.onAgain = startGame;
ui.onBack = () => {
  sound.button();
  goHome();
};
ui.onPause = () => screen?.setPaused?.(true);
ui.onResume = () => screen?.setPaused?.(false);
ui.onRestart = startGame;
ui.onHome = () => {
  sound.button();
  goHome();
};

const firstHome = new HomeScene(engine);
setScreen(() => firstHome);
ui.reveal(); // happens under the studio splash
// Once the scene is ready, judge performance right away (still hidden by the splash), so any
// resolution drop happens before the player sees the game.
firstHome.ready.then(() => (perfTimer = 0)).catch(() => {});
// The home UI appears as the splash lifts, so its intro animations play in view.
ui.playSplash(firstHome.ready, () => ui.showHome()).catch(() => {
  document.getElementById('splash')?.remove();
  ui.showHome();
});

// ---------- Main loop ----------

function resetTiming(): void {
  perfTimer = -2; // let shaders compile before judging performance
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

/** If the device can't hold ~50 fps, render fewer pixels (never goes back up, to avoid flicker). */
function adaptResolution(dt: number): void {
  perfTimer += dt;
  if (perfTimer < 1) return;
  perfTimer = 0;
  if (engine.getFps() < 48 && renderScale > 1) {
    renderScale = Math.max(1, renderScale - 0.25);
    engine.setHardwareScalingLevel(1 / renderScale);
  }
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
    if (settingsOpen) document.getElementById('closeSettingsBtn')!.click();
    else if (ui.lockerOpen) ui.onLockerBack();
    else if (resultOpen) ui.onBack();
    else if (screen instanceof GameScene) togglePause();
    else App.exitApp();
  }).catch(() => {});
}
