// A server that stays up.
//
// Everything else here plays one round and asserts something about it. This
// file asks the question a deployment asks instead: what does the process look
// like after a few hundred of them? Rooms are opened and abandoned, sockets
// connect and drop, matches run start to finish - and none of it may leave
// anything behind, because a room that is never freed is a server that dies on
// a Saturday night with eight people in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, PHASE, MAX_PLAYERS } from '../shared/constants.js';
import { C } from '../shared/protocol.js';

const { RoomManager } = await import('../server/rooms.js');
const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function fast() {
  TIMING.prep = 1; TIMING.combat = 20; TIMING.endgame = 5; TIMING.results = 2;
  TIMING.lobbyCountdown = 600;
}

test('rooms opened and abandoned are actually freed', () => {
  fast();
  const clock = fakeClock();
  try {
    const m = new RoomManager({ mode: MODES.DUEL });
    for (let i = 0; i < 300; i++) {
      const room = m.create({ isPublic: false });
      assert.ok(room, `the manager stopped opening towns at ${i}`);
      const stub = stubClient();
      room.addConnection(stub.client);
      room.handleMessage(stub.client, { t: C.JOIN, name: 'Ada' });
      room.removeConnection(stub.client);
      // Push the clock past the ninety-second idle grace and sweep.
      clock.advance(200_000);
      m.reap();
    }
    assert.equal(m.rooms.size, 0,
      `${m.rooms.size} towns nobody is in were still open after three hundred were opened`);
  } finally { clock.restore(); }
});

test('a full room churning players never grows past the table', () => {
  fast();
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'CHRN', isPublic: false, mode: MODES.DUEL });
    room.resetClock();
    // Two hundred people walk in and out of one lobby.
    for (let i = 0; i < 200; i++) {
      const stub = stubClient();
      room.addConnection(stub.client);
      room.handleMessage(stub.client, { t: C.JOIN, name: `Drifter${i}` });
      room.removeConnection(stub.client);
      assert.ok(room.players.size <= MAX_PLAYERS,
        `${room.players.size} bodies in a room that holds ${MAX_PLAYERS}`);
      assert.ok(room.clients.size <= MAX_PLAYERS,
        `${room.clients.size} sockets on a room that holds ${MAX_PLAYERS}`);
    }
    assert.equal(room.players.size, 0, 'the lobby kept a body for everybody who left');
    assert.equal(room.clients.size, 0, 'the room kept a socket for everybody who left');
  } finally { clock.restore(); }
});

test('sixty rounds back to back leave nothing behind', () => {
  fast();
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'SOAK', isPublic: false, mode: MODES.DUEL });
    room.botFillTarget = 6;
    room.resetClock();
    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: C.JOIN, name: 'Ada' });

    for (let i = 0; i < 60; i++) {
      room.beginMatch();
      secs(clock, room, 30);
      // Whatever the round left behind must not survive the next deal.
      assert.ok(room.history.length < 400, `${room.history.length} frames of history on round ${i}`);
      assert.ok(room.shotLog.length < 600, `${room.shotLog.length} shots logged on round ${i}`);
      assert.ok(room.footprints.length <= 1200,
        `${room.footprints.length} footprints on round ${i}`);
      assert.ok(room.timeline.length < 400, `${room.timeline.length} timeline rows on round ${i}`);
      assert.ok(room.dynamites.length < 40, `${room.dynamites.length} sticks in the air on round ${i}`);
      assert.ok(room.players.size <= MAX_PLAYERS,
        `${room.players.size} players at the table on round ${i}`);
      // And every player's own bookkeeping stays the size of a player.
      for (const p of room.players.values()) {
        assert.ok((p.duelHand || []).length < 40, `${p.name} is holding ${p.duelHand.length} cards`);
        assert.ok((p.seenAt?.size ?? 0) <= MAX_PLAYERS + 2,
          `${p.name} remembers seeing ${p.seenAt.size} people`);
      }
    }
  } finally { clock.restore(); }
});

test('the free-for-all does not grow either', () => {
  fast();
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'SOKF', isPublic: false, mode: MODES.FREE });
    room.botFillTarget = 8;
    room.resetClock();
    for (let i = 0; i < 40; i++) {
      room.beginMatch();
      secs(clock, room, 26);
      assert.ok(room.footprints.length <= 1200,
        `${room.footprints.length} footprints on round ${i} - the trail is not being swept`);
      assert.ok(room.history.length < 400, `${room.history.length} frames of history on round ${i}`);
      assert.ok(room.loot ? room.loot.length < 200 : true,
        `${room.loot?.length} crates on the street on round ${i}`);
    }
  } finally { clock.restore(); }
});

test('a match that ends really does end', () => {
  fast();
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'ENDS', isPublic: false, mode: MODES.DUEL });
    room.botFillTarget = 5;
    room.resetClock();
    room.beginMatch();
    // Long enough for a whole round to reach its own conclusion, whichever way.
    secs(clock, room, TIMING.prep + TIMING.combat + TIMING.endgame + TIMING.results + 12);
    assert.ok(room.phase === PHASE.LOBBY || room.phase === PHASE.RESULTS,
      `a round that had run its whole clock was still in ${room.phase}`);
  } finally { clock.restore(); }
});
