// The barrel turned round, in the town it belongs to.
//
// The card game has no chamber and no blanks in it: a Bang! is a Bang!, it is
// answered by a card, and if nothing answers it, it lands. A bullet that might
// be nothing turned every go into a coin toss underneath a deck that is already
// the whole of the tension there.
//
// The free-for-all is a different problem. Nobody can prove anything about
// anybody, and the only currency in the place is whether the men watching
// believe you. So that is where a man spins his own cylinder: the gamble is
// public, the payoff is public, and what it buys is the one thing the mode is
// short of.
//
// Three rules carry it, and all three are here:
//
//   It has to be seen. A gamble nobody witnessed buys nothing and costs a sixth
//   of your life for it, which is not a mechanic, it is a trap.
//
//   Only the men who watched hear about it, by the same eyes-on test a
//   witnessed kill uses - so it can never buy anybody anything through a wall.
//
//   Once a round. It is a thing you spend, not a thing you grind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, MODES, ROULETTE, SOCIAL, PHASE } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

// A patch of open ground with nothing solid standing in it.
const OPEN = [0, 0];

function town({ bots = 5, mode = MODES.FREE } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'SPIN', isPublic: false, mode });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  tick(clock, room, 40);
  freezeBots(room);
  const all = [...room.players.values()].filter((p) => p.alive);
  // Everybody a long way from everybody else unless a test puts them together.
  all.forEach((p, i) => { p.pos = { x: 400 + i * 60, y: 0, z: 400 }; });
  return {
    room, clock, stub, all,
    // Two men face to face and close enough to see each other's face. Yaw 0
    // looks down -Z here, so the man in front of you is at a smaller z.
    facing: (a, b) => {
      const [x, z] = OPEN;
      a.pos = { x, y: 0, z }; a.yaw = 0;
      b.pos = { x, y: 0, z: z - 6 }; b.yaw = Math.PI;
      a.pitch = 0; b.pitch = 0;
    },
  };
}

test('there is no chamber at the table and no blanks in it', () => {
  // The thing this whole file exists because of. A Bang! at a table is a Bang!.
  const { room, clock } = town({ mode: MODES.DUEL });
  try {
    assert.equal(room.chamber, undefined, 'the table grew a chamber back');
    assert.equal(typeof room.loadChamber, 'undefined', 'and something to load it with');
    assert.equal(typeof room.nextRound, 'undefined', 'and something to draw out of it');
    const p = [...room.players.values()][0];
    assert.equal(p.roundIsLive, undefined, 'and a round that might be nothing');
  } finally { clock.restore(); }
});

test('the card game does not answer the key at all', () => {
  const { room, clock, all, facing } = town({ mode: MODES.DUEL });
  try {
    const [a, b] = all;
    facing(a, b);
    const held = a.health;
    a.guns.revolver.mag = 6;
    room.onSelfShot(a);
    assert.equal(a.health, held, 'a man at the table shot himself');
    assert.ok(!a.rouletteSpent, 'and the table spent a bet it does not have');
  } finally { clock.restore(); }
});

test('a gamble nobody watched is refused rather than taken', () => {
  const { room, clock, all } = town();
  try {
    const [a] = all;
    // Alone in the desert: everybody else is four hundred metres away.
    const held = a.health;
    const mag = a.guns.revolver.mag;
    room.onSelfShot(a);
    assert.equal(a.health, held, 'he shot himself with nobody there to see it');
    assert.equal(a.guns.revolver.mag, mag, 'and it cost him a round');
    assert.ok(!a.rouletteSpent, 'and his one bet of the round');
  } finally { clock.restore(); }
});

test('a man watching is enough, and it costs a round out of the cylinder', () => {
  const { room, clock, all, facing } = town();
  try {
    const [a, b] = all;
    facing(a, b);
    a.guns.revolver.mag = 6;
    room.onSelfShot(a);
    assert.ok(a.rouletteSpent, 'somebody was watching and it was refused anyway');
    assert.equal(a.guns.revolver.mag, 5, 'and no round came out of the cylinder');
  } finally { clock.restore(); }
});

test('once a round, and the next round hands it back', () => {
  const { room, clock, all, facing } = town();
  try {
    const [a, b] = all;
    facing(a, b);
    a.guns.revolver.mag = 6;
    room.onSelfShot(a);
    const after = a.guns.revolver.mag;
    room.onSelfShot(a);
    room.onSelfShot(a);
    assert.equal(a.guns.revolver.mag, after, 'he span it again in the same round');

    room.beginMatch();
    assert.ok(!a.rouletteSpent, 'and a fresh round did not hand the bet back');
  } finally { clock.restore(); }
});

test('only the men who watched are told, and a wall is a wall', () => {
  // The whole value of the thing is that they saw it, so it must reach exactly
  // the men who could have - the same three questions a witnessed kill asks.
  const { room, clock, all, facing } = town();
  try {
    const [a, b, c] = all;
    facing(a, b);
    // Six metres off on the other side, with his back to it. He is there and
    // he is not looking.
    c.pos = { x: a.pos.x, y: 0, z: a.pos.z + 6 }; c.yaw = Math.PI; c.pitch = 0;

    const seen = room.watchers(a);
    assert.ok(seen.has(b.id), 'the man looking straight at him saw nothing');
    assert.ok(!seen.has(c.id), 'and the man facing the other way saw it');

    // And distance is distance.
    b.pos = { x: a.pos.x, y: 0, z: a.pos.z - (SOCIAL.witnessRange + 40) };
    assert.ok(!room.watchers(a).has(b.id), 'he was seen from across the map');
  } finally { clock.restore(); }
});

test('it is most of a life when it is the loaded one, and never before the bell', () => {
  const { room, clock, all, facing } = town();
  try {
    const [a, b] = all;
    facing(a, b);

    // Before the bell it is not on offer at all.
    room.phase = PHASE.PREP;
    const held = a.health;
    room.onSelfShot(a);
    assert.equal(a.health, held, 'he gambled before the bell');
    assert.ok(!a.rouletteSpent);

    // And the loaded chamber is a real bullet: survivable at full health,
    // which is what makes it a bet rather than a button.
    room.phase = PHASE.COMBAT;
    assert.ok(ROULETTE.damage > 0 && ROULETTE.damage < a.maxHealth,
      `${ROULETTE.damage} of ${a.maxHealth} is not a gamble, it is a coin with one side`);
    assert.ok(ROULETTE.chambers >= 2, 'a cylinder with one chamber in it');
  } finally { clock.restore(); }
});

test('the once-a-round rule is the setting rather than a copy of it', () => {
  // ROULETTE.oncePerLife sat next to a hardcoded check that did the same thing,
  // which makes it a comment wearing a setting's clothes: turn it off and
  // nothing happens. ROULETTE.cooldown was worse - it read 0 and nothing
  // anywhere consulted it, so anybody reading the file would take "no
  // cooldown" as a fact about the code when it was a fact about a line of text.
  const { room, clock, all, facing } = town();
  const was = { once: ROULETTE.oncePerLife, cool: ROULETTE.cooldown };
  try {
    const [me, watcher] = all;
    facing(me, watcher);
    me.guns.revolver.mag = 6;
    me.health = me.maxHealth;

    // As shipped: once, and the second attempt is refused.
    room.onSelfShot(me);
    assert.equal(me.rouletteSpent, true, 'the first spin never happened');
    const after = me.guns.revolver.mag;
    me.health = me.maxHealth;
    me.alive = true;
    room.onSelfShot(me);
    assert.equal(me.guns.revolver.mag, after, 'he span it twice in one round');

    // With the rule off and a cooldown, the cooldown is what stops him - which
    // is only true if the code reads the setting rather than repeating it.
    ROULETTE.oncePerLife = false;
    ROULETTE.cooldown = 30;
    me.health = me.maxHealth;
    me.alive = true;
    room.onSelfShot(me);
    assert.equal(me.guns.revolver.mag, after,
      'oncePerLife was turned off and the cooldown did nothing');

    clock.advance(31_000);
    me.health = me.maxHealth;
    me.alive = true;
    room.onSelfShot(me);
    assert.ok(me.guns.revolver.mag < after,
      'the cooldown ran out and he still could not take the bet');
  } finally {
    ROULETTE.oncePerLife = was.once;
    ROULETTE.cooldown = was.cool;
    clock.restore();
  }
});
