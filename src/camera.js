import { lerp } from './utils.js';

// Smoothly follows the car, keeping it centered with a look-ahead in the
// direction of travel (so the road ahead stays visible while driving fast).
export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
  }

  update(dt, car) {
    const lead = Math.max(-120, Math.min(320, car.speed)) * 0.4;
    const tx = car.x + car.dirX * lead;
    const ty = car.y + car.dirY * lead;
    // teleport if the car was reset far away
    if (Math.hypot(tx - this.x, ty - this.y) > 900) {
      this.snapTo(tx, ty);
      return;
    }
    const k = 1 - Math.exp(-5 * dt); // frame-rate independent smoothing
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
  }

  apply(ctx, width, height) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restore(ctx) {
    ctx.restore();
  }
}
