const http = require('http');
const fs = require('fs');
const path = require('path');
const { WsServer } = require('./server/wsserver.js');
const { Room } = require('./server/room.js');

const netif = require('./server/netif.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);

// ---- bind address -----------------------------------------------------------
// Explicit request wins: --host <all|local|iface|ipv4>, --iface <name>,
// or the HOST env var. Otherwise the player picks interactively (TTY), with
// the last saved choice as the default. Non-interactive launches keep the
// last saved choice, or all interfaces.
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node server.js [--port N | PORT env] [--host all|local|<iface>|<ipv4> | --iface <name> | HOST env]');
  console.log('Sans argument, le serveur demande quelle interface réseau utiliser pour le multijoueur.');
  process.exit(0);
}

function explicitHost() {
  const sel = argValue('--host') || argValue('--iface') || process.env.HOST;
  if (sel === undefined) return null; // not specified
  try {
    return netif.resolveHost(sel);
  } catch (err) {
    console.error(`Interface invalide : ${err.message}`);
    process.exit(1);
  }
}

function chooseBindHost() {
  const explicit = explicitHost();
  if (explicit !== null) return Promise.resolve(explicit);
  if (process.stdin.isTTY) {
    return netif.promptInterface({ defaultHost: netif.savedHost() }).then((host) => {
      netif.saveHost(host); // remember for next launch (and for non-interactive runs)
      return host;
    });
  }
  return Promise.resolve(netif.savedHost()); // undefined -> all interfaces
}

function describeHost(host) {
  if (!host) return 'toutes les interfaces';
  if (host === '127.0.0.1') return 'localhost uniquement';
  const i = netif.listInterfaces().find((x) => x.address === host);
  return i ? `${i.name} (${host})` : host;
}
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

chooseBindHost().then((host) => {
  const listener = server.listen(PORT, host, () => {
    const pageHost = host === '127.0.0.1' ? 'localhost' : (host || 'localhost'); // the address the host should open in the browser
    const share = host || netif.lanIp() || 'localhost'; // where other players reach the server
    const url = `http://${pageHost}:${PORT}`;
    try { fs.writeFileSync(path.join(ROOT, '.server.url'), url + '\n'); } catch { /* best effort */ }
    console.log('Canyon Run — serveur démarré');
    console.log(`  Interface  : ${describeHost(host)}`);
    console.log(`  Jeu        : ${url}`);
    if (host === '127.0.0.1') console.log('  Multijoueur: localhost uniquement — les autres joueurs ne pourront pas rejoindre.');
    else console.log(`  Multijoueur: partage http://${share}:${PORT} avec les autres joueurs de ton réseau.`);
  });
  listener.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} déjà utilisé — arrête l'autre serveur (./launch.sh stop) ou change le port (PORT=9000 ./launch.sh).`);
    else if (err.code === 'EADDRNOTAVAIL') console.error(`L'adresse choisie n'est pas disponible sur cette machine — relance et choisis une autre interface.`);
    else console.error(err);
    process.exit(1);
  });
});
