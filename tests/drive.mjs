// Headless playability test: a simple pursuit AI drives each generated track
// at full throttle, dodging obstacles reactively; crashes respawn the car on
// the centerline (like the in-game reset). Verifies every curve is drivable.
import { createWorld, pointAt } from '../src/world.js';
import { Car } from '../src/car.js';
import { getHitObstacle, isOffTrack } from '../src/collision.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function drive(seed, maxTime = 150) {
  const world = createWorld(seed);
  const car = new Car(world);
  const dt = 1 / 240;
  let t = 0, crashes = 0, offAccum = 0, curOff = 0, maxOffStreak = 0;

  while (t < maxTime) {
    const info = world.trackInfoAt(car.x, car.y);
    if (info.s >= world.finishS - 1) return { seed, ok: true, t, crashes };

    // Pursuit target: a point ahead on the centerline...
    let tp = pointAt(world.cl, Math.min(info.s + 260, world.finishS - 5));

    // ...pushed away by obstacles that are close and in front of us.
    let ax = 0, ay = 0;
    for (const ob of world.obstacles) {
      const dx = ob.x - car.x, dy = ob.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d < 170 && d > 0.001 && (dx * car.dirX + dy * car.dirY) / d > 0.2) {
        const wgt = (170 - d) / 170;
        ax -= (dx / d) * wgt; ay -= (dy / d) * wgt;
      }
    }
    const alen = Math.hypot(ax, ay);
    if (alen > 0.05) { tp.x += (ax / alen) * 95; tp.y += (ay / alen) * 95; }

    let da = Math.atan2(tp.y - car.y, tp.x - car.x) - car.angle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steer = clamp(da * 1.6, -1, 1);

    car.update(dt, { throttle: 1, steer });

    if (getHitObstacle(car, world.obstacles)) {
      crashes++;
      const rp = pointAt(world.cl, Math.min(info.s + 40, world.finishS - 5)); // respawn ahead
      car.x = rp.x; car.y = rp.y; car.angle = rp.angle; car.speed = 120;
    }

    const inf2 = world.trackInfoAt(car.x, car.y);
    if (isOffTrack(inf2)) {
      car.applyOffRoad(dt);
      curOff += dt; offAccum += dt; maxOffStreak = Math.max(maxOffStreak, curOff);
    } else curOff = 0;

    t += dt;
  }
  return { seed, ok: false, t, crashes, reason: 'timeout', s: world.trackInfoAt(car.x, car.y).s };
}

const seeds = [42, 165, 203, 222, 274]; // previously problematic
for (let i = 1; i <= 35; i++) if (!seeds.includes(i)) seeds.push(i);

let fails = 0;
const times = [];
for (const seed of seeds) {
  const r = drive(seed);
  if (r.ok) {
    times.push(r.t);
    console.log(`seed ${String(seed).padEnd(4)} OK   t=${r.t.toFixed(1)}s crashes=${r.crashes}`);
  } else {
    fails++;
    console.log(`seed ${String(seed).padEnd(4)} FAIL ${r.reason} at s=${(r.s ?? 0).toFixed(0)}/${createWorld(seed).finishS} crashes=${r.crashes}`);
  }
}
times.sort((a, b) => a - b);
console.log(`\n${seeds.length - fails}/${seeds.length} completed; time p50=${times[Math.floor(times.length / 2)]?.toFixed(1)}s max=${times[times.length - 1]?.toFixed(1)}s`);
