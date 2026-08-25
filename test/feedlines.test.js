// Every line the town says, said in Korean.
//
// The strings are checked elsewhere - that they exist, that nothing is orphaned
// and that no Korean entry is secretly English. What that cannot catch is a
// sentence whose holes do not match the holes the server filled: the key says
// {a} and the server sent {name}, and a Korean player reads the word "{a}".
// That got as far as a live round before anybody noticed, so this plays one.
//
// It is a runtime test rather than a static one on purpose. The message is the
// contract, so the messages are what it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, PHASE, DUEL } from '../shared/constants.js';
import { line, has } from '../shared/i18n.js';

const { Room } = await import('../server/room.js');

const HOLE = /\{\w+(?::[^{}]+)?\}/;

/** Every keyed line this room says, whoever it says it to. */
function listen(room) {
  const said = [];
  const grab = (msg) => { if (msg && msg.t === 'feed' && msg.k) said.push(msg); };
  const emit = room.emit.bind(room);
  const broadcast = room.broadcast.bind(room);
  room.emit = (p, msg) => { grab(msg); return emit(p, msg); };
  room.broadcast = (msg, ...rest) => { grab(msg); return broadcast(msg, ...rest); };
  return said;
}

function town({ bots = 5, mode = MODES.DUEL } = {}) {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'SAID', isPublic: false, mode });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  const said = listen(room);
  room.beginMatch();
  return { room, clock, said, stub };
}

/** Say it in both, and neither may come out with a hole still in it. */
function check(said, where) {
  assert.ok(said.length > 0, `${where}: nothing was said at all`);
  const bad = [];
  for (const msg of said) {
    for (const lang of ['en', 'ko']) {
      const out = line(lang, msg);
      if (HOLE.test(out)) bad.push(`${lang} ${msg.k}: ${out}`);
      if (!out) bad.push(`${lang} ${msg.k}: said nothing at all`);
    }
    if (!has('ko', msg.k)) bad.push(`${msg.k} was never translated`);
  }
  assert.deepEqual(bad, [], `${where}, and these came out wrong:\n  ${bad.join('\n  ')}`);
}

test('a whole turn-mode round says nothing with a hole left in it', () => {
  const { room, clock, said } = town();
  try {
    for (let i = 0; i < 20 * 260 && room.phase !== PHASE.RESULTS; i++) tick(clock, room, 1);
    const keys = new Set(said.map((m) => m.k));
    // A round that only ever said "roles dealt" would pass and prove nothing.
    assert.ok(keys.size >= 8, `only ${keys.size} different things were said all round`);
    check(said, 'a full round of the turn mode');
  } finally { clock.restore(); }
});

test('and neither does the free-for-all', () => {
  const { room, clock, said } = town({ mode: MODES.FREE });
  try {
    for (let i = 0; i < 20 * 260 && room.phase !== PHASE.RESULTS; i++) tick(clock, room, 1);
    check(said, 'a full round of the free-for-all');
  } finally { clock.restore(); }
});

test('the lines a round might not reach on its own get reached', () => {
  // Half of these are refusals, and a round of bots never gets refused because
  // bots do not play cards they cannot play. So they are asked for by hand.
  const { room, clock, said } = town();
  try {
    tick(clock, room, 40);
    const all = [...room.players.values()];
    const [me, them] = all;
    room.turn = { kind: 'turn', holder: me.id, endsAt: 1e12 };
    me.pos = { x: 0, y: 0, z: 0 };
    them.pos = { x: 0, y: 0, z: 8 };
    me.health = me.maxHealth;

    const play = (card, target) => {
      me.duelHand = [card];
      me.bangsThisTurn = 0;
      room.onDuelCard(me, { t: 'card', card, target: target ? target.id : undefined });
    };
    // Refusals.
    play('missed');                                  // not on your own go
    play('beer');                                    // not hurt enough
    me.gear = ['barrel']; play('barrel');            // already out
    me.gear = []; play('jail');                      // nobody named
    play('panic', them);                             // nothing to take
    them.duelHand = ['bang']; them.gear = [];
    play('catbalou');                                // nobody named
    // And the things that work.
    play('schofield'); play('barrel'); play('dynamite');
    play('stagecoach'); play('saloon'); play('store');
    play('indians'); play('gatling');
    play('jail', them); play('panic', them); play('catbalou', them);
    me.health = 1; play('beer');
    // The chamber, both ways round.
    room.chamber = [false]; me.duelHand = ['bang']; me.bangsThisTurn = 0;
    room.onSelfShot(me);
    room.chamber = [true]; me.duelHand = ['bang']; me.bangsThisTurn = 0;
    me.yaw = 0; them.pos = { x: 0, y: 0, z: 4 };
    room.onSelfShot(me);
    // The cell, at the top of a go.
    them.jailed = true; them.gear = ['jail'];
    room.onTurnStart(them);
    // And the stick.
    them.hasDynamite = true;
    room.onTurnStart(them);

    // The sixteen. A round of bots reaches whichever handful got dealt, so
    // twelve of these lines can go a hundred rounds without ever being said -
    // which is exactly how a hole in one of them survives.
    // Both of them back on their feet: the barrel turned round and the stick
    // above may well have put one of them in the ground, and a dead man's
    // hands do nothing.
    for (const who of [me, them]) {
      who.alive = true;
      who.maxHealth = who.maxHealth || DUEL.health;
      who.health = who.maxHealth;
      who.gear = [];
    }
    const hand = (who, id) => { who.gunhand = id; };
    hand(them, 'ironhide'); them.duelHand = [];
    room.onHitTaken(them, me, 1);
    hand(them, 'scavenger'); me.duelHand = ['bang']; them.duelHand = [];
    room.onHitTaken(them, me, 1);
    hand(them, 'scavenger'); me.duelHand = []; me.gear = [];
    room.onHitTaken(them, me, 1);
    hand(them, 'emptyhand'); them.duelHand = [];
    room.checkEmptyHand(them);
    hand(them, 'undertaker'); me.duelHand = ['bang', 'beer'];
    room.onDeathSpoils(me);

    // The round out of a man's back, and the two things that stop it. Neither
    // line is ever said by a round of bots that did not happen to gamble in
    // front of a man with a barrel.
    them.gear = ['barrel'];
    them.duelHand = ['missed'];
    them.bracedUntil = Date.now() / 1000 + 5;
    const realDraw = room.drawFor.bind(room);
    room.drawFor = () => true;
    room.throughStopped(them, me);
    room.drawFor = () => false;
    room.throughStopped(them, me);
    room.drawFor = realDraw;
    them.gear = [];

    // The one with a key to press, and every way it can be refused.
    room.turn = { kind: 'turn', holder: me.id, endsAt: 1e12 };
    hand(me, 'cooper'); room.onGunhandAbility(me);          // nothing to press
    hand(me, 'fieldsurgeon');
    room.turn = { kind: 'turn', holder: them.id, endsAt: 1e12 };
    room.onGunhandAbility(me);                              // not your go
    room.turn = { kind: 'turn', holder: me.id, endsAt: 1e12 };
    me.health = me.maxHealth; room.onGunhandAbility(me);    // not hurt enough
    me.health = 1; me.duelHand = ['bang']; room.onGunhandAbility(me);  // needs two
    me.duelHand = ['bang', 'beer', 'missed']; room.onGunhandAbility(me);  // and it works

    const keys = new Set(said.map((m) => m.k));
    for (const k of ['feed.bleedsSlow', 'feed.takesItBack', 'feed.tookItBack',
      'feed.neverEmpty', 'gun.nothingToPress', 'gun.notYourGo', 'gun.needTwoCards',
      'gun.twoForOne', 'feed.throughWood', 'feed.throughMissed']) {
      assert.ok(keys.has(k), `${k} was never said, so nothing here checked its holes`);
    }
    assert.ok(keys.size >= 28, `only ${keys.size} different lines were reached`);
    check(said, 'the lines a round does not always reach');
  } finally { clock.restore(); }
});
