// The wire itself.
//
// Every other test in this suite reaches into a Room object and reads its
// fields. That is the wrong altitude for the one promise this game makes.
// "The server does not send you what you should not know" is a claim about
// bytes on a socket, and the only way to check a claim about bytes is to open
// a socket, keep every frame that comes back, and read them.
//
// So this file starts the real server, connects real WebSockets, plays a real
// round, and keeps a transcript per connection. Then it asks the question an
// attacker asks: with devtools open and every packet in front of me, what do I
// know that I should not?

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { S, C } from '../shared/protocol.js';
import { VISION } from '../shared/constants.js';

const PORT = 8900 + Math.floor(Math.random() * 150);
const FREE_PORT = PORT + 1;
const BASE = `ws://127.0.0.1:${PORT}`;
const FREE = `ws://127.0.0.1:${FREE_PORT}`;
let server;
let freeServer;

/** One connected socket, with a full transcript of everything it was sent. */
class Spy {
  constructor(name, base = BASE) {
    this.name = name;
    this.rx = [];                 // every parsed frame, in order
    this.raw = [];                // and the bytes, so nothing hides in a field we forgot
    this.id = null;
    this.token = null;
    this.role = null;
    this.ws = new WebSocket(base);
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (buf) => {
        const text = buf.toString();
        this.raw.push(text);
        let m; try { m = JSON.parse(text); } catch { return; }
        this.rx.push(m);
        if (m.t === S.WELCOME) { this.id = m.selfId; this.token = m.token; }
        if (m.t === S.ROLE) this.role = m.role;
      });
    });
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }
  close() { try { this.ws.close(); } catch { /* gone */ } }

  /** Every frame of one type. */
  all(type) { return this.rx.filter((m) => m.t === type); }
  last(type) { const a = this.all(type); return a[a.length - 1] || null; }
  /** The whole transcript as one string, for "does this word appear at all". */
  text() { return this.raw.join('\n'); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn()` is truthy, or give up. Never a bare sleep for a condition. */
async function until(fn, ms = 8000, label = 'condition') {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function boot(port, extra = {}) {
  return spawn('node', ['server/index.js'], {
    env: {
      ...process.env, PORT: String(port), HNH_TELEMETRY: '0',
      HNH_PREP: '2', HNH_COMBAT: '12', HNH_ENDGAME: '4', HNH_RESULTS: '4',
      HNH_LOBBYCOUNTDOWN: '1', ...extra,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitFor(port) {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch { /* wait */ }
    await sleep(50);
  }
  throw new Error(`the server on ${port} never came up`);
}

before(async () => {
  server = boot(PORT);
  // The cull has nothing to withhold at a round table - everybody standing in
  // a ring can see everybody, correctly - so the free-for-all gets its own
  // server here, and it is the one the visibility test talks to.
  freeServer = boot(FREE_PORT, { HNH_MODE: 'free', HNH_COMBAT: '120', HNH_ENDGAME: '30' });
  await waitFor(PORT);
  await waitFor(FREE_PORT);
});

after(() => { server?.kill(); freeServer?.kill(); });

test('nothing on the wire tells you another player\'s role', async () => {
  const room = 'WIRE';
  const spies = [new Spy('a'), new Spy('b'), new Spy('c')];
  await Promise.all(spies.map((s) => s.open()));
  // A private room of our own so a stray public joiner cannot change the count.
  spies[0].send({ t: C.JOIN, name: 'Ada', create: true });
  await until(() => spies[0].id !== null, 4000, 'the first welcome');
  const code = spies[0].last(S.WELCOME).code;
  assert.ok(code, 'the welcome never said which town this is');
  for (const s of spies.slice(1)) s.send({ t: C.JOIN, name: s.name.toUpperCase(), room: code });
  await until(() => spies.every((s) => s.id !== null), 4000, 'three welcomes');

  // Everybody says ready - in a room with other people in it the button is a
  // vote, not a trigger. See test/lobby.test.js.
  for (const s of spies) s.send({ t: C.START });
  await until(() => spies.every((s) => s.role), 8000, 'roles dealt');
  // Bots fill the rest, so there is a whole town of hidden roles to leak.
  await sleep(2500);

  for (const s of spies) {
    const mine = s.rx.filter((m) => m.t === S.ROLE);
    assert.equal(mine.length >= 1, true, `${s.name} was never told who they are`);
    for (const m of mine) {
      assert.equal(m.id === undefined || m.id === s.id, true,
        'a role message arrived carrying somebody else\'s id');
    }
    // The whole transcript, every frame, before anyone has died: the word
    // "outlaw" may only ever appear as this player's own answer.
    const others = spies.filter((o) => o !== s);
    for (const o of others) {
      const leaked = s.rx.some((m) => m.t !== S.RESULTS && m.t !== S.ROLE
        && JSON.stringify(m).includes(`"role":"${o.role}"`) && o.role !== s.role);
      assert.equal(leaked, false,
        `${s.name} was sent a frame naming ${o.name}'s role (${o.role})`);
    }
  }
  for (const s of spies) s.close();
});

test('a snapshot only ever carries players the viewer can see', async () => {
  // In the free-for-all the cull is the whole game, and the snapshot carries
  // the one number that makes it checkable from outside: `aliveCount` is how
  // many people are still standing, and `ps` is how many of them you were sent.
  // The server telling you there are seven and handing you two is the promise,
  // on the wire, in bytes, from a socket that has no access to the room.
  const a = new Spy('a', FREE); const b = new Spy('b', FREE);
  await Promise.all([a.open(), b.open()]);
  a.send({ t: C.JOIN, name: 'Ada', create: true });
  await until(() => a.id, 4000, 'welcome');
  const code = a.last(S.WELCOME).code;
  b.send({ t: C.JOIN, name: 'Bo', room: code });
  await until(() => b.id, 4000, 'welcome');
  a.send({ t: C.START }); b.send({ t: C.START });
  await until(() => a.rx.some((m) => m.t === S.PHASE && m.phase === 'combat'), 12000, 'the bell');
  // A good stretch of a real round, with bots walking a real town.
  await until(() => a.all(S.SNAPSHOT).length > 240, 25000, 'a round\'s worth of snapshots');

  const snaps = a.all(S.SNAPSHOT).filter((m) => m.aliveCount > 1);
  assert.ok(snaps.length > 100, 'not enough of a round happened to prove anything');

  // 1. It is not vacuous: Ada was sent other people, or the cull would be
  //    trivially satisfied by sending nobody anything.
  const everSeen = new Set();
  for (const m of snaps) for (const e of m.ps) if (e.id !== a.id) everSeen.add(e.id);
  assert.ok(everSeen.size > 0, 'Ada was never sent a single other player all round');

  // 2. It is not a pass-through: for a real share of the round the server knew
  //    of more living players than it put on her wire.
  const withheld = snaps.filter((m) => m.ps.length < m.aliveCount).length;
  assert.ok(withheld > snaps.length * 0.5,
    `only ${withheld} of ${snaps.length} frames withheld anybody - the cull is decoration`);

  // 3. And it moves. Somebody who was on her wire came off it again, which is
  //    line of sight being re-asked every tick rather than answered once.
  const dropped = snaps.some((m, i) => i > 0
    && snaps[i - 1].ps.some((e) => e.id !== a.id && !m.ps.some((x) => x.id === e.id)));
  assert.ok(dropped, 'nobody ever left Ada\'s sight - the cull is computed once and cached');

  // 4. Nobody beyond the sight limit is ever on it. Positions travel in the
  //    frame, so this is checkable from the outside without knowing anything
  //    about the map: every player Ada was sent was inside VISION.far of her,
  //    every tick, for the whole round.
  let farthest = 0;
  for (const m of snaps) {
    const me = m.ps.find((e) => e.id === a.id);
    if (!me) continue;
    for (const e of m.ps) {
      if (e.id === a.id) continue;
      farthest = Math.max(farthest, Math.hypot(e.x - me.x, e.z - me.z));
    }
  }
  assert.ok(farthest <= VISION.far + 1,
    `somebody ${farthest.toFixed(1)}m away was on the wire and the limit is ${VISION.far}m`);

  // 5. And she is always in her own, or her client has no body to stand in.
  for (const m of a.all(S.SNAPSHOT)) {
    assert.ok(m.ps.some((e) => e.id === a.id), 'a snapshot arrived without the viewer in it');
  }
  a.close(); b.close();
});

test('guessing room codes costs a connection, not a loop', async () => {
  // Four letters out of thirty-two is a million codes, and a private room is
  // private because nobody guesses which one it is. A socket allowed to guess
  // as fast as it can send is a socket that finds every private room on the
  // server; this one gets twenty tries and then the door.
  const a = new Spy('guesser');
  await a.open();
  let closed = false;
  a.ws.on('close', () => { closed = true; });
  for (let i = 0; i < 40 && a.ws.readyState === WebSocket.OPEN; i++) {
    a.send({ t: C.JOIN, name: 'Nobody', room: `Z${String(i).padStart(3, '0')}` });
    await sleep(20);
  }
  await until(() => closed, 4000, 'the guesser being shown the door');
  assert.equal(closed, true, 'a socket guessed forty room codes and was still welcome');
  // A wrong code is a mistake anybody can make, so the first few are answered
  // rather than punished.
  const told = a.all(S.ERROR).filter((m) => m.k === 'err.noSuchTown');
  assert.ok(told.length >= 5, 'nobody was told their code was wrong, they were just cut off');
  a.close();
});

test('a restart says goodbye rather than dropping everybody in silence', async () => {
  // A deploy sends SIGTERM. Exiting on the spot drops every socket with no
  // close frame, and a browser cannot tell that apart from a tunnel going
  // down - so eight people are told their network is bad when what actually
  // happened is that a new version shipped. 1012 is "service restart", and
  // the client waits far longer for it than it waits for a blip.
  const port = PORT + 40;
  const own = boot(port);
  await waitFor(port);
  const a = new Spy('goodbye', `ws://127.0.0.1:${port}`);
  await a.open();
  a.send({ t: C.JOIN, name: 'Ada', create: true });
  await until(() => a.id, 4000, 'welcome');

  let code = null;
  a.ws.on('close', (c) => { code = c; });
  own.kill('SIGTERM');
  await until(() => code !== null, 6000, 'the socket closing');
  assert.equal(code, 1012, `the server went down with close code ${code}`);
  own.kill('SIGKILL');
});

test('a forged socket cannot deal itself a second body, a role, or a win', async () => {
  const a = new Spy('a');
  await a.open();
  a.send({ t: C.JOIN, name: 'Ada', create: true });
  await until(() => a.id !== null, 4000, 'welcome');
  const code = a.last(S.WELCOME).code;
  const myId = a.id;

  // Everything a hand-written client would try, in the order it would try it.
  const forged = [
    { t: C.JOIN, name: 'Ada again', room: code },
    { t: C.JOIN, token: 'not-a-token', room: code },
    { t: 'role' }, { t: S.ROLE, role: 'sheriff' },
    { t: S.RESULTS, winner: 'outlaw' },
    { t: S.KILL, killer: myId, victim: myId + 1 },
    { t: C.SHOOT, hit: myId + 1, damage: 9999 },
    { t: C.SHOOT, target: myId + 1, dmg: 1e9 },
    { t: C.CARD, card: 'bang', target: myId + 1, times: 1e6 },
    { t: C.CARD, index: -1 }, { t: C.CARD, index: 1e9 },
    { t: C.INPUT, pos: { x: 1e9, y: 1e9, z: 1e9 } },
    { t: C.INPUT, pos: { x: NaN, y: 0, z: 0 } },
    { t: C.ABILITY }, { t: C.ABILITY }, { t: C.ABILITY },
    { t: C.SELFSHOT }, { t: C.SELFSHOT },
    { t: C.RESTART }, { t: C.START }, { t: C.START },
    { t: C.CHAT, text: 'x'.repeat(4000) },
    { t: C.ACCUSE, target: 999999 },
    { t: '__proto__' }, { t: 'constructor' },
    { t: C.INPUT, pos: { __proto__: { x: 1 } } },
  ];
  for (const m of forged) { a.send(m); await sleep(8); }
  await sleep(400);

  // One socket, one body. The door sends two welcomes on purpose - the first
  // names the town before anybody is dealt in, the second names you - so the
  // count that matters is how many ever carried an identity.
  const identities = a.all(S.WELCOME).filter((m) => m.selfId !== null && m.selfId !== undefined);
  assert.equal(identities.length, 1, 'a second join dealt a second body');
  assert.equal(new Set(identities.map((m) => m.selfId)).size, 1, 'one socket, two ids');
  // Nothing it asked for turned into a result.
  assert.equal(a.all(S.RESULTS).length, 0, 'a forged results frame came back as real');
  // And the room is still there and still answering.
  const health = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  assert.equal(health.status, 200, 'a forged message took the server down');
  a.close();
});

test('a socket that floods is cut off, and the room survives it', async () => {
  const a = new Spy('flood');
  await a.open();
  a.send({ t: C.JOIN, name: 'Flood', create: true });
  await until(() => a.id !== null, 4000, 'welcome');
  let closed = false;
  a.ws.on('close', () => { closed = true; });
  for (let i = 0; i < 4000 && a.ws.readyState === WebSocket.OPEN; i++) {
    a.send({ t: C.INPUT, pos: { x: i % 30, y: 1, z: i % 30 }, yaw: i });
  }
  await until(() => closed, 6000, 'the flood being cut off');
  assert.equal(closed, true, 'a socket sending four thousand messages was left connected');
  const health = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  assert.equal(health.status, 200, 'a flood took the server down');
  a.close();
});
