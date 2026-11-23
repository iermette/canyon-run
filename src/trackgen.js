// Procedural track generation: a constrained random walk along the centerline.
// - Curvature is bounded so every generated curve is drivable at top speed.
// - Self-avoidance keeps looped-back parts of the track apart (no crossings).
// The returned waypoints + arc-length fractions are turned into sections,
// obstacles and scenery by world.js.

import { lerp } from './utils.js';

// Small deterministic PRNG so a seed always reproduces the same track.
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEN = {
  firstStraight: 500,         // clean spawn zone at the start of the track
  minStep: 100, maxStep: 240, // length of each centerline segment
  minRadius: 320,             // minimum turn radius (drivable at MAX_SPEED)
  minGap: 320,                // clearance to looped-back parts (no self-crossing)
  localArc: 400,              // arc distance that is always "the same road" (see below)
  targetLength: [7000, 9500], // total track length range
  minTotal: 5500,             // retry the walk if it ends up shorter than this
};

// Why localArc works: with curvature bounded to radius >= minRadius, two points
// `d` arc units apart on the path are always at least 2R*sin(d/2R) (with
// R = minRadius) Euclidean apart — a circular arc is the most folded shape the
// bound allows. At d = localArc that lower bound is ~374, already beyond
// minGap: anything closer in arc length is simply the same continuous road
// section and must never be rejected (on a straight or gentle bend its chord
// can dip just under minGap without any overlap risk). Anything farther can
// only come back within minGap after looping almost all the way around
// (d > ~1675), which is exactly the self-crossing case we want to reject.
function clearOfTrack(pts, cum, pArc, p) {
  const g2 = GEN.minGap * GEN.minGap;
  for (let i = 0; i < pts.length; i++) {
    if (pArc - cum[i] < GEN.localArc) continue; // same local road section
    const dx = pts[i].x - p.x, dy = pts[i].y - p.y;
    if (dx * dx + dy * dy < g2) return false;
  }
  return true;
}

function walkOnce(seed) {
  const rnd = mulberry32(seed);
  const pts = [{ x: 0, y: 0 }, { x: GEN.firstStraight, y: 0 }];
  const cum = [0, GEN.firstStraight];
  let heading = 0; // start facing +x so the spawn zone is a straight
  let s = GEN.firstStraight;
  const target = lerp(GEN.targetLength[0], GEN.targetLength[1], rnd());

  while (s < target) {
    const step = lerp(GEN.minStep, GEN.maxStep, rnd());
    const maxTurn = Math.min(0.9, step / GEN.minRadius); // curvature bound
    let placed = false;
    for (let attempt = 0; attempt < 20 && !placed; attempt++) {
      const h = heading + (rnd() * 2 - 1) * maxTurn;
      const p = {
        x: pts[pts.length - 1].x + Math.cos(h) * step,
        y: pts[pts.length - 1].y + Math.sin(h) * step,
      };
      if (clearOfTrack(pts, cum, s + step, p)) {
        pts.push(p); cum.push(s + step); heading = h; s += step; placed = true;
      }
    }
    if (!placed) break; // rare dead-end: keep the track built so far
  }

  const fracs = {
    tunnelStart: lerp(0.26, 0.36, rnd()),
    tunnelLen: lerp(0.14, 0.18, rnd()),
    bridgeLen: lerp(0.24, 0.32, rnd()),
  };

  // Same [x, y] pair format as the classic waypoints.
  return { waypoints: pts.map((p) => [p.x, p.y]), fracs, total: s };
}

// Deterministic per seed: if the walk dead-ends too early (rare), retry with a
// derived seed before giving up; the longest result wins as fallback.
export function generateTrack(seed) {
  let fallback = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = walkOnce((seed + attempt * 7919) >>> 0);
    if (!fallback || t.total > fallback.total) fallback = t;
    if (t.total >= GEN.minTotal) return t;
  }
  return fallback;
}
