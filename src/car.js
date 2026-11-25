import { clamp } from './utils.js';
import { VEHICLES } from './vehicles.js';
import { TURBO_MAX_MULT, TURBO_ACCEL_MULT } from './turbo.js';
import { KNOCK_TAU } from './bump.js';
import { NOS, NOS_ACCEL_MULT, NOS_CAP_MULT, NOS_STEER_MULT } from './nos.js';
import { driftTarget } from './drift.js';

const DRAG = 1.4;           // proportional drag, per second
const ROLL_FRICTION = 70;   // rolling resistance with no input, units/s^2
const GRIP_SPEED = 140;     // steering starts biting at this speed

export class Car {
  constructor(world, vehicle = VEHICLES[0]) {
    this.world = world;
    this.vehicle = vehicle;
    this.nos = new NOS();       // two charges per race (point 2)
    this.drift = 0;             // 0..1 current slide amount (point 5)
    this.latV = 0;              // outward lateral slide velocity, u/s
    this.braking = false;       // brake applied (rear lights) — point 6
    this.turnLeft = false;      // left turn signal held (X) — point 3
    this.turnRight = false;     // right turn signal held (V) — point 3
    this.flashTimer = 0;        // headlight flash remaining, s (C) — point 3
    this.reset();
  }

  setVehicle(vehicle) {
    this.vehicle = vehicle;
  }

  reset() {
    const start = this.world.carStart();
    this.x = start.x;
    this.y = start.y;
    this.angle = start.angle; // heading, radians (0 = +x)
    this.speed = 0;
    this.sinking = 0; // 0..1, set by the splash reset (the car slips under)
    this.knockX = 0;  // shove from a car bump (see bump.js), decays in update
    this.knockY = 0;
    this.drift = 0;
    this.latV = 0;
    this.braking = false;
    this.turnLeft = false;
    this.turnRight = false;
    this.flashTimer = 0;
  }

  // Restore the two NOS charges for a fresh race (called by main.js at start).
  resetNOS() { this.nos = new NOS(); }

  // Trigger the headlight flash for `duration` seconds (point 3, key C).
  flashHeadlights(duration = 1.2) { this.flashTimer = Math.max(this.flashTimer, duration); }

  get dirX() { return Math.cos(this.angle); }
  get dirY() { return Math.sin(this.angle); }

  // A rear-end shove (relayed 'push'): transient velocity along the collision
  // vector, added to the position integration and decaying exponentially.
  applyKnock(dirX, dirY, v) {
    this.knockX += dirX * v;
    this.knockY += dirY * v;
  }

  update(dt, drive) {
    const s = this.vehicle.stats;
    const turbo = !!drive.turbo; // catching a car ahead (see turbo.js)
    const nos = this.nos.active; // NOS injection firing (see nos.js)
    const braking = drive.throttle < 0 && this.speed > 5; // forward + brake

    // ---- longitudinal (NOS multiplies the acceleration, point 2) ----
    const accelMult = (turbo ? TURBO_ACCEL_MULT : 1) * (nos ? NOS_ACCEL_MULT : 1);
    if (drive.throttle > 0) this.speed += s.accel * accelMult * dt;
    else if (drive.throttle < 0) this.speed -= s.brake * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), ROLL_FRICTION * dt);

    this.speed -= this.speed * DRAG * dt; // drag always opposes motion

    // ---- ceiling: NOS > turbo > stock (hard while boosting, ease on cut-off) ----
    const cap = nos ? s.maxSpeed * NOS_CAP_MULT : turbo ? s.maxSpeed * TURBO_MAX_MULT : s.maxSpeed;
    if (this.speed > cap) {
      if (nos || turbo) this.speed = cap; // boost holds its ceiling, never overshoots
      else this.speed += (cap - this.speed) * Math.min(1, 3 * dt); // soft ease back
    } else {
      this.speed = clamp(this.speed, s.reverseMax, cap);
    }

    // ---- drift / slide when the corner is entered too fast (point 5) ----
    const target = driftTarget({ speed: this.speed, steer: drive.steer, turnRate: s.turnRate, braking });
    this.drift += (target - this.drift) * Math.min(1, 6 * dt);
    if (this.drift < 0.001) this.drift = 0;
    // outward lateral slide builds while drifting and decays when it stops
    const slide = this.drift * Math.abs(this.speed) * 0.5 * (drive.steer >= 0 ? -1 : 1);
    this.latV += (slide - this.latV) * Math.min(1, 5 * dt);
    if (Math.abs(this.latV) < 0.4) this.latV = 0;

    // ---- steering: understeers while sliding, nearly locked under NOS ----
    const grip = clamp(Math.abs(this.speed) / GRIP_SPEED, 0, 1) * (this.speed < 0 ? -1 : 1);
    const steerEff = (1 - 0.5 * this.drift) * (nos ? NOS_STEER_MULT : 1);
    this.angle += drive.steer * s.turnRate * grip * steerEff * dt;

    // ---- knockback decay + integrate (heading + lateral slide) ----
    const decay = Math.exp(-dt / KNOCK_TAU); // the shove fades out quickly
    this.knockX *= decay;
    this.knockY *= decay;
    const lat = this.latV || 0;
    this.x += (this.dirX * this.speed + this.knockX - Math.sin(this.angle) * lat) * dt;
    this.y += (this.dirY * this.speed + this.knockY + Math.cos(this.angle) * lat) * dt;

    // ---- timers + light state for the painter ----
    this.nos.update(dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.braking = braking;
  }

  // Heavy slowdown when off the road surface (grass, water, tunnel walls).
  applyOffRoad(dt) {
    const cap = Math.sign(this.speed) * Math.min(Math.abs(this.speed), 80);
    this.speed += (cap - this.speed) * Math.min(1, 5 * dt);
  }

  // Collision circles in world space. Long vehicles use two small circles
  // (nose + tail) so the hitbox follows their shape instead of one big blob.
  colliders() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    return this.vehicle.colliders.map((c) => ({
      x: this.x + c.dx * cos - c.dy * sin,
      y: this.y + c.dx * sin + c.dy * cos,
      r: c.r,
    }));
  }

  // Wheel contact points in world space, ordered front-left, front-right,
  // rear-left, rear-right (so 0&3 and 1&2 are the diagonal pairs).
  wheelContacts() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    return this.vehicle.wheelPts.map((w) => ({
      x: this.x + w.dx * cos - w.dy * sin,
      y: this.y + w.dx * sin + w.dy * cos,
    }));
  }

  // Rear-wheel world positions — where the drift smoke is emitted from.
  rearWheels() {
    const pts = this.wheelContacts();
    return [pts[2], pts[3]];
  }

  draw(ctx, now = 0) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.sinking > 0) { // going under: shrink and fade behind the splash
      const k = 1 - 0.65 * this.sinking;
      ctx.globalAlpha = Math.max(0, 1 - 1.15 * this.sinking);
      ctx.scale(k, k);
    }
    this.vehicle.draw(ctx, {
      braking: this.braking,
      turnLeft: this.turnLeft,
      turnRight: this.turnRight,
      flash: this.flashTimer > 0,
      nos: this.nos.active,
    }, now);
    ctx.restore();
  }
}
