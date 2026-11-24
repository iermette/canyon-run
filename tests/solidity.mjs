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

const me = VEHICLES[0];                                  // player default: single-circle nose car
const other = VEHICLES.find((v) => v.id === 'dodge-viper'); // two circles: nose + tail
const meR = me.colliders[0].r;
const tail = other.colliders.find((c) => c.dx < 0);
const sumR = meR + tail.r;
const now = performance.now();

function newCar(angle = 0) {
  return new Car({ carStart: () => ({ x: 0, y: 0, angle }) });
}
function remote(id, x, y, a, vehicleId = 'dodge-viper', frozen = false) {
  const r = new Remotes();
  r.setMeta(id, { name: 'X', color: '#fff', vehicleId });
  r.update(id, { x, y, a, s: 0 });
  if (frozen) r.cars.get(id).frozen = true;
  return r;
}
// Their tail circle in world space for a remote parked at (x, y, a).
const tailAt = (x, y, a) => ({
  x: x + tail.dx * Math.cos(a) - tail.dy * Math.sin(a),
  y: y + tail.dx * Math.sin(a) + tail.dy * Math.cos(a),
});

// ---- head-on overlap: ejected apart, approach velocity killed ----------------------
const X1 = (meR + 2) - tail.dx; // their tail circle lands 2u inside our nose circle
const car = newCar();
car.speed = 300;
const rem = remote('p1', X1, 0, 0);
const contacts = resolveCarOverlap(car, rem, now, 0.016);
const t1 = tailAt(X1, 0, 0);
check(contacts > 0, `overlap detected (${contacts} contact(s))`);
check(car.x < 0, `ejected backwards out of the penetration (x=${car.x.toFixed(1)})`);
const gap = Math.hypot(car.x - t1.x, car.y - t1.y);
check(gap >= sumR - SOLID_SOFT, `residual penetration <= softness (gap=${gap.toFixed(1)})`);
check(car.speed < 60, `approach velocity killed (speed=${car.speed.toFixed(1)})`);

// ---- repeated frames: never drives through ----------------------------------------
const X2 = 60;
const car2 = newCar();
for (let i = 0; i < 60; i++) {
  car2.update(0.016, { throttle: 1, steer: 0 });
  resolveCarOverlap(car2, remote('p1', X2, 0, 0), performance.now(), 0.016);
}
const stopX = X2 + tail.dx - meR; // resting distance: nose circle touches their tail
check(car2.x < stopX + 2, `driving into a held car never passes it (x=${car2.x.toFixed(1)} < ${stopX + 2})`);
check(car2.speed < 100, `grinding the flank bleeds speed (speed=${car2.speed.toFixed(1)})`);

// ---- side scrape: ejected sideways, forward motion preserved -----------------------
const car3 = newCar();
car3.speed = 200;
const rem3 = remote('p1', 17, 20, 0); // tail at (5, 20): flank overlap on our right side
resolveCarOverlap(car3, rem3, now, 0.016);
check(car3.y < 10, `scraping a flank is ejected sideways (y=${car3.y.toFixed(1)})`);
check(car3.x > -3, `and not shoved backwards (x=${car3.x.toFixed(1)})`);

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
resolveCarOverlap(car5, remote('p1', 20, 0, 0, 'dodge-viper', true), now, 0.016);
check(car5.x < -10, `a frozen car cannot be driven over either (x=${car5.x.toFixed(1)})`);

// ---- placedColliders rotates with the heading --------------------------------------
const cs = placedColliders(other, 100, 50, Math.PI / 2);
check(cs.length === 2 && cs.every((c) => Math.abs(c.x - 100) < 1e-9 && Math.abs(c.y - 50) > 10),
  `colliders placed in world space (${cs.map((c) => c.x.toFixed(0) + ',' + c.y.toFixed(0)).join(' ')})`);

console.log(failures === 0 ? '\nSOLIDITY: all checks passed' : `\nSOLIDITY: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
