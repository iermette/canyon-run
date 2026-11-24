'use strict';
// Network-interface selection for the multiplayer server's bind address.
// Zero dependencies.
//
// The browser cannot bind sockets, so the interface is chosen on the
// terminal at server launch: server.js shows a numbered list and reads one
// line from stdin. Non-interactive launches (piped stdin, tests, CI) skip
// the prompt and keep the last saved choice, or all interfaces.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST_FILE = path.join(__dirname, '..', '.server.host');

function isIPv4(family) {
  return family === 'IPv4' || family === 4;
}

// Every IPv4 address on the machine, with its interface name.
function listInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (isIPv4(a.family)) out.push({ name, address: a.address, internal: !!a.internal });
    }
  }
  return out;
}

// First non-internal IPv4 address, or null.
function lanIp() {
  for (const i of listInterfaces()) if (!i.internal) return i.address;
  return null;
}

// Resolve a user selection to a bind host:
//   undefined -> bind to all interfaces
//   '127.0.0.1' -> loopback only
//   <ipv4>    -> that interface
// Throws a French Error when the selection is unknown.
function resolveHost(selection, { interfaces } = {}) {
  const raw = String(selection == null ? '' : selection).trim();
  const s = raw.toLowerCase();
  if (s === '' || s === 'all' || s === 'toutes' || s === 'any' || s === '0.0.0.0' || s === '::') return undefined;
  if (s === 'local' || s === 'localhost' || s === '127.0.0.1') return '127.0.0.1';
  const ifaces = interfaces || listInterfaces();
  const byName = ifaces.find((i) => i.name.toLowerCase() === s);
  if (byName) return byName.address;
  const byAddr = ifaces.find((i) => i.address === raw);
  if (byAddr) return byAddr.address;
  // Accept any IPv4 literal (e.g. an alias not listed) — the OS rejects it
  // with EADDRNOTAVAIL if the address is not ours.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw)) return raw;
  const names = ifaces.map((i) => i.name).join(', ');
  throw new Error(`Interface inconnue : "${raw}". Choix possibles : all, local, ${names}`);
}

// Last saved choice, or undefined (stale/unknown values are discarded).
function savedHost() {
  try {
    const v = fs.readFileSync(HOST_FILE, 'utf8').trim();
    return v ? resolveHost(v) : undefined;
  } catch {
    return undefined;
  }
}

function saveHost(host) {
  try {
    fs.writeFileSync(HOST_FILE, `${host || 'all'}\n`);
  } catch { /* best effort */ }
}

// Interactive selection: print a numbered list, read one line from `input`.
// Resolves to a bind host (undefined = all interfaces).
//   - number 1..N   -> the Nth line
//   - name / IP     -> that interface (see resolveHost)
//   - Enter (empty) -> the default (last saved choice, else all)
// Invalid input re-prompts twice, then falls back to the default.
// EOF on the input stream also falls back to the default.
function promptInterface({ input = process.stdin, output = process.stdout, defaultHost = undefined } = {}) {
  return new Promise((resolve) => {
    const options = [
      { host: undefined, label: 'toutes les interfaces' },
      { host: '127.0.0.1', label: 'localhost uniquement (127.0.0.1)' },
      ...listInterfaces().filter((i) => !i.internal).map((i) => ({ host: i.address, label: `${i.name} — ${i.address}` })),
    ];
    let defIdx = options.findIndex((o) => (o.host || '') === (defaultHost || ''));
    if (defIdx < 0) defIdx = 0;

    let settled = false;
    function finish(host) {
      if (settled) return;
      settled = true;
      if (!output.isTTY) output.write('\n');
      resolve(host);
    }

    function render() {
      output.write('Interface réseau du serveur multijoueur :\n');
      options.forEach((o, i) => {
        output.write(`   ${i + 1}${i === defIdx ? ' *' : '  '} ${o.label}\n`);
      });
      output.write(`Choix [${defIdx + 1}] : `);
    }

    let attempts = 2; // extra re-prompts before falling back to the default
    function settle(line) {
      const s = String(line == null ? '' : line).trim();
      if (s === '') return finish(options[defIdx].host);
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (n >= 1 && n <= options.length) return finish(options[n - 1].host);
      } else {
        try {
          return finish(resolveHost(s));
        } catch { /* unknown selection: re-prompt */ }
      }
      if (attempts-- <= 0) {
        output.write(`Choix invalide — ${options[defIdx].host ? options[defIdx].host : 'toutes les interfaces'}.\n`);
        return finish(options[defIdx].host);
      }
      output.write('Choix invalide. ');
      render();
      armReader();
    }

    function armReader() {
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        const nl = buf.indexOf('\n');
        if (nl !== -1) { detach(); settle(buf.slice(0, nl).trim()); }
        else if (buf.length > 500) { detach(); settle(buf.trim()); } // absurd line: treat as input
      };
      const onEnd = () => { detach(); settle(null); }; // EOF: take the default
      function detach() {
        input.removeListener('data', onData);
        input.removeListener('end', onEnd);
      }
      input.on('data', onData);
      input.once('end', onEnd);
    }

    render();
    armReader();
  });
}

module.exports = { listInterfaces, lanIp, resolveHost, savedHost, saveHost, promptInterface, HOST_FILE };
