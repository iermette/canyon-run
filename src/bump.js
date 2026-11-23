import { VEHICLES } from './vehicles.js';

// Rear-end shoves between cars: the pushing client detects the contact
// (its nose circle vs the target's tail circle), relays the shove through
// the server, and the hit player applies the knockback to their own car.
// The knockback is a transient velocity along the collision vector that
// decays exponentially — it never touches speed or heading directly.

export const BUMP_STRENGTH = 0.55;    // knockback velocity vs pusher speed
export const PUSHER_SLOWDOWN = 0.75;  // pusher speed multiplier on impact
export const BUMP_COOLDOWN_MS = 500;  // one push per pair per this window
export const KNOCK_TAU = 0.35;        // seconds, exponential decay of the shove
const REAR_ARC = 0.4;                 // the contact must sit on the target's rear

export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];

// The vehicle's frontmost collider circle, placed in world space.
export function frontCircle(vehicle, x, y, angle) {
  const c = vehicle.colliders.reduce((a, b) => (b.dx > a.dx ? b : a));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x + c.dx * cos - c.dy * sin, y: y + c.dx * sin + c.dy * cos, r: c.r };
}

// The vehicle's rearmost collider circle, placed in world space.
export function rearCircle(vehicle, x, y, angle) {
  const c = vehicle.colliders.reduce((a, b) => (b.dx < a.dx ? b : a));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x + c.dx * cos - c.dy * sin, y: y + c.dx * sin + c.dy * cos, r: c.r };
}

// `target` is a sampled remote position {id, x, y, a}; `cooldowns` is a
// Map<id, timestampMs> owned by the caller. Returns {dirX, dirY, v} — the
// collision vector (nose -> tail, normalized) and the knockback velocity —
// or null when there is no push (no contact, side/front hit, cooldown).
export function contactBump(car, target, vehicle, now, cooldowns) {
  if (car.speed <= 0) return null; // rolling back or stopped: not a shove
  const last = cooldowns.get(target.id);
  if (last !== undefined && now - last < BUMP_COOLDOWN_MS) return null;

  const nose = frontCircle(car.vehicle, car.x, car.y, car.angle);
  const tail = rearCircle(vehicle, target.x, target.y, target.a);
  const dist = Math.hypot(target.x - nose.x, target.y - nose.y) || 1;
  // Contact gate: our nose touches their tail circle. The push vector points
  // nose -> their center, which stays well defined even in a deep overlap.
  if (Math.hypot(tail.x - nose.x, tail.y - nose.y) > nose.r + tail.r) return null;
  const nx = (target.x - nose.x) / dist, ny = (target.y - nose.y) / dist;
  // A shove only counts when we hit their rear — a side or head-on touch
  // leaves the vector off their heading and does nothing.
  if (nx * Math.cos(target.a) + ny * Math.sin(target.a) < REAR_ARC) return null;

  cooldowns.set(target.id, now);
  return { dirX: nx, dirY: ny, v: car.speed * BUMP_STRENGTH };
}
