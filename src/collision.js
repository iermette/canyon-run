import { circleVsCircle, circleVsBox } from './utils.js';

// Returns the first obstacle hit by any of the vehicle's collision circles, or null.
export function getHitObstacle(car, obstacles) {
  const hits = car.colliders();
  for (const ob of obstacles) {
    for (const c of hits) {
      if (ob.shape === 'circle') {
        if (circleVsCircle(c.x, c.y, c.r, ob.x, ob.y, ob.r)) return ob;
      } else { // oriented box (barrier aligned with the track)
        if (circleVsBox(ob.cx, ob.cy, ob.hx, ob.hy, ob.angle, c.x, c.y, c.r)) return ob;
      }
    }
  }
  return null;
}

// True when the car is off the drivable road surface.
export function isOffTrack(info) {
  return info.dist > info.section.width / 2 + 10;
}

const DRY = Object.freeze({ wet: 0, sunk: false });

// Water rule: how many of the four wheels touch the drink, and whether the car
// is sunk. One wheel over the shoulder is survivable (you can claw back onto
// the deck); two diagonally opposite ones means the car went in — plouf!
export function waterContact(car, world) {
  const w = world.water;
  const reach = 80; // wider than any vehicle: skip the point tests when far away
  if (car.x < w.x - reach || car.x > w.x + w.w + reach ||
      car.y < w.y - reach || car.y > w.y + w.h + reach) return DRY;

  const wet = car.wheelContacts().map((p) => world.inWater(p.x, p.y));
  return {
    wet: wet.filter(Boolean).length,
    sunk: (wet[0] && wet[3]) || (wet[1] && wet[2]), // front-left & rear-right, or front-right & rear-left
  };
}
