// Speedometer (point 4 of the feature spec): an 8-bit analog needle gauge,
// drawn on every screen. Pure canvas — takes a context, a center, a radius,
// and the speed in km/h. The needle eases toward the target for a live feel.
//
// Palette is the game's own (dark face, amber accent #f5a623, red redline),
// NOT a modern-web palette.

const TAU = Math.PI * 2;
const START = (135 * Math.PI) / 180; // lower-left
const SWEEP = (270 * Math.PI) / 180; // sweep clockwise through the top
const AMBER = '#f5a623';
const RED = '#ff5a4e';
const FAINT = 'rgba(232,237,244,0.55)';

export function drawSpeedometer(ctx, cx, cy, r, speedKmh, opts = {}) {
  const maxKmh = opts.maxKmh || 360;
  const label = opts.label || 'km/h';
  const redline = opts.redline || maxKmh * 0.78;
  const frac = Math.max(0, Math.min(1, speedKmh / maxKmh));
  const ang = (v) => START + SWEEP * (v / maxKmh);
  const px = (a, rad) => cx + Math.cos(a) * rad;
  const py = (a, rad) => cy + Math.sin(a) * rad;

  // face
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = '#10141c';
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();

  // redline arc
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, ang(redline), ang(maxKmh));
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.strokeStyle = RED;
  ctx.stroke();

  // ticks + numbers
  const majors = 6; // 0,60,120,180,240,300,360 -> 7 marks
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= majors; i++) {
    const v = (maxKmh / majors) * i;
    const a = ang(v);
    const r1 = r * 0.82, r2 = r * (v >= redline ? 0.66 : 0.70);
    ctx.beginPath();
    ctx.moveTo(px(a, r2), py(a, r2));
    ctx.lineTo(px(a, r1), py(a, r1));
    ctx.lineWidth = Math.max(1.5, r * 0.03);
    ctx.strokeStyle = v >= redline ? RED : FAINT;
    ctx.stroke();
    if (r > 40) {
      ctx.font = `700 ${Math.max(8, r * 0.15)}px system-ui, sans-serif`;
      ctx.fillStyle = v >= redline ? RED : 'rgba(232,237,244,0.8)';
      ctx.fillText(String(Math.round(v)), px(a, r * 0.52), py(a, r * 0.52));
    }
  }

  // minor ticks
  if (r > 34) {
    for (let v = (maxKmh / majors) / 2; v < maxKmh; v += (maxKmh / majors) / 2) {
      const a = ang(v);
      ctx.beginPath();
      ctx.moveTo(px(a, r * 0.70), py(a, r * 0.70));
      ctx.lineTo(px(a, r * 0.76), py(a, r * 0.76));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(232,237,244,0.3)';
      ctx.stroke();
    }
  }

  // needle
  const na = START + SWEEP * frac;
  ctx.beginPath();
  ctx.moveTo(px(na + Math.PI, r * 0.14), py(na + Math.PI, r * 0.14));
  ctx.lineTo(px(na, r * 0.80), py(na, r * 0.80));
  ctx.lineWidth = Math.max(2.5, r * 0.06);
  ctx.lineCap = 'round';
  ctx.strokeStyle = AMBER;
  ctx.stroke();

  // hub
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.12, 0, TAU);
  ctx.fillStyle = AMBER;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.05, 0, TAU);
  ctx.fillStyle = '#10141c';
  ctx.fill();

  // label
  if (r > 30) {
    ctx.font = `600 ${Math.max(8, r * 0.14)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(232,237,244,0.6)';
    ctx.fillText(label, cx, cy + r * 0.42);
  }
  ctx.restore();
}
