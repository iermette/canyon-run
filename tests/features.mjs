// Feature tests (points 1, 2, 5 of the spec): NOS state machine, the drift
// target, and the vehicle-family partition + roulette. All pure modules —
// no world, no DOM. Deterministic (rng is injected where it matters).
import { NOS, NOS_CHARGES, NOS_DURATION } from '../src/nos.js';
import { driftTarget } from '../src/drift.js';
import {
  FAMILY_COUNT, FAMILIES, familyOf, pickFamilyIndex, Roulette,
} from '../src/families.js';
import { VEHICLES } from '../src/vehicles.js';

let fails = 0;
function ok(cond, msg) {
  console.log(`${cond ? '  ok  ' : ' FAIL '}${msg}`);
  if (!cond) fails++;
  return !!cond;
}

// ---- NOS (point 2): two charges, no refusal, then exhausted ----
{
  const nos = new NOS();
  ok(nos.charges === NOS_CHARGES && NOS_CHARGES === 2, `starts with 2 charges (got ${nos.charges})`);
  ok(!nos.active && !nos.exhausted, 'fresh NOS is not firing and not exhausted');

  ok(nos.activate() === true, 'first injection fires');
  ok(nos.charges === 1, 'one charge consumed');
  ok(nos.active === true, 'injection is active');
  ok(nos.activate() === false, 'no double-fire while one is already firing');
  ok(nos.charges === 1, 'no charge consumed by the rejected re-fire');

  for (let t = 0; t < NOS_DURATION; t += 0.01) nos.update(0.01); // let it end
  ok(nos.active === false, 'injection ends after its duration');
  ok(nos.exhausted === false, 'one charge left: still usable, not exhausted');

  ok(nos.activate() === true, 'second injection fires');
  ok(nos.charges === 0, 'both charges now spent');
  for (let t = 0; t < NOS_DURATION; t += 0.01) nos.update(0.01);
  ok(nos.active === false && nos.exhausted === true, 'after both end, NOS is exhausted');
  ok(nos.activate() === false, 'no third injection: exhausted is final');
}

// ---- Drift (point 5): speed + handling decide the slide ----
{
  ok(driftTarget({ speed: 200, steer: 0, turnRate: 2.5 }) === 0, 'no steering -> no slide');
  ok(driftTarget({ speed: 20, steer: 1, turnRate: 2.5 }) === 0, 'too slow -> no slide');

  const slow = driftTarget({ speed: 400, steer: 1, turnRate: 1.6 });
  const quick = driftTarget({ speed: 400, steer: 1, turnRate: 3.3 });
  ok(slow > 0 && slow <= 1, `fast corner on a weak car slides (${slow.toFixed(2)})`);
  ok(quick >= 0 && quick < slow, `a sharper car holds more speed (${quick.toFixed(2)} < ${slow.toFixed(2)})`);

  const noBrake = driftTarget({ speed: 300, steer: 1, turnRate: 1.6, braking: false });
  const withBrake = driftTarget({ speed: 300, steer: 1, turnRate: 1.6, braking: true });
  ok(withBrake > noBrake && withBrake <= 1, `handbrake kicks the rear out (${withBrake.toFixed(2)} > ${noBrake.toFixed(2)})`);
}

// ---- Families (point 1): five speed bands, a partition of the catalog ----
{
  ok(FAMILY_COUNT === 5 && FAMILIES.length === 5, `five families (got ${FAMILIES.length})`);

  const seen = new Set();
  let total = 0;
  for (const f of FAMILIES) {
    total += f.vehicles.length;
    for (const v of f.vehicles) {
      if (seen.has(v.id)) ok(false, `vehicle ${v.id} appears in two families`);
      seen.add(v.id);
    }
  }
  ok(total === VEHICLES.length, `split covers the whole catalog (${total}/${VEHICLES.length})`);
  ok(seen.size === VEHICLES.length, 'every car belongs to exactly one family (no dupes/losses)');

  // Contiguous by speed: each band's fastest car is at most the next band's slowest.
  let ordered = true;
  for (let f = 0; f < FAMILIES.length - 1; f++) {
    if (FAMILIES[f].max > FAMILIES[f + 1].min) ordered = false;
  }
  ok(ordered, 'bands are contiguous, slowest to fastest');

  // familyOf agrees with the partition.
  const sample = VEHICLES[0];
  const expected = FAMILIES.findIndex((f) => f.vehicles.some((v) => v.id === sample.id));
  ok(familyOf(sample.id) === expected && expected >= 0, `familyOf(${sample.id}) -> family ${expected}`);
  ok(familyOf('not-a-real-car') === -1, 'unknown vehicle -> -1');
}

// ---- Roulette: a spin lands on the family it was drawn for ----
{
  const r = new Roulette();
  ok(r.current() === 0, 'pointer at 12 o\'clock sits on family 0');

  const target = 3;
  r.spin(target, { dur: 1, rng: () => 0.5 }); // rng 0.5 => zero jitter, deterministic
  let landed = null;
  for (let i = 0; i < 300 && landed === null; i++) landed = r.update(1 / 60);
  ok(landed === target, `spin drawn to family ${target} lands on ${target}`);

  // pickFamilyIndex stays in range and respects the injected rng.
  ok(pickFamilyIndex(() => 0) === 0, 'pickFamilyIndex(0) -> 0');
  ok(pickFamilyIndex(() => 0.999) === 4, 'pickFamilyIndex(0.999) -> 4');
  const mid = pickFamilyIndex(() => 0.5);
  ok(mid >= 0 && mid < FAMILY_COUNT, `pickFamilyIndex(0.5) in range (${mid})`);
}

if (fails) { console.log(`\nFEATURES: ${fails} checks failed`); process.exit(1); }
console.log('\nFEATURES: all checks passed');
