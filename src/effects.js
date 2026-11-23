import { mulberry32 } from './trackgen.js';

// One-off "plouf!" drawn in world space where a car went into the water:
// expanding ripples, a spray of droplets, bubbles while it slips under, and the
// onomatopoeia popping above the impact. The spray is seeded from the impact
// point, so every client in a room renders the same splash for a remote car.

export const SPLASH_WORD = 'PLOUF!';
export const SPLASH_MS = 1300; // total time the effect stays on screen

const RIPPLES = [
  { delay: 0, span: 95, life: 650 },
  { delay: 160, span: 140, life: 750 },
  { delay: 380, span: 190, life: 850 },
];
const WORD_MS = 1000;   // the word itself pops, rises, then fades
const BUBBLE_MS = 520;  // one bubble's lifetime

export class Splash {
  constructor(x, y, bornAt = performance.now()) {
    this.x = x;
    this.y = y;
    this.born = bornAt;

    const rnd = mulberry32(((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)) | 0);
    this.drops = Array.from({ length: 24 }, () => {
      const a = rnd() * Math.PI * 2;
      const sp = 70 + rnd() * 170; // outward speed in units/s, eased away
      return {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 400 + rnd() * 480,
        r: 1.5 + rnd() * 2.5,
      };
    });
    this.bubbles = Array.from({ length: 7 }, () => ({
      ox: (rnd() - 0.5) * 52,
      oy: (rnd() - 0.5) * 52,
      delay: 260 + rnd() * 620,
      r: 3 + rnd() * 6,
    }));
  }

  expired(now) { return now - this.born > SPLASH_MS; }

  draw(ctx, now) {
    const ms = now - this.born;
    if (ms < 0 || ms > SPLASH_MS) return;

    ctx.save();

    // white water crown right at the impact
    const flash = 1 - ms / 260;
    if (flash > 0) {
      ctx.fillStyle = `rgba(238,249,255,${0.55 * flash})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 16 + (1 - flash) * 46, 0, Math.PI * 2);
      ctx.fill();
    }

    // ripples running outward
    for (const rp of RIPPLES) {
      const p = (ms - rp.delay) / rp.life;
      if (p <= 0 || p >= 1) continue;
      const e = 1 - (1 - p) * (1 - p); // ease-out
      ctx.strokeStyle = `rgba(224,244,255,${0.7 * (1 - p)})`;
      ctx.lineWidth = 1 + (1 - p) * 6;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 14 + e * rp.span, 0, Math.PI * 2);
      ctx.stroke();
    }

    // droplets sprayed out
    for (const d of this.drops) {
      const p = ms / d.life;
      if (p >= 1) continue;
      const travel = (ms / 1000) * (1 - 0.45 * p); // ease-out along the ray
      ctx.fillStyle = `rgba(196,231,252,${1 - p})`;
      ctx.beginPath();
      ctx.arc(this.x + d.vx * travel, this.y + d.vy * travel, d.r * (1 - p), 0, Math.PI * 2);
      ctx.fill();
    }

    // bubbles as the car slips under
    for (const b of this.bubbles) {
      const p = (ms - b.delay) / BUBBLE_MS;
      if (p <= 0 || p >= 1) continue;
      ctx.strokeStyle = `rgba(236,248,255,${0.65 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x + b.ox, this.y + b.oy, b.r * (0.4 + p), 0, Math.PI * 2);
      ctx.stroke();
    }

    // the onomatopoeia, punching in then rising away
    const p = ms / WORD_MS;
    if (p < 1) {
      const pop = 1 + 0.35 * Math.max(0, 1 - ms / 240);
      const wy = this.y - 52 - p * 46;
      ctx.font = `900 ${Math.round(34 * pop)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(8,26,44,${0.85 * (1 - p)})`;
      ctx.strokeText(SPLASH_WORD, this.x, wy);
      ctx.fillStyle = `rgba(214,241,255,${1 - p})`;
      ctx.fillText(SPLASH_WORD, this.x, wy);
    }

    ctx.restore();
  }
}
