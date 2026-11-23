export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

// Closest point on segment ab to p. Returns {x, y, t} with t in [0, 1].
export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = clamp(t, 0, 1);
  return { x: ax + abx * t, y: ay + aby * t, t };
}

export function circleVsCircle(ax, ay, ar, bx, by, br) {
  return dist(ax, ay, bx, by) <= ar + br;
}

// Circle vs oriented box. Box: center (cx, cy), half extents hx/hy, angle of local x axis.
export function circleVsBox(cx, cy, hx, hy, angle, px, py, pr) {
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const qx = clamp(lx, -hx, hx);
  const qy = clamp(ly, -hy, hy);
  return dist(qx, qy, lx, ly) <= pr;
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
