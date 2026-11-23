# Canyon Run — top-down 2D driving game

A simple playable top-down driving prototype built with **HTML Canvas + vanilla
JavaScript ES modules**. No engine, no dependencies: flat rectangles/circles for
graphics and arcade-style movement.

Drive from the start line to the checkered finish through three distinct
sections — an **open** stretch, a dark narrow **tunnel**, and a **bridge** over
water — while avoiding cones, barrels, rocks and barriers. Hitting any obstacle
resets you to the start; driving off the road just slows you down.

Every track is **procedurally generated**: a seeded random walk with bounded
curvature (always drivable) and no self-crossings. The tunnel/bridge sections
land at random positions along it, and obstacles/trees are scattered per seed.
Press `N` for a new track, `C` to go back to the original hand-crafted one.

Before each race you pick your vehicle in the **garage** (12 vehicles with
different speed/acceleration/grip), then a checkered-flag countdown starts the
race. The game is also **multiplayer**: up to 15 players share one room over
WebSocket, the server runs the synced start for everyone, and the road widens
as more players join.

## Run it

The game uses ES modules, so it must be served over HTTP (opening `index.html`
via `file://` will not work). There are **no dependencies** — a tiny zero-dep
Node static server is included:

```bash
./launch.sh        # quick start: launches the server and opens the browser
                   # (close the window to stop; ./launch.sh stop as fallback)
npm run dev        # or simply: node server.js
# then open http://localhost:8080  (PORT=3000 npm run dev to change port)
```

Alternative with any static server you already have: `npx serve .`
(works in solo mode; multiplayer needs the WebSocket-capable `server.js`).

## Multiplayer (up to 15 players)

The included `server.js` serves the game **and** hosts one shared room on the
same port. To play with friends:

1. Start the server as usual (`./launch.sh` or `node server.js`).
2. Share your address: `http://localhost:8080` works for you; players on the
   same network use your LAN IP, e.g. `http://192.168.1.42:8080`
   (the server prints it at startup). The garage screen shows the exact URL
to share.
3. Everyone lands in a **lobby** with their name and vehicle choice. Press
   `ENTER` to ready up, then `ENTER` again to start — the server runs one
   shared 5-second checkered countdown for all connected players (the sync
   point), places everyone on a starting grid behind the line, and lights it
   green at the same instant.
4. Positions are relayed as ~15 snapshots/second through the server and
   interpolated client-side; your live position (`POS k/n`) is shown in the HUD.
   When everyone finishes (or leaves), the room returns to the lobby with a
   fresh random track for the next round.

The road width scales with the number of connected players (+9% per extra
player, capped) so 15 cars can line up side by side. If the WebSocket can't be
reached (e.g. you're on a static-only server), the game silently stays in solo
mode and keeps retrying.

## Controls

| Key | Action |
| --- | ------ |
| `W` / `Up` | accelerate |
| `S` / `Down` | brake / reverse |
| `A`, `D` or `Left`, `Right` | steer |
| `R` or `Space` | back to the garage (after finishing) |
| `G` | back to the garage (mid-race; in mp you leave the round alone) |
| `N` | new random track (solo only — in mp the track is shared) |
| `C` | classic hand-crafted track (solo only) |

In the **garage**: arrows/WASD move the selection, `R` picks a random vehicle,
`ENTER` starts the race (solo) or ready-up / start-for-everyone (multiplayer).

## Rules

- Reach the checkered **finish line** to win — your time is shown.
- Touching any obstacle (cone, barrel, rock, barrier) = crash: after a short
  delay you respawn at the start and the timer keeps running.
- Leaving the road (grass or water) heavily slows the car down; it is not an
  instant crash.
- The tunnel is narrow — one side is blocked by a rock, use the other half.

## Project structure

```
index.html      Canvas + page shell, loads src/main.js as an ES module
server.js       Zero-dependency Node server: static files + the multiplayer room
                (prints your LAN IP to share with other players)
package.json    Only defines "dev": "node server.js" — no dependencies
src/
  main.js       Entry point: canvas setup, the requestAnimationFrame game loop,
                wires world + car + camera + input + gameState together
  world.js      Track/world setup: builds a world from a centerline — either
                the classic hand-crafted one (seed 0) or a generated one — with
                the four sections in order (OPEN -> TUNNEL -> BRIDGE -> FINISH),
                per-section width/color, water under the bridge, scenery trees,
                obstacle placement, start/finish lines and all world rendering.
                Also exposes trackInfoAt() (nearest point / arc length on road).
  trackgen.js   Procedural generation: seeded PRNG (mulberry32) + constrained
                random walk (bounded curvature, self-avoidance) producing the
                centerline waypoints and section fractions for a seed.
  car.js        Arcade car physics: acceleration, braking/reverse, drag,
                speed-scaled steering, off-road slowdown; draws the car sprite.
  input.js      Keyboard state (held + edge-triggered presses) and mapping to
                {throttle, steer} drive commands.
  camera.js     Viewport logic: smooth follow with look-ahead in the direction
                of travel, keeps the car centered; world->screen transform.
  collision.js  Car (circle) vs obstacles (circles + oriented box for the
                barrier), plus the off-track check.
   gameState.js  Game states (countdown / playing / crashed / finished), timer,
                 win condition at the finish line, crash -> reset-to-start flow,
                 the checkered-flag countdown panel and the on-screen HUD.
   garage.js     Pre-race vehicle selection overlay; in multiplayer it doubles
                 as the lobby (player list, shareable URL, ready/start).
   vehicles.js   The 12-vehicle catalog: per-vehicle physics stats + top-down
                 canvas sprites (sports car, taxi, police, ambulance, fire
                 truck, cement mixer, dump truck, flatbed, bus, tank...).
   net.js        Thin WebSocket client for the room; falls back to solo when
                 no server is reachable.
   remotes.js    Other players' cars: snapshot buffer + interpolation ~120 ms
                 behind real time, name tags, staleness handling.
   utils.js      Small shared math helpers (clamp/lerp, closest point on
                 segment, circle & oriented-box collision, rounded rect path).
server/
  wsserver.js   Minimal RFC 6455 WebSocket server (zero dependencies):
                text frames, ping/pong, close handshake.
  room.js       The game room: lobby -> synced countdown -> race -> lobby.
                Authoritative for the round flow; relays position snapshots;
                scales road width with player count.
```

### How a frame flows

1. `main.js` computes `dt`, reads input and calls `car.update()` **only** in the
   `playing` state.
2. `collision.js` checks the car against obstacles (crash) or the road surface
   (off-track slowdown).
3. `gameState.update()` advances the timer, detects crossing the finish line
   (win), and after a crash delay respawns the car at the start.
4. `camera.update()` eases toward the car with look-ahead; rendering then draws
   world -> remote cars -> car in camera space, and finally the HUD (or the
   garage overlay) in screen space.

### Multiplayer flow

1. On load the client opens a WebSocket to the same host/port (`?name=...`).
2. The server's `Room` puts everyone in a lobby; each player picks a vehicle
   and readies up (garage screen). One `start` message flips the room into a
   5-second countdown — one shared `setTimeout` on the server is the sync
   point, then a single `go` broadcast releases every car at once.
3. During the race each client sends ~15 position snapshots/second; the server
   relays them to everyone else and clients interpolate ~120 ms behind real
   time so motion stays smooth.
4. Finishing (or leaving) is broadcast; when no racers remain, the room resets
   to the lobby with a fresh seed for the next round.

## License

Released under the [MIT License](LICENSE) — free to use, modify and redistribute.
