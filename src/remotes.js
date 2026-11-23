import { VEHICLES } from './vehicles.js';
import { Splash } from './effects.js';

// Other players' cars, interpolated ~120 ms behind real time so the 15 Hz
// snapshot stream renders smoothly. A car is dropped when its snapshots go
// stale (player left or finished and was cleaned up).

const LAG_MS = 120;
const STALE_MS = 4000;
const MAX_SNAPS = 16;

export class Remotes {
  constructor() {
    this.cars = new Map(); // id -> remote car state
  }

  setMeta(id, meta) {
    let c = this.cars.get(id);
    if (!c) { // known from the lobby/countdown before any snapshot arrived
      c = { id, name: '', color: '#ffffff', vehicleId: 'sports', s: 0, frozen: false, snaps: [] };
      this.cars.set(id, c);
    }
    Object.assign(c, meta);
  }

  update(id, snap) {
    let c = this.cars.get(id);
    if (!c) {
      c = { id, name: '', color: '#ffffff', vehicleId: 'sports', s: 0, frozen: false, snaps: [] };
      this.cars.set(id, c);
    }
    const now = performance.now();
    c.snaps.push({ x: snap.x, y: snap.y, a: snap.a, t: now });
    if (c.snaps.length > MAX_SNAPS) c.snaps.shift();
    if (typeof snap.s === 'number') c.s = snap.s; // arc position for the ranking
  }

  // A remote racer went into the drink: paint the same plouf! they see, at the
  // spot they were last seen.
  splash(id) {
    const c = this.cars.get(id);
    if (!c) return;
    const at = c.snaps[c.snaps.length - 1];
    if (!at) return;
    c.fx = new Splash(at.x, at.y);
  }

  remove(id) { this.cars.delete(id); }
  clear() { this.cars.clear(); }

  // Position of car `id` at time `now - LAG_MS`, or null when unknown/stale.
  sampleAt(id, now) {
    const c = this.cars.get(id);
    if (!c || c.snaps.length === 0) return null;
    const target = now - LAG_MS;
    const last = c.snaps[c.snaps.length - 1];
    if (!c.frozen && now - last.t > STALE_MS) return null; // stale — player gone
    // frozen (finished): stay put at the finish line until the lobby clears us
    if (target <= c.snaps[0].t) {
      const s = c.snaps[0];
      return { x: s.x, y: s.y, a: s.a };
    }
    for (let i = 1; i < c.snaps.length; i++) {
      if (c.snaps[i].t >= target) {
        const p = c.snaps[i - 1], q = c.snaps[i];
        const t = (target - p.t) / ((q.t - p.t) || 1e-9);
        let da = q.a - p.a;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, a: p.a + da * t };
      }
    }
    return { x: last.x, y: last.y, a: last.a };
  }

  draw(ctx, now) {
    for (const c of this.cars.values()) {
      if (c.fx) {
        if (c.fx.expired(now)) c.fx = null;
        else c.fx.draw(ctx, now);
      }
      const pos = this.sampleAt(c.id, now);
      if (!pos) continue;
      const v = VEHICLES.find((v) => v.id === c.vehicleId) || VEHICLES[0];

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.a);
      v.draw(ctx);
      ctx.restore();

      // name tag above the car (world space)
      const label = c.name || 'Player';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(label, pos.x, pos.y - 32);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, pos.x, pos.y - 32);
      // small color chip identifying the player (matches their lobby dot)
      ctx.fillStyle = c.color;
      ctx.fillRect(pos.x - w / 2 - 8, pos.y - 36, 5, 9);
    }
  }
}
