import { clamp, lerp, closestPointOnSegment, roundRectPath } from './utils.js';
import { generateTrack, mulberry32 } from './trackgen.js';
import { grassStyle, roadStyle, treeSprites } from './textures.js';

// Classic hand-crafted track (seed 0). Centerline waypoints in world units.
const CLASSIC_WAYPOINTS = [
  [-400, 0],     // start pad
  [300, 0],      // open straight
  [800, -150],   // open curve
  [1200, -450],
  [1700, -600],
  [2300, -650],  // end of open / tunnel entry (straight)
  [3000, -680],  // tunnel straight
  [3700, -700],  // tunnel exit
  [4200, -900],  // curve down toward the bridge
  [4600, -1400], // bridge over water (diagonal)
  [5000, -1900],
  [5600, -2200], // end of bridge
  [6300, -2300], // final straight to the finish
  [7000, -2350],
];

// Sections in driving order: open -> tunnel -> bridge -> finish.
// `from`/`to` are arc-length ranges along the centerline (total ~8147).
const CLASSIC_SECTIONS = [
  { name: 'OPEN',   from: 0,    to: 2900, width: 150, color: '#4d525e' },
  { name: 'TUNNEL', from: 2900, to: 4300, width: 95,  color: '#23262f' },
  { name: 'BRIDGE', from: 4300, to: 6800, width: 140, color: '#8a7a5c' },
  { name: 'FINISH', from: 6800, to: Infinity, width: 160, color: '#4d525e' },
];

const FINISH_S = 7350;      // arc length of the finish line (classic track)
const START_LINE_S = 100;   // arc length of the start banner
const CAR_START_S = 30;     // where the car spawns (just behind the start line)

function buildCenterline(raw) {
  const pts = raw.map(([x, y]) => ({ x, y }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

// Position and tangent angle on the centerline at arc length s.
export function pointAt(cl, s) {
  s = clamp(s, 0, cl.total);
  let i = 1;
  while (i < cl.cum.length && cl.cum[i] < s) i++;
  const a = cl.pts[i - 1], b = cl.pts[i];
  const segLen = cl.cum[i] - cl.cum[i - 1] || 1e-9;
  const t = (s - cl.cum[i - 1]) / segLen;
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

// Point at arc length s, shifted `offset` from the centerline.
export function placeOnTrack(cl, s, offset) {
  const p = pointAt(cl, s);
  return { x: p.x - Math.sin(p.angle) * offset, y: p.y + Math.cos(p.angle) * offset };
}

// Nearest-point query on the track for a world position.
function trackInfoAt(cl, sections, x, y) {
  let best = { d2: Infinity, s: 0 };
  for (let i = 1; i < cl.pts.length; i++) {
    const a = cl.pts[i - 1], b = cl.pts[i];
    const c = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
    const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d2 < best.d2) {
      best = { d2, s: cl.cum[i - 1] + c.t * (cl.cum[i] - cl.cum[i - 1]) };
    }
  }
  let section = sections[sections.length - 1];
  for (const sec of sections) if (best.s < sec.to) { section = sec; break; }
  return { dist: Math.sqrt(best.d2), s: best.s, section };
}

// Centerline points belonging to one section (boundaries interpolated so
// consecutive chunks share their edge point and the road stays continuous).
function chunkPoints(cl, from, to) {
  const pts = [pointAt(cl, from)];
  for (let i = 1; i < cl.pts.length - 1; i++) {
    if (cl.cum[i] > from + 1e-6 && cl.cum[i] < to - 1e-6) pts.push(cl.pts[i]);
  }
  pts.push(pointAt(cl, Math.min(to, cl.total)));
  return pts;
}

function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function label(ctx, text, x, y) {
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(text, x, y);
}

function drawTrees(ctx, trees) {
  const sprites = treeSprites();
  for (const [x, y, r, variant] of trees) {
    if (sprites.length > 0) {
      const img = sprites[((variant ?? 0) % sprites.length + sprites.length) % sprites.length];
      // offset shadow under the canopy: sells the tree's height
      ctx.fillStyle = 'rgba(6,10,6,0.30)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.22, y + r * 0.28, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      // flat fallback until the sprites are loaded (and if the files are missing)
      ctx.fillStyle = '#2c5e2a';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#38793a';
      ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.62, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawObstacles(ctx, obstacles) {
  for (const ob of obstacles) {
    if (ob.shape === 'circle') {
      if (ob.kind === 'cone') {
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r * 0.55, 0, Math.PI * 2); ctx.stroke();
      } else if (ob.kind === 'barrel') {
        ctx.fillStyle = '#b03030';
        ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#5e1616'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ob.x, ob.y, ob.r - 3, 0, Math.PI * 2); ctx.stroke();
      } else { // rock: bumpy polygon
        ctx.fillStyle = '#8d9096';
        ctx.beginPath();
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ob.seed;
          const rr = ob.r * (i % 2 === 0 ? 1 : 0.78);
          const px = ob.x + Math.cos(a) * rr, py = ob.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#5f6268'; ctx.lineWidth = 3; ctx.stroke();
      }
    } else { // barrier: oriented box with red/white stripes
      ctx.save();
      ctx.translate(ob.cx, ob.cy);
      ctx.rotate(ob.angle);
      const stripeH = 14;
      for (let i = 0; i < Math.ceil((ob.hy * 2) / stripeH); i++) {
        ctx.fillStyle = i % 2 === 0 ? '#d8dde3' : '#c0392b';
        const y0 = -ob.hy + i * stripeH;
        ctx.fillRect(-ob.hx, y0, ob.hx * 2, Math.min(stripeH, ob.hy * 2 - (y0 + ob.hy)));
      }
      ctx.restore();
    }
  }
}

// ---- generated-track dressing ---------------------------------------------

const sectionMid = (sec, total) => (sec.from + Math.min(sec.to, total)) / 2;

// Obstacles for a generated track: same spirit as the classic one, but with
// randomized positions/offsets. A circle offset to one side always leaves a
// wide lane on the other (freeLane = W + |off| - r); the barrier keeps a
// >= 55 free lane opposite its gap.
function makeObstacles(cl, sections, rnd) {
  const obs = [];
  const total = cl.total;
  const finishS = total - 300;
  const open = sections.find((s) => s.name === 'OPEN');
  const tunnel = sections.find((s) => s.name === 'TUNNEL');
  const bridge = sections.find((s) => s.name === 'BRIDGE');
  const finish = sections.find((s) => s.name === 'FINISH');

  const putCircle = (sec, s, kind, r, side = rnd() < 0.5 ? -1 : 1) => {
    const maxOff = sec.width / 2 - r - 6; // stays on the road surface
    if (maxOff <= 4) return;
    const off = lerp(0.35, 1, rnd()) * maxOff * side;
    obs.push({ shape: 'circle', kind, r, ...placeOnTrack(cl, s, off) });
  };

  // OPEN: two obstacles well apart along the section.
  const oA = open.from + 450, oB = open.to - 200;
  let f1 = rnd(), f2 = rnd();
  for (let i = 0; i < 8 && Math.abs(f1 - f2) < 0.45; i++) f2 = rnd();
  putCircle(open, lerp(oA, oB, f1), 'cone', 16 + rnd() * 4);
  putCircle(open, lerp(oA, oB, f2), 'barrel', 18 + rnd() * 4);

  // TUNNEL: one rock near the centerline (narrow road = tight squeeze).
  {
    const s = sectionMid(tunnel, total);
    const maxOff = tunnel.width / 2 - 18 - 6;   // stays on the road
    const minOff = 40 - tunnel.width / 2 + 18;  // keeps a >= 40 lane opposite (classic ~41)
    const off = lerp(minOff, maxOff, rnd()) * (rnd() < 0.5 ? -1 : 1);
    obs.push({ shape: 'circle', kind: 'rock', r: 18, seed: rnd() * Math.PI * 2, ...placeOnTrack(cl, s, off) });
  }

  // BRIDGE: one barrier leaving a gap on one side.
  {
    const hy = 38;
    const W = bridge.width / 2;
    const lo = Math.max(0, 55 - W + hy); // keeps a >= 55 free lane opposite the gap
    const hi = W + 8 - hy;               // allows up to 8 units of overhang past the edge
    if (hi > lo) {
      const s = sectionMid(bridge, total);
      const off = lerp(lo, hi, rnd()) * (rnd() < 0.5 ? -1 : 1);
      const p = placeOnTrack(cl, s, off);
      obs.push({ shape: 'box', kind: 'barrier', cx: p.x, cy: p.y, hx: 10, hy, angle: pointAt(cl, s).angle });
    }
  }

  // FINISH approach: slalom of two cones on alternating sides.
  const side = rnd() < 0.5 ? -1 : 1;
  putCircle(finish, finishS - 260, 'cone', 16, side);
  putCircle(finish, finishS - 130, 'cone', 16, -side);

  return obs;
}

// Trees scattered around the track: rejected when too close to the road or
// inside (or next to) the water body. Uses the same nearest-point query as
// gameplay, so "clear of the road" means exactly what it does in-game.
function makeTrees(cl, sections, water, rnd) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of cl.pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const M = 750;
  const trees = [];
  let guard = 0;
  while (trees.length < 60 && guard++ < 3000) {
    const x = lerp(x0 - M, x1 + M, rnd());
    const y = lerp(y0 - M, y1 + M, rnd());
    const info = trackInfoAt(cl, sections, x, y);
    if (info.dist < info.section.width / 2 + 90) continue; // keep clear of the road
    if (x > water.x - 50 && x < water.x + water.w + 50 &&
        y > water.y - 50 && y < water.y + water.h + 50) continue; // not in the water
    trees.push([x, y, 20 + rnd() * 14, Math.floor(rnd() * 3)]); // 4th: sprite variant
  }
  return trees;
}

// Water body under the bridge section (bounding box of the chunk + margin).
function makeWater(chunks) {
  const bridgePts = chunks.find((c) => c.name === 'BRIDGE').pts;
  let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
  for (const p of bridgePts) {
    wx0 = Math.min(wx0, p.x); wy0 = Math.min(wy0, p.y);
    wx1 = Math.max(wx1, p.x); wy1 = Math.max(wy1, p.y);
  }
  return { x: wx0 - 380, y: wy0 - 380, w: (wx1 - wx0) + 760, h: (wy1 - wy0) + 760 };
}

// Is a point in the drink? Inside the water body and off the drivable surface:
// the bridge deck is painted over the water and stays road. The road-edge
// margin matches isOffTrack()'s so the two agree at the shoulder.
function pointInWater(water, cl, sections, x, y) {
  if (x < water.x || x > water.x + water.w || y < water.y || y > water.y + water.h) return false;
  const info = trackInfoAt(cl, sections, x, y);
  return info.dist > info.section.width / 2 + 10;
}

// ---- shared scene drawing ---------------------------------------------------

function drawScene(ctx, world, vw, vh) {
  // grass background: bounding box of the centerline plus a margin large enough
  // to cover the whole viewport (zoom is 1, so CSS pixels == world units).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of world.cl.pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const m = Math.max(900, Math.hypot(vw || 1920, vh || 1080) / 2 + 400);
  // grass field: the 8-bit tile once loaded, else the flat fallback color
  ctx.fillStyle = grassStyle('#3f7d3a');
  ctx.fillRect(x0 - m, y0 - m, (x1 - x0) + 2 * m, (y1 - y0) + 2 * m);

  // water under the bridge
  const { water } = world;
  ctx.fillStyle = '#2e6da4';
  roundRectPath(ctx, water.x, water.y, water.w, water.h, 120);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 14; i++) { // little wave dashes (deterministic)
    const wx = water.x + 80 + ((i * 379) % Math.max(1, water.w - 160));
    const wy = water.y + 70 + ((i * 523) % Math.max(1, water.h - 140));
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + 25, wy - 8, wx + 50, wy);
    ctx.stroke();
  }

  // ambient darkness around the tunnel area
  const { tunnelCenter } = world;
  const g = ctx.createRadialGradient(tunnelCenter.x, tunnelCenter.y, 120, tunnelCenter.x, tunnelCenter.y, 980);
  g.addColorStop(0, 'rgba(4,6,14,0.55)');
  g.addColorStop(1, 'rgba(4,6,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(tunnelCenter.x - 980, tunnelCenter.y - 980, 1960, 1960);

  // road sections (chunks share boundary points -> continuous road)
  for (const chunk of world.chunks) {
    if (chunk.name === 'TUNNEL') { // tunnel walls behind the narrow dark road
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#14161c';
      ctx.lineWidth = chunk.width + 38;
      strokePath(ctx, chunk.pts);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // asphalt sections wear the texture; tunnel road and wooden bridge stay flat
    ctx.strokeStyle = (chunk.name === 'OPEN' || chunk.name === 'FINISH') ? roadStyle(chunk.color) : chunk.color;
    ctx.lineWidth = chunk.width;
    strokePath(ctx, chunk.pts);
    // dashed center line
    ctx.setLineDash([24, 30]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = chunk.name === 'TUNNEL' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.5)';
    strokePath(ctx, chunk.pts);
    ctx.setLineDash([]);
  }

  // start line (white bar across the road)
  {
    const p = pointAt(world.cl, world.startLineS);
    const openW = world.sections.find((s) => s.name === 'OPEN').width;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(-4, -openW / 2, 8, openW);
    ctx.restore();
  }

  // checkered finish line
  {
    const p = pointAt(world.cl, world.finishS);
    const halfW = 80;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    for (let i = 0; i < 10; i++) {
      for (let j = -1; j <= 1; j++) {
        ctx.fillStyle = (i + j + 2) % 2 === 0 ? '#f4f4f4' : '#15181d';
        ctx.fillRect(-halfW + i * 16, j * 16 - 8, 16, 16);
      }
    }
    ctx.restore();
  }

  // scenery (no collision)
  drawTrees(ctx, world.trees);

  // section labels (placed relative to each section's midpoint)
  const put = (text, s, offset) => {
    const p = placeOnTrack(world.cl, s, offset);
    label(ctx, text, p.x, p.y);
  };
  const openSec = world.sections.find((s) => s.name === 'OPEN');
  const tunnelSec = world.sections.find((s) => s.name === 'TUNNEL');
  const bridgeSec = world.sections.find((s) => s.name === 'BRIDGE');
  const finishSec = world.sections.find((s) => s.name === 'FINISH');
  put('START', world.startLineS + 60, -(openSec.width / 2 + 55));
  put('OPEN', sectionMid(openSec, world.cl.total), -(openSec.width / 2 + 55));
  put('TUNNEL', sectionMid(tunnelSec, world.cl.total), 0);
  put('BRIDGE', sectionMid(bridgeSec, world.cl.total), 0);
  put('FINISH', world.finishS + 80, -(finishSec.width / 2 + 50));

  drawObstacles(ctx, world.obstacles);
}

// ---- world builders -----------------------------------------------------------

// The original hand-crafted track (seed 0). opts: {widthFactor, startLineS}.
function buildClassicWorld(opts) {
  const f = opts.widthFactor ?? 1;
  const cl = buildCenterline(CLASSIC_WAYPOINTS);
  const sections = CLASSIC_SECTIONS.map((s) => ({ ...s, width: s.width * f }));
  const chunks = sections.map((sec) => ({ ...sec, pts: chunkPoints(cl, sec.from, sec.to) }));

  // Obstacles on or near the track (>= 3 required).
  const barrierPos = placeOnTrack(cl, 5500, -34);
  const obstacles = [
    { shape: 'circle', kind: 'cone',   r: 18, ...placeOnTrack(cl, 1500, 55) },   // open section
    { shape: 'circle', kind: 'barrel', r: 20, ...placeOnTrack(cl, 2400, -45) },  // open section
    { shape: 'circle', kind: 'rock',   r: 18, seed: 0.8, ...placeOnTrack(cl, 3550, 12) }, // tunnel
    { shape: 'box', kind: 'barrier', cx: barrierPos.x, cy: barrierPos.y, hx: 10, hy: 38, angle: pointAt(cl, 5500).angle }, // bridge
    { shape: 'circle', kind: 'cone',   r: 16, ...placeOnTrack(cl, 7050, 50) },   // finish approach (slalom)
    { shape: 'circle', kind: 'cone',   r: 16, ...placeOnTrack(cl, 7200, -50) },  // finish approach (slalom)
  ];

  const water = makeWater(chunks);
  const tunnelCenter = pointAt(cl, 3600);
  const trees = [
    [80, 260, 26, 0], [420, 330, 30, 1], [760, 250, 24, 2], [300, -360, 26, 1],
    [1500, -260, 28, 0], [2050, -420, 24, 2],
    [4950, -950, 26, 1], [5900, -1700, 26, 0], [6600, -2050, 26, 2],
  ];

  return {
    seed: 0, cl, sections, chunks, obstacles, water, tunnelCenter, trees,
    finishS: FINISH_S, startLineS: opts.startLineS ?? START_LINE_S,

    carStart() {
      const p = pointAt(cl, CAR_START_S);
      return { x: p.x, y: p.y, angle: p.angle };
    },

    trackInfoAt(x, y) {
      return trackInfoAt(cl, sections, x, y);
    },

    inWater(x, y) {
      return pointInWater(water, cl, sections, x, y);
    },

    draw(ctx, vw, vh) {
      drawScene(ctx, this, vw, vh);
    },
  };
}

// A random track derived from its seed. opts: {widthFactor, startLineS}.
function buildGeneratedWorld(seed, opts) {
  const f = opts.widthFactor ?? 1;
  const { waypoints, fracs } = generateTrack(seed);
  const cl = buildCenterline(waypoints);
  const total = cl.total;
  const t0 = total * fracs.tunnelStart;
  const t1 = t0 + total * fracs.tunnelLen;
  const b1 = t1 + total * fracs.bridgeLen;
  const sections = [
    { name: 'OPEN',   from: 0,    to: t0, width: 150 * f, color: '#4d525e' },
    { name: 'TUNNEL', from: t0,   to: t1, width: 95 * f,  color: '#23262f' },
    { name: 'BRIDGE', from: t1,   to: b1, width: 140 * f, color: '#8a7a5c' },
    { name: 'FINISH', from: b1,   to: Infinity, width: 160 * f, color: '#4d525e' },
  ];
  const chunks = sections.map((sec) => ({ ...sec, pts: chunkPoints(cl, sec.from, sec.to) }));

  // A second RNG stream so the dressing is decorrelated from the walk itself.
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const obstacles = makeObstacles(cl, sections, rnd);
  const water = makeWater(chunks);
  const tunnelCenter = pointAt(cl, (t0 + t1) / 2);
  const trees = makeTrees(cl, sections, water, rnd);

  return {
    seed, cl, sections, chunks, obstacles, water, tunnelCenter, trees,
    finishS: total - 300, startLineS: opts.startLineS ?? START_LINE_S,

    carStart() {
      const p = pointAt(cl, CAR_START_S);
      return { x: p.x, y: p.y, angle: p.angle };
    },

    trackInfoAt(x, y) {
      return trackInfoAt(cl, sections, x, y);
    },

    inWater(x, y) {
      return pointInWater(water, cl, sections, x, y);
    },

    draw(ctx, vw, vh) {
      drawScene(ctx, this, vw, vh);
    },
  };
}

// seed === 0 (or 'classic') -> the original hand-crafted track.
// Any other number -> that seeded random track; no argument -> fresh random.
// opts: {widthFactor, startLineS} — used by multiplayer to widen the road for
// more racers and to move the start line back behind the starting grid.
export function createWorld(seed = null, opts = {}) {
  if (seed === 0 || seed === 'classic') return buildClassicWorld(opts);
  const s = typeof seed === 'number' ? seed : ((Math.random() * 0x7fffffff) | 0);
  return buildGeneratedWorld(s, opts);
}
