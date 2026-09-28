import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// On the web, navigator.vibrate is blocked until a tap and spams the console; only vibrate in the native app.
const NATIVE = Capacitor.isNativePlatform();

/** Schedule notes slightly ahead so a busy frame can't make them start late with a clipped attack. */
const LOOKAHEAD = 0.012;
/** Cap on simultaneous sounds; beyond this, extra clicks are dropped (nobody hears the 15th one). */
const MAX_VOICES = 14;
/** Minimum spacing between repeats of the same effect, so a pinned puck can't machine-gun it. */
const MIN_GAP = { hit: 0.045, wall: 0.06 };

/** Tiny procedural sound engine – no audio assets required. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private last = { hit: -1, wall: -1 };
  private lastHaptic = 0;
  private _muted = false;
  /** Haptics on/off (settings). */
  vibration = true;

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  /**
   * Creates/resumes the audio context. Must first run from a user gesture (autoplay policy);
   * calling it on every tap also revives audio after Android suspends it in the background.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      // A limiter keeps overlapping sounds (goal jingle + hits) from clipping into crackle.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.55;
      this.master.connect(limiter);
      const len = Math.floor(ctx.sampleRate * 0.3);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /** Stop audio processing while the app is in the background. */
  suspend(): void {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  hit(strength: number): void {
    if (!this.gap('hit')) return;
    const k = Math.min(strength / 16, 1);
    this.tone(180 + k * 260, 0.09, 'triangle', 0.35 + k * 0.5, 0.5);
    this.click(0.05, 0.25 + k * 0.4, 2500);
  }

  wall(strength: number): void {
    if (!this.gap('wall')) return;
    const k = Math.min(strength / 16, 1);
    this.tone(110 + k * 90, 0.07, 'sine', 0.25 + k * 0.35, 0.6);
    this.click(0.03, 0.12 + k * 0.2, 1200);
  }

  beep(high = false): void {
    this.tone(high ? 880 : 520, high ? 0.35 : 0.14, 'square', 0.18);
  }

  button(): void {
    this.tone(660, 0.08, 'triangle', 0.3);
    this.tone(990, 0.1, 'triangle', 0.25, 1, 0.05);
  }

  goal(good: boolean): void {
    const notes = good ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    notes.forEach((f, i) => this.tone(f, 0.18, 'square', 0.2, 1, i * 0.09));
    this.click(0.4, 0.3, 800);
  }

  win(): void {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.28, 1, i * 0.11));
  }

  lose(): void {
    [440, 415, 392, 370, 330].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.12, 0.98, i * 0.16));
  }

  haptic(style: 'light' | 'medium' | 'heavy'): void {
    if (!NATIVE || !this.vibration) return;
    const now = performance.now();
    if (now - this.lastHaptic < 60) return;
    this.lastHaptic = now;
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    Haptics.impact({ style: map[style] }).catch(() => {});
  }

  hapticNotify(success: boolean): void {
    if (!NATIVE || !this.vibration) return;
    Haptics.notification({ type: success ? NotificationType.Success : NotificationType.Error }).catch(() => {});
  }

  /** The context is running, i.e. a sound would play now rather than pile up and burst out on resume. */
  private live(): AudioContext | null {
    return this.ctx && this.master && this.ctx.state === 'running' ? this.ctx : null;
  }

  private gap(kind: keyof typeof MIN_GAP): boolean {
    const ctx = this.live();
    if (!ctx || ctx.currentTime - this.last[kind] < MIN_GAP[kind]) return false;
    this.last[kind] = ctx.currentTime;
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 1, delay = 0): void {
    const ctx = this.live();
    if (!ctx || this.voices >= MAX_VOICES) return;
    const t = ctx.currentTime + LOOKAHEAD + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    this.track(osc, g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private click(dur: number, vol: number, cutoff: number): void {
    const ctx = this.live();
    if (!ctx || !this.noise || this.voices >= MAX_VOICES) return;
    const t = ctx.currentTime + LOOKAHEAD;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    this.track(src, g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Counts a voice until it ends, then disconnects its nodes so the audio graph stays small. */
  private track(src: AudioScheduledSourceNode, out: GainNode): void {
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      out.disconnect();
    };
  }
}
