// What happens when somebody's wifi goes out.
//
// Eight people in a voice call is eight home connections, and over a
// twenty-minute round at least one of them will blip. The server already keeps
// a dropped player's body standing for a grace period and hands it back to the
// tab that reclaims it - this is the file that checks the seams around that,
// because every one of them is a way to lose somebody's round to a two-second
// hiccup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, SOCIAL, MODES, DUEL, PHASE } from '../shared/constants.js';
import { C, S } from '../shared/protocol.js';

const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function town({ mode = MODES.FREE, humans = 2, bots = 5 } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'DROP', isPublic: false, mode });
  room.botFillTarget = bots;
  room.resetClock();
  const stubs = [];
  for (let i = 0; i < humans; i++) {
    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: C.JOIN, name: `P${i}` });
    stub.player = room.players.get(stub.client.playerId);
    stubs.push(stub);
  }
  room.beginMatch();
  secs(clock, room, 2);
  // A body left standing in the street is every bit as shootable as it was -
  // that is the point of the grace and it is tested elsewhere. Here it would
  // just mean a bot occasionally shot the man whose reconnect is the subject,
  // so nobody is holding a gun for the length of this file.
  freezeBots(room);
  return { room, clock, stubs };
}

test('a blip does not cost you your body', () => {
  const { room, clock, stubs } = town();
  try {
    const [me] = stubs;
    const id = me.player.id;
    const token = me.player.token;
    me.player.health = 61;
    const where = { ...me.player.pos };

    room.removeConnection(me.client);
    assert.equal(me.player.connected, false);
    assert.equal(me.player.alive, true, 'a dropped socket killed him on the spot');
    secs(clock, room, SOCIAL.reconnectGrace - 5);
    assert.equal(me.player.alive, true, 'he fell over inside the grace');

    // Back, with the token the tab kept.
    const back = stubClient();
    room.addConnection(back.client);
    room.handleMessage(back.client, { t: C.JOIN, name: 'P0', token });
    assert.equal(back.client.playerId, id, 'he was dealt a stranger instead of his own body');
    assert.equal(room.players.get(id).health, 61, 'he came back healed');
    assert.deepEqual(room.players.get(id).pos, where, 'his body moved while he was gone');
    assert.equal(room.players.get(id).connected, true);
  } finally { clock.restore(); }
});

test('and past the grace there is nothing to come back to', () => {
  const { room, clock, stubs } = town();
  try {
    const [me] = stubs;
    const token = me.player.token;
    room.removeConnection(me.client);
    secs(clock, room, SOCIAL.reconnectGrace + 2);
    assert.equal(me.player.alive, false, 'a body stood in the street forever');

    // The token still names him: he is dead, in the round's account, and a tab
    // that comes back is told so rather than handed somebody else.
    const back = stubClient();
    room.addConnection(back.client);
    room.handleMessage(back.client, { t: C.JOIN, name: 'P0', token });
    assert.equal(back.client.playerId, me.player.id, 'his own corpse was given away');
    const said = back.sent.filter((m) => m.t === S.FEED).map((m) => m.k);
    assert.ok(said.includes('feed.backDead'), 'nobody told him he was dead');
  } finally { clock.restore(); }
});

test('a token is the only thing that reclaims a seat', () => {
  const { room, clock, stubs } = town();
  try {
    const [me] = stubs;
    const mine = me.player.id;
    room.removeConnection(me.client);

    for (const guess of [null, undefined, '', 'x', me.player.token + 'a',
      '00000000-0000-4000-8000-000000000000']) {
      const bad = stubClient();
      room.addConnection(bad.client);
      room.handleMessage(bad.client, { t: C.JOIN, name: 'Thief', token: guess });
      assert.notEqual(bad.client.playerId, mine,
        `a socket claiming ${JSON.stringify(guess)} was handed somebody else's body`);
      room.removeConnection(bad.client);
    }
  } finally { clock.restore(); }
});

test('the lap does not stop for six seconds for a man who is not there', () => {
  // A go for somebody whose wifi went out is a go the table spends waiting, and
  // the reconnect grace is four laps long. Eight players and one bad
  // connection was four dead goes in a game whose whole loop is a six-second
  // go, and nobody at the table can tell a player thinking from one who left.
  const { room, clock, stubs } = town({ mode: MODES.DUEL, humans: 1, bots: 5 });
  try {
    const [me] = stubs;
    room.removeConnection(me.client);

    // Hand him the floor the way the lap would.
    const t = Date.now() / 1000;
    room.turnPtr = room.turnOrder.indexOf(me.player.id) - 1;
    room.advanceTurn(t);
    assert.equal(room.turnHolder, me.player.id, 'test setup: he never got the floor');
    const given = room.turn.endsAt - t;
    assert.ok(given <= DUEL.turnAway + 0.01,
      `an empty chair was given ${given.toFixed(1)}s of a ${DUEL.turn}s go`);

    // And a tab that comes back inside it gets the go it was owed, whole.
    const back = stubClient();
    room.addConnection(back.client);
    room.handleMessage(back.client, { t: C.JOIN, name: 'P0', token: me.player.token });
    const now2 = Date.now() / 1000;
    assert.ok(room.turn.endsAt - now2 > DUEL.turn - 0.5,
      'he reconnected into his own go and got the stub of it');
  } finally { clock.restore(); }
});

test('a connected player still gets the whole go', () => {
  const { room, clock, stubs } = town({ mode: MODES.DUEL, humans: 1, bots: 5 });
  try {
    const [me] = stubs;
    const t = Date.now() / 1000;
    room.turnPtr = room.turnOrder.indexOf(me.player.id) - 1;
    room.advanceTurn(t);
    assert.equal(room.turnHolder, me.player.id, 'test setup: he never got the floor');
    assert.ok(room.turn.endsAt - t > DUEL.turn - 0.01,
      'somebody sitting right there was rushed off the table');
  } finally { clock.restore(); }
});

test('two tabs cannot hold one seat', () => {
  // A refresh opens the new socket before the browser's close reaches us about
  // half the time. The token owns the seat, so claiming it evicts whoever is
  // sitting in it - otherwise the loser of that race gets a stranger's body.
  const { room, clock, stubs } = town();
  try {
    const [me] = stubs;
    const token = me.player.token;
    const second = stubClient();
    room.addConnection(second.client);
    room.handleMessage(second.client, { t: C.JOIN, name: 'P0', token });

    assert.equal(second.client.playerId, me.player.id, 'the refresh was dealt a new body');
    assert.equal(me.client.playerId, null, 'the old tab still thinks it owns the seat');
    assert.equal(room.players.get(me.player.id).client, second.client);
    // And the old socket falling over afterwards must not take the body with it.
    room.removeConnection(me.client);
    assert.equal(room.players.get(me.player.id).connected, true,
      'the stale socket closing knocked the live one out of its own body');
  } finally { clock.restore(); }
});

test('somebody leaving the lobby does not leave a ghost in the roster', () => {
  const { room, clock, stubs } = town({ humans: 3, bots: 0 });
  try {
    room.phase = PHASE.LOBBY;
    const before = room.players.size;
    room.removeConnection(stubs[2].client);
    assert.equal(room.players.size, before - 1, 'a lobby leaver stayed on the list');
    assert.equal(room.humanCount(), 2);
  } finally { clock.restore(); }
});

test('a blip on the round boundary does not cost you your seat', () => {
  // The narrowest window there is, and it used to swallow people whole. The
  // sweep that clears a finished round deleted anybody who was not connected,
  // so a tab that dropped in the last seconds of a round came back a stranger:
  // new body, new name, no place on the aftermath screen and no vote on riding
  // again. It is the same grace it would have been given a second earlier.
  const { room, clock, stubs } = town({ humans: 2, bots: 4 });
  try {
    const [me, other] = stubs;
    const token = me.player.token;
    const id = me.player.id;
    const name = me.player.name;
    room.removeConnection(me.client);

    // The round ends underneath him and the room goes back to the lobby.
    room.toLobby();
    assert.ok(room.players.has(id),
      'the round ending took the seat of somebody who was two seconds from being back');

    const back = stubClient();
    room.addConnection(back.client);
    room.handleMessage(back.client, { t: C.JOIN, name, token });
    assert.equal(back.client.playerId, id, 'he came back a stranger');
    assert.equal(room.players.get(id).name, name, 'and under a different name');
    assert.ok(other.player, 'test setup: there was nobody else in the room');
  } finally { clock.restore(); }
});

test('but somebody who really went home is swept', () => {
  const { room, clock, stubs } = town({ humans: 2, bots: 4 });
  try {
    const [me] = stubs;
    const id = me.player.id;
    room.removeConnection(me.client);
    room.toLobby();
    assert.ok(room.players.has(id), 'test setup: he was gone before the grace ran');

    secs(clock, room, SOCIAL.reconnectGrace + 3);
    assert.equal(room.players.has(id), false,
      'a lobby kept a seat for somebody who closed their tab a minute ago');
    assert.equal(room.humanCount(), 1);
  } finally { clock.restore(); }
});
