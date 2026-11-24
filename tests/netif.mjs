// Unit tests for server/netif.js: interface listing, host resolution,
// saved-choice persistence, and the interactive prompt (fake stdin/stdout).
import fs from 'node:fs';
import netif from '../server/netif.js';

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.error(`  FAIL ${label}`); }
}

const { listInterfaces, lanIp, resolveHost, savedHost, saveHost, promptInterface, HOST_FILE } = netif;

// ---- listing ------------------------------------------------------------------
const ifaces = listInterfaces();
check(Array.isArray(ifaces) && ifaces.length >= 1, 'listInterfaces returns at least one IPv4 interface');
check(ifaces.every((i) => /^(\d{1,3}\.){3}\d{1,3}$/.test(i.address) && i.name), 'entries carry name + IPv4 address');
check(ifaces.some((i) => i.internal && i.address === '127.0.0.1'), 'loopback 127.0.0.1 is listed');
check(lanIp() === null || /^(\d{1,3}\.){3}\d{1,3}$/.test(lanIp()), 'lanIp is an IPv4 or null');

// ---- resolution -----------------------------------------------------------------
check(resolveHost('all') === undefined, "'all' -> bind all interfaces (undefined)");
check(resolveHost('') === undefined, 'empty -> bind all interfaces');
check(resolveHost('0.0.0.0') === undefined, "'0.0.0.0' -> bind all interfaces");
check(resolveHost('local') === '127.0.0.1', "'local' -> loopback");
check(resolveHost('localhost') === '127.0.0.1', "'localhost' -> loopback");
check(resolveHost('127.0.0.1') === '127.0.0.1', 'loopback address passes through');

const lo = ifaces.find((i) => i.address === '127.0.0.1');
check(resolveHost(lo.name) === '127.0.0.1', `'${lo.name}' (interface name) -> its address`);
if (lanIp()) {
  const lan = ifaces.find((i) => i.address === lanIp());
  check(resolveHost(lan.address) === lan.address, `LAN address ${lan.address} passes through`);
  check(resolveHost(lan.name) === lan.address, `'${lan.name}' (LAN name) -> its address`);
}
let threw = false;
try { resolveHost('iface-din-aucune'); } catch { threw = true; }
check(threw, 'unknown interface throws');
check(resolveHost('10.9.8.7') === '10.9.8.7', 'any IPv4 literal is accepted (OS will validate)');

// ---- saved choice ---------------------------------------------------------------
saveHost('all');
check(savedHost() === undefined, "saved 'all' -> undefined (bind all)");
saveHost('127.0.0.1');
check(savedHost() === '127.0.0.1', "saved '127.0.0.1' -> loopback");
saveHost(lanIp() || 'all');
check(savedHost() === (lanIp() || undefined), `saved LAN address ${lanIp() || '(none)'} round-trips`);
fs.writeFileSync(HOST_FILE, 'iface-din-aucune\n');
check(savedHost() === undefined, 'stale saved choice falls back to all interfaces');
if (fs.existsSync(HOST_FILE)) fs.unlinkSync(HOST_FILE); // leave the repo clean

// ---- interactive prompt (fake streams) -------------------------------------------
class FakeIO {
  constructor(lines) {
    this.lines = lines;
    this.out = [];
  }
  write(s) { this.out.push(s); }
  push(line) {
    // deliver one input line asynchronously, like a typed Enter
    setImmediate(() => this.input.emit('data', Buffer.from(line)));
  }
  end() { setImmediate(() => this.input.emit('end')); }
}

async function runPrompt(lines, { eof = false, defaultHost } = {}) {
  const { Readable } = await import('node:stream');
  const input = new Readable({ read() {} });
  const output = { isTTY: false, write: () => {} };
  const io = new FakeIO(lines);
  io.input = input;
  const p = promptInterface({ input, output, defaultHost });
  for (const l of lines) io.push(l);
  if (eof) io.end();
  return p;
}

{ // empty line -> default (all interfaces)
  const host = await runPrompt(['\n']);
  check(host === undefined, 'prompt: Enter -> default (all interfaces)');
}
{ // number selects the line (1 = all, 2 = local)
  const host = await runPrompt(['2\n']);
  check(host === '127.0.0.1', 'prompt: "2" -> localhost');
}
{ // interface name selection
  const lan = ifaces.find((i) => !i.internal);
  if (lan) {
    const host = await runPrompt([`${lan.name}\n`]);
    check(host === lan.address, `prompt: "${lan.name}" -> ${lan.address}`);
  }
}
{ // invalid then valid
  const host = await runPrompt(['bogus\n', '127.0.0.1\n']);
  check(host === '127.0.0.1', 'prompt: invalid re-prompts, then accepts');
}
{ // invalid until the attempts are spent -> default
  const host = await runPrompt(['bogus1\n', 'bogus2\n', 'bogus3\n', 'bogus4\n']);
  check(host === undefined, 'prompt: repeated invalid input falls back to default');
}
{ // EOF -> default
  const host = await runPrompt([], { eof: true });
  check(host === undefined, 'prompt: EOF -> default');
}
{ // Enter takes the last saved choice, exactly as server.js passes it
  saveHost('127.0.0.1');
  const host = await runPrompt(['\n'], { defaultHost: netif.savedHost() });
  check(host === '127.0.0.1', 'prompt: Enter -> last saved choice when given');
  if (fs.existsSync(HOST_FILE)) fs.unlinkSync(HOST_FILE);
}

if (failures) { console.error(`\nnetif: ${failures} échec(s)`); process.exit(1); }
console.log('netif: OK');
