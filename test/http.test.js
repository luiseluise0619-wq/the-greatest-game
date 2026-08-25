// The front door. Everything else in this suite talks to Room objects
// directly; this is the only place the actual HTTP server is asked to answer.
//
// It matters for two reasons. The page is served with no build step, so a
// single wrong content type means an ESM import fails and the game is a black
// screen. And the same handler that serves the client is the one that must not
// serve the server: `server/room.js` is on the same disk as `client/index.html`
// and only the ALLOW list stands between them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = 8600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), HNH_TELEMETRY: '0' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Poll rather than sleep: on a loaded machine the listen call is not instant,
  // and a fixed pause is either flaky or slow.
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the server never came up');
});

after(() => server?.kill());

/** A request with the path sent exactly as written, normalisation and all. */
function raw(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let body = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => { body += d; });
    sock.on('end', () => resolve(body));
    sock.on('error', reject);
  });
}

test('the page comes back as a page, with the import map that boots it', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<script type="importmap">/, 'nothing would resolve "three"');
  assert.match(html, /js\/main\.js/);
});

test('every file the page then asks for is served, and served as script', async () => {
  // The browser refuses a module served as anything but JavaScript, so a wrong
  // content type here is a black screen, not a warning.
  for (const path of ['/js/main.js', '/shared/constants.js', '/vendor/three.module.js']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 200, `${path} was not served`);
    assert.match(res.headers.get('content-type') || '', /javascript/,
      `${path} came back as something a browser will not execute as a module`);
    const body = await res.text();
    assert.ok(body.length > 200, `${path} came back empty`);
  }
  const css = await fetch(`${BASE}/css/style.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
});

test('the server does not serve the server', async () => {
  // Roles, bot brains and the deck are all decided in these files. Anything
  // that hands them to a player hands them the answers.
  for (const path of ['/server/room.js', '/server/bots.js', '/package.json', '/package-lock.json']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 404, `${path} is readable over HTTP`);
  }
});

test('a path that climbs out of the served directories does not', async () => {
  for (const path of [
    '/client/../server/room.js',
    '/../server/room.js',
    '/..%2f..%2fserver%2froom.js',
    '/%2e%2e/%2e%2e/package.json',
    '/client/js/../../../server/bots.js',
    '/shared/../server/room.js',
  ]) {
    const head = await raw(path);
    assert.match(head, /^HTTP\/1\.1 (404|400)/, `${path} climbed out and was answered`);
    assert.ok(!/onAbility|BOT_TUNING|dependencies/.test(head), `${path} came back with real contents`);
  }
});

test('an unknown path is a plain 404, not a stack trace', async () => {
  const res = await fetch(`${BASE}/nothing/here.js`);
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.equal(body, 'not found');
  assert.ok(!/Error|at Object|node:internal/.test(body));
});

test('the proof sheet is where the README says it is', async () => {
  // The README hands people /proof/ and /proof/?c=witness. A directory read is
  // an EISDIR, which came back looking exactly like a 404 - so the one page
  // that shows what the printing press produces was unreachable by its own
  // documented address.
  for (const path of ['/proof/', '/proof', '/proof/index.html', '/proof/?c=witness']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 200, `${path} does not answer`);
    const html = await res.text();
    assert.match(html, /PROOF SHEET/, `${path} answered with something else`);
  }
});

test('a directory with no index in it is still a 404', async () => {
  const res = await fetch(`${BASE}/js/`);
  assert.equal(res.status, 404);
});

test('/healthz answers with the readout the deploy notes promise', async () => {
  // DEPLOY.md prints this object verbatim and the container healthcheck polls
  // it, so the shape is part of the contract rather than a debugging aid.
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const j = await res.json();
  for (const key of ['ok', 'uptime', 'rooms', 'inMatch', 'humans']) {
    assert.ok(key in j, `/healthz says nothing about "${key}"`);
  }
  assert.equal(j.ok, true);
  assert.equal(typeof j.uptime, 'number');
});

test('/stats answers with the three numbers a playtest is read by', async () => {
  const res = await fetch(`${BASE}/stats`);
  assert.equal(res.status, 200);
  const j = await res.json();
  for (const key of ['witnessedKillShare', 'cardPlayRate', 'wins']) {
    assert.ok(key in j, `/stats says nothing about "${key}" and DEPLOY.md tells people to read it`);
  }
});

test('a path that cannot be decoded is a 404 and not the end of the process', async () => {
  // "/%" is not a valid escape, and decodeURIComponent throws a URIError on it
  // rather than returning anything. Nothing caught that, so one request from
  // anybody who can reach the port took the whole process down - and with it
  // every round being played on it. A browser never sends these; curl does.
  for (const path of ['/%', '/%E0%A4%A', '/%zz', '/client/%']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 404, `${path} was answered with ${res.status}`);
  }
  // And the server is still there afterwards, which is the whole point.
  const health = await fetch(`${BASE}/healthz`);
  assert.equal(health.status, 200, 'a malformed path took the server with it');
});
