// Water rule: two diagonally opposite wheels in the drink = "plouf!" and the
// player goes back to the start line. One wheel, one axle or one side of the
// car is survivable (you can claw your way back onto the deck).
import { createWorld } from '../src/world.js';
import { Car } from '../src/car.js';
import { waterContact } from '../src/collision.js';
import { GameState, State } from '../src/gameState.js';
import { VEHICLES } from '../src/vehicles.js';
import { SPLASH_MS } from '../src/effects.js';

let fails = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${extra ? ` (${extra})` : ''}`); }
}

const world = createWorld(0); // the lake is crossed by a bridge; water = lake minus road
const sports = VEHICLES[0];

// --- 1. the rule itself, on a flat plane where we decide what is water ------
// Sports wheels (angle 0 at the origin): FL(13,-10.5) FR(13,10.5) RL(-13,-10.5) RR(-13,10.5)
const plane = (test) => ({
  water: { x: -200, y: -200, w: 400, h: 400 },
  inWater: test,
});
const at = (car, x, y, angle) => { car.x = x; car.y = y; car.angle = angle; return car; };

// The world is procedural, so instead of hard-coding coordinates that depend
// on the layout we search the real water for the placements we need:
//   deep  – the water point farthest from any road (every wheel in the drink)
//   shore – points hugging the shoreline where one wheel / one axle is in
const wrect = world.water;
const marginAt = (x, y) => {
  const info = world.trackInfoAt(x, y);
  return info.dist - info.section.width / 2 - 10;
};
let deep = null;
for (let i = 1; i < 60; i++) for (let j = 1; j < 60; j++) {
  const x = wrect.x + wrect.w * i / 60, y = wrect.y + wrect.h * j / 60;
  if (!world.inWater(x, y)) continue;
  const m = marginAt(x, y);
  if (m > (deep?.m ?? -1)) deep = { x, y, m };
}
let shoreOne = null, shoreAxle = null;
for (let i = 0; i <= 140 && !(shoreOne && shoreAxle); i++)
  for (let j = 0; j <= 140; j++) {
    const x = wrect.x + wrect.w * i / 140, y = wrect.y + wrect.h * j / 140;
    if (!world.inWater(x, y)) continue;
    const m = marginAt(x, y);
    if (m < 0 || m > 30) continue; // shoreline band only
    for (const a of [0, Math.PI / 2, Math.PI / 4, 3 * Math.PI / 4]) {
      const r = waterContact(at(new Car(world, sports), x, y, a), world);
      if (r.wet === 1 && !shoreOne) shoreOne = { x, y, a };
      if (r.wet === 2 && !r.sunk && !shoreAxle) shoreAxle = { x, y, a };
    }
  }

const probe = at(new Car(world, sports), 0, 0, 0);
check('diagonal FL+RR = plouf',
  waterContact(probe, plane((x, y) => (x > 0 && y < 0) || (x < 0 && y > 0))).sunk === true);
check('one whole side = survivable',
  (() => { const r = waterContact(probe, plane((_x, y) => y > 0)); return r.wet === 2 && r.sunk === false; })());
check('one whole axle = survivable',
  (() => { const r = waterContact(probe, plane((x, _y) => x > 0)); return r.wet === 2 && r.sunk === false; })());
check('three wheels = plouf',
  waterContact(probe, plane((x, y) => !(x < 0 && y < 0))).sunk === true);

// --- 2. every vehicle, dropped deep in the lake (far from the bridge) --------
check('lake has deep water', deep !== null, 'no in-water point found');
if (deep) {
  let allAfloat = true, culprit = '';
  for (const v of VEHICLES) {
    const r = waterContact(at(new Car(world, v), deep.x, deep.y, 0), world);
    if (!(r.wet === 4 && r.sunk)) { allAfloat = false; culprit = `${v.name} wet=${r.wet}`; break; }
  }
  check('every vehicle afloat deep in the lake', allAfloat, culprit);
}

// --- 3. dry ground and far-away broad phase ---------------------------------
{
  const start = world.carStart();
  const car = at(new Car(world, sports), start.x, start.y, start.angle);
  const r = waterContact(car, world);
  check('start line is dry', r.wet === 0 && r.sunk === false, `wet=${r.wet}`);
}

// --- 4. creeping over the shoreline ------------------------------------------
// We searched the real shoreline (hugging the road) for a car with exactly
// one wheel in and one with a whole axle in — both survivable. A car dropped
// deep in the lake has all four wheels in — plouf.
check('found a one-wheel shoreline', shoreOne !== null);
check('found an axle shoreline', shoreAxle !== null);
if (shoreOne) {
  const r = waterContact(at(new Car(world, sports), shoreOne.x, shoreOne.y, shoreOne.a), world);
  check('one wheel in = survivable', r.wet === 1 && !r.sunk, `wet=${r.wet}`);
}
if (shoreAxle) {
  const r = waterContact(at(new Car(world, sports), shoreAxle.x, shoreAxle.y, shoreAxle.a), world);
  check('one axle in = survivable', r.wet === 2 && !r.sunk, `wet=${r.wet}`);
}
if (deep) {
  const r = waterContact(at(new Car(world, sports), deep.x, deep.y, 0), world);
  check('all four wheels in = plouf', r.wet === 4 && r.sunk, `wet=${r.wet}`);
}

// --- 5. a plunge on the bridge sends you back to the start line -------------
{
  const start = world.carStart();
  const car = new Car(world, sports);
  const gs = new GameState(car);
  car.x = 4700; car.y = -1700; car.angle = Math.PI / 2; // on the deck, nose south
  gs.state = State.PLAYING;
  gs.time = 12.5;

  // drive south off the end of the bridge into the lake, full throttle
  let splashed = null;
  for (let i = 0; i < 600 && !splashed; i++) {
    car.update(1 / 120, { throttle: 1, steer: 0.6 });
    const r = waterContact(car, world);
    if (r.sunk) splashed = { ...r, x: car.x, y: car.y };
  }
  check('driving off the bridge = plouf', splashed !== null, JSON.stringify(waterContact(car, world)));

  gs.splash({ x: car.x, y: car.y });
  check('splash puts the race on hold', gs.state === State.CRASHED);
  check('splash spawns the plouf! effect', gs.fx !== null);

  let sinking = 0;
  for (let i = 0; i < 1200 && gs.state === State.CRASHED; i++) {
    gs.update(1 / 120, world);
    sinking = Math.max(sinking, car.sinking);
  }
  check('the car slips under', sinking > 0.99, `max sinking=${sinking.toFixed(2)}`);
  check('back on the grid', gs.state === State.PLAYING &&
    Math.abs(car.x - start.x) < 1 && Math.abs(car.y - start.y) < 1,
    `at ${car.x.toFixed(0)},${car.y.toFixed(0)} want ${start.x},${start.y}`);
  check('car surfaced again', car.sinking === 0);
  check('timer keeps running through the swim', gs.time > 12.5, `t=${gs.time.toFixed(1)}`);

  // the effect is done before the respawn, and forgets itself afterwards
  const fx = gs.fx;
  check('plouf! expires', fx.expired(fx.born + SPLASH_MS + 10) && !fx.expired(fx.born));
}

// --- 6. the plain obstacle crash still works --------------------------------
{
  const car = new Car(world, sports);
  const gs = new GameState(car);
  const start = world.carStart();
  gs.state = State.PLAYING;
  gs.crash({ x: 100, y: 100 });
  check('crash stays a crash', gs.state === State.CRASHED && gs.fx === null && gs.crashKind === 'crash');
  for (let i = 0; i < 400 && gs.state === State.CRASHED; i++) gs.update(1 / 120, world);
  check('crash respawns at the start too', car.x === start.x && car.y === start.y);
  check('crash never sinks the car', car.sinking === 0);
}

console.log(fails ? `\n${fails} failure(s)` : '\nall water checks passed');
process.exit(fails ? 1 : 0);
