import { createWorld, pointAt, placeOnTrack } from './world.js';
import { Car } from './car.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { getHitObstacle, isOffTrack, waterContact } from './collision.js';
import { GameState, State } from './gameState.js';
import { chaseTarget } from './turbo.js';
import { contactBump, PUSHER_SLOWDOWN, vehicleById } from './bump.js';
import { resolveCarOverlap } from './solidity.js';
import { Garage } from './garage.js';
import { Net } from './net.js';
import { Remotes } from './remotes.js';
import { loadTextures } from './textures.js';
import { drawSpeedometer } from './speedometer.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// 8-bit tiles: load grass + asphalt and turn them into repeating patterns.
// Fire-and-forget — drawScene falls back to the flat colors until they're in.
loadTextures(ctx);

// ---- multiplayer wiring -------------------------------------------------------
const playerName = new URLSearchParams(location.search).get('name') || '';
const net = new Net();
const remotes = new Remotes();
let mode = 'solo';            // 'mp' once the room connection is up
let wasMp = false;            // ever connected to a room (for the CONN LOST hint)
let myId = null;              // my player id in the room
let finishedTimes = new Map();// remote id -> finish time (for the position label)
let bumpCooldowns = new Map(); // remote id -> last rear-end shove (ms)
let lastS = 0;                // my arc-length on the track (snapshots + ranking)
let snapAccum = 0;
let finishSent = false;

const garage = new Garage();
garage.shareUrl = location.href.split('#')[0];
garage.draftName = playerName; // prefill the name screen from ?name=... if present

function tryConnect() { net.connect(playerName); }
net.on('connect', () => { mode = 'mp'; wasMp = true; garage.mode = 'mp'; });
net.on('fail', () => setTimeout(tryConnect, 5000)); // server down / room full: retry
net.on('disconnect', () => {
  // Keep racing locally; remote cars fade out via snapshot staleness.
  mode = 'solo';
  garage.mode = 'solo';
  setTimeout(tryConnect, 3000);
});

net.on('lobby', (m) => {
  if (phase !== 'garage') return; // ignore lobby updates mid-round
  myId = m.you;
  finishedTimes.clear();
  remotes.clear();
  bumpCooldowns.clear();
  garage.setLobby(m.players, m.you);
  garage.raceInProgress = m.phase !== 'lobby';
  if (m.phase === 'lobby') {
    // Preview the track everyone will race on. The road widens with the
    // number of connected players (same formula as server/room.js).
    const wf = Math.min(1 + (m.players.length - 1) * 0.09, 2.3);
    world = createWorld(m.seed, { widthFactor: wf });
    car.world = world;
    car.reset();
    camera.snapTo(car.x, car.y);
    gameState.reset();
  }
});

net.on('countdown', (m) => {
  const slot = m.slots.find((s) => s.id === myId);
  if (!slot) return; // not in this round (joined mid-race): wait for the next one
  world = createWorld(m.seed, { widthFactor: m.widthFactor, startLineS: m.startLineS });
  car.world = world;
  const p = pointAt(world.cl, slot.s);
  const pos = placeOnTrack(world.cl, slot.s, slot.off);
  car.x = pos.x; car.y = pos.y; car.angle = p.angle; car.speed = 0;
  lastS = slot.s; finishSent = false; snapAccum = 0;
  remotes.clear(); finishedTimes.clear(); bumpCooldowns.clear();
  for (const pl of m.players) {
    if (pl.id !== myId) remotes.setMeta(pl.id, { name: pl.name, color: pl.color, vehicleId: pl.vehicleId });
  }
  // Own car uses the vehicle id the server broadcast, so everyone's windows
  // show the same sprite for every player (startRace() only covers solo).
  const me = m.players.find((pl) => pl.id === myId);
  car.setVehicle(vehicleById(me ? me.vehicleId : garage.selected.id));
  car.resetNOS(); // fresh NOS packs each race (point 2)
  phase = 'countdown';
  gameState.beginCountdown(m.duration / 1000, true); // synced: the server's 'go' ends it
  camera.snapTo(car.x, car.y);
});

net.on('go', () => {
  if (phase !== 'countdown') return;
  phase = 'racing';
  gameState.go();
});

net.on('snap', (m) => remotes.update(m.id, m));
net.on('finished', (m) => {
  finishedTimes.set(m.id, m.time);
  const rc = remotes.cars.get(m.id); // keep their car frozen at the finish line
  if (rc) rc.frozen = true;
});
net.on('left', (m) => { remotes.remove(m.id); finishedTimes.delete(m.id); });
net.on('splash', (m) => remotes.splash(m.id)); // another racer went into the drink
net.on('push', (m) => {
  // Someone rear-ended us: get shoved along their collision vector.
  if (typeof m.dx === 'number' && typeof m.dy === 'number' && m.v > 0) {
    car.applyKnock(m.dx, m.dy, m.v);
  }
});

// ---- game objects -------------------------------------------------------------
let world = createWorld(); // fresh random track on load (createWorld(0) = classic)
const car = new Car(world);
const camera = new Camera();
camera.snapTo(car.x, car.y);
const input = new Input();
const gameState = new GameState(car);

let phase = 'garage'; // garage -> countdown -> racing
let waterWarn = false; // one wheel is already in the drink (HUD hint)
let turboState = null; // null | 'ready' | 'on' (HUD hint, see turbo.js)
tryConnect();

// Mouse picking in the garage: the canvas is fullscreen, so client coords are
// already the screen-space coords the garage draws its cards in.
canvas.addEventListener('click', (e) => {
  if (phase !== 'garage' || !garage.nameDone) return;
  const action = garage.handleClick(e.clientX, e.clientY);
  if (action === 'select' && mode === 'mp') {
    garage.localReady = false; // new selection: my 'ready' is stale
    net.send({ t: 'vehicle', vehicleId: garage.selected.id });
  } else if (action === 'confirm') {
    if (mode === 'solo') startRace();
    else if (!garage.localReady) { garage.localReady = true; net.send({ t: 'ready', vehicleId: garage.selected.id }); }
    else net.send({ t: 'start' });
  }
});

function startRace() {
  car.setVehicle(garage.selected);
  car.resetNOS(); // fresh NOS packs each race (point 2)
  phase = 'countdown';
  gameState.reset(); // local checkered countdown, then GO
  camera.snapTo(car.x, car.y);
}

function toGarage() {
  phase = 'garage';
  car.reset();
  gameState.reset();
  camera.snapTo(car.x, car.y);
}

// Replace the current track: new world, respawn the car, recenter the camera.
function switchWorld(next) {
  world = next;
  car.world = next;
  car.reset();
  camera.snapTo(car.x, car.y);
  gameState.reset();
}

// "POS k/n" for multiplayer: count racers ahead of me (finished ones always are).
function myPositionLabel() {
  const n = 1 + remotes.cars.size;
  if (n <= 1) return null;
  let ahead = 0;
  const iAmFinished = gameState.state === State.FINISHED;
  for (const id of remotes.cars.keys()) {
    const finT = finishedTimes.get(id);
    if (iAmFinished) {
      if (finT !== undefined && finT < gameState.time) ahead++;
    } else if (finT !== undefined || (remotes.cars.get(id)?.s ?? 0) > lastS) {
      ahead++;
    }
  }
  return `POS ${ahead + 1}/${n}`;
}

// Small debug hook (used by browser tests; harmless in production).
window.__canyonRun = {
  get world() { return world; },
  get car() { return car; },
  get remotes() { return remotes; },
};

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp big hitches
  last = now;

  // ---- update ----
  if (phase === 'garage') {
    const action = garage.update(input);
    if (action === 'name') {
      // Tell the room our name so other players see it (queued until connected).
      net.send({ t: 'name', name: garage.name });
    } else if (action === 'confirm') startRace();
    else if (mode === 'mp' && action === 'ready') net.send({ t: 'ready', vehicleId: garage.selected.id });
    else if (mode === 'mp' && action === 'vehicle') net.send({ t: 'vehicle', vehicleId: garage.selected.id });
    else if (mode === 'mp' && action === 'start') net.send({ t: 'start' });
  } else if (phase === 'countdown') {
    gameState.update(dt, world); // checkered countdown display
    if (gameState.state !== State.COUNTDOWN) phase = 'racing'; // solo GO (mp waits for the server's 'go')
  } else if (phase === 'racing') {
    waterWarn = false;
    turboState = null;
    // Signals + headlight (point 3): X left, C flash, V right. Held keys are
    // set every frame; the headlight flash is a single press.
    car.turnLeft = input.isDown('KeyX');
    car.turnRight = input.isDown('KeyV');
    if (input.wasPressed('KeyC')) car.flashHeadlights();
    // NOS (point 2): F fires one of two packs; steering near-locked while it
    // fires, so it's only safe on a straight. Player's call, no refusal.
    if (gameState.state === State.PLAYING && input.wasPressed('KeyF')) car.nos.activate();
    if (gameState.state === State.PLAYING) {
      // Turbo: hold Space while a car is ahead on the track; it cuts off
      // when our nose comes level with theirs (chaseTarget goes null).
      const chase = chaseTarget(world, car, remotes, now);
      const turbo = chase !== null && input.isDown('Space');
      turboState = chase === null ? null : (turbo ? 'on' : 'ready');
      car.update(dt, { ...input.readDrive(), turbo });
      const hit = getHitObstacle(car, world.obstacles);
      const drink = hit ? { wet: 0, sunk: false } : waterContact(car, world);
      if (hit) {
        gameState.crash({ x: car.x, y: car.y });
      } else if (drink.sunk) {
        // Two opposite wheels in the water: plouf! and back to the start line.
        gameState.splash({ x: car.x, y: car.y });
        if (mode === 'mp' && net.connected) net.send({ t: 'splash' });
      } else {
        waterWarn = drink.wet > 0; // a wheel over the edge is still survivable
        const info = world.trackInfoAt(car.x, car.y);
        if (isOffTrack(info)) car.applyOffRoad(dt); // grass/water slows the car down
      }

      // Rear-end shove: my nose in contact with another racer's tail pushes
      // them along the collision vector — the server relays it, they apply
      // the knockback to their own car (see server/room.js 'push').
      if (mode === 'mp' && net.connected) {
        for (const c of remotes.cars.values()) {
          if (c.frozen) continue; // parked at the finish line: solid decor
          const pos = remotes.sampleAt(c.id, now);
          if (!pos) continue;
          const bump = contactBump(car, { id: c.id, ...pos }, vehicleById(c.vehicleId), now, bumpCooldowns);
          if (bump) {
            net.send({ t: 'push', id: c.id, dx: bump.dirX, dy: bump.dirY, v: bump.v });
            car.speed *= PUSHER_SLOWDOWN; // the impact costs me some momentum
          }
        }
      }

      // Solidity: eject our car out of any overlap with another car, so two
      // sprites can never ride on top of each other (see solidity.js).
      resolveCarOverlap(car, remotes, now, dt);
    }

    gameState.update(dt, world); // timer, win check, crash -> reset countdown
    lastS = world.trackInfoAt(car.x, car.y).s;

    if (mode === 'mp' && net.connected) {
      snapAccum += dt;
      if (snapAccum >= 1 / 15) { // ~15 position updates per second
        snapAccum = 0;
        net.send({ t: 'snap', x: car.x, y: car.y, a: car.angle, s: lastS });
      }
      if (gameState.state === State.FINISHED && !finishSent) {
        finishSent = true;
        net.send({ t: 'finish', time: gameState.time });
      }
    }

    // R/Space after finishing -> back to the garage. In mp the server already
    // removed us from the race, so we simply wait for the next lobby.
    if (gameState.state === State.FINISHED && (input.wasPressed('KeyR') || input.wasPressed('Space'))) {
      toGarage();
    }

    // N/C: solo only — in mp the track is shared and server-assigned.
    if (mode !== 'mp') {
      if (input.wasPressed('KeyN')) switchWorld(createWorld());
      else if (input.wasPressed('KeyT')) switchWorld(createWorld(0));
    }

    // G: back to the garage. In mp this abandons the race for me only.
    if (gameState.state !== State.FINISHED && input.wasPressed('KeyG')) {
      if (mode === 'mp' && net.connected) net.send({ t: 'quit' });
      toGarage();
    }
  }

  camera.update(dt, car);
  input.endFrame();

  // ---- render ----
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  camera.apply(ctx, w, h); // world space: car stays (near) centered
  world.draw(ctx, w, h);
  if (phase !== 'garage') remotes.draw(ctx, now);
  car.draw(ctx);
  gameState.drawImpactFx(ctx, now); // crash ring, or the plouf! over the sinking car
  camera.restore(ctx);     // back to screen space

  if (phase === 'garage') {
    garage.draw(ctx, w, h);
  } else {
    const info = world.trackInfoAt(car.x, car.y);
    let trackLabel = world.seed === 0 ? 'CLASSIC' : '#' + world.seed;
    if (wasMp && !net.connected) trackLabel += ' · CONN LOST'; // was mp, dropped mid-race
    gameState.drawHUD(ctx, w, h, info.section.name, isOffTrack(info),
      trackLabel, car.vehicle.short, myPositionLabel(), waterWarn, turboState);
    // Speedometer (point 4): needle gauge, top-right, on every screen.
    const gR = Math.min(56, Math.max(42, h * 0.11));
    drawSpeedometer(ctx, w - gR - 22, gR + 22, gR, car.speed, { maxKmh: 500, label: 'km/h' });
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
