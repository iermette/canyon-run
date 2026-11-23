import { vehicleById } from './bump.js';

// Cars are solid: every client ejects its OWN car out of any overlap with a
// remote car, along the contact normal. Each client does the same, so two
// cars pushing each other apart converge to a real separation — the ejection
// travels back to the other player through our snapshots.
//
// Approach velocity into the contact is mostly killed (no forcing through),
// while scraping along a flank costs a little speed. Frozen cars parked at
// the finish line are solid too — nobody drives over them.

export const SOLID_SOFT = 0.85;      // fraction of the penetration ejected per pass
export const SOLID_PASSES = 3;       // relaxation passes over all contacts
export const SOLID_KILL = 0.9;       // fraction of the approach velocity killed
export const SCRAPE_RATE = 3;        // speed lost per second while grinding a flank

// The vehicle's collider circles placed in world space.
export function placedColliders(vehicle, x, y, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return vehicle.colliders.map((c) => ({
    x: x + c.dx * cos - c.dy * sin,
    y: y + c.dx * sin + c.dy * cos,
    r: c.r,
  }));
}

// Resolve every overlap between our car and the visible remote cars.
// Returns the number of contacts found (0 when nothing was touching).
export function resolveCarOverlap(car, remotes, now, dt) {
  let contacts = 0;
  for (let pass = 0; pass < SOLID_PASSES; pass++) {
    let touched = false;
    const mine = car.colliders();
    for (const c of remotes.cars.values()) {
      const p = remotes.sampleAt(c.id, now);
      if (!p) continue; // unknown or stale — nothing to collide with
      const theirs = placedColliders(vehicleById(c.vehicleId), p.x, p.y, p.a);
      for (const m of mine) {
        for (const t of theirs) {
          const dx = m.x - t.x, dy = m.y - t.y;
          const dist = Math.hypot(dx, dy);
          const pen = m.r + t.r - dist;
          if (pen <= 0) continue;
          const nx = dx / (dist || 1), ny = dy / (dist || 1); // normal, pointing away from them
          car.x += nx * pen * SOLID_SOFT;
          car.y += ny * pen * SOLID_SOFT;
          // Velocity toward the other car (along this normal) is mostly killed.
          const vn = (car.dirX * nx + car.dirY * ny) * car.speed;
          if (vn < 0) car.speed += vn * SOLID_KILL;
          touched = true;
          if (pass === 0) contacts++;
        }
      }
    }
    if (!touched) break;
  }
  if (contacts > 0) car.speed *= Math.max(0, 1 - SCRAPE_RATE * dt); // grinding friction
  return contacts;
}
