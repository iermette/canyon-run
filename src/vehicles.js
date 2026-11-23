import { roundRectPath } from './utils.js';

// Vehicle catalog — every vehicle is drawn top-down in local coordinates:
// centered on (0, 0), nose pointing +x. Sizes are comparable to the original
// car (~36 x 20 units) so all of them fit the narrowest road section.
//
// stats: maxSpeed / accel / brake in units/s(²), turnRate rad/s, reverseMax < 0.
// colliders: circles in local space used for obstacle hits (long vehicles use
// two circles nose + tail instead of one big one).
// wheelBox: [frontAxleX, rearAxleX, halfTrack] — the four wheel contact points
// used for the "in the drink" test. Keep it aligned with the wheels() the draw
// function paints (for tracked/wheeled-in-line vehicles it is the contact band).

const WHEEL = '#1c1f24';
const GLASS = '#cfe4ff';

function wheels(ctx, xs, yHalf, w = 9, h = 5) {
  ctx.fillStyle = WHEEL;
  for (const x of xs) {
    ctx.fillRect(x - w / 2, -yHalf - h / 2, w, h);
    ctx.fillRect(x - w / 2, yHalf - h / 2, w, h);
  }
}

function body(ctx, len, wid, r = 6) {
  roundRectPath(ctx, -len / 2, -wid / 2, len, wid, r);
  ctx.fill();
}

// ---- draw functions ----------------------------------------------------------

// Red race car with twin white stripes and a rear wing.
function drawSports(ctx) {
  wheels(ctx, [-13, 13], 10.5);
  ctx.fillStyle = '#d64541';
  body(ctx, 38, 17, 7);
  ctx.fillStyle = '#2a2d33'; // rear wing
  ctx.fillRect(-19, -9, 4, 18);
  ctx.fillStyle = '#f4f6f8'; // twin racing stripes
  ctx.fillRect(-15, -4.5, 30, 3);
  ctx.fillRect(-15, 1.5, 30, 3);
  ctx.fillStyle = '#274b6d'; // cockpit
  roundRectPath(ctx, -4, -5.5, 12, 11, 4);
  ctx.fill();
}

// Yellow cab with roof checkers and a taxi sign.
function drawTaxi(ctx) {
  wheels(ctx, [-12, 12], 10);
  ctx.fillStyle = '#ffd23e';
  body(ctx, 36, 18, 6);
  for (let i = 0; i < 5; i++) { // roof checker strip
    ctx.fillStyle = i % 2 ? '#f4f6f8' : '#22252b';
    ctx.fillRect(-10 + i * 4, -3.5, 4, 7);
  }
  ctx.fillStyle = '#ffffff'; // roof sign
  roundRectPath(ctx, 7, -3, 6, 6, 1.5);
  ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.fillRect(-8, -7, 9, 14);
}

// White patrol car with a blue stripe and a red/blue light bar.
function drawPolice(ctx) {
  wheels(ctx, [-12, 12], 10);
  ctx.fillStyle = '#eef2f7';
  body(ctx, 36, 18, 6);
  ctx.fillStyle = '#2b5fd9'; // center stripe
  ctx.fillRect(-18, -2.5, 36, 5);
  ctx.fillStyle = GLASS;
  ctx.fillRect(-7, -7, 9, 14);
  ctx.fillStyle = '#e04b3a'; // light bar (red side)
  ctx.fillRect(6, -6, 4, 5);
  ctx.fillStyle = '#3d7eff'; // light bar (blue side)
  ctx.fillRect(6, 1, 4, 5);
}

// Boxy white van with a red cross on the roof.
function drawAmbulance(ctx) {
  wheels(ctx, [-13, 13], 10);
  ctx.fillStyle = '#f4f6f8';
  body(ctx, 40, 19, 5);
  ctx.fillStyle = '#e04b3a'; // roof cross
  ctx.fillRect(-9, -7, 4, 14);
  ctx.fillRect(-15, -2, 14, 4);
  ctx.fillStyle = GLASS;
  ctx.fillRect(14, -8, 4, 16);
}

// Long red truck with a ladder along the roof.
function drawFire(ctx) {
  wheels(ctx, [-20, -8, 14], 11.5, 9, 6);
  ctx.fillStyle = '#d64541';
  body(ctx, 56, 20, 5);
  ctx.fillStyle = GLASS; // cab windshield
  ctx.fillRect(20, -8, 5, 16);
  ctx.fillStyle = '#9aa3ad'; // ladder rails + rungs
  ctx.fillRect(-24, -3.5, 40, 7);
  ctx.fillStyle = '#6d7680';
  for (let i = 0; i < 8; i++) ctx.fillRect(-21 + i * 5, -3.5, 2, 7);
}

// Yellow cab with a grey mixing drum on the back.
function drawMixer(ctx) {
  wheels(ctx, [-14, 10], 11.5, 9, 6);
  ctx.fillStyle = '#8d939c'; // drum (capsule seen from above)
  roundRectPath(ctx, -24, -8, 30, 16, 8);
  ctx.fill();
  ctx.strokeStyle = '#6d747e'; // spiral hint on the drum
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-19 + i * 8, -8);
    ctx.lineTo(-15 + i * 8, 8);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffd23e'; // cab
  roundRectPath(ctx, 6, -9.5, 14, 19, 4);
  ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.fillRect(17, -8, 3, 16);
}

// Orange cab with an open ribbed bed.
function drawDump(ctx) {
  wheels(ctx, [-14, 8], 11.5, 9, 6);
  ctx.fillStyle = '#b07a3e'; // bed walls
  roundRectPath(ctx, -24, -9, 28, 18, 3);
  ctx.fill();
  ctx.fillStyle = '#8a5c2c'; // bed floor
  roundRectPath(ctx, -21.5, -6.5, 23, 13, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; // ribs
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    const x = -24 + i * 7;
    ctx.beginPath(); ctx.moveTo(x, -9); ctx.lineTo(x, 9); ctx.stroke();
  }
  ctx.fillStyle = '#f08c2e'; // cab
  roundRectPath(ctx, 4, -10, 16, 20, 4);
  ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.fillRect(17, -8, 3, 16);
}

// Orange semi cab pulling a flatbed of wooden planks.
function drawFlatbed(ctx) {
  wheels(ctx, [-20, -10, 12], 11.5, 9, 6);
  ctx.fillStyle = '#a87c4f'; // plank bed
  roundRectPath(ctx, -30, -8.5, 34, 17, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 6; i++) {
    const x = -30 + i * (34 / 6);
    ctx.beginPath(); ctx.moveTo(x, -8.5); ctx.lineTo(x, 8.5); ctx.stroke();
  }
  ctx.fillStyle = '#f08c2e'; // cab
  roundRectPath(ctx, 4, -10, 16, 20, 4);
  ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.fillRect(17, -8, 3, 16);
}

// Red double-decker: long body with two rows of side windows.
function drawBus(ctx) {
  wheels(ctx, [-24, -12, 18], 11.5, 9, 6);
  ctx.fillStyle = '#d64541';
  body(ctx, 64, 20, 6);
  ctx.fillStyle = GLASS; // window rows on both sides
  for (let i = 0; i < 8; i++) {
    const x = -27 + i * 7;
    ctx.fillRect(x, -9.5, 5, 3);
    ctx.fillRect(x, 6.5, 5, 3);
  }
  ctx.fillRect(28, -8, 4, 16); // windshield
}

// Olive hull on dark tracks with a turret and long barrel.
function drawTank(ctx) {
  ctx.fillStyle = '#2a2d33'; // tracks
  roundRectPath(ctx, -17, -11.5, 34, 6, 3); ctx.fill();
  roundRectPath(ctx, -17, 5.5, 34, 6, 3); ctx.fill();
  ctx.fillStyle = '#5f7a3e'; // hull
  body(ctx, 32, 18, 4);
  ctx.fillStyle = '#4c6330'; // turret + barrel
  ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(0, -2.5, 20, 5);
}

// Small pink scooter: two thin wheels, low body, handlebar.
function drawMoto(ctx) {
  ctx.fillStyle = WHEEL; // wheels
  ctx.fillRect(-11, -3, 6, 6);
  ctx.fillRect(7, -3, 6, 6);
  ctx.fillStyle = '#ff7ab8'; // body
  roundRectPath(ctx, -9, -4.5, 18, 9, 4);
  ctx.fill();
  ctx.fillStyle = WHEEL; // seat + handlebar
  ctx.fillRect(-6, -3, 6, 6);
  ctx.strokeStyle = WHEEL;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(9, -6); ctx.lineTo(9, 6); ctx.stroke();
}

// White van with orange stripes and an ice-cream cone on the roof.
function drawIceCream(ctx) {
  wheels(ctx, [-12, 12], 10);
  ctx.fillStyle = '#f4f6f8';
  body(ctx, 38, 19, 5);
  ctx.fillStyle = '#ff9d5c'; // side stripes
  ctx.fillRect(-17, -9.5, 30, 3);
  ctx.fillRect(-17, 6.5, 30, 3);
  ctx.fillStyle = '#e8b04c'; // cone (tip pointing back)
  ctx.beginPath();
  ctx.moveTo(-1, -2.5); ctx.lineTo(-1, 2.5); ctx.lineTo(-9, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ff9ec7'; // scoop
  ctx.beginPath(); ctx.arc(1, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GLASS;
  ctx.fillRect(15, -8, 3.5, 16);
}

// ---- catalog ------------------------------------------------------------------

export const VEHICLES = [
  {
    id: 'sports', name: 'Sports Car', short: 'SPORTS',
    blurb: 'Top-speed king — fast to launch, sharp in the corners.',
    stats: { maxSpeed: 400, accel: 480, brake: 560, turnRate: 2.9, reverseMax: -150 },
    colliders: [{ dx: 0, dy: 0, r: 15 }],
    wheelBox: [13, -13, 10.5],
    draw: drawSports,
  },
  {
    id: 'taxi', name: 'Taxi', short: 'TAXI',
    blurb: 'The city classic — balanced and dependable.',
    stats: { maxSpeed: 320, accel: 400, brake: 520, turnRate: 2.6, reverseMax: -130 },
    colliders: [{ dx: 0, dy: 0, r: 16 }],
    wheelBox: [12, -12, 10],
    draw: drawTaxi,
  },
  {
    id: 'police', name: 'Police Car', short: 'POLICE',
    blurb: 'Built for pursuit — quick and nimble.',
    stats: { maxSpeed: 370, accel: 460, brake: 580, turnRate: 2.8, reverseMax: -140 },
    colliders: [{ dx: 0, dy: 0, r: 16 }],
    wheelBox: [12, -12, 10],
    draw: drawPolice,
  },
  {
    id: 'ambulance', name: 'Ambulance', short: 'AMBULANCE',
    blurb: 'Every second counts — steady all-rounder.',
    stats: { maxSpeed: 300, accel: 380, brake: 500, turnRate: 2.4, reverseMax: -120 },
    colliders: [{ dx: 0, dy: 0, r: 16 }],
    wheelBox: [13, -13, 10],
    draw: drawAmbulance,
  },
  {
    id: 'moto', name: 'Scooter', short: 'SCOOTER',
    blurb: 'Tiny and twitchy — fastest launch in the garage.',
    stats: { maxSpeed: 360, accel: 520, brake: 600, turnRate: 3.4, reverseMax: -110 },
    colliders: [{ dx: 0, dy: 0, r: 10 }],
    wheelBox: [10, -8, 0], // in line: both wheels are each other's opposite
    draw: drawMoto,
  },
  {
    id: 'icecream', name: 'Ice Cream Van', short: 'ICE CREAM',
    blurb: 'Sweet ride — light handling with a friendly face.',
    stats: { maxSpeed: 290, accel: 360, brake: 480, turnRate: 2.3, reverseMax: -115 },
    colliders: [{ dx: 0, dy: 0, r: 16 }],
    wheelBox: [12, -12, 10],
    draw: drawIceCream,
  },
  {
    id: 'firetruck', name: 'Fire Truck', short: 'FIRE TRUCK',
    blurb: 'Heavy and long — slow to turn, hard to stop.',
    stats: { maxSpeed: 240, accel: 260, brake: 420, turnRate: 1.9, reverseMax: -100 },
    colliders: [{ dx: -18, dy: 0, r: 9 }, { dx: 18, dy: 0, r: 9 }],
    wheelBox: [14, -20, 11.5],
    draw: drawFire,
  },
  {
    id: 'mixer', name: 'Cement Mixer', short: 'MIXER',
    blurb: 'The drum keeps spinning — patience wins races.',
    stats: { maxSpeed: 220, accel: 240, brake: 400, turnRate: 1.8, reverseMax: -90 },
    colliders: [{ dx: -12, dy: 0, r: 9 }, { dx: 12, dy: 0, r: 9 }],
    wheelBox: [10, -14, 11.5],
    draw: drawMixer,
  },
  {
    id: 'dump', name: 'Dump Truck', short: 'DUMP TRUCK',
    blurb: 'Hauling the load — torquey but sluggish.',
    stats: { maxSpeed: 230, accel: 250, brake: 410, turnRate: 1.8, reverseMax: -95 },
    colliders: [{ dx: -13, dy: 0, r: 9 }, { dx: 13, dy: 0, r: 9 }],
    wheelBox: [8, -14, 11.5],
    draw: drawDump,
  },
  {
    id: 'flatbed', name: 'Flatbed Semi', short: 'FLATBED',
    blurb: 'Long hauler — big brakes, wide turns.',
    stats: { maxSpeed: 260, accel: 270, brake: 430, turnRate: 1.7, reverseMax: -100 },
    colliders: [{ dx: -19, dy: 0, r: 9 }, { dx: 19, dy: 0, r: 9 }],
    wheelBox: [12, -20, 11.5],
    draw: drawFlatbed,
  },
  {
    id: 'bus', name: 'Double-Decker Bus', short: 'BUS',
    blurb: 'Two floors of passengers — the longest ride in town.',
    stats: { maxSpeed: 250, accel: 250, brake: 420, turnRate: 1.6, reverseMax: -90 },
    colliders: [{ dx: -21, dy: 0, r: 9 }, { dx: 21, dy: 0, r: 9 }],
    wheelBox: [18, -24, 11.5],
    draw: drawBus,
  },
  {
    id: 'tank', name: 'Tank', short: 'TANK',
    blurb: 'Slow as a glacier — but that torque is no joke.',
    stats: { maxSpeed: 200, accel: 300, brake: 480, turnRate: 1.4, reverseMax: -120 },
    colliders: [{ dx: 0, dy: 0, r: 15 }],
    wheelBox: [15, -15, 8.5], // tracks: contact band along the hull
    draw: drawTank,
  },
];

// The four wheel contact points in local space, in the order front-left,
// front-right, rear-left, rear-right — so indices (0,3) and (1,2) are the two
// diagonal pairs. Used by car.wheelContacts() / collision.waterContact().
for (const v of VEHICLES) {
  const [fx, rx, hy] = v.wheelBox;
  v.wheelPts = [
    { dx: fx, dy: -hy }, { dx: fx, dy: hy },
    { dx: rx, dy: -hy }, { dx: rx, dy: hy },
  ];
}

// Normalized stat values (0..1) for the garage's little bars.
const norm = (key) => {
  const vals = VEHICLES.map((v) => v.stats[key]);
  const min = Math.min(...vals), max = Math.max(...vals);
  return VEHICLES.map((v) => (max === min ? 0.5 : (v.stats[key] - min) / (max - min)));
};

export const STAT_BARS = {
  speed: norm('maxSpeed'),
  accel: norm('accel'),
  grip: norm('turnRate'),
};
