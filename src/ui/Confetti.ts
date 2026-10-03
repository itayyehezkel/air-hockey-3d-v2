/**
 * Paper confetti and small sparkles on a full-screen 2D canvas (the result popup's celebration).
 * Confetti pieces are thrown out, then slow down and fall like paper: each one spins, flips (it looks thin
 * when edge-on and darker on its back) and sways side to side. Kept small, per the hyper-casual style.
 */

const COLORS = ['#ff4d6d', '#ffd23f', '#3ec1ff', '#5be37b', '#b06bff', '#ff9a3c'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vrot: number;
  flip: number;
  vflip: number;
  sway: number;
  color: string;
  /** Sparkles fade out over their life; confetti lives until it leaves the screen. */
  life: number;
  age: number;
  sparkle: boolean;
}

export class Confetti {
  private readonly ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private raf = 0;
  private last = 0;
  private dpr = 1;
  private rainTimer = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Throws `count` pieces from (x, y) in CSS pixels, spread around `angle` (radians, 0 = right, -PI/2 = up). */
  burst(x: number, y: number, count: number, angle = -Math.PI / 2, spread = 1.3, power = 1): void {
    const s = this.scale();
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = (480 + Math.random() * 560) * s * power;
      this.pieces.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: (11 + Math.random() * 6) * s,
        h: (7 + Math.random() * 4) * s,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 9,
        flip: Math.random() * Math.PI * 2,
        vflip: 5 + Math.random() * 7,
        sway: Math.random() * Math.PI * 2,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: Infinity,
        age: 0,
        sparkle: false,
      });
    }
    this.start();
  }

  /**
   * A gentle confetti rain from above the top edge for `ms` milliseconds (keeps the celebration going after the
   * burst). Pieces enter already falling slowly.
   */
  rain(ms: number, perSecond: number): void {
    const until = performance.now() + ms;
    const drop = () => {
      if (performance.now() > until) return;
      // Cap the pile (e.g. if the app is in the background and frames stop while the timer keeps going).
      if (this.pieces.length < 450) this.burst(Math.random() * innerWidth, -20, 1, Math.PI / 2, 0.6, 0.15);
      this.rainTimer = window.setTimeout(drop, 1000 / perSecond);
    };
    drop();
  }

  /** A quick ring of tiny gold/white dots (a star landing). */
  sparkle(x: number, y: number, count = 12): void {
    const s = this.scale();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const v = (140 + Math.random() * 160) * s;
      const size = (3 + Math.random() * 3) * s;
      this.pieces.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: size, h: size, rot: 0, vrot: 0, flip: 0, vflip: 0, sway: 0,
        color: Math.random() < 0.6 ? '#ffd84a' : '#ffffff', life: 0.3 + Math.random() * 0.15, age: 0, sparkle: true,
      });
    }
    this.start();
  }

  /** Sizes the canvas and draws once ahead of time: the first full-screen setup stalls a frame for a long time. */
  warmUp(): void {
    this.resize();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.fillStyle = 'rgba(0,0,0,0)';
    this.ctx.fillRect(0, 0, 1, 1);
    this.ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  clear(): void {
    clearTimeout(this.rainTimer);
    this.pieces = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Piece sizes follow the screen a little (designed at 400 px wide). */
  private scale(): number {
    return Math.min(1.4, Math.max(0.8, Math.min(innerWidth, innerHeight * 0.6) / 400));
  }

  private start(): void {
    if (this.raf) return;
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private resize(): void {
    this.dpr = Math.min(1.5, devicePixelRatio || 1); // confetti is small: full retina detail isn't worth the cost
    const w = Math.round(innerWidth * this.dpr);
    const h = Math.round(innerHeight * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { ctx } = this;
    const s = this.scale();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const keep: Piece[] = [];
    for (const p of this.pieces) {
      p.age += dt;
      if (p.sparkle) {
        const k = Math.pow(0.02, dt); // strong drag: a quick pop outward that stops
        p.vx *= k;
        p.vy *= k;
      } else {
        // Paper: air drag and gentle gravity, so it slows down and then floats down slowly (about 75 px/s),
        // swaying side to side, and stays on screen for many seconds.
        const k = Math.pow(0.15, dt);
        p.vx *= k;
        p.vy = p.vy * k + 140 * s * dt;
        p.vx += Math.sin(p.age * 2.6 + p.sway) * 110 * s * dt;
        p.rot += p.vrot * dt;
        p.flip += p.vflip * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > p.life || p.y > innerHeight + 30) continue;
      keep.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.sparkle) {
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.w * (1 - 0.5 * (p.age / p.life)), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const c = Math.cos(p.flip);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.max(0.08, Math.abs(c)));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        if (c < 0) {
          // The back of the paper is a little darker.
          ctx.fillStyle = 'rgba(0,0,40,0.22)';
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
      }
      ctx.restore();
    }
    this.pieces = keep;
    this.raf = keep.length ? requestAnimationFrame(this.frame) : 0;
  };
}
