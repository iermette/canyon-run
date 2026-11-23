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

const world = createWorld(0); // classic: the lake sits far from every road
const lake = { x: world.water.x + world.water.w / 2, y: world.water.y + world.water.h / 2 };
const sports = VEHICLES[0];

// --- 1. the rule itself, on a flat plane where we decide what is water ------
// Sports wheels (angle 0 at the origin): FL(13,-10.5) FR(13,10.5) RL(-13,-10.5) RR(-13,10.5)
const plane = (test) => ({
  water: { x: -200, y: -200, w: 400, h: 400 },
  inWater: test,
});
const at = (car, x, y, angle) => { car.x = x; car.y = y; car.angle = angle; return car; };

const probe = at(new Car(world, sports), 0, 0, 0);
check('diagonal FL+RR = plouf',
  waterContact(probe, plane((x, y) => (x > 0 && y < 0) || (x < 0 && y > 0))).sunk === true);
check('one whole side = survivable',
  (() => { const r = waterContact(probe, plane((x, y) => y > 0)); return r.wet === 2 && r.sunk === false; })());
check('one whole axle = survivable',
  (() => { const r = waterContact(probe, plane((x, y) => x > 0)); return r.wet === 2 && r.sunk === false; })());
check('three wheels = plouf',
  waterContact(probe, plane((x, y) => !(x < 0 && y < 0))).sunk === true);

// --- 2. every vehicle, dropped in the middle of the lake --------------------
for (const v of VEHICLES) {
  const car = at(new Car(world, v), lake.x, lake.y, 0);
  const r = waterContact(car, world);
  check(`${v.name.padEnd(14)} afloat in the lake`, r.sunk && r.wet === 4, `wet=${r.wet}`);
}

// --- 3. dry ground and far-away broad phase ---------------------------------
{
  const start = world.carStart();
  const car = at(new Car(world, sports), start.x, start.y, start.angle);
  const r = waterContact(car, world);
  check('start line is dry', r.wet === 0 && r.sunk === false, `wet=${r.wet}`);
}

// --- 4. creeping over the shoreline ----------------------------------------
// The lake's bottom edge is y = -3200; a 45-degree car crossing it gets wet
// wheel by wheel: 1 wheel, then the front axle -> both survivable.
{
  const A = Math.PI / 4;
  const one = waterContact(at(new Car(world, sports), 2200, -3210, A), world);
  check('one wheel in = survivable', one.wet === 1 && one.sunk === false, `wet=${one.wet}`);
  const axle = waterContact(at(new Car(world, sports), 2200, -3200, A), world);
  check('front axle in = survivable', axle.wet === 2 && axle.sunk === false, `wet=${axle.wet}`);
  const in4 = waterContact(at(new Car(world, sports), 2200, -3170, A), world);
  check('all four wheels in = plouf', in4.wet === 4 && in4.sunk === true, `wet=${in4.wet}`);
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
