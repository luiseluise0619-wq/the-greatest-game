// The lobby, for a room with people in it.
//
// The button that deals the roles used to deal them the instant anybody
// pressed it. Alone with bots that is right. With seven other people in the
// room it is not a button, it is a race - and the person who wins it starts
// the round while the other six are still choosing a face. That is the single
// thing most likely to ruin the first round eight friends ever play, so the
// button is a readiness call whenever there is somebody to wait for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient } from './helpers.js';
import { TIMING, PHASE } from '../shared/constants.js';
import { C, S } from '../shared/protocol.js';

const { Room } = await import('../server/room.js');

function lobby({ isPublic = false } = {}) {
  TIMING.prep = 2; TIMING.combat = 200; TIMING.endgame = 20; TIMING.results = 5;
  TIMING.lobbyCountdown = 600;      // never auto-deal underneath a test
  const room = new Room({ code: 'LBBY', isPublic });
  room.resetClock();
  return room;
}

/** One human at the door, the way a socket does it. */
function seat(room, name) {
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: C.JOIN, name });
  stub.player = room.players.get(stub.client.playerId);
  return stub;
}

const lastLobby = (stub) => [...stub.sent].reverse().find((m) => m.t === S.LOBBY) || null;

test('alone with bots the button still just deals', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const me = seat(room, 'Ada');
    room.handleMessage(me.client, { t: C.START });
    assert.notEqual(room.phase, PHASE.LOBBY, 'one person had to vote with themselves');
    // And nothing tells a lone player there is a vote going on.
    assert.equal(lastLobby(me).readyOf, 0, 'the lobby reported a vote of one');
  } finally { clock.restore(); }
});

test('with somebody else in the room the button is a readiness call', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const a = seat(room, 'Ada');
    const b = seat(room, 'Bo');

    room.handleMessage(a.client, { t: C.START });
    assert.equal(room.phase, PHASE.LOBBY,
      'Ada dealt the roles while Bo was still choosing a face');
    const mid = lastLobby(b);
    assert.equal(mid.readyN, 1, 'Bo was not told anybody had said they were ready');
    assert.equal(mid.readyOf, 2);
    assert.equal(mid.players.find((p) => p.name === 'Ada').ready, true);
    assert.equal(mid.players.find((p) => p.name === 'Bo').ready, false);

    room.handleMessage(b.client, { t: C.START });
    assert.notEqual(room.phase, PHASE.LOBBY, 'everybody was ready and nothing happened');
  } finally { clock.restore(); }
});

test('pressing it again takes it back', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const a = seat(room, 'Ada');
    seat(room, 'Bo');
    room.handleMessage(a.client, { t: C.START });
    assert.equal(a.player.lobbyReady, true);
    room.handleMessage(a.client, { t: C.START });
    assert.equal(a.player.lobbyReady, false,
      'somebody who changed their mind about a gunhand was stuck ready');
    assert.equal(lastLobby(a).readyN, 0);
  } finally { clock.restore(); }
});

test('the last person to walk out does not strand the rest', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const a = seat(room, 'Ada');
    const b = seat(room, 'Bo');
    const c = seat(room, 'Cal');
    room.handleMessage(a.client, { t: C.START });
    room.handleMessage(b.client, { t: C.START });
    assert.equal(room.phase, PHASE.LOBBY, 'two of three was enough');

    // Cal closes his tab without ever pressing it. The other two are ready and
    // nobody is left to wait for, so the round has to start rather than the
    // two of them sitting in a lobby forever waiting on a vote from a tab that
    // no longer exists.
    room.removeConnection(c.client);
    assert.notEqual(room.phase, PHASE.LOBBY,
      'Ada and Bo were left waiting on somebody who had gone home');
  } finally { clock.restore(); }
});

test('a bot never has to be waited for', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const a = seat(room, 'Ada');
    seat(room, 'Bo');
    room.botFillTarget = 6;
    room.pushLobby();
    const seen = lastLobby(a);
    assert.equal(seen.readyOf, 2, 'the bots were counted into the vote');
  } finally { clock.restore(); }
});

test('readiness does not survive the round it started', () => {
  const clock = fakeClock();
  try {
    const room = lobby();
    const a = seat(room, 'Ada');
    const b = seat(room, 'Bo');
    room.handleMessage(a.client, { t: C.START });
    room.handleMessage(b.client, { t: C.START });
    assert.notEqual(room.phase, PHASE.LOBBY);
    for (const p of room.players.values()) {
      assert.equal(!!p.lobbyReady, false,
        `${p.name} carried a ready flag into the round and would deal the next one alone`);
    }
  } finally { clock.restore(); }
});
