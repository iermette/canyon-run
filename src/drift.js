// Drift / slide (point 5 of the feature spec): a car that reaches a corner
// too fast loses lateral grip and slides. How fast it starts to slide depends
// on the vehicle's handling (turnRate) — better cars hold more speed. The
// result is a 0..1 "drift amount" that Car.update turns into a reduced turn
// rate (understeer) and an outward lateral slide.
//
// Pure function so it can be unit-tested without a world or a DOM.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Target drift amount (0..1) for a given state.
 * @param {number} speed   longitudinal speed in u/s (sign matters only via |.|)
 * @param {number} steer   steering input -1..1 (0 = straight)
 * @param {number} turnRate the vehicle's handling stat (rad/s); higher = more grip
 * @param {boolean} [braking] whether the brake is applied (handbrake helps initiate)
 */
export function driftTarget({ speed, steer, turnRate, braking = false }) {
  const demand = Math.abs(steer || 0);
  const sp = Math.abs(speed || 0);
  if (demand < 0.15 || sp < 40) return 0; // no turning or too slow -> no slide

  // Speed at which this particular car starts to lose grip. Better handling
  // (higher turnRate) slides later; a 3.3 rad/s car holds ~30% more than a 1.6.
  const gripHold = 120 + turnRate * 55;
  let t = clamp((sp - gripHold) / 150, 0, 1) * (0.35 + 0.65 * demand);
  if (braking) t = Math.min(1, t * 1.35); // handbrake kicks the rear out
  return t;
}
