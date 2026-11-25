'use strict';
// One game room: lobby -> synced countdown -> race -> back to lobby.
// The server is authoritative for the round flow (who started when, which
// seed/width everyone shares) and a dumb relay for position snapshots.

const PLAYER_COLORS = [
  '#ff5a4e', '#ffd23e', '#7dff8a', '#3dd6f5', '#b07aff',
  '#ff9de2', '#ffa94d', '#8ef5c0', '#f5f5f5', '#ff7ab8',
  '#7fb2ff', '#e8c15c', '#a3e635', '#f97316', '#2dd4bf',
];

const COUNTDOWN_MS = 5000; // must match the client's checkered countdown
const MAX_PLAYERS = 15;
const FAMILY_COUNT = 5; // must stay in sync with FAMILY_COUNT in src/families.js

class Room {
  constructor() {
    this.players = new Map(); // id -> player
    this.phase = 'lobby';     // lobby | countdown | racing
    this.seed = ((Math.random() * 0x7fffffff) | 1); // non-zero: random track for round 1
    this.racingIds = new Set();
    this.slots = new Map();   // id -> {s, off} starting grid position
    this.countdownTimer = null;
    this.nextId = 1;
    // Shared fairness draw (point 1): one family for the whole room, visible on
    // every screen. Drawn on the first request and kept for the session, so all
    // players (and every round) pick from the SAME family.
    this.family = null; // null until drawn, then 0..FAMILY_COUNT-1
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
    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.racingIds.delete(p.id);
      this.slots.delete(p.id);
      this.broadcast({ t: 'left', id: p.id });
      // A countdown with no racers left is pointless; a race with none ends.
      if (this.phase === 'countdown' && this.players.size === 0) this.backToLobby();
      else if (this.phase === 'racing' && this.racingIds.size === 0) this.backToLobby();
    } else {
      for (const q of this.players.values()) this.sendLobbyTo(q);
    }
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
        p.vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.slice(0, 32) : 'ferrari-288-gto';
        p.ready = true;
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;

      case 'vehicle':
        // Garage selection changed. Remembered for the next countdown even
        // without re-readying, so everyone draws the car this player picked.
        p.vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.slice(0, 32) : 'ferrari-288-gto';
        for (const q of this.players.values()) this.sendLobbyTo(q);
        break;

      case 'draw': {
        // Shared fairness draw (point 1): the server picks ONE family for the
        // whole room and broadcasts it. Every client spins its wheel to this same
        // result and locks its picker to this family, so all players share one
        // category. Idempotent: once drawn, further requests just re-broadcast
        // the same family (one draw per session, not one per player).
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
        if (!this.racingIds.delete(p.id)) return;
        this.broadcast({ t: 'finished', id: p.id, time: Number(msg.time) || 0 });
        if (this.phase === 'racing' && this.racingIds.size === 0) this.backToLobby();
        break;

      case 'quit': // G during the race: leave the round, others keep going
        if (!this.racingIds.delete(p.id)) return;
        this.slots.delete(p.id);
        this.broadcast({ t: 'left', id: p.id });
        if (this.phase === 'racing' && this.racingIds.size === 0) this.backToLobby();
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

  backToLobby() {
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = null; }
    this.phase = 'lobby';
    this.seed = ((Math.random() * 0x7fffffff) | 1); // fresh track for the next round
    this.racingIds.clear();
    this.slots.clear();
    // Reset everyone first, then broadcast — sending while mutating would let
    // early recipients see a partially-reset roster.
    for (const p of this.players.values()) p.ready = false;
    for (const p of this.players.values()) this.sendLobbyTo(p);
  }

  sendLobbyTo(p) {
    const players = [...this.players.values()].map((q) => ({
      id: q.id, name: q.name, vehicleId: q.vehicleId, ready: q.ready, color: q.color,
    }));
    p.ws.send(JSON.stringify({ t: 'lobby', phase: this.phase, you: p.id, family: this.family, players }));
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) p.ws.send(s);
  }
}

module.exports = { Room, COUNTDOWN_MS };
