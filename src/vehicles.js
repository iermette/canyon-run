import { roundRectPath } from './utils.js';
import { CARS } from './vehicleData.js';

// Vehicle catalog — every car is drawn top-down in local coordinates, centered
// on (0,0) with the nose pointing +x. Sizes stay comparable to the old set
// (~36 x 20) so all of them fit the narrowest road section (tunnel, width 95).
//
// Data (color, roof, stripe, archetype, stats) lives in vehicleData.js. This
// module turns each row into a playable vehicle: derived physics, colliders,
// wheel contacts, and a parametric 8-bit top-down painter keyed on the
// archetype — so a new car is one data row, not a new draw function.
//
// stats: maxSpeed / accel / brake in units/s(²), turnRate rad/s, reverseMax < 0.
// colliders: circles in local space for obstacle hits (long vehicles use two,
// nose + tail). wheelPts: the four wheel contacts for the "in the drink" test,
// ordered front-left, front-right, rear-left, rear-right (diagonal pairs 0&3, 1&2).

// ---- small color helpers ------------------------------------------------------

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shade = (hex, amt) => { // amt -1..1 : negative darkens, positive lightens
  const { r, g, b } = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  return rgbToHex({ r: r + (t - r) * p, g: g + (t - g) * p, b: b + (t - b) * p });
};
const luminance = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// A stripe that always reads against the body: light body → dark stripe,
// dark body → light stripe.
function stripeColor(body) {
  return luminance(body) > 0.6 ? '#20242b' : '#f2f4f8';
}

// ---- archetype profiles -------------------------------------------------------
// Geometry in local units (nose +x). `canopy` is the glass band as fractions of
// length: [frontEdge, rearEdge] measured from the center. Feature flags drive
// the distinctive bits of each silhouette.
const ARCH = {
  HY: { len: 46, wid: 23, r: 6,  wing: 1.0, canopy: [0.16, 0.60], splitter: true,  mirrors: true  },
  SC: { len: 44, wid: 22, r: 6,  wing: 0.8, canopy: [0.16, 0.58], splitter: true,  mirrors: true  },
  MU: { len: 48, wid: 22, r: 5,  wing: 0.0, canopy: [0.10, 0.50], hoodScoop: true, mirrors: false },
  RR: { len: 40, wid: 21, r: 7,  wing: 0.0, canopy: [0.22, 0.56], wideRear: true,  mirrors: true  },
  CU: { len: 40, wid: 20, r: 6,  wing: 0.0, canopy: [0.18, 0.55], mirrors: true    },
  RT: { len: 38, wid: 20, r: 7,  wing: 0.0, canopy: [0.20, 0.56], round: true,     mirrors: true  },
  HA: { len: 36, wid: 19, r: 5,  wing: 0.0, canopy: [0.24, 0.60], boxy: true,      mirrors: true  },
  SD: { len: 44, wid: 19, r: 5,  wing: 0.0, canopy: [0.26, 0.58], boxy: true,      mirrors: true  },
  WA: { len: 46, wid: 19, r: 5,  wing: 0.0, canopy: [0.24, 0.66], boxy: true,      mirrors: true  },
  SV: { len: 46, wid: 23, r: 6,  wing: 0.0, canopy: [0.26, 0.60], boxy: true, tall: true,  mirrors: true },
};

// ---- parametric 8-bit painter -------------------------------------------------

function paintWheels(ctx, len, wid, tall) {
  const h = tall ? 6 : 5;
  const w = 10;
  const yH = wid / 2;
  const xF = len / 2 - 10;
  const xR = -len / 2 + 12;
  ctx.fillStyle = '#14161b';
  for (const x of [xF, xR]) {
    roundRectPath(ctx, x - w / 2, -yH - h / 2 - 1, w, h, 2); ctx.fill();
    roundRectPath(ctx, x - w / 2, yH - h / 2 + 1, w, h, 2); ctx.fill();
  }
  // hubs (a lighter dot so the wheels read as wheels, not blobs)
  ctx.fillStyle = '#3a4048';
  for (const x of [xF, xR]) {
    ctx.fillRect(x - 1.5, -yH - h / 2 + 1, 3, 3);
    ctx.fillRect(x - 1.5, yH - h / 2 - 1, 3, 3);
  }
}

function paintBody(ctx, p, body, roof, stripe) {
  const L = p.len, W = p.wid, r = p.r;

  // drop shadow (offset to the lower-right for a sense of height)
  ctx.fillStyle = 'rgba(8,10,14,0.32)';
  roundRectPath(ctx, -L / 2 + 3, -W / 2 + 4, L, W, r); ctx.fill();

  // rear wing (behind the body) — sport archetypes
  if (p.wing > 0) {
    const wingW = W * (0.72 + 0.3 * p.wing);
    ctx.fillStyle = shade(body, -0.45);
    roundRectPath(ctx, -L / 2 - 4, -wingW / 2, 6, wingW, 2); ctx.fill();
    ctx.fillStyle = shade(roof, -0.5);
    ctx.fillRect(-L / 2 - 4, -wingW / 2, 6, 3); // wing endplates
    ctx.fillRect(-L / 2 - 4, wingW / 2 - 3, 6, 3);
  }

  // main body shell
  ctx.fillStyle = body;
  roundRectPath(ctx, -L / 2, -W / 2, L, W, r); ctx.fill();
  // chunky 8-bit outline
  ctx.strokeStyle = 'rgba(10,12,16,0.85)';
  ctx.lineWidth = 2;
  roundRectPath(ctx, -L / 2, -W / 2, L, W, r); ctx.stroke();

  // nose taper: a lighter trapezoid on the front third for low sport cars
  if (p.splitter || p.wing > 0.5) {
    ctx.fillStyle = shade(body, 0.10);
    ctx.beginPath();
    ctx.moveTo(L / 2, -W / 2 + 3);
    ctx.lineTo(L / 2 - L * 0.22, -W * 0.30);
    ctx.lineTo(L / 2 - L * 0.22, W * 0.30);
    ctx.lineTo(L / 2, W / 2 - 3);
    ctx.closePath(); ctx.fill();
  }

  // hood scoop for muscle cars
  if (p.hoodScoop) {
    ctx.fillStyle = shade(body, -0.35);
    roundRectPath(ctx, L * 0.08, -W * 0.16, L * 0.16, W * 0.32, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,16,0.6)'; ctx.lineWidth = 1.5;
    roundRectPath(ctx, L * 0.08, -W * 0.16, L * 0.16, W * 0.32, 3); ctx.stroke();
  }

  // roof / greenhouse
  const cx0 = (p.canopy[0] - 0.5) * L; // front edge of canopy (center-relative)
  const cx1 = (p.canopy[1] - 0.5) * L; // rear edge
  const cw = cx1 - cx0;
  const roofW = W * (p.boxy ? 0.74 : 0.66);
  ctx.fillStyle = roof;
  roundRectPath(ctx, cx0, -roofW / 2, cw, roofW, p.round ? 9 : 4); ctx.fill();
  ctx.strokeStyle = 'rgba(10,12,16,0.5)'; ctx.lineWidth = 1.5;
  roundRectPath(ctx, cx0, -roofW / 2, cw, roofW, p.round ? 9 : 4); ctx.stroke();

  // glass windshield strip (front of canopy) + rear glass (back of canopy)
  ctx.fillStyle = '#bfe0ff';
  ctx.globalAlpha = 0.9;
  const ws = Math.min(L * 0.07, 6);
  roundRectPath(ctx, cx0, -roofW / 2 + 2, ws, roofW - 4, 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9cc8f0';
  roundRectPath(ctx, cx1 - ws, -roofW / 2 + 3, ws * 0.8, roofW - 6, 2); ctx.fill();

  // livery
  if (stripe === 'twin') {
    ctx.fillStyle = stripeColor(body);
    ctx.fillRect(-L / 2 + 4, -3.2, L - 8, 2.4);
    ctx.fillRect(-L / 2 + 4, 0.8, L - 8, 2.4);
  } else if (stripe === 'side') {
    ctx.fillStyle = stripeColor(body);
    ctx.fillRect(-L / 2 + 4, -W / 2 + 2.5, L - 8, 3);
    ctx.fillRect(-L / 2 + 4, W / 2 - 5.5, L - 8, 3);
  }

  // side mirrors
  if (p.mirrors) {
    ctx.fillStyle = shade(body, -0.3);
    ctx.fillRect(cx1 + 2, -W / 2 - 2.5, 4, 3);
    ctx.fillRect(cx1 + 2, W / 2 - 0.5, 4, 3);
  }

  // lights
  ctx.fillStyle = '#fff6d8'; // headlights
  ctx.fillRect(L / 2 - 4, -W / 2 + 3, 3.4, 4);
  ctx.fillRect(L / 2 - 4, W / 2 - 7, 3.4, 4);
  ctx.fillStyle = '#ff4b3e'; // tail lights
  ctx.fillRect(-L / 2 + 1, -W / 2 + 3, 3, 4);
  ctx.fillRect(-L / 2 + 1, W / 2 - 7, 3, 4);
  if (p.wing > 0.5) { // full-width LED bar on hypercars
    ctx.fillStyle = '#ff2b2b';
    ctx.fillRect(-L / 2 + 1, -W * 0.3, 2.4, W * 0.6);
  }
}

function drawCar(ctx, car) {
  const p = ARCH[car.arch] || ARCH.CU;
  paintWheels(ctx, p.len, p.wid, !!p.tall);
  paintBody(ctx, p, car.body, car.roof, car.stripe);
}

// ---- catalog assembly ---------------------------------------------------------

const N = CARS.length;
const normOf = (key) => {
  const vals = CARS.map((c) => c[key]);
  const min = Math.min(...vals), max = Math.max(...vals);
  return CARS.map((c) => (max === min ? 0.5 : (c[key] - min) / (max - min)));
};
const Ntop = normOf('top'), Na = normOf('a'), Ncls = normOf('cls'), Nhd = normOf('handle');

function buildVehicle(c, i) {
  const p = ARCH[c.arch] || ARCH.CU;
  const L = p.len, W = p.wid;
  const half = L / 2;

  const maxSpeed = Math.round(180 + Ntop[i] * 260);            // 180..440 u/s
  const accel    = Math.round(560 - Na[i] * 320);               // 560..240 (a: fast→slow)
  const brake    = Math.round(380 + Ncls[i] * 200);             // 380..580
  const turnRate = +(1.6 + Nhd[i] * 1.7).toFixed(2);            // 1.6..3.3 rad/s
  const reverseMax = -Math.round(95 + Ntop[i] * 55);            // -95..-150

  // Colliders: long vehicles (muscle, wagon, sv) get nose + tail circles.
  const two = c.arch === 'MU' || c.arch === 'WA' || c.arch === 'SV' || c.arch === 'SD';
  const r = Math.max(12, W / 2 + 2);
  const colliders = two
    ? [{ dx: -half * 0.5, dy: 0, r: r * 0.9 }, { dx: half * 0.5, dy: 0, r: r * 0.9 }]
    : [{ dx: 0, dy: 0, r }];

  // Wheels sit just inside the painted tires; half-track slightly under the
  // body edge so a car parked on the line still clips the water with two wheels.
  const trackHalf = W / 2 - 2;
  const wheelPts = [
    { dx: half - 10, dy: -trackHalf }, // front-left
    { dx: half - 10, dy: trackHalf },  // front-right
    { dx: -(half - 12), dy: -trackHalf }, // rear-left
    { dx: -(half - 12), dy: trackHalf },  // rear-right
  ];

  return {
    id: c.id,
    name: `${c.maker} ${c.model}`,
    short: c.model.toUpperCase().replace(/\s+/g, ' '),
    blurb: `${c.era} · ${c.region === 'EU' ? 'Europe' : c.region === 'NA' ? 'Am. du Nord' : 'Japon & Asie'} · ${c.top} km/h`,
    arch: c.arch,
    era: c.era,
    region: c.region,
    body: c.body,
    roof: c.roof,
    stripe: c.stripe,
    stats: { maxSpeed, accel, brake, turnRate, reverseMax },
    colliders,
    wheelPts,
    draw: (ctx) => drawCar(ctx, { arch: c.arch, body: c.body, roof: c.roof, stripe: c.stripe }),
  };
}

export const VEHICLES = CARS.map(buildVehicle);

// Normalized stat values (0..1) for the garage's little bars.
export const STAT_BARS = {
  speed: Ntop,
  accel: CARS.map((_, i) => 1 - Na[i]), // a: low = fast → bar high
  grip: Nhd,
};
