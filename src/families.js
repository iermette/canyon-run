// Vehicle families + the lottery roulette (point 1 of the feature spec).
//
// Fairness: the catalog is split into FIVE speed tiers ("paliers de vitesse"),
// cut contiguously by maxSpeed. Before choosing a car, the roulette draws one
// family at random; only the cars of that family are selectable. Every car
// belongs to exactly one family, so the split is a partition of the catalog.
//
// Headless-testable: FAMILIES is a pure derivation; Roulette is a pure
// animation state machine (no DOM, dt passed in).

import { VEHICLES } from './vehicles.js';

export const FAMILY_COUNT = 5;
export const FAMILY_NAMES = ['Éco', 'Sportives', 'GT', 'Supers', 'Hypercars'];
export const FAMILY_COLORS = ['#8fd3ff', '#7dff8a', '#ffd23e', '#ff9a6b', '#ff5a4e'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Cut the catalog (sorted by maxSpeed ascending) into 5 contiguous bands.
// The leftover cars (N % 5) go to the fastest tiers, so the slowest band is
// not starved and the bands stay contiguous by speed.
export const FAMILIES = (() => {
  const sorted = [...VEHICLES].sort((a, b) => a.stats.maxSpeed - b.stats.maxSpeed);
  const n = Math.floor(sorted.length / FAMILY_COUNT);
  const rem = sorted.length % FAMILY_COUNT;
  const out = [];
  let i = 0;
  for (let f = 0; f < FAMILY_COUNT; f++) {
    const size = n + (f >= FAMILY_COUNT - rem ? 1 : 0);
    const vehicles = sorted.slice(i, i + size);
    i += size;
    out.push({
      id: f,
      name: FAMILY_NAMES[f],
      color: FAMILY_COLORS[f],
      vehicles,
      min: vehicles.length ? vehicles[0].stats.maxSpeed : 0,
      max: vehicles.length ? vehicles[vehicles.length - 1].stats.maxSpeed : 0,
    });
  }
  return out;
})();

// Which family a vehicle id belongs to (-1 if unknown).
export function familyOf(vId) {
  return FAMILIES.findIndex((f) => f.vehicles.some((v) => v.id === vId));
}

// Random family index. `rng` is injectable so tests can be deterministic.
export function pickFamilyIndex(rng = Math.random) {
  const r = clamp(Number.isFinite(rng()) ? rng() : 0, 0, 0.999999);
  return Math.floor(r * FAMILY_COUNT) % FAMILY_COUNT;
}

// A wheel with `count` equal segments. The pointer sits at the top (12 o'clock).
// Segment f occupies wheel-local angle [f*seg, (f+1)*seg) measured clockwise
// from the top. With the wheel rotated by `angle` (radians, clockwise), the
// local angle showing at the top is (-angle) mod 2π, so:
//     current() = floor( ((-angle) mod 2π) / seg )
// and a spin lands on `target` by ending at an angle A with
//     (-A) mod 2π = target*seg + seg/2 (+ a little jitter).
export class Roulette {
  constructor(count = FAMILY_COUNT) {
    this.count = count;
    this.angle = 0;
    this.spinning = false;
    this.t = 0;
    this.dur = 0;
    this.from = 0;
    this.to = 0;
    this.result = null; // landed family id once the spin finishes
  }

  get seg() { return (2 * Math.PI) / this.count; }

  // Which family is under the pointer right now.
  current() {
    const top = ((-this.angle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return Math.floor(top / this.seg) % this.count;
  }

  // Begin spinning so the wheel lands on family `target`.
  spin(target, { dur = 2.6, rng = Math.random } = {}) {
    target = ((target % this.count) + this.count) % this.count;
    this.result = null;
    this.spinning = true;
    this.dur = dur;
    this.t = dur;
    this.from = this.angle;
    const jitter = (rng() - 0.5) * this.seg * 0.6;
    const center = -(target * this.seg + this.seg / 2) + jitter; // A mod 2π
    const m = Math.ceil((this.from + 3 * 2 * Math.PI - center) / (2 * Math.PI));
    this.to = center + m * 2 * Math.PI;
    if (this.to <= this.from) this.to += 2 * Math.PI;
    return target;
  }

  // Advance the spin. Returns the landed family id once it finishes,
  // otherwise null while still spinning.
  update(dt) {
    if (!this.spinning) return this.result;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0;
      this.angle = this.to;
      this.spinning = false;
      this.result = this.current();
      return this.result;
    }
    const k = 1 - this.t / this.dur;
    const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
    this.angle = this.from + (this.to - this.from) * e;
    return null;
  }
}
