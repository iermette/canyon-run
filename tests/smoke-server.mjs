// Smoke test for the interface selection in server.js.
// Spawns the real server non-interactively (stdin not a TTY) and checks the
// banner, the .server.url file, the effective bind and clean error paths.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import netif from '../server/netif.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18000 + Math.floor(Math.random() * 2000); // random port, no collision with dev servers
const LAN = netif.lanIp();

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

function startServer(env = {}, args = []) {
  const child = spawn(process.execPath, ['server.js', ...args], {
    cwd: ROOT,
    env: { ...process.env, PORT, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve) => {
    const t = setInterval(() => {
      if (out.includes('serveur démarré') || child.exitCode !== null) {
        clearInterval(t);
        resolve(out);
      }
    }, 50);
  });
  return { child, out: () => out, ready };
}

async function waitForExit(child, ms = 4000) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, ms);
    child.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });
}

function tcpOpen(host, port, ms = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: ms });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

const urlFile = () => {
  try { return fs.readFileSync(path.join(ROOT, '.server.url'), 'utf8').trim(); }
  catch { return null; }
};

// ---- 1. --help -----------------------------------------------------------------
{
  const s = startServer({}, ['--help']);
  const code = await waitForExit(s.child);
  check(code === 0, '--help exits 0');
  check(/Usage: node server.js/.test(s.out()), '--help prints usage');
}

// ---- 2. --host local ------------------------------------------------------------
{
  fs.rmSync(path.join(ROOT, '.server.url'), { force: true });
  fs.rmSync(path.join(ROOT, '.server.host'), { force: true });
  const s = startServer({}, ['--host', 'local']);
  const out = await s.ready;
  check(out.includes('serveur démarré'), 'server started');
  check(out.includes('localhost uniquement'), 'banner: localhost only');
  check(urlFile() === `http://localhost:${PORT}`, `.server.url = http://localhost:${PORT}`);
  check(await tcpOpen('127.0.0.1', PORT), 'accepts connections on loopback');
  s.child.kill('SIGTERM');
  await waitForExit(s.child);
}

// ---- 3. HOST=<lan> env -----------------------------------------------------------
if (LAN) {
  const lanName = netif.listInterfaces().find((i) => i.address === LAN)?.name || '';
  fs.rmSync(path.join(ROOT, '.server.url'), { force: true });
  const s = startServer({ HOST: LAN });
  const out = await s.ready;
  check(out.includes(`partage http://${LAN}:${PORT}`), 'share URL announced');
  check(out.includes(`${lanName} (${LAN})`), 'interface named in banner');
  check(urlFile() === `http://${LAN}:${PORT}`, `.server.url = http://${LAN}:${PORT}`);
  check(await tcpOpen(LAN, PORT), 'reachable on its LAN IP');
  s.child.kill('SIGTERM');
  await waitForExit(s.child);
}

// ---- 4. saved choice is used when non-interactive --------------------------------
if (LAN) {
  fs.writeFileSync(path.join(ROOT, '.server.host'), LAN + '\n');
  fs.rmSync(path.join(ROOT, '.server.url'), { force: true });
  const s = startServer();
  const out = await s.ready;
  check(out.includes(`partage http://${LAN}:${PORT}`), 'saved choice used without prompt');
  check(!/Quelle interface/.test(out), 'no prompt in non-interactive mode');
  s.child.kill('SIGTERM');
  await waitForExit(s.child);
}
fs.rmSync(path.join(ROOT, '.server.host'), { force: true });

// ---- 5. invalid interface ----------------------------------------------------------
{
  const s = startServer({}, ['--host', 'iface-din-aucune']);
  const code = await waitForExit(s.child);
  check(code === 1, 'invalid interface -> exit 1');
}

// ---- 6. unreachable address --------------------------------------------------------
{
  const s = startServer({}, ['--host', '10.9.8.7']);
  const code = await waitForExit(s.child);
  check(code === 1, 'unreachable address -> exit 1');
  check(s.out().includes("n'est pas disponible"), 'clean EADDRNOTAVAIL message');
}

// ---- 7. default: all interfaces ----------------------------------------------------
{
  fs.rmSync(path.join(ROOT, '.server.url'), { force: true });
  const s = startServer();
  const out = await s.ready;
  check(out.includes('toutes les interfaces'), 'default binds all interfaces');
  check(urlFile() === `http://localhost:${PORT}`, 'share URL falls back to localhost');
  check(await tcpOpen('127.0.0.1', PORT), 'serves on loopback');
  s.child.kill('SIGTERM');
  await waitForExit(s.child);
}
fs.rmSync(path.join(ROOT, '.server.url'), { force: true });

if (failures) { console.error(`\nsmoke: ${failures} échec(s)`); process.exit(1); }
console.log('smoke: OK');
