import { VEHICLES } from './vehicles.js';

// Turbo: a racer holding Space behind another car goes a little faster until
// their nose (caput) is level with the nose of the car they are chasing.
// Target selection is pure geometry on the track (arc length of the noses),
// so it can be tested headless like the rest of the track logic.

export const TURBO_MAX_MULT = 1.15;   // boosted top speed while chasing
export const TURBO_ACCEL_MULT = 1.25; // boosted launch while chasing

// Forward reach of a vehicle from its centre, from its collision circles.
export function noseExtent(vehicle) {
  return Math.max(...vehicle.colliders.map((c) => c.dx + c.r));
}

// Arc position of a vehicle's nose ("caput"), projected back onto the road.
export function noseS(world, x, y, angle, vehicle) {
  const e = noseExtent(vehicle);
  return world.trackInfoAt(x + Math.cos(angle) * e, y + Math.sin(angle) * e).s;
}

// The closest remote whose nose is ahead of mine: { id, delta } (delta =
// nose-to-nose gap along the track), or null when nobody is being chased.
// Frozen cars (finished, parked at the line) are not chase targets.
export function chaseTarget(world, me, remotes, now) {
  const mine = noseS(world, me.x, me.y, me.angle, me.vehicle);
  let best = null;
  for (const c of remotes.cars.values()) {
    if (c.frozen) continue;
    const pos = remotes.sampleAt(c.id, now);
    if (!pos) continue;
    const vehicle = VEHICLES.find((v) => v.id === c.vehicleId) || VEHICLES[0];
    const delta = noseS(world, pos.x, pos.y, pos.a, vehicle) - mine;
    if (delta > 0 && (best === null || delta < best.delta)) best = { id: c.id, delta };
  }
  return best;
}
