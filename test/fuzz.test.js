// Everything a socket can send that a real client never would.
//
// The server wraps handleMessage in a try/catch, so a throw here does not take
// the process down - it prints a stack trace and abandons whatever it was
// halfway through doing. That is worse than a crash in one way: a message that
// throws inside killPlayer leaves the round in a state nobody designed, and it
// costs one hostile socket nothing to send it a thousand times.
//
// So: no message may throw, and no message may leave the room's own invariants
// broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, PHASE, CARD_ORDER, MODES } from '../shared/constants.js';
import { C } from '../shared/protocol.js';

const { Room } = await import('../server/room.js');

function liveRoom({ bots = 6, prep = 1 } = {}) {
  TIMING.prep = prep; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'FUZZ', isPublic: false, mode: MODES.FREE });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: C.JOIN, name: 'Fuzzer' });
  room.beginMatch();
  tick(clock, room, 40);
  freezeBots(room);
  return { room, clock, stub, me: () => [...room.players.values()].find((p) => !p.bot) };
}

// Values chosen to break the assumptions the handlers actually make: numbers
// where objects go, objects where numbers go, and the three that get through
// every `typeof x === 'number'` check ever written.
const NASTY = [
  undefined, null, 0, -1, 1e309, -1e309, NaN, Infinity, -Infinity,
  '', 'x'.repeat(5000), '__proto__', 'constructor', 'toString',
  true, false, [], {}, [[[[[]]]]], { x: NaN, y: null, z: 'z' },
  { length: 1e9 }, -0, 0.1, '3', '{}', '[]',
];
// Deliberately not in that list: an object with a throwing toString. Every
// message arrives as JSON.parse of a socket frame, so nothing on the wire can
// carry behaviour - guarding against it would be defending a door nobody can
// reach.

/** Every shape of message worth throwing at the room. */
function* messages() {
  const types = Object.values(C);
  for (const t of types) {
    yield { t };
    for (const v of NASTY) {
      yield { t, dir: v };
      yield { t, pos: v };
      yield { t, slot: v };
      yield { t, id: v };
      yield { t, card: v };
      yield { t, text: v };
      yield { t, line: v };
      yield { t, name: v };
      yield { t, token: v };
      yield { t, remove: v };
      yield { t, pos: { x: v, y: v, z: v }, yaw: v, pitch: v };
      yield { t, dir: [v, v, v] };
    }
  }
  // Not a message type at all.
  for (const v of NASTY) yield { t: v };
  yield { t: 'nonsense' };
  yield { t: '__proto__' };
  yield { t: 'constructor' };
}

test('no message a socket can send makes the room throw', () => {
  const { room, clock, stub } = liveRoom();
  try {
    let sent = 0;
    for (const msg of messages()) {
      sent++;
      // Straight at the room, not through the manager's try/catch: the point is
      // that there is nothing for the catch to catch.
      room.handleMessage(stub.client, msg);
    }
    assert.ok(sent > 500, `only ${sent} messages were tried`);
    // And the room is still a room afterwards.
    assert.ok(room.players.size >= 6, 'players went missing');
    assert.ok([PHASE.PREP, PHASE.COMBAT, PHASE.ENDGAME, PHASE.RESULTS, PHASE.LOBBY].includes(room.phase));
    for (const p of room.players.values()) {
      assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y) && Number.isFinite(p.pos.z),
        `${p.name} was moved somewhere that is not a place`);
      assert.ok(Number.isFinite(p.health), `${p.name}'s health stopped being a number`);
      assert.ok(Number.isFinite(p.yaw) && Number.isFinite(p.pitch));
      assert.ok(Array.isArray(p.hand), `${p.name}'s hand stopped being a hand`);
      assert.ok(p.hand.every((c) => CARD_ORDER.includes(c)), `${p.name} is holding something that is not a card`);
    }
  } finally { clock.restore(); }
});

test('the room still runs a full tick after all of that', () => {
  const { room, clock, stub } = liveRoom();
  try {
    for (const msg of messages()) room.handleMessage(stub.client, msg);
    // Twenty seconds of the real loop. Anything the fuzz left in a bad state -
    // a NaN position, a half-finished reload - surfaces here rather than in the
    // assertions above.
    tick(clock, room, 20);
    assert.ok([PHASE.COMBAT, PHASE.ENDGAME, PHASE.RESULTS].includes(room.phase), `phase ${room.phase}`);
    for (const p of room.players.values()) {
      assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.health));
    }
  } finally { clock.restore(); }
});

test('a socket that never joined cannot do anything at all', () => {
  const { room, clock } = liveRoom();
  try {
    const before = room.players.size;
    const ghost = stubClient();
    room.addConnection(ghost.client);
    for (const msg of messages()) {
      if (msg.t === C.JOIN) continue;      // that one is allowed, and is the point
      room.handleMessage(ghost.client, msg);
    }
    assert.equal(room.players.size, before, 'a socket that never joined changed the roster');
    assert.equal(ghost.of('role').length, 0, 'a socket that never joined was dealt a role');
    assert.equal(ghost.of('snap').length, 0, 'a socket that never joined was sent the town');
  } finally { clock.restore(); }
});

test('joining twice on one socket does not deal a second body', () => {
  const { room, clock } = liveRoom();
  try {
    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: C.JOIN, name: 'Twice' });
    const after = room.players.size;
    for (let i = 0; i < 20; i++) room.handleMessage(stub.client, { t: C.JOIN, name: `Twice ${i}` });
    assert.equal(room.players.size, after, 'one socket collected several bodies');
  } finally { clock.restore(); }
});

// The manager is the part every socket meets first, before there is a room or
// a player to check anything against.
test('nothing a fresh socket can ask for gets past the manager', async () => {
  const { RoomManager } = await import('../server/rooms.js');
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  try {
    const manager = new RoomManager();
    for (const v of NASTY) {
      for (const msg of [
        { t: C.JOIN, room: v },
        { t: C.JOIN, create: v },
        { t: C.JOIN, name: v, room: v, create: v },
        { t: C.JOIN, room: v, token: v },
      ]) {
        const stub = stubClient();
        manager.handleMessage(stub.client, msg);
        // Either it was refused with a reason, or it landed in a room. Never a
        // socket left holding neither.
        const err = stub.last('error');
        assert.ok(err || stub.client.room, `nothing came back for ${JSON.stringify(msg).slice(0, 80)}`);
        if (err) {
          assert.equal(typeof err.msg, 'string');
          assert.ok(err.msg.length < 200, `a refusal ran to ${err.msg.length} characters`);
        }
      }
    }
    // And a socket with no room of its own cannot reach one by talking.
    const ghost = stubClient();
    for (const msg of messages()) {
      if (msg.t === C.JOIN) continue;
      manager.handleMessage(ghost.client, msg);
    }
    assert.equal(ghost.client.room, null, 'a socket talked its way into a town');
  } finally { clock.restore(); }
});
