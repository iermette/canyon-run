const http = require('http');
const fs = require('fs');
const path = require('path');
const { WsServer } = require('./server/wsserver.js');
const { Room } = require('./server/room.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found: ' + urlPath);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

// Multiplayer: one shared room on the same port (ws://host:port/?name=...).
const room = new Room();
new WsServer(server, (conn, req) => {
  const query = new URL(req.url, 'http://localhost').searchParams;
  const p = room.join(conn, query.get('name'));
  if (!p) { // room full — the client falls back to solo
    conn.onmessage = () => {};
    conn.close();
    return;
  }
  conn.onmessage = (text) => {
    try { room.message(p, JSON.parse(text)); } catch { /* ignore malformed */ }
  };
  conn.onclose = () => room.leave(p);
});

// Best-effort LAN IP so the host can tell friends where to connect.
function lanIp() {
  const os = require('os');
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

server.listen(PORT, () => {
  console.log(`Serving the driving game at http://localhost:${PORT}`);
  const ip = lanIp();
  if (ip) console.log(`Multiplayer: share http://${ip}:${PORT} with other players on your network.`);
});
