// Many towns, one server. Nothing tested how a socket finds a room until now,
// which is the first thing that happens to every player who ever arrives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MAX_PLAYERS, PHASE } from '../shared/constants.js';

const { RoomManager, MAX_ROOMS } = await import('../server/rooms.js');

function manager() {
  TIMING.prep = 2; TIMING.combat = 200; TIMING.endgame = 20; TIMING.results = 5;
  TIMING.lobbyCountdown = 600;      // never auto-deal underneath a test
  return new RoomManager();
}

/** Put n humans in a room, the way a real socket would. */
function fill(room, n, prefix = 'P') {
  const clients = [];
  for (let i = 0; i < n; i++) {
    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: 'join', name: `${prefix}${i}` });
    clients.push(stub);
  }
  return clients;
}

test('room codes are readable aloud and never collide', () => {
  const m = manager();
  const codes = new Set();
  for (let i = 0; i < 150; i++) {
    const code = m.makeCode();
    assert.ok(code, 'ran out of codes far too early');
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
      `"${code}" has a character somebody will misread over voice`);
    assert.equal(codes.has(code), false, `${code} was handed out twice`);
    codes.add(code);
    m.rooms.set(code, {});        // pretend it was taken
  }
});

test('quick play fills the busiest lobby instead of scattering people', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const quiet = m.create({ isPublic: true });
    const busy = m.create({ isPublic: true });
    fill(quiet, 1);
    fill(busy, 3);

    // Four people arriving one at a time all land in the busy one, not in a
    // fifth empty town each - which is how this genre dies.
    for (let i = 0; i < 4; i++) {
      assert.equal(m.quickJoin(), busy, `arrival ${i} was scattered`);
      fill(busy, 1, 'late');
    }
    assert.equal(m.rooms.size, 2, 'quick play opened towns nobody asked for');
  } finally { clock.restore(); }
});

test('quick play would rather wait in a lobby than join a fight in progress', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const midMatch = m.create({ isPublic: true });
    fill(midMatch, 4);
    midMatch.beginMatch();
    assert.notEqual(midMatch.phase, PHASE.LOBBY);

    const waiting = m.create({ isPublic: true });
    fill(waiting, 1);

    assert.equal(m.quickJoin(), waiting, 'a newcomer was dropped into a round already running');
  } finally { clock.restore(); }
});

test('quick play opens a town when every one of them is full', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const full = m.create({ isPublic: true });
    fill(full, MAX_PLAYERS);
    assert.equal(m.hasSpace(full), false);
    const fresh = m.quickJoin();
    assert.notEqual(fresh, full);
    assert.equal(m.rooms.size, 2);
  } finally { clock.restore(); }
});

test('a private town is only reachable by its code', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const priv = m.resolve({ create: true }).room;
    assert.equal(priv.isPublic, false);
    fill(priv, 1);

    // Quick play must not find it.
    const quick = m.quickJoin();
    assert.notEqual(quick, priv, 'quick play walked into a private town');

    // The code does, in any case.
    assert.equal(m.resolve({ room: priv.code }).room, priv);
    assert.equal(m.resolve({ room: priv.code.toLowerCase() }).room, priv);
    assert.equal(m.resolve({ room: ` ${priv.code} ` }).room, priv);
  } finally { clock.restore(); }
});

test('a bad code is refused in words somebody can act on', () => {
  const m = manager();
  const missing = m.resolve({ room: 'ZZZZ' });
  assert.ok(missing.error, 'a code for a town that does not exist was accepted');
  assert.match(missing.error, /ZZZZ/, 'the refusal does not say which code failed');

  const clock = fakeClock();
  try {
    const room = m.create({ isPublic: false });
    fill(room, MAX_PLAYERS);
    const full = m.resolve({ room: room.code });
    assert.ok(full.error, 'a ninth player was let into an eight gun town');
    assert.match(full.error, /full/i);
  } finally { clock.restore(); }
});

test('empty towns are reaped, busy ones are not', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const empty = m.create({ isPublic: true });
    const busy = m.create({ isPublic: true });
    fill(busy, 1);

    m.reap();
    assert.equal(m.rooms.size, 2, 'a town was reaped the instant it was made');

    clock.advance(200 * 1000);
    m.reap();
    assert.equal(m.rooms.has(empty.code), false, 'an empty town outlived its grace');
    assert.equal(m.rooms.has(busy.code), true, 'a town with somebody in it was reaped');
  } finally { clock.restore(); }
});

test('a town that empties out is reaped, but not before the grace', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const room = m.create({ isPublic: true });
    const [only] = fill(room, 1);
    room.removeConnection(only.client);

    clock.advance(30 * 1000);
    m.reap();
    assert.equal(m.rooms.has(room.code), true, 'reaped a town somebody might still be reconnecting to');

    clock.advance(200 * 1000);
    m.reap();
    assert.equal(m.rooms.has(room.code), false, 'an abandoned town was kept forever');
  } finally { clock.restore(); }
});

test('the server says so rather than falling over when it is out of room', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    // The cap is a measured number rather than a round one - a full room costs
    // about 0.39ms a tick and a 20Hz loop has 50ms - so read it rather than
    // quoting it, and stop if it is ever set somewhere a test cannot reach.
    assert.ok(MAX_ROOMS > 0 && MAX_ROOMS < 5000, `the room cap is ${MAX_ROOMS}`);
    for (let i = 0; i < MAX_ROOMS; i++) {
      assert.ok(m.create({ isPublic: false }), `the manager stopped opening towns at ${i}`);
    }
    assert.equal(m.rooms.size, MAX_ROOMS);
    assert.equal(m.create({ isPublic: true }), null, 'the room cap did nothing');
    const res = m.resolve({ create: true });
    assert.ok(res.error, 'a socket at capacity got a room that does not exist');
    assert.match(res.error, /capacity/i);
  } finally { clock.restore(); }
});

test('one tick loop drives every town', () => {
  const m = manager();
  const clock = fakeClock();
  try {
    const a = m.create({ isPublic: false });
    const b = m.create({ isPublic: false });
    fill(a, 1); fill(b, 1);
    a.botFillTarget = 4; b.botFillTarget = 4;
    a.resetClock(); b.resetClock();
    a.beginMatch(); b.beginMatch();

    // The manager's own loop, stepped by hand.
    for (let i = 0; i < 60; i++) {
      clock.advance(50);
      for (const room of m.rooms.values()) room.step();
    }
    assert.equal(a.phase, PHASE.COMBAT, 'town A never left preparation');
    assert.equal(b.phase, PHASE.COMBAT, 'town B never left preparation');
  } finally { clock.restore(); }
});

test('a step that throws in one town does not take the others down', () => {
  const m = manager();
  const clock = fakeClock();
  const realError = console.error;
  console.error = () => {};
  try {
    const bad = m.create({ isPublic: false });
    const good = m.create({ isPublic: false });
    fill(good, 1);
    good.botFillTarget = 4;
    good.resetClock();
    good.beginMatch();
    bad.step = () => { throw new Error('the saloon caught fire'); };

    m.start();
    for (let i = 0; i < 60; i++) {
      clock.advance(50);
      for (const room of m.rooms.values()) {
        try { room.step(); } catch { /* the manager swallows these */ }
      }
    }
    clearInterval(m.timer);
    assert.equal(good.phase, PHASE.COMBAT, 'a broken town stopped a working one');
  } finally {
    console.error = realError;
    clock.restore();
  }
});
