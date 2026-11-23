'use strict';
// Minimal RFC 6455 WebSocket server, zero dependencies.
// Supports exactly what the game needs: text frames both ways, ping/pong,
// close frames, and per-connection onmessage/onclose callbacks.

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsServer {
  // opts: { pingIntervalMs = 30000, pongTimeoutMs = 15000 }
  constructor(httpServer, onConnection, opts = {}) {
    this.pingIntervalMs = opts.pingIntervalMs ?? 30000;
    this.pongTimeoutMs = opts.pongTimeoutMs ?? 15000;
    httpServer.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head, onConnection));
    this._conns = new Set();
    // Liveness: ping every connection; drop it if no pong arrives in time.
    // Catches silently-dead peers (killed browsers, dropped networks) that
    // never send a close frame — without this they linger as ghost players.
    const t = setInterval(() => this._liveness(), this.pingIntervalMs);
    if (t.unref) t.unref();
  }

  _liveness() {
    const now = Date.now();
    for (const conn of [...this._conns]) {
      if (conn.closed) continue;
      if (conn._pingSentAt && now - conn._pingSentAt > this.pongTimeoutMs) {
        this._teardown(conn); // no pong — the peer is gone
        continue;
      }
      if (!conn._pingSentAt) { // only ping when not already waiting for a pong
        this.sendRaw(conn, Buffer.from([0x89, 0])); // ping (empty payload)
        conn._pingSentAt = now;
      }
    }
  }

  _handleUpgrade(req, socket, head, onConnection) {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const conn = {
      socket,
      _buf: head && head.length ? Buffer.from(head) : Buffer.alloc(0),
      onmessage: null, // (text: string) => void
      onclose: null,   // () => void — fired exactly once
      closed: false,
      _pingSentAt: null,
    };
    conn.send = (text) => this.send(conn, text);
    this._conns.add(conn);

    socket.on('data', (chunk) => this._onData(conn, chunk));
    socket.on('end', () => this._teardown(conn)); // EOF without a close frame (tab closed, process killed)
    socket.on('close', () => this._teardown(conn));
    socket.on('error', () => this._teardown(conn));
    onConnection(conn, req);
  }

  _onData(conn, chunk) {
    conn._buf = Buffer.concat([conn._buf, chunk]);
    for (;;) {
      const frame = WsServer.readFrame(conn._buf);
      if (!frame) return; // incomplete — wait for more data
      conn._buf = conn._buf.subarray(frame.end);
      this._dispatch(conn, frame);
      if (conn.closed) return;
    }
  }

  _dispatch(conn, frame) {
    switch (frame.opcode) {
      case 0x1: // text
        if (conn.onmessage) conn.onmessage(Buffer.from(frame.payload).toString('utf8'));
        break;
      case 0x9: // ping -> pong with the same payload
        this.sendRaw(conn, Buffer.concat([Buffer.from([0x8a, frame.payload.length]), frame.payload]));
        break;
      case 0xa: // pong — answers our liveness ping
        conn._pingSentAt = null;
        break;
      case 0x8: // close
        this.close(conn);
        break;
      default: // binary / reserved opcodes are not used by the game
        break;
    }
  }

  // Parse one complete frame from buf, or null if more bytes are needed.
  static readFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(1 << 30)) return null; // refuse absurd frames
      len = Number(big);
      off = 10;
    }
    let maskKey = null;
    if (masked) {
      if (buf.length < off + 4) return null;
      maskKey = buf.subarray(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return null;
    const payload = Buffer.from(buf.subarray(off, off + len)); // copy out of the buffer
    if (masked && payload.length > 0) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    }
    return { opcode, payload, end: off + len };
  }

  // Server -> client text frame (unmasked per the RFC).
  send(conn, text) {
    if (conn.closed) return;
    const data = Buffer.from(text, 'utf8');
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    try { conn.socket.write(Buffer.concat([header, data])); } catch { /* socket gone */ }
  }

  sendRaw(conn, buf) {
    if (conn.closed) return;
    try { conn.socket.write(buf); } catch { /* socket gone */ }
  }

  close(conn) {
    if (conn.closed || conn.closing) return;
    conn.closing = true;
    try { conn.socket.write(Buffer.from([0x88, 0x0])); } catch { /* socket gone */ } // empty close frame
    const t = setTimeout(() => this._teardown(conn), 500);
    if (t.unref) t.unref();
  }

  _teardown(conn) {
    if (conn.closed) return;
    conn.closed = true;
    this._conns.delete(conn);
    if (conn.onclose) conn.onclose(); // fired exactly once, from any path
    try { conn.socket.destroy(); } catch { /* already gone */ }
  }
}

module.exports = { WsServer };
