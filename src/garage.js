import { VEHICLES, STAT_BARS } from './vehicles.js';
import { roundRectPath } from './utils.js';
import { FAMILIES, FAMILY_NAMES, FAMILY_COLORS, pickFamilyIndex, Roulette } from './families.js';
import { drawSpeedometer } from './speedometer.js';

const BAR_KEYS = ['speed', 'accel', 'grip'];
const BAR_LABELS = ['SPD', 'ACC', 'GRIP'];
const ROW_H = 54;

// Which catalog row each vehicle lives on, for the STAT_BARS lookups.
const STAT_INDEX = new Map(VEHICLES.map((v, i) => [v.id, i]));

// ---- countries (the "world" filter) ------------------------------------------
// Three geographic markets + a "World" catch-all. `gx/gy` are the marker
// anchors on the 12x7 world grid below.
const REGION_ORDER = ['ALL', 'NA', 'EU', 'JP'];
const REGION_LABEL = { ALL: 'World', NA: 'N. America', EU: 'Europe', JP: 'Asia (JP)' };
const GEO = {
  NA: { gx: 3.1, gy: 2.2 },
  EU: { gx: 7.9, gy: 1.7 },
  JP: { gx: 10.5, gy: 1.5 },
};
const REGION_COUNT = { ALL: VEHICLES.length };
for (const v of VEHICLES) REGION_COUNT[v.region] = (REGION_COUNT[v.region] || 0) + 1;

// A deliberately coarse, recognisable world map (12 x 7 grid, 1 = land).
// North America (left), Europe + Africa (center), Japan (top right), a hint of
// South America and Australia. Stylised on purpose — it's a picker, not a chart.
const WORLD = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1],
  [0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0],
  [0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const inRect = (x, y, r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// Pre-race vehicle selection. Left: a world map to filter by country. Center: an
// alphabetically-sorted, scrollable list with a thumbnail per car. Right: a big
// preview with the stat bars. Doubles as the multiplayer lobby (player list,
// shareable address, ready/start flow) — that protocol is unchanged.
export class Garage {
  constructor() {
    this.mode = 'solo'; // 'solo' | 'mp'
    this.players = []; // lobby entries: {id, name, vehicleId, ready, color}
    this.you = null; // my player id in mp mode
    this.shareUrl = '';
    this.raceInProgress = false; // someone else started the round already

    // Name entry (first screen): draft is what's being typed, name is confirmed.
    this.draftName = '';
    this.name = '';
    this.nameDone = false;

    // Vehicle picker state.
    this.region = 'ALL';
    this.query = '';
    this.list = []; // filtered + sorted vehicles (VEHICLES refs)
    this.cursor = 0; // index into this.list
    this.scrollY = 0; // list scroll offset (px), eased toward scrollTarget
    this.scrollTarget = 0;
    this.hoverRow = -1;
    this.hoverEase = 0;
    this.previewT = 1; // 0..1 pop-in for the big preview
    this.lastPreviewId = null;
    this.mapPulse = 0;
    this.listT = 0;
    this._lastNow = 0;

    // Hit rects from the last draw (mouse).
    this.rowRects = [];
    this.chipRects = [];
    this.markerRects = [];
    this.btnRect = null;
    this.searchRect = null;
    this.clearRect = null;
    this.randomRect = null;

    this.thumbCache = new Map();
    this.reduceMotion = (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Fairness roulette (point 1): before the picker, a wheel draws one of the
    // 5 speed families; only that family's cars are selectable. Re-spun on every
    // entry to the garage via resetWheel() (main.js toGarage).
    this.spin = new Roulette(FAMILIES.length);
    this.spinStarted = false;
    this.spinDone = false;
    this.wheelDone = false;
    this.drawnFamily = null; // index into FAMILIES once the wheel stops

    // Build the initial (unfiltered) list so the picker is never empty on entry.
    this.rebuild();
  }

  // Re-arm the roulette so a fresh family is drawn each time we enter the garage.
  resetWheel() {
    this.spin = new Roulette(FAMILIES.length);
    this.spinStarted = false;
    this.spinDone = false;
    this.wheelDone = false;
    this.drawnFamily = null;
    this.cursor = 0;
    this.rebuild();
  }

  confirmName(name) {
    this.name = String(name || '').trim().slice(0, 16) || 'Player';
    this.draftName = this.name;
    this.nameDone = true;
  }

  get selected() { return this.list[this.cursor] || VEHICLES[0]; }

  setLobby(players, you) {
    this.players = players || [];
    this.you = you || null;
    const me = this.players.find((p) => p.id === you);
    if (me && !me.ready) this.localReady = false; // server reset my ready flag
  }

  // ---- derived list ------------------------------------------------------------

  // Re-filter + re-sort the visible list. Keeps the current car if it survives
  // the new filter, otherwise falls back to the first row.
  rebuild(keepSelection = true) {
    const q = this.query.trim().toLowerCase();
    // Family constraint (point 1): once the roulette has drawn a family, only
    // that family's cars are selectable. Region + search sub-filter within it.
    const fam = this.drawnFamily;
    const famIds = fam !== null ? new Set(FAMILIES[fam].vehicles.map((v) => v.id)) : null;
    const keep = (v) =>
      (famIds === null || famIds.has(v.id)) &&
      (this.region === 'ALL' || v.region === this.region) &&
      (!q || v.name.toLowerCase().includes(q) || v.short.toLowerCase().includes(q));
    const list = VEHICLES.filter(keep).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const prevId = keepSelection && this.list[this.cursor] ? this.list[this.cursor].id : null;
    let idx = prevId ? list.findIndex((v) => v.id === prevId) : 0;
    if (idx < 0) idx = 0;
    this.list = list;
    this.cursor = clamp(idx, 0, Math.max(0, list.length - 1));
    this.scrollY = 0;
    this.scrollTarget = 0;
    this.listT = 0;
    this.mapPulse = 0;
    this.hoverRow = -1;
  }

  setRegion(id) {
    if (this.region === id) return;
    this.region = id;
    this.rebuild();
  }

  selectRow(idx) {
    this.cursor = clamp(idx, 0, Math.max(0, this.list.length - 1));
    this.scrollTarget = this.cursor * ROW_H;
  }

  randomCar() {
    if (!this.list.length) return;
    this.cursor = (Math.random() * this.list.length) | 0;
    this.scrollTarget = this.cursor * ROW_H;
    this.previewT = 0;
  }

  cycleRegion(dir) {
    const i = REGION_ORDER.indexOf(this.region);
    this.setRegion(REGION_ORDER[(i + dir + REGION_ORDER.length) % REGION_ORDER.length]);
  }

  // ---- input ---------------------------------------------------------------

  update(input) {
    if (!this.nameDone) return this.updateNameScreen(input);
    if (!this.wheelDone) return this.updateWheel(input);
    this.tick();
    const N = this.list.length;
    if (!N) return null;

    let moved = false;
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) { this.cursor = (this.cursor + 1) % N; moved = true; }
    else if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) { this.cursor = (this.cursor - 1 + N) % N; moved = true; }
    else if (input.wasPressed('PageDown')) { this.cursor = Math.min(N - 1, this.cursor + 8); moved = true; }
    else if (input.wasPressed('PageUp')) { this.cursor = Math.max(0, this.cursor - 8); moved = true; }
    else if (input.wasPressed('End')) { this.cursor = N - 1; moved = true; }
    else if (input.wasPressed('Home')) { this.cursor = 0; moved = true; }
    else if (input.wasPressed('BracketRight')) { this.cycleRegion(1); moved = true; }
    else if (input.wasPressed('BracketLeft')) { this.cycleRegion(-1); moved = true; }

    if (moved) {
      this.scrollTarget = this.cursor * ROW_H;
      if (this.list[this.cursor].id !== this.lastPreviewId) { this.previewT = 0; this.lastPreviewId = this.list[this.cursor].id; }
      if (this.mode === 'mp') { this.localReady = false; return 'vehicle'; }
    }

    // Text goes to the search box; BackSpace deletes, Escape clears the filter.
    if (input.wasPressed('BackSpace') && this.query) { this.query = this.query.slice(0, -1); this.rebuild(); return null; }
    if (input.wasPressed('Escape')) {
      if (this.query || this.region !== 'ALL') { this.query = ''; this.region = 'ALL'; this.rebuild(); return null; }
    }
    const typed = input.drainChars();
    if (typed) { this.query = (this.query + typed).slice(0, 24); this.rebuild(); return null; }

    if (this.mode === 'mp' && this.raceInProgress) return null; // wait for the round to end
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('Space')) {
      if (this.mode === 'solo') return 'confirm';
      if (!this.localReady) { this.localReady = true; return 'ready'; }
      return 'start';
    }
    return null;
  }

  // Advance time-based animations (call every frame on the vehicle screen).
  tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._lastNow || now)) / 1000);
    this._lastNow = now;
    if (this.reduceMotion) {
      this.previewT = 1; this.hoverEase = this.hoverRow >= 0 ? 1 : 0; this.scrollY = this.scrollTarget;
      return;
    }
    this.previewT = Math.min(1, this.previewT + dt * 5);
    this.listT += dt;
    this.mapPulse += dt;
    this.hoverEase = lerp(this.hoverEase, this.hoverRow >= 0 ? 1 : 0, Math.min(1, dt * 14));
    this.scrollY = lerp(this.scrollY, this.scrollTarget, Math.min(1, dt * 14));
  }

  // Roulette screen (point 1): the wheel spins, lands on a family, then waits
  // for ENTER/click to proceed to the picker (where only that family is selectable).
  updateWheel(input) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._lastNow || now)) / 1000);
    this._lastNow = now;
    if (!this.spinStarted) {
      this.spinStarted = true;
      this.spin.spin(pickFamilyIndex());
    }
    const confirm = input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('Space');
    if (confirm && this.spin.spinning) this.spin.t = this.spin.dur; // fast-forward this frame
    const r = this.spin.update(dt);
    if (r !== null && !this.spinDone) {
      this.spinDone = true;
      this.drawnFamily = r;
      this.cursor = 0;
      this.lastPreviewId = null;
      this.previewT = 0;
      this.rebuild();
      return null; // stay on the wheel and show the result
    }
    if (this.spinDone && confirm) {
      this.wheelDone = true;
      return 'family'; // main.js may echo the drawn family to the room
    }
    return null;
  }

  // Name entry screen: type characters, BackSpace deletes, ENTER confirms.
  updateNameScreen(input) {
    const typed = input.drainChars();
    if (typed) this.draftName = (this.draftName + typed).slice(0, 16);
    if (input.wasPressed('BackSpace')) this.draftName = this.draftName.slice(0, -1);
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) {
      this.confirmName(this.draftName);
      return 'name'; // main.js sends it to the room so others see it
    }
    return null;
  }

  // Mouse. Returns 'select' (a car/region changed — main may re-sync),
  // 'confirm' (the action button — start/ready), or false (nothing).
  handleClick(x, y) {
    if (inRect(x, y, this.btnRect)) return 'confirm';
    if (inRect(x, y, this.randomRect)) { this.randomCar(); return 'select'; }
    if (inRect(x, y, this.clearRect)) { this.query = ''; this.rebuild(); return 'select'; }
    for (const c of this.chipRects) if (inRect(x, y, c)) { this.setRegion(c.id); return 'select'; }
    for (const m of this.markerRects) if (Math.hypot(x - m.cx, y - m.cy) <= m.r) { this.setRegion(m.id); return 'select'; }
    for (const r of this.rowRects) if (inRect(x, y, r)) { this.selectRow(r.idx); this.previewT = 0; this.lastPreviewId = this.list[this.cursor].id; return 'select'; }
    return false;
  }

  // ---- rendering -----------------------------------------------------------

  // Dimmed track + blue grid floor (shared by the name and vehicle screens).
  drawBackdrop(ctx, w, h) {
    ctx.fillStyle = 'rgba(8,12,20,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(96,134,255,0.10)'; // blue grid floor
    ctx.lineWidth = 1;
    const g = 44;
    for (let x = ((w % g) / 2) % g; x < w; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = ((h % g) / 2) % g; y < h; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }

  // First screen: enter a name before choosing the vehicle.
  drawNameScreen(ctx, w, h) {
    this.drawBackdrop(ctx, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 42px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('ENTER YOUR NAME', w / 2, h * 0.3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('ENTER YOUR NAME', w / 2, h * 0.3);

    const bw = Math.min(460, w - 80), bh = 58;
    const bx = (w - bw) / 2, by = h / 2 - bh / 2;
    roundRectPath(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffd23e';
    ctx.stroke();

    const blinkOn = (performance.now() % 1000) < 600;
    ctx.font = '600 24px system-ui, sans-serif';
    if (this.draftName) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.draftName, bx + 20, by + bh / 2 + 1);
      const tw = ctx.measureText(this.draftName).width;
      if (blinkOn) ctx.fillRect(bx + 20 + tw + 4, by + 13, 2.5, bh - 26);
    } else if (blinkOn) {
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('Type your name…', bx + 20, by + bh / 2 + 1);
    }

    ctx.textAlign = 'center';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23e';
    ctx.fillText('Press ENTER to confirm', w / 2, by + bh + 40);
    if (this.mode === 'mp') {
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.7)';
      ctx.fillText('Other players will see this name in the lobby and on track', w / 2, by + bh + 68);
    }

    // Speed gauge (point 4) — present on every screen, top-right.
    this.drawGauge(ctx, w, h);
  }

  // Speed gauge (point 4): a small needle gauge in the top-right, on every screen.
  drawGauge(ctx, w, h) {
    const v = this.selected;
    const R = Math.min(54, Math.max(40, h * 0.1));
    const cx = w - R - 22, cy = R + 22;
    // Fixed 0–500 scale (matches the racing HUD); the needle sits at the
    // selected car's top speed, so the picker previews how fast it is.
    const topKmh = v && v.stats && v.stats.maxSpeed ? v.stats.maxSpeed : 0;
    drawSpeedometer(ctx, cx, cy, R, topKmh, { maxKmh: 500, label: 'km/h' });
  }

  // Roulette wheel (point 1): the fairness draw before the picker.
  drawWheel(ctx, w, h) {
    this.drawBackdrop(ctx, w, h);
    const cx = w / 2, cy = h / 2 - 14;
    const R = Math.min(w, h) * 0.26;
    const seg = (Math.PI * 2) / FAMILIES.length;

    for (let f = 0; f < FAMILIES.length; f++) {
      const a0 = -Math.PI / 2 + this.spin.angle + f * seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a0 + seg);
      ctx.closePath();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = FAMILY_COLORS[f];
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(10,14,22,0.9)';
      ctx.stroke();
      const am = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(am) * R * 0.62, cy + Math.sin(am) * R * 0.62);
      ctx.rotate(am + Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(10,14,22,0.92)';
      ctx.fillText(FAMILY_NAMES[f], 0, 0);
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#161b24'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffd23e'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - R - 16);
    ctx.lineTo(cx - 11, cy - R + 8);
    ctx.lineTo(cx + 11, cy - R + 8);
    ctx.closePath();
    ctx.fillStyle = '#ffd23e'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(10,14,22,0.9)'; ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('FAIRNESS DRAW', cx, cy - R - 46);
    ctx.fillStyle = '#fff'; ctx.fillText('FAIRNESS DRAW', cx, cy - R - 46);
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,244,0.75)';
    ctx.fillText('A class is drawn at random — only its cars are selectable', cx, cy - R - 24);
    if (this.spin.spinning) {
      ctx.font = '600 17px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('Spinning…', cx, cy + R + 34);
    } else if (this.drawnFamily !== null) {
      const fam = FAMILIES[this.drawnFamily];
      ctx.font = '700 21px system-ui, sans-serif';
      ctx.fillStyle = fam.color;
      ctx.fillText(`You drew: ${fam.name}  (${fam.vehicles.length} cars)`, cx, cy + R + 34);
      ctx.font = '500 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.75)';
      ctx.fillText('Press ENTER to choose your car', cx, cy + R + 60);
    }
    this.drawGauge(ctx, w, h);
  }

  draw(ctx, w, h) {
    if (!this.nameDone) { this.drawNameScreen(ctx, w, h); return; }
    if (!this.wheelDone) { this.drawWheel(ctx, w, h); return; }
    this.drawBackdrop(ctx, w, h);

    // title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 40px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('CHOOSE YOUR VEHICLE', w / 2, 52);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CHOOSE YOUR VEHICLE', w / 2, 52);
    if (this.drawnFamily !== null) {
      const fam = FAMILIES[this.drawnFamily];
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillStyle = fam.color;
      ctx.fillText(`Drawn class — ${fam.name}  ·  ${fam.vehicles.length} cars`, w / 2, 80);
    }

    // layout: [world map]  [list]  [preview], then the action bar
    const margin = 18, gap = 16, pad = 14;
    let top = 92;
    if (this.mode === 'mp') top = this.drawLobbyChips(ctx, w, 96) + 12;

    const btnH = 54, hintH = 26;
    const bottomBlock = btnH + hintH + gap * 2 + 10;
    const panelTop = top;
    const panelBottom = h - bottomBlock;
    const panelH = Math.max(170, panelBottom - panelTop);

    const mapW = clamp(w * 0.24, 196, 330);
    const prevW = clamp(w * 0.30, 250, 392);
    const mapX = margin;
    const listX = mapX + mapW + gap;
    const prevX = Math.min(w - margin - prevW, listX + (w - margin * 2 - gap * 2 - mapW - prevW));
    const listW = Math.max(260, prevX - listX - gap);

    this.drawMapPanel(ctx, mapX, panelTop, mapW, panelH, pad);
    this.drawListPanel(ctx, listX, panelTop, listW, panelH, pad);
    this.drawPreviewPanel(ctx, prevX, panelTop, prevW, panelH, pad);
    this.drawActionBar(ctx, w, panelBottom, btnH, hintH, gap);
    this.drawGauge(ctx, w, h);
  }

  // ---- world map panel -----------------------------------------------------

  drawMapPanel(ctx, x, y, w, h, pad) {
    this.chipRects = [];
    this.markerRects = [];

    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,244,0.75)';
    ctx.fillText('BY  COUNTRY', x + pad, y + pad + 2);

    // map area
    const rows = WORLD.length, cols = WORLD[0].length;
    const mapAreaW = w - pad * 2;
    const mapAreaH = h * 0.52;
    const cell = Math.min(mapAreaW / cols, mapAreaH / rows);
    const mw = cell * cols, mh = cell * rows;
    const mx = x + (w - mw) / 2, my = y + pad + 20;

    // ocean plate
    roundRectPath(ctx, mx - 8, my - 8, mw + 16, mh + 16, 10);
    ctx.fillStyle = 'rgba(20,32,54,0.55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,160,255,0.16)';
    ctx.stroke();

    // land cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!WORLD[r][c]) continue;
        const cx = mx + c * cell, cy = my + r * cell;
        roundRectPath(ctx, cx + 1, cy + 1, cell - 2, cell - 2, Math.min(4, cell * 0.2));
        ctx.fillStyle = 'rgba(96,140,200,0.30)';
        ctx.fill();
      }
    }

    // region markers (clickable)
    for (const id of ['NA', 'EU', 'JP']) {
      const g = GEO[id];
      const cx = mx + g.gx * cell, cy = my + g.gy * cell;
      const active = this.region === id;
      const dim = this.region !== 'ALL' && !active;

      // pulse ring on the active region
      if (active && !this.reduceMotion) {
        const t = (this.mapPulse % 1.6) / 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 5 + t * 12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,210,62,${0.5 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, active ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = dim ? 'rgba(232,237,244,0.35)' : active ? '#ffd23e' : '#9fb6d8';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(10,14,22,0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, active ? 2.4 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,14,22,0.9)';
      ctx.fill();

      this.markerRects.push({ id, cx, cy, r: 14 });

      ctx.textAlign = 'center';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = active ? '#ffd23e' : dim ? 'rgba(232,237,244,0.4)' : 'rgba(232,237,244,0.8)';
      ctx.fillText(REGION_LABEL[id].split(' ')[0].toUpperCase(), cx, my + mh + 14);
    }

    // region chips (with counts) at the bottom of the panel
    const chips = REGION_ORDER;
    const chipGap = 6;
    const total = w - pad * 2;
    const chipW = (total - chipGap * (chips.length - 1)) / chips.length;
    const chipH = 30;
    const chipY = y + h - pad - chipH;
    ctx.textBaseline = 'middle';
    chips.forEach((id, i) => {
      const cx = x + pad + i * (chipW + chipGap);
      const active = this.region === id;
      roundRectPath(ctx, cx, chipY, chipW, chipH, 8);
      ctx.fillStyle = active ? 'rgba(255,210,62,0.18)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = active ? '#ffd23e' : 'rgba(255,255,255,0.16)';
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = active ? '#ffd23e' : '#dfe6ee';
      const label = REGION_LABEL[id].split(' ')[0];
      ctx.fillText(label, cx + chipW / 2 - 7, chipY + chipH / 2 - 4);
      ctx.font = '500 9px system-ui, sans-serif';
      ctx.fillStyle = active ? 'rgba(255,210,62,0.8)' : 'rgba(232,237,244,0.55)';
      ctx.fillText(String(REGION_COUNT[id] || 0), cx + chipW / 2 - 7, chipY + chipH / 2 + 9);
      this.chipRects.push({ id, x: cx, y: chipY, w: chipW, h: chipH });
    });
    ctx.textBaseline = 'alphabetic';
  }

  // ---- list panel ----------------------------------------------------------

  getThumb(v) {
    let c = this.thumbCache.get(v.id);
    if (c) return c;
    const pw = 64, ph = 36;
    c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const g = c.getContext('2d');
    g.translate(pw / 2, ph / 2);
    g.scale(1.02, 1.02);
    v.draw(g);
    this.thumbCache.set(v.id, c);
    return c;
  }

  drawListPanel(ctx, x, y, w, h, pad) {
    this.rowRects = [];
    const headerH = 58;
    const vx = x + pad, vw = w - pad * 2;
    const vy = y + pad + headerH - 20;
    const vh = h - pad * 2 - headerH + 20;

    // panel
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    // search box (always active — typing filters the list)
    const sw = vw - 40, sh = 30;
    const sx = vx, sy = y + pad;
    roundRectPath(ctx, sx, sy, sw, sh, 8);
    ctx.fillStyle = 'rgba(10,14,22,0.5)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,210,62,0.5)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '500 13px system-ui, sans-serif';
    const q = this.query;
    ctx.fillStyle = q ? '#ffffff' : 'rgba(232,237,244,0.45)';
    ctx.fillText(q || 'Type to search…', sx + 12, sy + sh / 2 + 1);
    if (q) {
      const tw = ctx.measureText(q).width;
      if ((performance.now() % 1000) < 600) ctx.fillRect(sx + 12 + tw + 4, sy + 8, 2, sh - 16);
    }
    // clear (x)
    if (q) {
      const crr = { x: sx + sw - 24, y: sy + 5, w: 19, h: 19 };
      roundRectPath(ctx, crr.x, crr.y, crr.w, crr.h, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(crr.x + 6, crr.y + 6); ctx.lineTo(crr.x + 13, crr.y + 13);
      ctx.moveTo(crr.x + 13, crr.y + 6); ctx.lineTo(crr.x + 6, crr.y + 13);
      ctx.stroke();
      this.clearRect = crr;
    } else this.clearRect = null;
    // random (dice)
    const rr = { x: sx + sw + 6, y: sy, w: 30, h: sh };
    roundRectPath(ctx, rr.x, rr.y, rr.w, rr.h, 8);
    ctx.fillStyle = 'rgba(127,178,255,0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(127,178,255,0.45)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#9fc2ff';
    ctx.fillText('⚄', rr.x + rr.w / 2, rr.y + rr.h / 2 + 1);
    this.randomRect = rr;

    // count + active filter
    ctx.textAlign = 'right';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,244,0.6)';
    const filterLabel = this.region === 'ALL' ? 'World' : REGION_LABEL[this.region];
    ctx.fillText(`${this.list.length} cars · ${filterLabel}`, vx + vw, sy + sh + 14);

    // scroll viewport
    ctx.save();
    roundRectPath(ctx, vx, vy, vw, vh, 10);
    ctx.fillStyle = 'rgba(8,12,20,0.4)';
    ctx.fill();
    ctx.clip();

    const list = this.list;
    if (!list.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.5)';
      ctx.fillText('No cars match — clear the search', vx + vw / 2, vy + vh / 2);
    }

    const first = Math.max(0, Math.floor(this.scrollY / ROW_H) - 1);
    const last = Math.min(list.length, Math.ceil((this.scrollY + vh) / ROW_H) + 1);
    for (let i = first; i < last; i++) {
      const v = list[i];
      const ry = vy + i * ROW_H - this.scrollY;
      if (ry + ROW_H < vy - 2 || ry > vy + vh + 2) continue;
      const sel = i === this.cursor;
      const hover = i === this.hoverRow;
      const a = this.reduceMotion ? 1 : easeOut(clamp((this.listT - i * 0.012) / 0.22, 0, 1));

      ctx.globalAlpha = a;
      const rx = vx + 4, rw = vw - 8;

      // row bg
      roundRectPath(ctx, rx, ry + 3, rw, ROW_H - 6, 9);
      ctx.fillStyle = sel ? 'rgba(255,210,62,0.14)' : hover ? `rgba(255,255,255,${0.06 + 0.05 * this.hoverEase})` : 'rgba(255,255,255,0.03)';
      ctx.fill();
      if (sel) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,210,62,0.55)';
        ctx.stroke();
        // amber selection tab on the left edge
        roundRectPath(ctx, vx + 4, ry + 8, 4, ROW_H - 16, 2);
        ctx.fillStyle = '#ffd23e';
        ctx.fill();
      }

      // thumbnail
      ctx.drawImage(this.getThumb(v), rx + 8, ry + (ROW_H - 30) / 2, 52, 28);

      // name + sub
      const tx = rx + 66;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = sel ? '700 14px system-ui, sans-serif' : '600 13px system-ui, sans-serif';
      ctx.fillStyle = sel ? '#ffd23e' : '#e7edf5';
      const nameW = Math.min(150, rw - 66 - 96);
      ctx.fillText(clip(ctx, v.name, nameW), tx, ry + ROW_H / 2 - 8);
      ctx.font = '500 10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.55)';
      const sub = `${v.era} · ${REGION_LABEL[v.region]}`;
      ctx.fillText(clip(ctx, sub, nameW), tx, ry + ROW_H / 2 + 9);

      // top speed on the right
      ctx.textAlign = 'right';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = sel ? '#ffd23e' : 'rgba(159,198,255,0.85)';
      ctx.fillText(`${v.stats.maxSpeed}`, vx + vw - 34, ry + ROW_H / 2 - 8);
      ctx.font = '500 9px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.45)';
      ctx.fillText('u/s', vx + vw - 34, ry + ROW_H / 2 + 9);

      this.rowRects.push({ x: rx, y: ry + 2, w: rw, h: ROW_H - 4, idx: i });
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // scroll indicator
    if (list.length * ROW_H > vh) {
      const content = list.length * ROW_H;
      const trackX = vx + vw - 6, trackY = vy + 4, trackH = vh - 8;
      roundRectPath(ctx, trackX, trackY, 3, trackH, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fill();
      const thumbH = Math.max(24, trackH * (vh / content));
      const maxOff = trackH - thumbH;
      const off = clamp(this.scrollY / (content - vh), 0, 1) * maxOff;
      roundRectPath(ctx, trackX, trackY + off, 3, thumbH, 1.5);
      ctx.fillStyle = 'rgba(255,210,62,0.7)';
      ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---- preview panel -------------------------------------------------------

  drawPreviewPanel(ctx, x, y, w, h, pad) {
    const v = this.selected;
    const idx = STAT_INDEX.get(v.id) || 0;

    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,244,0.75)';
    ctx.fillText('PREVIEW', x + pad, y + pad + 2);

    // big car with a pop-in animation
    const cx = x + w / 2;
    const stageH = Math.min(h * 0.44, 190);
    const cy = y + pad + 20 + stageH / 2;
    const pop = this.reduceMotion ? 1 : easeOut(this.previewT);
    const scale = Math.min(stageH / 34, (w - 40) / 60) * (0.9 + 0.1 * pop);
    ctx.save();
    ctx.globalAlpha = this.reduceMotion ? 1 : 0.25 + 0.75 * pop;
    // soft floor glow
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16 * scale, 40 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    v.draw(ctx);
    ctx.restore();
    ctx.globalAlpha = 1;

    // name + meta
    const metaY = cy + Math.min(60, stageH / 2 + 26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(clip(ctx, v.name, w - 30), x + w / 2, metaY + 4);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,198,255,0.85)';
    ctx.fillText(`${v.era}  ·  ${REGION_LABEL[v.region]}`, x + w / 2, metaY + 24);

    // stat bars
    const barY = metaY + 46;
    const barX = x + pad + 6, barW = w - pad * 2 - 12;
    for (let k = 0; k < BAR_KEYS.length; k++) {
      const by = barY + k * 24;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.7)';
      ctx.fillText(BAR_LABELS[k], barX, by + 2);
      const trackX = barX + 42, trackW = barW - 42;
      roundRectPath(ctx, trackX, by - 5, trackW, 9, 4.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      const val = STAT_BARS[BAR_KEYS[k]][idx] || 0;
      const fillW = (this.reduceMotion ? 1 : pop) * Math.max(0.02, val) * trackW;
      if (fillW > 1) {
        roundRectPath(ctx, trackX, by - 5, fillW, 9, 4.5);
        ctx.fillStyle = '#ffd23e';
        ctx.fill();
      }
      // numeric hint
      ctx.textAlign = 'right';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.6)';
      const num = BAR_KEYS[k] === 'speed' ? `${v.stats.maxSpeed}` : BAR_KEYS[k] === 'accel' ? `${v.stats.accel}` : `${v.stats.turnRate.toFixed(1)}`;
      ctx.fillText(num, barX + barW, by + 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---- action bar (button + hints) ----------------------------------------

  btnLabel() {
    if (this.mode === 'mp') {
      if (this.raceInProgress) return 'RACE IN PROGRESS';
      const me = this.players.find((p) => p.id === this.you);
      return (me && me.ready) ? 'START FOR ALL  ▸' : 'READY  ▸';
    }
    return 'START RACE  ▸';
  }

  drawActionBar(ctx, w, panelBottom, btnH, hintH, gap) {
    const by = panelBottom + gap;
    const bw = Math.min(420, w - 60);
    const bx = (w - bw) / 2;
    this.btnRect = { x: bx, y: by, w: bw, h: btnH };

    const disabled = this.mode === 'mp' && this.raceInProgress;
    const ready = this.mode === 'mp' && !this.raceInProgress && this.players.find((p) => p.id === this.you)?.ready;

    // glow under the button
    roundRectPath(ctx, bx + 6, by + btnH, bw - 12, 6, 3);
    ctx.fillStyle = ready ? 'rgba(125,255,138,0.5)' : 'rgba(255,210,62,0.35)';
    ctx.fill();

    roundRectPath(ctx, bx, by, bw, btnH, 12);
    ctx.fillStyle = disabled ? 'rgba(255,255,255,0.05)' : ready ? 'rgba(125,255,138,0.16)' : 'rgba(255,210,62,0.14)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = disabled ? 'rgba(255,255,255,0.2)' : ready ? '#7dff8a' : '#ffd23e';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillStyle = disabled ? 'rgba(232,237,244,0.5)' : ready ? '#7dff8a' : '#ffd23e';
    ctx.fillText(this.btnLabel(), bx + bw / 2, by + btnH / 2 + 1);

    // share URL (mp) sits in the hints row
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,244,0.6)';
    const hint = this.mode === 'mp'
      ? `↑ ↓ list · type to search · click the map to filter · ENTER ready/start     ·     share ${this.shareUrl}`
      : '↑ ↓ list · type to search · click the map to filter · ENTER start';
    ctx.fillText(hint, w / 2, by + btnH + hintH / 2 + 4);
  }

  // MP lobby chips under the title; returns the bottom y of the chips row.
  drawLobbyChips(ctx, w, y) {
    const chipH = 26, gapX = 8, maxW = w - 60;
    let x = (w - Math.min(maxW, this.players.length * 130)) / 2, cy = y;
    ctx.textBaseline = 'middle';
    ctx.font = '500 13px system-ui, sans-serif';
    for (const p of this.players) {
      const label = `${p.name}${p.id === this.you ? ' (you)' : ''}`;
      const cw = ctx.measureText(label).width + 42;
      if (x + cw > w - 30 && x > 30) { x = (w - Math.min(maxW, this.players.length * 130)) / 2; cy += chipH + gapX; }
      roundRectPath(ctx, x, cy, cw, chipH, 13);
      ctx.fillStyle = p.ready ? 'rgba(125,255,138,0.14)' : 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.ready ? 'rgba(125,255,138,0.6)' : 'rgba(255,255,255,0.2)';
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x + 14, cy + chipH / 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dfe6ee';
      ctx.fillText(label, x + 26, cy + chipH / 2 + 1);
      if (p.ready) { ctx.fillStyle = '#7dff8a'; ctx.fillText('✓', x + cw - 18, cy + chipH / 2 + 1); }
      ctx.textAlign = 'center';
      x += cw + gapX;
    }
    return cy + chipH;
  }
}

// Truncate a string to fit a pixel width (keeps a trailing ellipsis).
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
