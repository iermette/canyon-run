import { VEHICLES, STAT_BARS } from './vehicles.js';
import { roundRectPath } from './utils.js';

const COLS = 4;
const ROWS = Math.ceil(VEHICLES.length / COLS);
const BAR_KEYS = ['speed', 'accel', 'grip'];
const BAR_LABELS = ['SPD', 'ACC', 'GRIP'];

// Pre-race vehicle selection. Drawn as an overlay on top of the track scene,
// with a blue grid floor as a nod to the reference sheet. In multiplayer it
// doubles as the lobby: player list, shareable address and ready/start flow.
export class Garage {
  constructor() {
    this.index = 0;
    this.cards = []; // card rects from the last draw (for mouse clicks)
    this.mode = 'solo';        // 'solo' | 'mp'
    this.players = [];         // lobby entries: {id, name, vehicleId, ready, color}
    this.you = null;           // my player id in mp mode
    this.shareUrl = '';
    this.raceInProgress = false; // someone else started the round already
    // Name entry (first screen): draft is what's being typed, name is confirmed.
    this.draftName = '';
    this.name = '';
    this.nameDone = false;
  }

  confirmName(name) {
    this.name = String(name || '').trim().slice(0, 16) || 'Player';
    this.draftName = this.name;
    this.nameDone = true;
  }

  get selected() { return VEHICLES[this.index]; }

  setLobby(players, you) {
    this.players = players || [];
    this.you = you || null;
    const me = this.players.find((p) => p.id === you);
    if (me && !me.ready) this.localReady = false; // server reset my ready flag
  }

  update(input) {
    if (!this.nameDone) return this.updateNameScreen(input);

    const N = VEHICLES.length;
    let moved = false;
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) { this.index = (this.index + COLS - 1) % N; moved = true; }
    else if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) { this.index = (this.index + 1) % N; moved = true; }
    else if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) { this.index = (this.index - COLS + N) % N; moved = true; }
    else if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) { this.index = (this.index + COLS) % N; moved = true; }
    else if (input.wasPressed('KeyR')) { this.index = (Math.random() * N) | 0; moved = true; }
    // Changing the vehicle in mp means re-reading: my 'ready' is stale.
    if (moved && this.mode === 'mp') this.localReady = false;

    if (this.mode === 'mp' && this.raceInProgress) return null; // wait for the round to end
    if (input.wasPressed('Enter') || input.wasPressed('Space')) {
      if (this.mode === 'solo') return 'confirm';
      if (!this.localReady) { this.localReady = true; return 'ready'; }
      return 'start';
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

  handleClick(x, y) {
    for (const c of this.cards) {
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        this.index = c.i;
        return true;
      }
    }
    return false;
  }

  // Dimmed track + blue grid floor (shared by the name and vehicle screens).
  drawBackdrop(ctx, w, h) {
    ctx.fillStyle = 'rgba(8,12,20,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(96,134,255,0.10)'; // blue grid floor
    ctx.lineWidth = 1;
    const g = 44;
    for (let x = ((w % g) / 2) % g; x < w; x += g) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = ((h % g) / 2) % g; y < h; y += g) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
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

    // input box (left-aligned text + blinking caret)
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
      if (blinkOn) {
        ctx.fillRect(bx + 20 + tw + 4, by + 13, 2.5, bh - 26);
      }
    } else if (blinkOn) {
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('Type your name…', bx + 20, by + bh / 2 + 1);
    }

    // hints
    ctx.textAlign = 'center';
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23e';
    ctx.fillText('Press ENTER to confirm', w / 2, by + bh + 40);
    if (this.mode === 'mp') {
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.7)';
      ctx.fillText('Other players will see this name in the lobby and on track', w / 2, by + bh + 68);
    }
  }

  draw(ctx, w, h) {
    if (!this.nameDone) { this.drawNameScreen(ctx, w, h); return; }

    this.drawBackdrop(ctx, w, h);


    // title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 42px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText('CHOOSE YOUR VEHICLE', w / 2, 56);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CHOOSE YOUR VEHICLE', w / 2, 56);

    // multiplayer: player chips under the title (wraps to a second row)
    let top = 104;
    if (this.mode === 'mp') {
      const chipH = 26, gapX = 8, maxW = w - 60;
      let x = (w - Math.min(maxW, this.players.length * 130)) / 2, y = top;
      ctx.font = '500 13px system-ui, sans-serif';
      for (const p of this.players) {
        const label = `${p.name}${p.id === this.you ? ' (you)' : ''}`;
        const cw = ctx.measureText(label).width + 42;
        if (x + cw > w - 30 && x > 30) { x = (w - Math.min(maxW, this.players.length * 130)) / 2; y += chipH + gapX; }
        roundRectPath(ctx, x, y, cw, chipH, 13);
        ctx.fillStyle = p.ready ? 'rgba(125,255,138,0.14)' : 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.ready ? 'rgba(125,255,138,0.6)' : 'rgba(255,255,255,0.2)';
        ctx.stroke();
        ctx.fillStyle = p.color; // player color dot
        ctx.beginPath(); ctx.arc(x + 14, y + chipH / 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#dfe6ee';
        ctx.fillText(label, x + 26, y + chipH / 2 + 1);
        if (p.ready) {
          ctx.fillStyle = '#7dff8a';
          ctx.fillText('✓', x + cw - 18, y + chipH / 2 + 1);
        }
        ctx.textAlign = 'center';
        x += cw + gapX;
      }
      top = y + chipH + 14;
    }

    // card grid (shrinks to leave room for the lobby chips)
    const gap = 16;
    const bottomPad = this.mode === 'mp' ? 128 : 112;
    const areaH = h - top - bottomPad;
    let cardW = Math.min((w - 80 - gap * (COLS - 1)) / COLS, 340);
    let cardH = Math.min((areaH - gap * (ROWS - 1)) / ROWS, 250);
    const gridW = cardW * COLS + gap * (COLS - 1);
    const gridH = cardH * ROWS + gap * (ROWS - 1);
    const x0 = (w - gridW) / 2;
    const y0 = top + Math.max(0, (areaH - gridH) / 2);

    this.cards = [];
    for (let i = 0; i < VEHICLES.length; i++) {
      const v = VEHICLES[i];
      const cx = x0 + (i % COLS) * (cardW + gap);
      const cy = y0 + ((i / COLS) | 0) * (cardH + gap);
      const sel = i === this.index;

      roundRectPath(ctx, cx, cy, cardW, cardH, 14);
      ctx.fillStyle = sel ? 'rgba(255,210,62,0.13)' : 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = sel ? 3 : 2;
      ctx.strokeStyle = sel ? '#ffd23e' : 'rgba(255,255,255,0.18)';
      ctx.stroke();

      // vehicle preview (scaled up from game size)
      const s = Math.max(1.1, Math.min(cardW / 95, cardH / 78, 2.4));
      ctx.save();
      ctx.translate(cx + cardW / 2, cy + cardH * 0.4);
      ctx.scale(s, s);
      v.draw(ctx);
      ctx.restore();

      // name
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = sel ? '#ffd23e' : '#dfe6ee';
      ctx.fillText(v.name, cx + cardW / 2, cy + cardH - 48);

      // stat bars (normalized across the whole catalog)
      const colW = Math.min(70, (cardW - 32) / 3);
      for (let k = 0; k < BAR_KEYS.length; k++) {
        const bx = cx + 16 + k * (colW + 4);
        const by = cy + cardH - 26;
        ctx.textAlign = 'left';
        ctx.font = '500 9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(232,237,244,0.6)';
        ctx.fillText(BAR_LABELS[k], bx, by - 5);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        roundRectPath(ctx, bx, by, colW - 8, 5, 2.5);
        ctx.fill();
        const val = STAT_BARS[BAR_KEYS[k]][i];
        if (val > 0.04) {
          ctx.fillStyle = sel ? '#ffd23e' : '#7fb2ff';
          roundRectPath(ctx, bx, by, Math.max(5, (colW - 8) * val), 5, 2.5);
          ctx.fill();
        }
      }

      this.cards.push({ x: cx, y: cy, w: cardW, h: cardH, i });
    }

    // bottom lines (vehicle selection screen)
    const sel = VEHICLES[this.index];
    if (this.mode === 'mp') {
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23e';
      ctx.fillText(`Share this address: ${this.shareUrl}`, w / 2, h - 78);

      const me = this.players.find((p) => p.id === this.you);
      let status;
      if (this.raceInProgress) status = 'Race in progress — you will join the next round';
      else if (!me || !me.ready) status = `${sel.name} — ${sel.blurb}`;
      else status = `Ready! Press ENTER to start the race for everyone`;
      ctx.font = '600 17px system-ui, sans-serif';
      ctx.fillStyle = this.raceInProgress ? '#3dd6f5' : (me && me.ready ? '#7dff8a' : '#ffd23e');
      ctx.fillText(status, w / 2, h - 48);

      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.75)';
      ctx.fillText('← → ↑ ↓ / WASD choose · R random · ENTER ready/start', w / 2, h - 22);
    } else {
      ctx.font = '600 17px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23e';
      ctx.fillText(`${sel.name} — ${sel.blurb}`, w / 2, h - 58);
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(232,237,244,0.75)';
      ctx.fillText('← → ↑ ↓ / WASD choose · R random · ENTER start race', w / 2, h - 28);
    }
  }
}
