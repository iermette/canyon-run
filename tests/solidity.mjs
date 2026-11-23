// Solidity unit tests: a car can never overlap or drive through another car.
import { Remotes } from '../src/remotes.js';
import { Car } from '../src/car.js';
import { resolveCarOverlap, placedColliders, SOLID_SOFT } from '../src/solidity.js';
import { VEHICLES } from '../src/vehicles.js';

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

const firetruck = VEHICLES.find((v) => v.id === 'firetruck');
const now = performance.now();

function newCar(angle = 0) {
  return new Car({ carStart: () => ({ x: 0, y: 0, angle }) });
}
function remote(id, x, y, a, vehicleId = 'firetruck', frozen = false) {
  const r = new Remotes();
  r.setMeta(id, { name: 'X', color: '#fff', vehicleId });
  r.update(id, { x, y, a, s: 0 });
  if (frozen) r.cars.get(id).frozen = true;
  return r;
}

// ---- head-on overlap: ejected apart, approach velocity killed ----------------------
const car = newCar();
car.speed = 300;
const rem = remote('p1', 20, 0, 0); // tail circle at x=2, overlapping our nose
const contacts = resolveCarOverlap(car, rem, now, 0.016);
check(contacts > 0, `overlap detected (${contacts} contact(s))`);
check(car.x < -20, `ejected backwards out of the penetration (x=${car.x.toFixed(1)})`);
const gap = Math.hypot(car.x - 2, 0); // our circle center vs their tail circle
check(gap >= firetruck.colliders.find((c) => c.dx < 0).r + 15 - SOLID_SOFT, `residual penetration <= softness (gap=${gap.toFixed(1)})`);
check(car.speed < 60, `approach velocity killed (speed=${car.speed.toFixed(1)})`);

// ---- repeated frames: never drives through ----------------------------------------
const car2 = newCar();
const rem2 = remote('p1', 60, 0, 0);
for (let i = 0; i < 60; i++) {
  car2.update(0.016, { throttle: 1, steer: 0 });
  resolveCarOverlap(car2, rem2, performance.now(), 0.016);
}
check(car2.x < 60 + 15 + 9, `driving into a held car never passes it (x=${car2.x.toFixed(1)} < ${60 + 24})`);
check(car2.speed < 100, `grinding the flank bleeds speed (speed=${car2.speed.toFixed(1)})`);

// ---- side scrape: ejected sideways, forward motion preserved -----------------------
const car3 = newCar();
car3.speed = 200;
const rem3 = remote('p1', 25, 16, 0); // flank overlap on our right side
resolveCarOverlap(car3, rem3, now, 0.016);
check(car3.y < 16, `scraping a flank is ejected sideways (y=${car3.y.toFixed(1)})`);

// ---- no contact, stale or invisible remote: untouched ------------------------------
const car4 = newCar();
car4.speed = 250;
resolveCarOverlap(car4, remote('p1', 300, 0, 0), now, 0.016);
check(car4.x === 0 && car4.speed === 250, 'a distant car changes nothing');
const empty = new Remotes();
resolveCarOverlap(car4, empty, now, 0.016);
check(car4.x === 0 && car4.speed === 250, 'no remote cars (solo) change nothing');

// ---- frozen car at the finish line is solid ----------------------------------------
const car5 = newCar();
car5.speed = 400;
resolveCarOverlap(car5, remote('p1', 20, 0, 0, 'firetruck', true), now, 0.016);
check(car5.x < -20, 'a frozen car cannot be driven over either');

// ---- placedColliders rotates with the heading --------------------------------------
const cs = placedColliders(firetruck, 100, 50, Math.PI / 2);
check(cs.length === 2 && cs.some((c) => Math.abs(c.y - 50) > 17 && Math.abs(c.x - 100) < 1e-9), `colliders placed in world space (${cs.map((c) => c.x.toFixed(0) + ',' + c.y.toFixed(0)).join(' ')})`);

console.log(failures === 0 ? '\nSOLIDITY: all checks passed' : `\nSOLIDITY: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
