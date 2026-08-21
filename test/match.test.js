// The round itself: roles, win conditions, and the information rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { PHASE, TIMING, ROLES, PLAYER } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

function makeRoom({ bots = 6, prep = 3, combat = 400 } = {}) {
  TIMING.prep = prep; TIMING.combat = combat; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'TEST', isPublic: false });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  return { room, clock, stub, me: () => [...room.players.values()].find((p) => !p.bot) };
}

test('a match deals exactly one of each required role and starts everyone alive', () => {
  const { room, clock } = makeRoom({ bots: 8 });
  try {
    room.beginMatch();
    const players = [...room.players.values()];
    assert.equal(players.length, 8);
    assert.equal(players.filter((p) => p.role === 'sheriff').length, 1);
    assert.ok(players.every((p) => p.alive && p.health > 0));
    assert.ok(players.every((p) => ROLES[p.role]), 'every player has a real role');
    // The Sheriff carries a quiet extra margin nobody else can see.
    const sheriff = players.find((p) => p.role === 'sheriff');
    assert.ok(sheriff.maxHealth > PLAYER.maxHealth);
  } finally { clock.restore(); }
});

test('nobody is told anybody else\'s role at the start', () => {
  const { room, clock, stub } = makeRoom();
  try {
    room.beginMatch();
    const role = stub.last('role');
    assert.ok(role, 'the player must be told their own role');
    assert.ok(ROLES[role.role]);
    // Their own card is the only role in anything they were sent.
    const others = [...room.players.values()].filter((p) => p.bot);
    const wire = JSON.stringify(stub.sent);
    for (const o of others) {
      assert.equal(
        wire.includes(`"${o.name}","role"`), false,
        `${o.name}'s role leaked to the client`,
      );
    }
  } finally { clock.restore(); }
});

test('guns do nothing during preparation', () => {
  const { room, clock } = makeRoom({ prep: 60 });
  try {
    room.beginMatch();
    const [a, b] = [...room.players.values()];
    const before = b.health;
    room.applyDamage(b, a, 50, 'revolver', null);
    assert.equal(b.health, before, 'somebody took damage before the bell');
    assert.equal(room.phase, PHASE.PREP);
  } finally { clock.restore(); }
});

test('killing the Sheriff ends the round for the gang', () => {
  const { room, clock } = makeRoom({ bots: 8, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    assert.equal(room.phase, PHASE.COMBAT);
    const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff');
    const outlaw = [...room.players.values()].find((p) => p.role === 'outlaw');
    room.applyDamage(sheriff, outlaw, 999, 'revolver', null);
    assert.equal(room.phase, PHASE.RESULTS);
    assert.equal(room.results.winner, 'outlaw');
  } finally { clock.restore(); }
});

test('burying every outlaw and the renegade wins it for the law', () => {
  const { room, clock } = makeRoom({ bots: 8, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff');
    for (const p of [...room.players.values()]) {
      if (p.faction !== 'law') room.applyDamage(p, sheriff, 999, 'revolver', null);
    }
    assert.equal(room.results.winner, 'law');
    assert.ok(sheriff.alive);
  } finally { clock.restore(); }
});

test('a kill only names the killer to somebody who watched it', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    const victim = [...room.players.values()].find((p) => p.bot && p.alive);
    const killer = [...room.players.values()].find((p) => p.bot && p.alive && p !== victim);

    freezeBots(room);
    // Put our player inside the mine, far from a killing in the church.
    player.pos = { x: 58, y: 0, z: -18 };
    victim.pos = { x: 0, y: 0, z: 20 };
    killer.pos = { x: 2, y: 0, z: 22 };
    tick(clock, room, 2);
    stub.reset();
    room.applyDamage(victim, killer, 999, 'revolver', null);

    const kill = stub.last('kill');
    assert.ok(kill, 'the death should still be announced');
    assert.equal(kill.victimName, victim.name);
    assert.equal(kill.victimRole, victim.role, 'the dead always reveal their role');
    assert.equal(kill.witnessed, false);
    assert.equal(kill.killerName, null, 'named a killer nobody could see');
  } finally { clock.restore(); }
});

test('the victim always learns who shot them', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    const killer = [...room.players.values()].find((p) => p.bot && p.alive);
    stub.reset();
    room.applyDamage(player, killer, 999, 'revolver', null);
    const kill = stub.last('kill');
    assert.equal(kill.youDied, true);
    assert.equal(kill.killerName, killer.name);
  } finally { clock.restore(); }
});

test('a death replay carries only the killer and the victim', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 20 * 8);          // fill the history buffer during live fire
    const player = me();
    const killer = [...room.players.values()].find((p) => p.bot && p.alive);
    stub.reset();
    room.applyDamage(player, killer, 999, 'revolver', null);

    const replay = stub.last('replay');
    assert.ok(replay, 'no killcam was sent');
    assert.ok(replay.frames.length > 5);
    const ids = new Set(replay.frames.flatMap((f) => f.ps.map((e) => e.id)));
    assert.deepEqual(
      [...ids].sort(), [player.id, killer.id].sort(),
      'the replay leaked a bystander',
    );
  } finally { clock.restore(); }
});

test('the dead cannot talk to the living', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6, prep: 1 });
  try {
    room.beginMatch();
    tick(clock, room, 40);
    const player = me();
    const ghostHeard = [];
    // A second, living client to check what it receives.
    const other = stubClient();
    room.addConnection(other.client);
    room.handleMessage(other.client, { t: 'join', name: 'Alive' });
    const alive = [...room.players.values()].find((p) => p.name === 'Alive');
    alive.alive = true;

    player.alive = false;
    other.reset();
    room.onChat(player, { text: 'the sheriff is Dutch' });
    assert.equal(other.of('chat').length, 0, 'a ghost coached a living player');

    player.alive = true;
    player.lastChatAt = 0;
    other.reset();
    room.onChat(player, { text: 'still breathing' });
    assert.equal(other.of('chat').length, 1, 'living chat should reach everyone');
  } finally { clock.restore(); }
});
