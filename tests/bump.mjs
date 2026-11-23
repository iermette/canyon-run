// Rear-end shove unit tests: rear/side/head-on geometry, cooldown, knockback.
import { contactBump, frontCircle, rearCircle, vehicleById, BUMP_STRENGTH, BUMP_COOLDOWN_MS } from '../src/bump.js';
import { Car } from '../src/car.js';
import { VEHICLES } from '../src/vehicles.js';

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

const me = VEHICLES.find((v) => v.id === 'sports');   // one circle, r=15
const van = VEHICLES.find((v) => v.id === 'firetruck'); // tail circle at dx=-18, r=9
const car = { x: 0, y: 0, angle: 0, speed: 300, vehicle: me };
const cooldowns = new Map();
const NOW = 10000;

// The van's tail circle must touch my nose circle: tail center within r+r.
const nose = frontCircle(me, 0, 0, 0);
const tailOf = (x, y, a) => rearCircle(van, x, y, a);
const sumR = nose.r + tailOf(0, 0, 0).r;

// ---- rear hit straight ahead -----------------------------------------------------
// Tail center 3 units before full overlap, van pointing the same way as me.
const hitX = nose.x + (sumR - 3) - tailOf(0, 0, 0).x;
const bump = contactBump(car, { id: 'p2', x: hitX, y: 0, a: 0 }, van, NOW, cooldowns);
check(bump !== null, `rear contact pushes (van at x=${hitX.toFixed(1)})`);
check(bump && bump.dirX > 0.9 && Math.abs(bump.dirY) < 0.1, `push along the collision vector (dir ${bump && bump.dirX.toFixed(2)},${bump && bump.dirY.toFixed(2)})`);
check(bump && Math.abs(bump.v - 300 * BUMP_STRENGTH) < 1e-9, `strength proportional to my speed (v=${bump && bump.v})`);

// ---- cooldown per pair -------------------------------------------------------------
check(contactBump(car, { id: 'p2', x: hitX, y: 0, a: 0 }, van, NOW + 100, cooldowns) === null, 'same pair suppressed during the cooldown');
check(contactBump(car, { id: 'p2', x: hitX, y: 0, a: 0 }, van, NOW + BUMP_COOLDOWN_MS + 1, cooldowns) !== null, 'same pair can push again after the cooldown');

// ---- side and head-on touches -------------------------------------------------------
check(contactBump(car, { id: 'p3', x: 8, y: 21, a: 0 }, van, NOW + 2000, cooldowns) === null, 'side touch does not push');
check(contactBump(car, { id: 'p4', x: 5, y: 0, a: Math.PI }, van, NOW + 3000, cooldowns) === null, 'head-on touch does not push');

// ---- no contact, no rolling back ----------------------------------------------------
check(contactBump(car, { id: 'p5', x: 200, y: 0, a: 0 }, van, NOW + 4000, cooldowns) === null, 'no contact, no push');
check(contactBump({ ...car, speed: -100 }, { id: 'p6', x: hitX, y: 0, a: 0 }, van, NOW + 5000, cooldowns) === null, 'rolling back does not push');

// ---- knockback integration on the real Car ------------------------------------------
const real = new Car({ carStart: () => ({ x: 0, y: 0, angle: 0 }) });
real.applyKnock(1, 0, 200);
real.update(0.1, { throttle: 0, steer: 0 });
check(real.x > 10 && real.x < 18, `shoved forward by the knockback (x=${real.x.toFixed(1)})`);
check(Math.abs(real.speed) < 1e-9, 'the shove leaves speed untouched');
check(real.knockX > 120 && real.knockX < 180, `the shove decays (knockX=${real.knockX.toFixed(1)} after 100ms)`);

check(vehicleById('nope').id === VEHICLES[0].id, 'unknown vehicle id falls back to the first vehicle');

console.log(failures === 0 ? '\nBUMP: all checks passed' : `\nBUMP: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
