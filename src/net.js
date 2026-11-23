// Thin client for the game's WebSocket room (same host/port as the page).
// If the connection can't be established, the game simply stays in solo mode.

export class Net {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.handlers = new Map(); // message type -> [fn]
    this.queue = [];           // messages sent before the socket opened
  }

  connect(name) {
    if (this.ws) return true;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/?name=${encodeURIComponent(name || '')}`);
    } catch {
      this.emit('fail');
      return false;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      for (const m of this.queue.splice(0)) ws.send(m);
      this.emit('connect');
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const fns = this.handlers.get(msg.t);
      if (fns) for (const fn of fns) fn(msg);
    };
    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      this.emit(wasConnected ? 'disconnect' : 'fail');
    };
    return true;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  send(obj) {
    const text = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (this.queue.length < 50) this.queue.push(text); // small buffer until open
  }

  emit(type, ...args) {
    const fns = this.handlers.get(type);
    if (fns) for (const fn of fns) fn(...args);
  }
}
