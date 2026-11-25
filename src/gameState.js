import { roundRectPath, clamp } from './utils.js';
import { Splash, SPLASH_WORD } from './effects.js';

export const State = Object.freeze({
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  CRASHED: 'crashed',
  FINISHED: 'finished',
});

const CRASH_RESET_DELAY = 1.8; // seconds the car stays down before respawning at start
const SPLASH_RESET_DELAY = 2.4; // same, but the swimmer gets a longer plouf!
const SINK_SECONDS = 1.2;      // how long the car takes to slip under
const COUNTDOWN_SECONDS = 5;   // pre-race checkered countdown
const GO_FLASH = 0.9;          // seconds "GO!" stays on screen after the light turns green

export class GameState {
  constructor(car) {
    this.car = car;
    this.reset();
  }

  reset() {
    this.beginCountdown(COUNTDOWN_SECONDS, false);
    this.time = 0;
    this.crashTimer = 0;
    this.crashPoint = null;
    this.crashKind = 'crash'; // 'crash' | 'splash'
    this.fx = null;           // splash effect (world space)
  }

  // Solo: the countdown runs locally. Multiplayer (synced=true): the server's
  // 'go' message ends it — beginCountdown() is called from that flow instead.
  beginCountdown(seconds, synced) {
    this.state = State.COUNTDOWN;
    this.countdown = seconds;
    this.goTimer = 0;
    this.synced = !!synced;
  }

  // Server 'go' (or a local fallback): lights out.
  go() {
    if (this.state !== State.COUNTDOWN) return;
    this.state = State.PLAYING;
    this.goTimer = GO_FLASH;
  }

  crash(point) {
    if (this.state !== State.PLAYING) return;
    this.sendBackToStart(point, 'crash');
  }

  // Two opposite wheels in the drink: same penalty as a crash (respawn at the
  // start line) but the car sinks under with a plouf! instead of a crash ring.
  splash(point) {
    if (this.state !== State.PLAYING) return;
    this.sendBackToStart(point, 'splash');
  }

  sendBackToStart(point, kind) {
    this.state = State.CRASHED;
    this.crashKind = kind;
    this.crashTimer = kind === 'splash' ? SPLASH_RESET_DELAY : CRASH_RESET_DELAY;
    this.crashPoint = { x: point.x, y: point.y };
    this.fx = kind === 'splash' ? new Splash(point.x, point.y) : null;
  }

  finish() {
    this.state = State.FINISHED;
  }

  update(dt, world) {
    if (this.state === State.COUNTDOWN) {
      this.countdown -= dt;
      // Solo: lights out locally. Synced: wait for the server's 'go' — with a
      // 2s grace in case the message was lost.
      if (!this.synced && this.countdown <= 0) this.go();
      else if (this.synced && this.countdown <= -2) this.go();
    } else if (this.state === State.PLAYING) {
      this.time += dt;
      if (this.goTimer > 0) this.goTimer -= dt;
      const info = world.trackInfoAt(this.car.x, this.car.y);
      // win: crossed the finish line while on the road surface
      if (info.s >= world.finishS && info.dist <= info.section.width / 2 + 8) {
        this.finish();
      }
    } else if (this.state === State.CRASHED) {
      this.time += dt; // the race clock keeps running through the swim/respawn
      this.crashTimer -= dt;
      if (this.crashKind === 'splash') {
        this.car.sinking = clamp((SPLASH_RESET_DELAY - this.crashTimer) / SINK_SECONDS, 0, 1);
      }
      if (this.crashTimer <= 0) {
        this.car.reset(); // back to the start
        this.state = State.PLAYING;
      }
    }
  }

  drawHUD(ctx, w, h, sectionName, offTrack, trackLabel, vehicleLabel, posLabel, inDrink = false, turboState = null) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lines = [
      'Controls: W/Up gas - S/Down brake/reverse',
      'A/D or Left/Right steer · Space turbo · F NOS · X/C/V lights · N new · T classic · G garage',
      `TIME ${this.time.toFixed(1)}s   SECTION ${sectionName}${trackLabel ? `   TRACK ${trackLabel}` : ''}${vehicleLabel ? `   VEHICLE ${vehicleLabel}` : ''}${posLabel ? `   ${posLabel}` : ''}`, 
    ];
    // warnings get their own colour (the drink one outranks plain off-track)
    const colors = ['#e8edf4', '#e8edf4', '#e8edf4'];
    if (this.state === State.PLAYING) {
      if (inDrink) {
        lines.push('IN THE WATER! A wheel is wet - two opposite ones = plouf!');
        colors.push('#5fd8ff');
      } else if (offTrack) {
        lines.push('OFF TRACK! You are slowing down');
        colors.push('#ffd23e');
      }
      // turbo hint only when a racer is ahead to chase
      if (turboState === 'on') {
        lines.push('TURBO ON! Faster until your nose is level with the car ahead');
        colors.push('#ffb14e');
      } else if (turboState === 'ready') {
        lines.push('TURBO READY - hold Space to catch the car ahead');
        colors.push('#8fa3bf');
      }
    }

    ctx.font = '600 15px system-ui, sans-serif';
    const panelW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28;
    const lineH = 22;
    ctx.fillStyle = 'rgba(10,14,20,0.55)';
    roundRectPath(ctx, 14, 14, panelW, lines.length * lineH + 16, 10);
    ctx.fill();
    lines.forEach((line, i) => {
      ctx.fillStyle = colors[i] || '#e8edf4';
      ctx.fillText(line, 26, 14 + 24 + i * lineH);
    });

    // centered state messages
    if (this.state === State.CRASHED) {
      const back = `Back to the start in ${Math.max(0, this.crashTimer).toFixed(1)}s...`;
      if (this.crashKind === 'splash') this.drawBanner(ctx, w / 2, h * 0.3, SPLASH_WORD, back, '#5fd8ff');
      else this.drawBanner(ctx, w / 2, h * 0.3, 'CRASHED!', back, '#ff5a4e');
    } else if (this.state === State.FINISHED) {
      this.drawBanner(ctx, w / 2, h * 0.3, `FINISHED IN ${this.time.toFixed(1)}s!`, 'R/Space: retry  ·  N: new track  ·  G: garage', '#7dff8a');
    } else if (this.state === State.COUNTDOWN) {
      const d = Math.ceil(this.countdown);
      const e = d - this.countdown; // 0 -> 1 within the current digit's second
      this.drawFlagPanel(ctx, w / 2, h * 0.4, String(d), '#ffffff', 'Get ready...',
        1 + 0.3 * Math.max(0, 1 - e / 0.3)); // pop-in on each new digit
    } else if (this.goTimer > 0) {
      const e = GO_FLASH - this.goTimer;
      this.drawFlagPanel(ctx, w / 2, h * 0.4, 'GO!', '#7dff8a', null,
        1 + 0.3 * Math.max(0, 1 - e / 0.3));
    }
    ctx.restore();
  }

  drawBanner(ctx, x, y, title, sub, color) {
    ctx.textAlign = 'center';
    ctx.font = '800 52px system-ui, sans-serif';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(title, x, y);
    ctx.fillStyle = color;
    ctx.fillText(title, x, y);
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeText(sub, x, y + 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sub, x, y + 40);
  }

  // Big checkered-flag panel with a centered word (countdown digit or GO!).
  drawFlagPanel(ctx, x, y, text, color, sub, pop = 1) {
    const S = 290;      // outer size of the checkerboard
    const cell = S / 8; // 8x8 flag pattern
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#f4f4f4' : '#15181d';
        ctx.fillRect(-S / 2 + i * cell, -S / 2 + j * cell, cell, cell);
      }
    }
    // solid dark inner panel keeps the text readable against the flag pattern
    roundRectPath(ctx, -S / 2 + 30, -S / 2 + 30, S - 60, S - 60, 18);
    ctx.fillStyle = '#161b24';
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(150 * pop)}px system-ui, sans-serif`;
    ctx.lineWidth = 14;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, 0, sub ? -18 : 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, sub ? -18 : 0);

    if (sub) {
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeText(sub, 0, S / 2 - 58);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(sub, 0, S / 2 - 58);
    }
    ctx.restore();
  }

  // expanding ring at the crash spot, or the whole plouf! when the car swam
  // back to the start (world space; `now` is the rAF timestamp in ms)
  drawImpactFx(ctx, now) {
    if (!this.crashPoint || this.state !== State.CRASHED) return;
    if (this.fx) {
      if (!this.fx.expired(now)) this.fx.draw(ctx, now);
      return;
    }
    const t = 1 - this.crashTimer / CRASH_RESET_DELAY; // 0 -> 1
    ctx.save();
    ctx.strokeStyle = `rgba(255,90,60,${Math.max(0, 1 - t)})`;
    ctx.lineWidth = 4 + t * 10;
    ctx.beginPath();
    ctx.arc(this.crashPoint.x, this.crashPoint.y, 20 + t * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
