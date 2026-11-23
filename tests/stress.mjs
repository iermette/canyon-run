// Stress test for procedural track generation (run with node).
import { createWorld } from '../src/world.js';

const N = 300;
let failures = 0;
const minDistHist = [];
let lenMin = Infinity, lenMax = -Infinity;

function segSamples(a, b, k) {
  const pts = [];
  for (let i = 1; i <= k; i++) {
    const t = i / (k + 1);
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return pts;
}

for (let seed = 1; seed <= N; seed++) {
  const w = createWorld(seed);
  const cl = w.cl;
  const errs = [];

  // --- length in range (generateTrack retries until >= minTotal=5500) ---
  lenMin = Math.min(lenMin, cl.total);
  lenMax = Math.max(lenMax, cl.total);
  if (cl.total < 5500) errs.push(`too short: ${cl.total.toFixed(0)}`);

  // --- curvature bound: turn per step <= step / minRadius ---
  for (let i = 2; i < cl.pts.length; i++) {
    const a = cl.pts[i - 2], b = cl.pts[i - 1], c = cl.pts[i];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const stepLen = cl.cum[i] - cl.cum[i - 1];
    if (Math.abs(d) > stepLen / 320 + 1e-6) errs.push(`curvature violated at seg ${i}`);
  }

  // --- self-overlap: min distance between segments separated by >= 450 arc units.
  // Guarantee: placement keeps candidates >= 320 from old vertices (arc >= 400),
  // a segment midpoint can be at most ~120 closer than its endpoints, so >= 160
  // (max sum of road half-widths = 155) must hold. ---
  const K = 8;
  let minD = Infinity;
  for (let i = 0; i < cl.pts.length - 1; i++) {
    const si = segSamples(cl.pts[i], cl.pts[i + 1], K);
    for (let j = i + 2; j < cl.pts.length - 1; j++) {
      if (cl.cum[j] - cl.cum[i + 1] < 450) continue; // same local road section
      const sj = segSamples(cl.pts[j], cl.pts[j + 1], K);
      for (const p of si) for (const q of sj) {
        minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
  }
  minDistHist.push(minD);
  if (minD < 160) errs.push(`self-overlap risk: min separated dist ${minD.toFixed(0)}`);

  // --- sections ordered, finish + slalom inside FINISH section ---
  const [open, tunnel, bridge, finish] = w.sections;
  if (!(tunnel.from < tunnel.to && tunnel.to < bridge.to && bridge.to < cl.total)) errs.push('sections not ordered');
  if (w.finishS - 260 <= bridge.to) errs.push(`slalom cone outside FINISH section (${w.finishS - 260} vs ${bridge.to})`);

  // --- obstacles on the road surface ---
  for (const ob of w.obstacles) {
    const info = w.trackInfoAt(ob.shape === 'box' ? ob.cx : ob.x, ob.shape === 'box' ? ob.cy : ob.y);
    if (info.dist > info.section.width / 2 + 1) errs.push(`obstacle off road: ${ob.kind} dist=${info.dist.toFixed(0)} halfW=${(info.section.width / 2).toFixed(0)}`);
  }

  // --- trees clear of road and water ---
  for (const [x, y] of w.trees) {
    const info = w.trackInfoAt(x, y);
    if (info.dist < info.section.width / 2 + 89) errs.push(`tree too close to road: dist=${info.dist.toFixed(0)}`);
    const { water } = w;
    if (x > water.x - 50 && x < water.x + water.w + 50 && y > water.y - 50 && y < water.y + water.h + 50) errs.push('tree in water');
  }

  // --- determinism: same seed -> same track ---
  const w2 = createWorld(seed);
  if (w2.cl.total !== cl.total || w2.cl.pts[3].x !== cl.pts[3].x || w2.finishS !== w.finishS) errs.push('not deterministic');

  if (errs.length) {
    failures++;
    console.log(`seed ${seed}: ` + errs.join('; '));
  }
}

minDistHist.sort((a, b) => a - b);
console.log(`\n${N} seeds tested, ${failures} failed`);
console.log(`length: min=${lenMin.toFixed(0)} max=${lenMax.toFixed(0)}`);
console.log(`min non-adjacent segment distance: worst=${minDistHist[0].toFixed(0)} p5=${minDistHist[Math.floor(N * 0.05)].toFixed(0)} median=${minDistHist[N / 2].toFixed(0)}`);

// classic world smoke test
const c = createWorld(0);
console.log(`\nclassic: total=${c.cl.total.toFixed(0)} finishS=${c.finishS} obstacles=${c.obstacles.length} trees=${c.trees.length} seed=${c.seed}`);
if (Math.abs(c.cl.total - 8147) > 5 || c.obstacles.length !== 6 || c.trees.length !== 9) {
  console.log('CLASSIC WORLD CHANGED — check!');
  process.exit(1);
}
process.exit(failures ? 1 : 0);
