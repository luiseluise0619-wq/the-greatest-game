// The chamber, the draw, and the barrel turned round.
//
// Three rules that between them decide what anybody is doing while it is not
// their go - which, in a mode where one gun is live at a time and six people
// are standing still, is most of the round.
//
//   The chamber is the town's, not yours. It is loaded at the start of every
//   walk and announced - so many live, so many blank, never the order - and
//   every shot anybody fires draws the next one. Six people spend the lap
//   counting the same six rounds.
//
//   A gun has to be steady on somebody before it will fire. That is the draw,
//   and it is the only warning the man on the other end of it gets.
//
//   Which is what makes the card in his hand a decision rather than a
//   deduction: it only saves him if he saw it coming and moved.
//
// And the barrel turned round: a blank buys another go, a live round costs a
// hit and carries on out of your back into whoever chose to stand behind you.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, MODES, DUEL } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function town({ bots = 5 } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'ROUL', isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  secs(clock, room, 2);
  freezeBots(room);
  const all = [...room.players.values()];
  // Everybody out of everybody else's way unless a test puts them somewhere.
  all.forEach((p, i) => { p.pos = { x: 400 + i * 40, y: 0, z: 400 }; });
  return {
    room, clock, stub, all,
    turn: (p) => { room.turn = { kind: 'turn', holder: p.id, endsAt: 1e12 }; p.bangsThisTurn = 0; },
  };
}

test('the chamber is loaded in the open and counted down by everybody', () => {
  const { room, clock, stub } = town();
  try {
    const said = stub.last('chamber');
    assert.ok(said, 'the town was never told what went into it');
    assert.ok(said.live >= 1 && said.blank >= 1,
      `${said.live} live and ${said.blank} blank leaves nothing worth counting`);
    assert.equal(said.live + said.blank, room.chamber.length);
    // One round for every man alive, so it comes back round to you empty.
    assert.equal(room.chamber.length, [...room.players.values()].filter((p) => p.alive).length);

    const before = room.chamber.length;
    room.nextRound();
    assert.equal(room.chamber.length, before - 1, 'a round was fired and the count did not move');
    // And it is never left empty: the next lap loads it again rather than
    // handing somebody a gun with nothing in it.
    room.chamber = [];
    assert.equal(typeof room.nextRound(), 'boolean');
    assert.ok(room.chamber.length >= 1);
  } finally { clock.restore(); }
});

test('a gun has to be steady before it will fire', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a] = all;
    turn(a);
    a.duelHand = ['bang'];
    a.nextFireAt = 0;
    a.aimDwell = 0;
    room.onShoot(a, { dir: [0, 0, -1] });
    assert.deepEqual(a.duelHand, ['bang'], 'a snap shot went off with no warning to anybody');

    a.aimDwell = DUEL.drawTime + 0.05;
    room.onShoot(a, { dir: [0, 0, -1] });
    assert.deepEqual(a.duelHand, [], 'a steady barrel would not fire');
  } finally { clock.restore(); }
});

test('the card only saves the man who saw it coming', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a, b] = all;
    turn(a);
    a.pos = { x: 0, y: 0, z: 0 };
    b.pos = { x: 0, y: 0, z: 6 };
    b.gear = [];
    b.duelHand = ['missed'];
    b.bracedUntil = 0;

    const held = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, held - 1, 'it was spent for him');
    assert.deepEqual(b.duelHand, ['missed'], 'and the card went with it');

    // Braced, and the same shot finds nobody.
    b.bracedUntil = 1e12;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, held - 1, 'bracing did not save him');
    assert.deepEqual(b.duelHand, [], 'and it cost nothing to be right');
  } finally { clock.restore(); }
});

test('bracing is for somebody else\'s go, not your own', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a, b] = all;
    turn(a);
    room.onBrace(a);
    assert.ok(!(a.bracedUntil > 0), 'the man holding the floor ducked on his own turn');
    room.onBrace(b);
    assert.ok(b.bracedUntil > 0);
  } finally { clock.restore(); }
});

test('a blank is noise, and it still costs the card', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a, b] = all;
    turn(a);
    a.pos = { x: 0, y: 0, z: 0 };
    b.pos = { x: 0, y: 0, z: 6 };
    b.gear = []; b.duelHand = [];
    a.roundIsLive = false;
    const held = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, held, 'a blank took a hit off somebody');
    a.roundIsLive = true;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, held - 1, 'and a live round did not');
  } finally { clock.restore(); }
});

test('the barrel turned round: a click buys another go', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a, b] = all;
    turn(a);
    a.duelHand = ['bang', 'bang'];
    a.pos = { x: 0, y: 0, z: 0 }; a.yaw = 0;
    b.pos = { x: 0, y: 0, z: 4 };
    const [hpA, hpB] = [a.health, b.health];

    room.chamber = [false];
    room.onSelfShot(a);
    assert.equal(a.health, hpA, 'a blank took a hit');
    assert.equal(b.health, hpB, 'and reached the man behind him');
    assert.equal(room.turnHolder, a.id, 'a click did not buy another go');
    assert.equal(a.duelHand.length, 1, 'and it was free');
  } finally { clock.restore(); }
});

test('and a live one goes through you into whoever stood behind', () => {
  const { room, clock, all, turn } = town();
  try {
    const [a, b] = all;
    turn(a);
    a.duelHand = ['bang'];
    a.pos = { x: 0, y: 0, z: 0 }; a.yaw = 0;      // facing -z, so the back is +z
    b.pos = { x: 0, y: 0, z: 4 };
    const [hpA, hpB] = [a.health, b.health];

    room.chamber = [true];
    room.onSelfShot(a);
    assert.equal(a.health, hpA - 1, 'it went off and missed the man holding it');
    assert.equal(b.health, hpB - 1, 'and stopped before the man lined up behind him');
  } finally { clock.restore(); }
});

test('standing out of the line is the whole of not being shot through', () => {
  const { room, clock, all } = town();
  try {
    const [a, b] = all;
    a.pos = { x: 0, y: 0, z: 0 }; a.yaw = 0;
    for (const p of all.slice(2)) p.pos = { x: 900, y: 0, z: 900 };

    b.pos = { x: 0, y: 0, z: 4 };
    assert.equal(room.linedUpBehind(a)?.id, b.id, 'directly behind and not found');
    b.pos = { x: DUEL.selfShot.corridor + 1.5, y: 0, z: 4 };
    assert.equal(room.linedUpBehind(a), null, 'a step to one side was still in the line');
    b.pos = { x: 0, y: 0, z: DUEL.selfShot.reach + 10 };
    assert.equal(room.linedUpBehind(a), null, 'the round carried further than it should');
    b.pos = { x: 0, y: 0, z: -6 };
    assert.equal(room.linedUpBehind(a), null, 'the man in front was shot in the back');

    // Nearest first: a round that has been through one man does not find a second.
    b.pos = { x: 0, y: 0, z: 4 };
    const third = all[2];
    third.pos = { x: 0, y: 0, z: 9 };
    assert.equal(room.linedUpBehind(a)?.id, b.id, 'it reached past the first man in the line');
  } finally { clock.restore(); }
});
