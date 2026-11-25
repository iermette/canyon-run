'use strict';
// One game room: lobby -> synced countdown -> race -> SYNCHRONIZED round end ->
// shared scoreboard -> "next" -> wheel removes a category -> back to lobby.
//
// The server is authoritative for the round flow (who started when, which
// seed/width everyone shares) and a dumb relay for position snapshots.
//
// Synchronized round end ("manche synchronisée"):
//  - When the FIRST car crosses the line the round clock starts: a 15s grace
//    period (raceEnding) lets the late racers cross too, then a 3-2-1 countdown
//    (ending) is broadcast to EVERY screen. If everyone is already done (all
//    finished/quit) the countdown starts immediately — nobody waits for no one.
//  - When the 3-2-1 hits zero the round ends for ALL players at once and the
//    shared scoreboard (scoring) is revealed: this round's result sorted by
//    finish order plus the cumulative stats across all rounds. It is identical
//    on every screen.
//  - The moment ANY player confirms ("next"), everyone is sent back to the menu:
//    the wheel turns and REMOVES the category just raced (so it never reappears),
//    a fresh track is rolled, and the next round begins.
//
// The client (src/main.js) mirrors these phases and draws the scoreboard.
// Solo mode is untouched: with no server the game stays fully local.

const PLAYER_COLORS = [
  '#ff5a4e', '#ffd23e', '#7dff8a', '#3dd6f5', '#b07aff',
  '#ff9de2', '#ffa94d', '#8ef5c0', '#f5f5f5', '#ff7ab8',
  '#7fb2ff', '#e8c15c', '#a3e635', '#f97316', '#2dd4bf',
];

const COUNTDOWN_MS = 5000; // must match the client's checkered countdown
const GRACE_MS = 15000;    // first finish -> synchronized round end (late racers can cross)
const ENDING_MS = 3000;    // the synchronized 3-2-1 shown on every screen
const MAX_PLAYERS = 15;
const FAMILY_COUNT = 5;    // must stay in sync with FAMILY_COUNT in src/families.js
const POINTS = [10, 7, 5, 3, 1, 1, 1, 1, 1, 1]; // 1st..10th, then 1

class Room {
  constructor() {
    this.players = new Map(); // id -> player
    this.phase = 'lobby';     // lobby | countdown | racing | scoring
    this.seed = ((Math.random() * 0x7fffffff) | 1); // non-zero: random track for round 1
    this.racingIds = new Set();
    this.slots = new Map();   // id -> {s, off} starting grid position
    this.nextId = 1;
    this.countdownTimer = null;
    this.graceTimer = null;
    this.endingTimer = null;
    this.graceUntil = 0;
    this.endingAt = 0;

    // Shared fairness draw (point 1): one family for the whole room, visible on
    // every screen. Drawn on the first request and kept until the next round.
    this.family = null; // null until drawn, then 0..FAMILY_COUNT-1
    // The wheel's pool of still-eligible categories. Each round the category
    // that was just raced is eliminated, so categories only ever come OUT; when
    // the pool is exhausted it wraps around (everyone back to the full set).
    this.familyPool = Array.from({ length: FAMILY_COUNT }, (_, i) => i);
    // Cumulative stats per player across all rounds.
    this.totals = new Map(); // id -> { points, wins, races, bestTime }
    this.results = [];       // this round: { id, name, vehicleId, order, time, dnf, points }
    this.round = 0;          // completed rounds
  }

  // Road width scales with the number of connected players (the user's core
  // request): +9% per extra player, capped so the tunnel stays passable.
  get widthFactor() {
    return Math.min(1 + (this.players.size - 1) * 0.09, 2.3);
  }

  join(ws, name) {
    if (this.players.size >= MAX_PLAYERS) return null; // room full — client stays solo
    const id = 'p' + this.nextId++;
    const p = {
      id,
      name: String(name || '').slice(0, 16) || `Player ${this.players.size + 1}`,
      ws,
      vehicleId: 'ferrari-288-gto',
      ready: false,
      color: PLAYER_COLORS[(this.nextId - 2) % PLAYER_COLORS.length],
    };
    this.players.set(id, p);
    for (const q of this.players.values()) this.sendLobbyTo(q); // everyone sees the new roster
    return p;
  }

  leave(p) {
    if (!this.players.delete(p.id)) return;
    this.totals.delete(p.id);
    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.racingIds.delete(p.id);
      this.slots.delete(p.id);
      const others = [...this.players.values()];
      if (others.length === 0) {
        // No one left to race: clean up so a rejoin starts fresh.
        this.cancelTimers();
        this.results = [];
        this.graceUntil = 0;
        this.endingAt = 0;
        this.phase = 'lobby';
        return;
      }
      this.broadcast({ t: 'left', id: p.id });
      this.maybeEndRound(); // a leaver may be the last racer -> end the round
    } else if (this.phase === 'scoring') {
      // A player leaves the scoreboard: the rest stay, minus the departed.
      this.broadcast({ t: 'left', id: p.id });
    }
    for (const q of this.players.values()) this.sendLobbyTo(q);
  }

  message(p, msg) {
    switch (msg.t) {
      case 'name': {
        const n = String(msg.name || '').trim().slice(0, 16);
        if (!n) return;
        p.name = n; // visible in the lobby chips and on track name tags
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;
      }

      case 'ready':
        if (this.phase !== 'lobby') return;
        p.vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.slice(0, 32) : p.vehicleId;
        p.ready = true;
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;

      case 'vehicle':
        // Garage selection changed. Remembered for the next countdown even
        // without re-readying, so everyone draws the car this player picked.
        p.vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.slice(0, 32) : p.vehicleId;
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;

      case 'draw': {
        // Shared fairness draw (point 1): the server picks ONE family for the
        // whole room and broadcasts it. Every client spins its wheel to this same
        // result and locks its picker to this family, so all players share one
        // category. Idempotent: once drawn, further requests just re-broadcast
        // the same family (one draw per round, not one per player).
        if (this.phase !== 'lobby') return;
        if (this.family === null) this.family = Math.min(FAMILY_COUNT - 1, (Math.random() * FAMILY_COUNT) | 0);
        this.broadcast({ t: 'family', id: this.family });
        // Re-send the lobby so every client's roster state carries the shared
        // family, and a late joiner inherits it on join.
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;
      }

      case 'start':
        if (this.phase !== 'lobby') return;
        this.startCountdown();
        break;

      case 'snap':
        // Relay to every other racer only — spectators and lobby players don't need it.
        if (this.phase === 'racing' && this.racingIds.has(p.id)) {
          const out = JSON.stringify({ t: 'snap', id: p.id, x: msg.x, y: msg.y, a: msg.a, s: msg.s });
          for (const q of this.players.values()) if (q !== p) q.ws.send(out);
        }
        break;

      case 'splash': // a racer went into the drink — show everyone the plouf!
        if (this.phase === 'racing' && this.racingIds.has(p.id)) {
          const out = JSON.stringify({ t: 'splash', id: p.id });
          for (const q of this.players.values()) if (q.id !== p.id) q.ws.send(out);
        }
        break;

      case 'push': { // a racer rear-ended someone — relay the shove to the victim only
        if (this.phase !== 'racing' || !this.racingIds.has(p.id)) return;
        const q = this.players.get(msg.id);
        if (!q || q === p) return; // unknown peer, or pushing myself
        const dx = Number(msg.dx) || 0, dy = Number(msg.dy) || 0;
        const v = Math.min(Math.max(Number(msg.v) || 0, 0), 500); // sane impulse bound
        q.ws.send(JSON.stringify({ t: 'push', dx, dy, v }));
        break;
      }

      case 'finish':
        if (this.phase !== 'racing') return;
        this.registerFinish(p, Number(msg.time) || 0);
        break;

      case 'quit': // G during the race: leave the round, others keep going
        if (this.phase !== 'racing') return;
        if (!this.racingIds.has(p.id)) return;
        this.racingIds.delete(p.id);
        this.slots.delete(p.id);
        // The quitter didn't finish: record them as DNF so the shared
        // scoreboard accounts for every racer in the round.
        this.results.push({ id: p.id, name: p.name, vehicleId: p.vehicleId, order: 0, time: null, dnf: true, points: 0 });
        this.broadcast({ t: 'left', id: p.id });
        this.maybeEndRound(); // a leaver may be the last racer -> end the round
        break;

      case 'next':
        // Synchronized round end: ANY player confirming sends everyone back to
        // the menu (and turns the wheel to the next category).
        if (this.phase !== 'scoring') return;
        this.nextRound();
        break;

      default:
        break;
    }
  }

  startCountdown() {
    const ids = [...this.players.keys()];
    if (ids.length === 0) return;

    // Starting grid behind the start line: up to 5 columns, rows of 65 units.
    const cols = Math.min(5, ids.length);
    const rows = Math.ceil(ids.length / cols);
    const startLineS = 48 + (rows - 1) * 65; // keeps the back row at s >= 8
    this.slots.clear();
    ids.forEach((id, i) => {
      const col = i % cols;
      const row = (i / cols) | 0;
      this.slots.set(id, { s: startLineS - 40 - row * 65, off: (col - (cols - 1) / 2) * 46 });
    });

    for (const p of this.players.values()) p.ready = true; // implicit ready
    this.phase = 'countdown';
    // Reset the round bookkeeping so a re-entry starts clean.
    this.results = [];
    this.graceUntil = 0;
    this.endingAt = 0;
    for (const p of this.players.values()) this.totals.delete(p.id); // fresh round stats
    const payload = {
      t: 'countdown',
      duration: COUNTDOWN_MS,
      seed: this.seed,
      widthFactor: this.widthFactor,
      startLineS,
      slots: [...this.slots.entries()].map(([id, s]) => ({ id, ...s })),
      // player meta so clients can draw name tags + the right vehicle sprite
      players: ids.map((id) => {
        const q = this.players.get(id);
        return { id: q.id, name: q.name, color: q.color, vehicleId: q.vehicleId };
      }),
    };
    this.broadcast(payload);

    // One shared clock for everyone — the sync point of the race.
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      if (this.phase !== 'countdown') return; // room reset meanwhile
      this.phase = 'racing';
      this.racingIds = new Set(ids);
      this.broadcast({ t: 'go' });
    }, COUNTDOWN_MS);
  }

  // ---- synchronized round end ---------------------------------------------------

  // A racer crossed the line (or the round is being wrapped up): record the
  // result, broadcast the shared finish order, and drive the round-end clock.
  registerFinish(p, time) {
    if (!this.racingIds.delete(p.id)) return;
    this.slots.delete(p.id);
    const order = this.results.filter((r) => !r.dnf).length + 1;
    const points = POINTS[order - 1] || 1;
    this.results.push({ id: p.id, name: p.name, vehicleId: p.vehicleId, order, time, dnf: false, points });

    // Shared broadcast: every screen sees the same finish order (drives the HUD).
    this.broadcast({ t: 'finished', id: p.id, time, order, points });

    this.onFirstFinish();  // the first crossing starts the synchronized clock
    this.maybeEndRound();  // ...or ends the round now if no one is left
  }

  // The first car across the line: the race is over, but the late racers still
  // get a 15s grace to cross before the synchronized 3-2-1 kicks in.
  onFirstFinish() {
    if (this.graceUntil !== 0) return; // already counting down
    this.graceUntil = Date.now() + GRACE_MS;
    this.broadcast({ t: 'raceEnding', graceUntil: this.graceUntil });
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.checkRoundEnd(), GRACE_MS);
  }

  // All racers done (finished or quit) -> start the round end immediately.
  maybeEndRound() {
    if (this.phase !== 'racing' || this.endingTimer) return;
    if (this.racingIds.size > 0) return; // someone is still out there
    this.checkRoundEnd();
  }

  // Grace elapsed (or everyone done): start the synchronized 3-2-1 countdown.
  checkRoundEnd() {
    if (this.phase !== 'racing' || this.endingTimer) return;
    if (this.racingIds.size > 0 && Date.now() < this.graceUntil) return; // still in grace

    // Mark the stragglers (still racing when the grace ran out) as DNF.
    for (const id of [...this.racingIds]) {
      const p = this.players.get(id);
      if (p) this.results.push({ id, name: p.name, vehicleId: p.vehicleId, order: 0, time: null, dnf: true, points: 0 });
    }
    this.racingIds = new Set();
    this.sortResults();

    this.endingAt = Date.now() + ENDING_MS;
    this.broadcast({ t: 'ending', endsAt: this.endingAt });
    if (this.endingTimer) clearTimeout(this.endingTimer);
    this.endingTimer = setTimeout(() => this.finalizeRound(), ENDING_MS);
  }

  // The 3-2-1 hits zero: the round ends for EVERYONE, the scoreboard is in.
  finalizeRound() {
    if (this.phase !== 'racing') return;
    this.cancelTimers();
    this.phase = 'scoring';
    this.round += 1;
    for (const r of this.results) if (!r.dnf) this.updateTotals(r.id, r.time, r.order, r.points);
    this.broadcast({
      t: 'scoreboard',
      round: this.round,
      family: this.family,
      results: this.results,
      totals: Object.fromEntries(this.totals),
    });
  }

  // ---- "next": everyone back to the menu, wheel removes a category --------------

  nextRound() {
    if (this.phase !== 'scoring') return;
    this.cancelTimers();
    this.results = [];
    this.racingIds = new Set();
    this.slots.clear();
    this.graceUntil = 0;
    this.endingAt = 0;

    this.drawFamily(); // the wheel turns: the raced category is eliminated, fresh draw
    this.seed = ((Math.random() * 0x7fffffff) | 1); // fresh shared track
    this.phase = 'lobby';
    for (const p of this.players.values()) { p.ready = false; this.totals.delete(p.id); }

    // Everyone back to the menu at once, on the same (new) category.
    for (const q of this.players.values()) this.sendLobbyTo(q);
  }

  // Turn the wheel: eliminate the category that was just raced, then draw a new
  // one from what's left. Categories only ever come OUT; when the pool is empty
  // it wraps around (everyone back to the full set).
  drawFamily() {
    if (this.familyPool === null || this.familyPool.length === 0) {
      this.familyPool = Array.from({ length: FAMILY_COUNT }, (_, i) => i);
    }
    if (this.family != null) {
      const i = this.familyPool.indexOf(this.family);
      if (i >= 0) this.familyPool.splice(i, 1); // eliminate the raced category
      if (this.familyPool.length === 0) this.familyPool = Array.from({ length: FAMILY_COUNT }, (_, i) => i);
    }
    const idx = Math.floor(Math.random() * this.familyPool.length);
    this.family = this.familyPool[idx];
    return this.family;
  }

  updateTotals(id, time, order, points) {
    const t = this.totals.get(id) || { points: 0, wins: 0, races: 0, bestTime: null };
    t.points += points;
    t.races += 1;
    if (order === 1) t.wins += 1;
    if (t.bestTime === null || time < t.bestTime) t.bestTime = time;
    this.totals.set(id, t);
  }

  sortResults() {
    // Finished racers by finish time, DNF last.
    this.results.sort((a, b) => {
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;
      if (a.dnf && b.dnf) return 0;
      return (a.time || 0) - (b.time || 0);
    });
  }

  cancelTimers() {
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = null; }
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    if (this.endingTimer) { clearTimeout(this.endingTimer); this.endingTimer = null; }
  }

  sendLobbyTo(p) {
    const players = [...this.players.values()].map((q) => ({
      id: q.id, name: q.name, vehicleId: q.vehicleId, ready: q.ready, color: q.color,
    }));
    p.ws.send(JSON.stringify({ t: 'lobby', phase: this.phase, you: p.id, family: this.family, round: this.round, players }));
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) p.ws.send(s);
  }
}

module.exports = { Room, COUNTDOWN_MS, GRACE_MS, ENDING_MS, FAMILY_COUNT };
