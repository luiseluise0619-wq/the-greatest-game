// The eighty cards.
//
// Every effect here is the original's, and every one of them is checked from
// the server's side: what the card does, who it may be done to, and how far
// away they are allowed to be. The two that the original resolves by asking the
// table a question are checked for resolving the way a player with any sense
// would answer, because a first-person game cannot stop and ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, MODES, DUEL } from '../shared/constants.js';
import {
  DECK_SIZE, DISTANCE_UNIT, DUEL_CARDS, buildDeck, reachOf, inReach,
} from '../shared/deck.js';
import { Pile, handLimit } from '../server/deck.js';

const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function table({ bots = 5 } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'CARD', isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  secs(clock, room, 2);
  freezeBots(room);
  const all = [...room.players.values()];
  return {
    room, clock, all,
    give: (p, ...cards) => { p.duelHand = cards.slice(); },
    turn: (p) => { room.turn = { kind: 'turn', holder: p.id, endsAt: 1e12 }; p.bangsThisTurn = 0; },
    apart: (p, q, m) => { p.pos = { x: 0, y: 0, z: 0 }; q.pos = { x: 0, y: 0, z: m }; },
  };
}

test('the deck is the deck: eighty cards in the right proportions', () => {
  assert.equal(DECK_SIZE, 80);
  const counts = {};
  for (const id of buildDeck()) counts[id] = (counts[id] || 0) + 1;
  // The three that decide the shape of every hand.
  assert.equal(counts.bang, 25, 'the whole game is how often this comes up');
  assert.equal(counts.missed, 12);
  assert.equal(counts.beer, 6);
  for (const [id, card] of Object.entries(DUEL_CARDS)) {
    assert.equal(counts[id], card.count, `${card.name} is printed the wrong number of times`);
  }
});

test('the pile deals, discards and comes back round again', () => {
  const pile = new Pile();
  assert.equal(pile.remaining, 80);
  const drawn = pile.takeMany(80);
  assert.equal(drawn.length, 80);
  assert.equal(pile.remaining, 0);
  // A round can outlast the deck. Everything thrown away goes back under.
  pile.putMany(drawn);
  assert.equal(pile.take() !== null, true, 'the deck ran out and stayed out');
});

test('you are dealt a hand the size of your health', () => {
  const { room, clock, all } = table();
  try {
    for (const p of all) {
      assert.equal(p.duelHand.length, p.maxHealth, `${p.role} was dealt ${p.duelHand.length}`);
    }
    const sheriff = all.find((p) => p.role === 'sheriff');
    assert.equal(sheriff.duelHand.length, DUEL.sheriffHealth,
      'the star is one card as well as one hit better off');
    assert.equal(room.pile.remaining, 80 - all.reduce((n, p) => n + p.maxHealth, 0));
  } finally { clock.restore(); }
});

test('ammunition is cards, and one of them is a turn', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a] = all;
    turn(a);
    a.nextFireAt = 0;
    give(a);
    assert.equal(room.canFire(a), false, 'an empty hand still pulled the trigger');
    give(a, 'bang', 'bang', 'bang');
    assert.equal(room.canFire(a), true);
    room.spendBang(a);
    assert.equal(room.canBang(a), false, 'two shots on one go');
    assert.equal(a.duelHand.length, 2, 'firing did not cost a card');
    // Except with the gun that says otherwise.
    a.weaponCard = 'volcanic';
    assert.equal(room.canBang(a), true, 'the Volcanic is the exception and was not');
  } finally { clock.restore(); }
});

test('a gun reaches as far as the card in front of you says', () => {
  const { room, clock, all, give, turn, apart } = table();
  try {
    const [a, b] = all;
    turn(a);
    give(a, 'bang', 'bang', 'bang', 'bang');
    give(b);
    b.gear = [];

    // Bare hands: one step of ground.
    assert.equal(Math.round(reachOf(a)), DISTANCE_UNIT);
    apart(a, b, DISTANCE_UNIT + 5);
    const far = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, far, 'a shot landed from outside the gun\'s reach');
    apart(a, b, DISTANCE_UNIT - 2);
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, far - 1, 'a shot inside the reach did nothing');

    // And the far end of the street with the right rifle.
    a.weaponCard = 'winchester';
    assert.equal(Math.round(reachOf(a)), DISTANCE_UNIT * 5);
    apart(a, b, DISTANCE_UNIT * 4);
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, far - 2);

    // A scope is a step nearer; a mustang is a step further out.
    a.weaponCard = null;
    a.gear = ['scope'];
    assert.equal(Math.round(reachOf(a)), DISTANCE_UNIT * 2);
    b.gear = ['mustang'];
    assert.equal(inReach(a, b, DISTANCE_UNIT * 2 - 1), false, 'the mustang did not buy a step');
    assert.equal(inReach(a, b, DISTANCE_UNIT - 1), true);
  } finally { clock.restore(); }
});

test('a shot can be answered by the card you were holding for it', () => {
  const { room, clock, all, give, turn, apart } = table();
  try {
    const [a, b] = all;
    turn(a);
    apart(a, b, 8);
    give(a, 'bang', 'bang');
    b.gear = [];
    give(b, 'missed');
    // Answered, not answered for: the card comes out of the hand of somebody
    // who watched the barrel swing onto them and moved. See roulette.test.js
    // for the deciding half; this is the card doing its job once it is spent.
    b.bracedUntil = 1e12;
    const held = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, held, 'the Missed! did not');
    assert.deepEqual(b.duelHand, [], 'and it was not spent');
    // With nothing left it lands, braced or not.
    b.bracedUntil = 1e12;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, held - 1);
  } finally { clock.restore(); }
});

test('the hand you may keep shrinks with the health you have left', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a] = all;
    turn(a);
    a.health = 2;
    give(a, 'bang', 'bang', 'beer', 'beer', 'missed');
    assert.equal(handLimit(a), 2);
    room.onTurnEnd(a);
    assert.equal(a.duelHand.length, 2, 'a dying man kept his whole hand');
    a.health = 4;
    give(a, 'bang', 'bang', 'beer');
    room.onTurnEnd(a);
    assert.equal(a.duelHand.length, 3, 'a healthy man was made to throw cards away');
  } finally { clock.restore(); }
});

test('the cards that heal, and the one that will not pour for two men', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a] = all;
    turn(a);
    a.health = 2;
    give(a, 'beer');
    room.onDuelCard(a, { card: 'beer' });
    assert.equal(a.health, 3);

    for (const p of all) p.health = 2;
    turn(a);
    give(a, 'saloon');
    room.onDuelCard(a, { card: 'saloon' });
    assert.ok(all.every((p) => !p.alive || p.health === 3), 'the house did not buy everybody a round');

    // Down to two men and a beer is a piece of card.
    for (const p of all.slice(2)) p.alive = false;
    turn(a);
    a.health = 1;
    give(a, 'beer');
    room.onDuelCard(a, { card: 'beer' });
    assert.equal(a.health, 1, 'somebody drank their way out of a two-man standoff');
    assert.deepEqual(a.duelHand, ['beer'], 'and it cost them the card');
  } finally { clock.restore(); }
});

test('taking a card off somebody, from close up and from anywhere', () => {
  const { room, clock, all, give, turn, apart } = table();
  try {
    const [a, b] = all;
    turn(a);
    apart(a, b, 10);
    give(b, 'bang', 'bang');
    b.gear = []; b.weaponCard = null;
    give(a, 'panic');
    room.onDuelCard(a, { card: 'panic', target: b.id });
    assert.equal(b.duelHand.length, 1, 'nothing was taken');
    assert.ok(a.duelHand.includes('bang'), 'and it did not end up in the hand that took it');

    // Out of arm's reach it does nothing at all.
    turn(a);
    apart(a, b, DISTANCE_UNIT * 3);
    give(a, 'panic');
    room.onDuelCard(a, { card: 'panic', target: b.id });
    assert.deepEqual(a.duelHand, ['panic'], 'somebody picked a pocket from sixty metres');

    // Spite carries further than a bullet.
    turn(a);
    give(a, 'catbalou');
    give(b, 'beer');
    room.onDuelCard(a, { card: 'catbalou', target: b.id });
    assert.equal(b.duelHand.length, 0);
    assert.ok(!a.duelHand.includes('beer'), 'the thrown card was pocketed rather than discarded');
  } finally { clock.restore(); }
});

test('a cell costs a go, and the star is above it', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a] = all;
    const other = all.find((p) => p.role !== 'sheriff' && p.id !== a.id);
    turn(a);
    give(a, 'jail');
    other.gear = []; other.jailed = false;
    room.onDuelCard(a, { card: 'jail', target: other.id });
    assert.equal(other.jailed, true);

    const sheriff = all.find((p) => p.role === 'sheriff');
    if (sheriff.id !== a.id) {
      turn(a);
      give(a, 'jail');
      sheriff.gear = []; sheriff.jailed = false;
      room.onDuelCard(a, { card: 'jail', target: sheriff.id });
      assert.equal(sheriff.jailed, false, 'the man wearing the star was locked up');
      assert.deepEqual(a.duelHand, ['jail'], 'and it cost the card to fail');
    }
  } finally { clock.restore(); }
});

test('the two that point at everybody', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a] = all;
    const rest = () => all.filter((p) => p.id !== a.id && p.alive);
    for (const p of all) { p.health = 4; p.gear = []; }

    // Spend a Bang! or take the hit.
    turn(a);
    give(a, 'indians');
    for (const p of rest()) give(p, 'bang');
    room.onDuelCard(a, { card: 'indians' });
    assert.ok(rest().every((p) => p.health === 4 && p.duelHand.length === 0),
      'somebody paid in blood while holding the card that answers it');

    turn(a);
    give(a, 'indians');
    for (const p of rest()) give(p);
    room.onDuelCard(a, { card: 'indians' });
    assert.ok(rest().every((p) => p.health === 3));
    assert.equal(a.health, 4, 'it caught the man who played it');

    // The one that does not aim.
    for (const p of all) p.health = 4;
    turn(a);
    give(a, 'gatling');
    for (const p of rest()) give(p);
    room.onDuelCard(a, { card: 'gatling' });
    assert.ok(rest().every((p) => p.health === 3), 'it missed somebody');
    assert.equal(a.health, 4);
  } finally { clock.restore(); }
});

test('a duel is won by whoever brought more bullets', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a, b] = all;
    for (const p of all) p.health = 4;
    turn(a);
    give(a, 'duel', 'bang', 'bang');
    give(b, 'bang');
    room.onDuelCard(a, { card: 'duel', target: b.id });
    assert.equal(b.health, 3, 'the man who ran out did not take the hit');
    assert.equal(a.health, 4);
    // The man called out throws first, so this takes one bullet each and the
    // caller keeps the spare: bang, bang, and then nothing to answer with.
    assert.deepEqual(a.duelHand, ['bang'], 'the exchange cost the wrong number of shots');

    // The other way round, when the caller is the one who runs dry.
    for (const p of all) p.health = 4;
    turn(a);
    give(a, 'duel', 'bang');
    give(b, 'bang', 'bang');
    room.onDuelCard(a, { card: 'duel', target: b.id });
    assert.equal(a.health, 3, 'the caller ran out and walked away unhurt');
    assert.equal(b.health, 4);
  } finally { clock.restore(); }
});

test('nothing can be played on anybody else\'s go', () => {
  const { room, clock, all, give, turn } = table();
  try {
    const [a, b] = all;
    turn(b);
    a.health = 2;
    give(a, 'beer');
    room.onDuelCard(a, { card: 'beer' });
    assert.equal(a.health, 2, 'a card was played out of turn');
    assert.deepEqual(a.duelHand, ['beer']);
  } finally { clock.restore(); }
});

test('a weapon goes on the table, and the old one goes in the discard', () => {
  const { room, clock, all, turn } = table();
  try {
    const [p] = all;
    turn(p);
    p.duelHand = ['volcanic', 'schofield'];
    p.weaponCard = null;
    room.onDuelCard(p, { t: 'card', card: 'volcanic' });
    assert.equal(p.weaponCard, 'volcanic', 'the gun was announced and never picked up');
    assert.deepEqual(p.duelHand, ['schofield'], 'and it stayed in the hand as well');

    room.onDuelCard(p, { t: 'card', card: 'schofield' });
    assert.equal(p.weaponCard, 'schofield', 'you may only hold one, and it is the new one');
    assert.deepEqual(p.duelHand, []);
    assert.ok(room.pile.discard.includes('volcanic'), 'the old gun vanished rather than being thrown away');
    assert.equal(reachOf(p), 2 * DISTANCE_UNIT, 'the new gun did not change what it reaches');
  } finally { clock.restore(); }
});
