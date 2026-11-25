// NOS — the short, violent nitrous injection (point 2 of the feature spec).
// Two charges per race. While an injection runs the car accelerates far beyond
// its normal ceiling, and steering is almost locked (NOS_STEER_MULT) so a car
// fired in a corner shoots straight out of the road. There is NO activation
// refusal: the player decides; the violence is the consequence.
//
// Headless-testable: pure state machine, no DOM, no timers (dt is passed in).

export const NOS_CHARGES = 2;      // two injections per race, then it's gone
export const NOS_DURATION = 1.15;  // seconds an injection lasts
export const NOS_ACCEL_MULT = 5.5; // x normal acceleration while firing
export const NOS_CAP_MULT = 1.48;  // x maxSpeed ceiling while firing
export const NOS_STEER_MULT = 0.12;// steering effectiveness (nearly locked)

export class NOS {
  constructor() {
    this.charges = NOS_CHARGES;
    this.active = false;
    this.timer = 0;
  }

  // Fire one injection. Returns true if it started. No-op while already
  // firing or when both charges are spent.
  activate() {
    if (this.active || this.charges <= 0) return false;
    this.charges -= 1;
    this.active = true;
    this.timer = NOS_DURATION;
    return true;
  }

  update(dt) {
    if (this.active) {
      this.timer -= dt;
      if (this.timer <= 0) { this.active = false; this.timer = 0; }
    }
  }

  // True once both charges are spent and the last injection has ended.
  get exhausted() { return this.charges <= 0 && !this.active; }
}
