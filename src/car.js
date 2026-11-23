import { clamp } from './utils.js';
import { VEHICLES } from './vehicles.js';

const DRAG = 1.4;           // proportional drag, per second
const ROLL_FRICTION = 70;   // rolling resistance with no input, units/s^2
const GRIP_SPEED = 140;     // steering starts biting at this speed

export class Car {
  constructor(world, vehicle = VEHICLES[0]) {
    this.world = world;
    this.vehicle = vehicle;
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
  }

  get dirX() { return Math.cos(this.angle); }
  get dirY() { return Math.sin(this.angle); }

  update(dt, drive) {
    const s = this.vehicle.stats;
    if (drive.throttle > 0) this.speed += s.accel * dt;
    else if (drive.throttle < 0) this.speed -= s.brake * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), ROLL_FRICTION * dt);

    this.speed -= this.speed * DRAG * dt; // drag always opposes motion
    this.speed = clamp(this.speed, s.reverseMax, s.maxSpeed);

    // Steering only bites at speed and inverts while reversing.
    const grip = clamp(Math.abs(this.speed) / GRIP_SPEED, 0, 1) * (this.speed < 0 ? -1 : 1);
    this.angle += drive.steer * s.turnRate * grip * dt;

    this.x += this.dirX * this.speed * dt;
    this.y += this.dirY * this.speed * dt;
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

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.sinking > 0) { // going under: shrink and fade behind the splash
      const k = 1 - 0.65 * this.sinking;
      ctx.globalAlpha = Math.max(0, 1 - 1.15 * this.sinking);
      ctx.scale(k, k);
    }
    this.vehicle.draw(ctx);
    ctx.restore();
  }
}
