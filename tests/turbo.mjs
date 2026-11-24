// Turbo unit tests: chase-target selection on the track (nose-level cut-off)
// and the boosted speed ceilings in Car.update. No browser needed.
import { createWorld, pointAt } from '../src/world.js';
import { Car } from '../src/car.js';
import { VEHICLES } from '../src/vehicles.js';
import { Remotes } from '../src/remotes.js';
import { chaseTarget, noseExtent, TURBO_MAX_MULT } from '../src/turbo.js';

let fails = 0;
function ok(cond, msg) {
  console.log(`${cond ? '  ok  ' : ' FAIL '}${msg}`);
  if (!cond) fails++;
  return !!cond;
}

const world = createWorld(0); // classic hand-made track
const sports = VEHICLES.find((v) => v.id === 'mclaren-f1');
const taxi = VEHICLES.find((v) => v.id === 'peugeot-205-gti');
const car = new Car(world, sports);
const startS = world.trackInfoAt(car.x, car.y).s;

// One remote parked on the centerline `ahead` units past my centre.
function aheadRemote(ahead, veh = 'peugeot-205-gti', extra) {
  const remotes = new Remotes();
  remotes.setMeta('A', { name: 'A', color: '#fff', vehicleId: veh });
  const p = pointAt(world.cl, startS + ahead);
  remotes.update('A', { x: p.x, y: p.y, a: p.angle, s: startS + ahead });
  if (extra) extra(remotes);
  return remotes;
}

const now = performance.now();

{ // a car 150 ahead is a chase target, gap measured nose to nose
  const t = chaseTarget(world, car, aheadRemote(150), now);
  ok(t && t.id === 'A', 'car ahead -> chase target');
  const expected = 150 + noseExtent(taxi) - noseExtent(sports);
  ok(t && Math.abs(t.delta - expected) < 30, `gap is nose-to-nose (~${expected.toFixed(0)}, got ${t && t.delta.toFixed(0)})`);
}
{ // noses level or past: nothing left to catch -> no turbo
  ok(chaseTarget(world, car, aheadRemote(noseExtent(sports) - noseExtent(taxi) - 2), now) === null, 'nose level or ahead of theirs -> no target');
}
{ // a car fully behind me is not someone I am chasing
  ok(chaseTarget(world, car, aheadRemote(-20), now) === null, 'car behind -> no target');
}
{ // finished racers sit frozen at the line: not chase targets
  ok(chaseTarget(world, car, aheadRemote(150, 'taxi', (r) => { r.cars.get('A').frozen = true; }), now) === null, 'frozen (finished) car -> no target');
}
{ // two cars ahead: the closest one is the target
  const r = aheadRemote(150, 'taxi', (rr) => {
    rr.setMeta('B', { name: 'B', vehicleId: 'dodge-viper' });
    const p = pointAt(world.cl, startS + 300);
    rr.update('B', { x: p.x, y: p.y, a: p.angle, s: startS + 300 });
  });
  const t2 = chaseTarget(world, car, r, now);
  ok(t2 && t2.id === 'A', 'closest car ahead wins the target');
}
{
  ok(chaseTarget(world, car, new Remotes(), now) === null, 'no cars around (solo) -> no target');
}

// ---- turbo physics in Car.update ----
{
  const dt = 1 / 240;
  const plain = new Car(world, sports);
  const boosted = new Car(world, sports);
  for (let i = 0; i < 240 * 4; i++) { // 4 s at full throttle
    plain.update(dt, { throttle: 1 });
    boosted.update(dt, { throttle: 1, turbo: true });
  }
  ok(boosted.speed > plain.speed * 1.1, `turbo pulls ahead (${boosted.speed.toFixed(0)} vs ${plain.speed.toFixed(0)} u/s)`);
  ok(boosted.speed <= sports.stats.maxSpeed * TURBO_MAX_MULT + 1e-6, 'never above the boosted ceiling');

  // Cut-off eases back to the normal ceiling instead of clamping hard.
  boosted.speed = 450;
  boosted.update(dt, { throttle: 0 });
  ok(boosted.speed > 420, `turbo cut-off eases down (${boosted.speed.toFixed(1)}, not a jump to ${sports.stats.maxSpeed})`);
}

if (fails) { console.log(`\nTURBO: ${fails} checks failed`); process.exit(1); }
console.log('\nTURBO: all checks passed');
