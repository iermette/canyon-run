// End-to-end multiplayer test: boots the real server (static + WebSocket room)
// on an ephemeral port, connects simulated players with Node's built-in
// WebSocket, and verifies the full round flow:
//   lobby -> start -> synced countdown (~5s) -> go -> snapshot relay
//   -> finish xN -> back to lobby (new seed), plus road-width scaling.
import http from 'node:http';
import net from 'node:net';
import wsserverMod from '../server/wsserver.js';
import roomMod from '../server/room.js';

const { WsServer } = wsserverMod;
const { Room, COUNTDOWN_MS } = roomMod;

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

// ---- boot the real server on an ephemeral port -------------------------------
const server = http.createServer((_req, res) => res.end('ok'));
const room = new Room();
// Short liveness timers so the ghost-cleanup check below stays fast.
new WsServer(server, (conn, req) => {
  const query = new URL(req.url, 'http://localhost').searchParams;
  const p = room.join(conn, query.get('name'));
  if (!p) { conn.onmessage = () => {}; conn.close(); return; }
  conn.onmessage = (text) => { try { room.message(p, JSON.parse(text)); } catch {} };
  conn.onclose = () => room.leave(p);
}, { pingIntervalMs: 200, pongTimeoutMs: 400 });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// ---- tiny client helper -------------------------------------------------------
class Client {
  constructor(name) {
    this.name = name;
    this.id = null;
    this.msgs = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/?name=${encodeURIComponent(name)}`);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'lobby') this.id = m.you;
      this.msgs.push(m);
    };
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  clear() { this.msgs.length = 0; } // drop stale messages before the next phase
  // Wait until a message matching pred() arrives (scanning from the front).
  async next(pred, timeoutMs = 8000) {
    const t0 = Date.now();
    for (;;) {
      const i = this.msgs.findIndex(pred);
      if (i !== -1) return this.msgs.splice(0, i + 1)[i]; // consume up to it
      if (Date.now() - t0 > timeoutMs) throw new Error(`${this.name}: timed out waiting for message`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  close() { this.ws.close(); }
}

const A = new Client('Alice');
await A.next((m) => m.t === 'lobby' && m.players.length === 1);
check(true, 'player joins -> lobby with 1 player');
check(room.widthFactor === 1, `room.widthFactor == 1 with 1 player (got ${room.widthFactor})`);

const B = new Client('Bob');
await B.next((m) => m.t === 'lobby' && m.players.length === 2);
const C = new Client('Carol');
await C.next((m) => m.t === 'lobby' && m.players.length === 3);
check(Math.abs(room.widthFactor - (1 + 2 * 0.09)) < 1e-9, `road widens with players: widthFactor == ${room.widthFactor} for 3`);

// ---- shared family draw (point 1) ---------------------------------------------
// One server-authorized draw per room: every player lands on the same family,
// the wheel is just the reveal. The server is the single source of truth.
[A, B, C].forEach((c) => c.clear()); // drop join chatter
A.send({ t: 'draw' });
const famA = await A.next((m) => m.t === 'family');
const famB = await B.next((m) => m.t === 'family');
const famC = await C.next((m) => m.t === 'family');
check(famA.id === famB.id && famB.id === famC.id, `all players receive the same drawn family (${famA.id})`);
check(Number.isInteger(famA.id) && famA.id >= 0 && famA.id <= 4, `drawn family is a valid index (${famA.id})`);
check(room.family === famA.id, `room.family holds the shared draw (${room.family})`);
await B.next((m) => m.t === 'lobby' && m.family === famA.id);
check(true, 'lobby payload carries the shared family');
// Re-requesting is idempotent: the family does not change.
A.clear(); B.clear();
A.send({ t: 'draw' });
const famA2 = await A.next((m) => m.t === 'family');
check(famA2.id === famA.id, `re-requesting keeps the same family (${famA2.id})`);
// A late joiner inherits the already-drawn family via the lobby payload.
const D = new Client('Dave');
const dLobby = await D.next((m) => m.t === 'lobby' && m.players.length === 4);
check(dLobby.family === famA.id, 'late joiner inherits the shared family');
A.clear(); // drop the stale 3-player lobby from the re-draw so we match Dave's leave
D.close();
await A.next((m) => m.t === 'lobby' && m.players.length === 3, 4000); // Dave left

// ---- rename ---------------------------------------------------------------------
A.send({ t: 'name', name: 'Zoe' });
await B.next((m) => m.t === 'lobby' && m.players.find((p) => p.id === A.id)?.name === 'Zoe');
check(true, 'rename broadcast to other players (Alice -> Zoe)');

// ---- start the round -----------------------------------------------------------
[A, B, C].forEach((c) => c.clear()); // drop lobby chatter from the joins
A.send({ t: 'ready', vehicleId: 'mclaren-f1' });
await B.next((m) => m.t === 'lobby' && m.players.find((p) => p.id === A.id)?.vehicleId === 'mclaren-f1');
check(true, 'ready message updates the lobby (Alice -> tank)');
C.send({ t: 'vehicle', vehicleId: 'dodge-viper' }); // changed pick without re-readying
await B.next((m) => m.t === 'lobby' && m.players.find((p) => p.id === C.id)?.vehicleId === 'dodge-viper');
check(true, 'vehicle change without ready updates the lobby (Carol -> bus)');
[A, B, C].forEach((c) => c.clear()); // only round messages from here on

A.send({ t: 'start' });
const cd = await Promise.all([A.next((m) => m.t === 'countdown'), B.next((m) => m.t === 'countdown'), C.next((m) => m.t === 'countdown')]);
check(cd.every((m) => m.seed > 0 && m.slots.length === 3), `countdown broadcast to all with 3 grid slots (seed ${cd[0].seed})`);
check(cd.every((m) => m.players.find((p) => p.id === A.id)?.name === 'Zoe'), 'renamed player keeps the new name in the countdown payload');
check(cd.every((m) => m.players.find((p) => p.id === A.id)?.vehicleId === 'mclaren-f1'
  && m.players.find((p) => p.id === C.id)?.vehicleId === 'dodge-viper'), "countdown payload carries every player's current vehicle");
check(cd.every((m) => Math.abs(m.widthFactor - room.widthFactor) < 1e-9), 'all clients get the same width factor');
const s = cd[0].slots.map((x) => x.s).sort((a, b) => a - b);
check(s.every((v) => v >= 5 && v <= cd[0].startLineS), `grid sits behind the start line (s=${s.join(',')} line=${cd[0].startLineS})`);

// The countdown must last ~COUNTDOWN_MS before 'go' — that is the sync point.
const tGo = Date.now();
await Promise.all([A.next((m) => m.t === 'go', COUNTDOWN_MS + 4000), B.next((m) => m.t === 'go'), C.next((m) => m.t === 'go')]);
check(Date.now() - tGo >= COUNTDOWN_MS - 150, `countdown lasted ~${COUNTDOWN_MS}ms before go`);

// ---- snapshot relay -------------------------------------------------------------
A.send({ t: 'snap', x: 12.5, y: -3, a: 0.4, s: 90 });
const gotB = await B.next((m) => m.t === 'snap' && m.id === A.id);
check(gotB.x === 12.5 && gotB.s === 90, `snapshot relayed to Bob (x=${gotB.x}, s=${gotB.s})`);
await C.next((m) => m.t === 'snap' && m.id === A.id);
check(true, 'snapshot relayed to Carol too');

// ---- rear-end push relay -----------------------------------------------------------
A.send({ t: 'push', id: B.id, dx: 0.98, dy: 0.17, v: 180 });
const gotPush = await B.next((m) => m.t === 'push');
check(gotPush.dx === 0.98 && gotPush.dy === 0.17 && gotPush.v === 180, `push relayed to the victim only (v=${gotPush.v})`);
await new Promise((r) => setTimeout(r, 150)); // the pusher must not get a push back
check(!A.msgs.some((m) => m.t === 'push') && !C.msgs.some((m) => m.t === 'push'), 'push reaches only the hit player');
A.send({ t: 'push', id: B.id, dx: 1, dy: 0, v: 1e9 });
const gotClamped = await B.next((m) => m.t === 'push');
check(gotClamped.v === 500, `absurd push velocity clamped by the server (v=${gotClamped.v})`);

// ---- finishes -> back to lobby ---------------------------------------------------
A.send({ t: 'finish', time: 42.5 });
const finB = await B.next((m) => m.t === 'finished' && m.id === A.id);
check(finB.time === 42.5, `finish broadcast with Alice's time (${finB.time})`);

B.send({ t: 'finish', time: 43.1 });
C.send({ t: 'quit' }); // Carol abandons instead of finishing
const lobbyA = await A.next((m) => m.t === 'lobby' && m.phase === 'lobby');
check(lobbyA.players.length === 3, 'everyone back in the lobby after the round ends');
check(room.seed !== cd[0].seed, `next round gets a fresh seed (${cd[0].seed} -> ${room.seed})`);
check(lobbyA.players.every((p) => p.ready === false), 'ready flags reset for the next round');

// ---- ghost cleanup (silent death) ---------------------------------------------------
// A peer that completes the WS handshake and then goes silent (killed browser):
// liveness must drop it so it doesn't linger as a ghost player.
const raw = net.connect(port, '127.0.0.1');
raw.on('error', () => {});
raw.write(
  'GET /?name=Ghost HTTP/1.1\r\n' +
  'Host: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
);
const before = room.players.size;
await new Promise((res) => {
  const iv = setInterval(() => { if (room.players.size === before + 1) { clearInterval(iv); res(); } }, 25);
});
check(true, 'ghost peer joins the room after a raw handshake');
const t0 = Date.now();
while (room.players.size > before && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25));
check(room.players.size === before, `silent ghost dropped by liveness in ${Date.now() - t0}ms`);
raw.destroy();

// ---- leave mid-lobby --------------------------------------------------------------
B.close();
await A.next((m) => m.t === 'lobby' && m.players.length === 2, 4000);
check(Math.abs(room.widthFactor - (1 + 1 * 0.09)) < 1e-9, `road narrows again after Bob leaves (widthFactor ${room.widthFactor})`);

A.close(); C.close();
server.close();

console.log(failures === 0 ? '\nMULTIPLAYER: all checks passed' : `\nMULTIPLAYER: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
