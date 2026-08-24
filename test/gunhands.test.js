// The sixteen.
//
// The card game this mode is modelled on deals a character as well as a role,
// and the character is half of what makes a hand interesting: the same four
// cards are a different game in front of a man who draws one back every time he
// is hit than in front of a man who only needs one card to stop you.
//
// All sixteen effects are the original's - a game system is not anybody's
// property - and every one of them is checked here from the server's side,
// because every one of them is a rule some other test in this suite is
// deliberately measuring without.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, DUEL } from '../shared/constants.js';
import { GUNHANDS, GUNHAND_ORDER, healthOf } from '../shared/gunhands.js';
import { reachOf, coverOf, inReach, DISTANCE_UNIT } from '../shared/deck.js';

const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function table({ bots = 5 } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'HAND', isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  secs(clock, room, 2);
  const all = [...room.players.values()];
  all.forEach((p, i) => {
    p.gunhand = null;
    p.pos = { x: 500 + i * 40, y: 0, z: 500 };
    p.gear = [];
    p.duelHand = [];
  });
  return {
    room, clock, all,
    deal: (p, id) => {
      p.gunhand = id;
      p.maxHealth = healthOf(id, DUEL.health);
      p.health = p.maxHealth;
      return p;
    },
    turn: (p) => { room.turn = { kind: 'turn', holder: p.id, endsAt: Date.now() / 1000 + 1e6 }; p.bangsThisTurn = 0; },
    face: (a, b, m) => { a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: 0, y: 0, z: m }; },
  };
}

test('all sixteen are dealt, and no two men get the same one', () => {
  assert.equal(GUNHAND_ORDER.length, 16);
  const { room, clock, all } = table();
  try {
    const dealt = [...room.players.values()].map((p) => p.gunhand);
    // gunhand was cleared by the fixture; check what beginMatch actually dealt.
    const fresh = new Room({ code: 'X', isPublic: false, mode: MODES.DUEL });
    fresh.botFillTarget = 7;
    fresh.resetClock();
    fresh.beginMatch();
    const hands = [...fresh.players.values()].map((p) => p.gunhand);
    assert.ok(hands.every((h) => GUNHANDS[h]), `somebody was dealt ${hands.find((h) => !GUNHANDS[h])}`);
    assert.equal(new Set(hands).size, hands.length, 'two men got the same gunhand');
    for (const p of fresh.players.values()) {
      assert.equal(p.maxHealth, healthOf(p.gunhand, DUEL.health) + (p.role === 'sheriff' ? 1 : 0),
        `${p.gunhand} started on the wrong number of hits`);
      assert.equal(p.duelHand.length, p.maxHealth, 'and was dealt the wrong number of cards');
    }
    assert.equal(dealt.length, all.length);
  } finally { clock.restore(); }
});

test('one bleeds a card for every hit, and one takes it off whoever landed it', () => {
  const { room, clock, all, deal, turn, face } = table();
  try {
    const [a, b, c] = all;
    turn(a);
    a.roundIsLive = true;
    deal(b, 'ironhide');
    face(a, b, 6);
    b.duelHand = [];
    const before = b.duelHand.length;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.ok(b.duelHand.length > before, 'he was shot and it cost the shooter nothing');

    deal(c, 'scavenger');
    c.pos = { x: 0, y: 0, z: 7 };
    c.duelHand = [];
    a.duelHand = ['bang', 'missed'];
    a.gear = [];
    room.applyDamage(c, a, 99, 'shot', null, 'body');
    assert.equal(a.duelHand.length + (a.gear || []).length, 1, 'the shooter kept everything he had');
    assert.equal(c.duelHand.length, 1, 'and it did not end up in the hand it was taken for');
    assert.equal(healthOf('scavenger', DUEL.health), 3, 'and he is meant to be cheaper to kill for it');
  } finally { clock.restore(); }
});

test('one reads a Missed! as a shot, and fires it', () => {
  const { room, clock, all, deal, turn, face } = table();
  try {
    const [a, b] = all;
    deal(a, 'ambidexter');
    turn(a);
    a.duelHand = ['missed'];
    a.nextFireAt = 0;
    a.aimDwell = DUEL.drawTime + 0.2;
    assert.equal(room.canFire(a), true, 'he could not fire with a hand full of ammunition');
    room.onShoot(a, { dir: [0, 0, -1] });
    assert.deepEqual(a.duelHand, [], 'and it never left his hand');

    // And the other way: a Bang! gets him out of the way of one.
    deal(b, 'ambidexter');
    face(a, b, 6);
    b.duelHand = ['bang'];
    b.gear = [];
    b.bracedUntil = 1e12;
    room.chamber = [true];
    const held = b.health;
    room.turn = { kind: 'turn', holder: a.id, endsAt: 1e12 };
    a.roundIsLive = true;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, held, 'a Bang! did not stop one coming the other way');
    assert.deepEqual(b.duelHand, []);
  } finally { clock.restore(); }
});

test('one takes two to get out of the way of', () => {
  const { room, clock, all, deal, turn, face } = table();
  try {
    const [a, b] = all;
    deal(a, 'butcher');
    turn(a);
    face(a, b, 6);
    a.roundIsLive = true;
    b.gear = [];
    b.bracedUntil = 1e12;

    b.duelHand = ['missed'];
    let held = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, held - 1, 'one was enough against the man it is never enough against');
    assert.deepEqual(b.duelHand, ['missed'], 'and it was spent for nothing');

    b.bracedUntil = 1e12;
    b.duelHand = ['missed', 'missed'];
    held = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, held, 'two was not enough either');
    assert.deepEqual(b.duelHand, [], 'and it cost both of them');
  } finally { clock.restore(); }
});

test('one stands behind a barrel he never had to find', () => {
  const { room, clock, all, deal, turn, face } = table();
  try {
    const [a, b] = all;
    turn(a);
    deal(b, 'cooper');
    face(a, b, 6);
    a.roundIsLive = true;
    b.gear = []; b.duelHand = []; b.bracedUntil = 0;
    // It is a chance rather than a rule, so it is counted: forty shots at a man
    // with no barrel in front of him should still find wood some of the time.
    let stopped = 0;
    for (let i = 0; i < 60; i++) {
      b.health = b.maxHealth;
      room.applyDamage(b, a, 99, 'shot', null, 'body');
      if (b.health === b.maxHealth) stopped += 1;
    }
    assert.ok(stopped >= 4, `sixty shots and the barrel stopped ${stopped}`);
    assert.ok(stopped <= 40, `sixty shots and the barrel stopped ${stopped} - it is meant to be a chance`);
  } finally { clock.restore(); }
});

test('one is always a step further out, and one always reaches a step further', () => {
  const { room, clock, all, deal } = table();
  try {
    const [a, b] = all;
    const plainReach = reachOf(a);
    deal(b, 'drifter');
    assert.equal(coverOf(b), DISTANCE_UNIT, 'she stands where the tape says she does');
    assert.equal(inReach(a, b, plainReach - 1), false, 'and a gun that reaches her reached her');
    deal(a, 'spotter');
    assert.equal(reachOf(a), plainReach + DISTANCE_UNIT, 'he reads the ground and it changed nothing');
    assert.equal(inReach(a, b, plainReach - 1), true, 'and the two of them did not cancel out');
    assert.ok(room);
  } finally { clock.restore(); }
});

test('one has no limit of one shot a turn', () => {
  const { room, clock, all, deal, turn } = table();
  try {
    const [a] = all;
    deal(a, 'quickdraw');
    turn(a);
    a.duelHand = ['bang', 'bang', 'bang'];
    a.bangsThisTurn = 3;
    assert.equal(room.canBang(a), true, 'three shots into his go and he was told to stop');
    a.gunhand = null;
    assert.equal(room.canBang(a), false, 'and everybody else was not');
  } finally { clock.restore(); }
});

test('one gets asked twice every time the game asks', () => {
  const { room, clock, all, deal } = table();
  try {
    const [a, b] = all;
    deal(a, 'fortunate');
    let lucky = 0, plain = 0;
    for (let i = 0; i < 400; i++) {
      if (room.drawFor(a, 'jail')) lucky += 1;
      if (room.drawFor(b, 'jail')) plain += 1;
    }
    // A quarter each time, asked twice, is a bit under a half.
    assert.ok(lucky > plain, `asked twice ${lucky}, asked once ${plain}`);
    assert.ok(lucky > 120 && lucky < 250, `asked twice came out ${lucky} in 400`);
  } finally { clock.restore(); }
});

test('one is never holding nothing', () => {
  const { room, clock, all, deal, turn } = table();
  try {
    const [a] = all;
    deal(a, 'emptyhand');
    turn(a);
    a.duelHand = ['bang'];
    a.nextFireAt = 0;
    a.aimDwell = DUEL.drawTime + 0.2;
    room.onShoot(a, { dir: [0, 0, -1] });
    assert.equal(a.duelHand.length, 1, 'she fired her last card and stood there empty');
  } finally { clock.restore(); }
});

test('one goes through the pockets of everybody who goes down', () => {
  const { room, clock, all, deal } = table();
  try {
    const [a, b] = all;
    deal(a, 'undertaker');
    a.duelHand = [];
    b.duelHand = ['bang', 'beer', 'missed'];
    room.killPlayer(b, a, 'shot', null);
    assert.deepEqual(a.duelHand.sort(), ['bang', 'beer', 'missed'], 'the body was buried with its hand');
    assert.deepEqual(b.duelHand, []);
  } finally { clock.restore(); }
});

test('one buys a hit back with two cards, and only on his own go', () => {
  const { room, clock, all, deal, turn } = table();
  try {
    const [a, b] = all;
    deal(a, 'fieldsurgeon');
    a.health = a.maxHealth - 2;
    a.duelHand = ['bang', 'beer', 'missed'];

    turn(b);
    room.onGunhandAbility(a);
    assert.equal(a.health, a.maxHealth - 2, 'he patched himself up on somebody else\'s go');

    turn(a);
    room.onGunhandAbility(a);
    assert.equal(a.health, a.maxHealth - 1, 'and could not do it on his own');
    assert.equal(a.duelHand.length, 1, 'for the wrong number of cards');

    // And with one card left there is nothing to pay with.
    room.onGunhandAbility(a);
    assert.equal(a.health, a.maxHealth - 1, 'he paid with a card he did not have');
  } finally { clock.restore(); }
});

test('the four who do not draw off the top of the pile', () => {
  const { room, clock, all, deal, turn } = table();
  try {
    const [a, b] = all;

    // Off somebody else's hand.
    deal(a, 'cutpurse');
    a.duelHand = []; a.pos = { x: 0, y: 0, z: 0 };
    b.duelHand = ['winchester']; b.pos = { x: 0, y: 0, z: 5 };
    turn(a);
    room.drawForTurn(a);
    assert.equal(a.duelHand.length, DUEL.draw, 'she was dealt the wrong number');
    assert.ok(a.duelHand.includes('winchester'), 'and none of it came out of a hand');
    assert.deepEqual(b.duelHand, [], 'and he still has it');

    // Off the floor.
    deal(a, 'ragpicker');
    a.duelHand = [];
    room.pile.discard = ['gatling'];
    room.drawForTurn(a);
    assert.equal(a.duelHand.length, DUEL.draw);
    assert.ok(a.duelHand.includes('gatling'), 'the top of the discard stayed on the discard');

    // Second face up, and a red one buys another - so a hand of two or more.
    deal(a, 'cardsharp');
    a.duelHand = [];
    room.drawForTurn(a);
    assert.ok(a.duelHand.length >= DUEL.draw, `she was dealt ${a.duelHand.length}`);

    // Three seen, two kept, one back on the pile.
    deal(a, 'surveyor');
    a.duelHand = [];
    const pile = room.pile.remaining;
    room.drawForTurn(a);
    assert.equal(a.duelHand.length, DUEL.draw, 'she kept the wrong number');
    assert.equal(room.pile.remaining, pile - DUEL.draw, 'and the third one did not go back');
  } finally { clock.restore(); }
});
