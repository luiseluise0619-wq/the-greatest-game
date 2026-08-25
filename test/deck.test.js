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
  DECK_SIZE, DISTANCE_UNIT, DUEL_CARDS, buildDeck, reachOf, reachSeats, coverSeats,
  sightSeats, inReach,
} from '../shared/deck.js';
import { Pile, handLimit } from '../server/deck.js';
import { healthOf } from '../shared/gunhands.js';

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
  // Six of the sixteen bend a rule this file is about - one reaches a step
  // further, one stands a step out, one is behind a barrel he never found.
  // Every test below is measuring the rule rather than the men who bend it,
  // except the one that counts what was dealt.
  const dealt = new Map(all.map((p) => [p.id, p.gunhand]));
  for (const p of all) p.gunhand = null;
  return {
    room, clock, all, dealt,
    give: (p, ...cards) => { p.duelHand = cards.slice(); },
    turn: (p) => { room.turn = { kind: 'turn', holder: p.id, endsAt: 1e12 }; p.bangsThisTurn = 0; },
    apart: (p, q, m) => { p.pos = { x: 40, y: 0, z: 0 }; q.pos = { x: 40, y: 0, z: m }; },
    // Distance in the turn mode is seats, so this is what "apart" means now:
    // sit these two n places from each other and take everybody else out of
    // the circle, so nothing else is between them.
    seats: (p, q, n) => {
      for (const o of all) o.seat = null;
      p.seat = 0;
      q.seat = n;
      // Filler, so the ring is big enough for n to be the short way round.
      let at = 1;
      for (const o of all) {
        if (o === p || o === q) continue;
        while (at === n) at += 1;
        o.seat = at++;
      }
      p.pos = { x: 40, y: 0, z: 0 };
      q.pos = { x: 40, y: 0, z: 4 };
    },
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
  const { room, clock, all, dealt } = table();
  try {
    for (const p of all) {
      assert.equal(p.duelHand.length, p.maxHealth, `${p.role} was dealt ${p.duelHand.length}`);
    }
    // The star is a hit and a card better off than the same man without it -
    // which is not a fixed number any more, because two of the sixteen only
    // have three hits in them to start with.
    const sheriff = all.find((p) => p.role === 'sheriff');
    const bare = healthOf(dealt.get(sheriff.id), DUEL.health);
    assert.equal(sheriff.duelHand.length, bare + (DUEL.sheriffHealth - DUEL.health),
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
  // Seats, the way the card game counts them: the belt gun everybody starts
  // with reaches the man next to you and nothing further.
  const { room, clock, all, give, turn, seats } = table();
  try {
    const [a, b] = all;
    turn(a);
    give(a, 'bang', 'bang', 'bang', 'bang');
    give(b);
    b.gear = [];
    a.roundIsLive = true;

    assert.equal(reachSeats(a), 1, 'a belt gun grew');
    seats(a, b, 3);
    const far = b.health;
    room.applyDamage(b, a, 99, 'shot', null, 'head');
    assert.equal(b.health, far, 'a shot landed from three seats away with a belt gun');
    seats(a, b, 1);
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, far - 1, 'and the man next to him was out of reach');

    // And across the table with the right rifle.
    a.weaponCard = 'winchester';
    assert.equal(reachSeats(a), 5);
    seats(a, b, 4);
    room.applyDamage(b, a, 99, 'shot', null, 'body');
    assert.equal(b.health, far - 2);

    // A scope is a seat nearer; a mustang is a seat further out.
    a.weaponCard = null;
    a.gear = ['scope'];
    assert.equal(reachSeats(a), 2);
    b.gear = ['mustang'];
    assert.equal(inReach(a, b, 0, 2), false, 'the mustang did not buy a seat');
    assert.equal(inReach(a, b, 0, 1), true);
    // And the ground is still how the free-for-all measures it.
    assert.equal(Math.round(reachOf(a)), DISTANCE_UNIT * 2);
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
  const { room, clock, all, give, turn, seats } = table();
  try {
    const [a, b] = all;
    turn(a);
    seats(a, b, 1);
    give(b, 'bang', 'bang');
    b.gear = []; b.weaponCard = null;
    give(a, 'panic');
    room.onDuelCard(a, { card: 'panic', target: b.id });
    assert.equal(b.duelHand.length, 1, 'nothing was taken');
    assert.ok(a.duelHand.includes('bang'), 'and it did not end up in the hand that took it');

    // Out of arm's reach it does nothing at all.
    turn(a);
    seats(a, b, 3);
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

test('the gear that moves the tape moves it by what the card says', () => {
  // Two cards in the deck change how far a man can reach and how far away he
  // counts as, and both write the number down: rangeBonus and distanceBonus.
  // Neither field was read by anything. The sums named the two cards by hand
  // instead, so the card table was documentation of a rule kept somewhere
  // else - and a third card carrying either field would have printed a rule
  // it did not have.
  const bare = { gear: [], weaponCard: null };
  const withGear = (id) => ({ gear: [id], weaponCard: null });

  const reachers = Object.values(DUEL_CARDS).filter((c) => c.rangeBonus);
  const coverers = Object.values(DUEL_CARDS).filter((c) => c.distanceBonus);
  assert.ok(reachers.length, 'no card claims to lengthen a gun any more');
  assert.ok(coverers.length, 'no card claims to put a man further out any more');

  for (const c of reachers) {
    assert.equal(reachSeats(withGear(c.id)), reachSeats(bare) + c.rangeBonus,
      `${c.name} says it is worth ${c.rangeBonus} and is not`);
    assert.equal(reachOf(withGear(c.id)),
      reachOf(bare) + c.rangeBonus * DISTANCE_UNIT,
      `${c.name} moves the seats but not the metres`);
  }
  for (const c of coverers) {
    assert.equal(coverSeats(withGear(c.id)), coverSeats(bare) + c.distanceBonus,
      `${c.name} says it is worth ${c.distanceBonus} and is not`);
  }

  // And the two of them cancel: a glass against a horse is where you started.
  const shooter = withGear(reachers[0].id);
  const target = withGear(coverers[0].id);
  const seats = reachSeats(bare);
  assert.ok(inReach(shooter, target, 0, seats), 'the glass did not answer the horse');
  assert.ok(!inReach(shooter, target, 0, seats + 1), 'and it answered it twice over');
});

test('a card reaches as far as the man counts, not as far as he sits', () => {
  // One number decides every range in this game, the way it does in the
  // original: the horse in front of a man puts him a step further out from
  // everybody, and the glass in front of you brings the whole table a step
  // nearer. Both apply to the guns AND to the one card that reaches across
  // and takes something out of somebody's hand - Panic! is an arm's length,
  // and an arm's length to a man on a horse is not the same seat.
  const bare = { gear: [], weaponCard: null };
  const horse = Object.values(DUEL_CARDS).find((c) => c.distanceBonus);
  const glass = Object.values(DUEL_CARDS).find((c) => c.rangeBonus);
  const onHorse = { gear: [horse.id], weaponCard: null };
  const withGlass = { gear: [glass.id], weaponCard: null };

  assert.equal(sightSeats(bare, bare, 1), 1, 'a plain neighbour is one away');
  assert.equal(sightSeats(bare, onHorse, 1), 1 + horse.distanceBonus,
    `${horse.name} did not put him further out`);
  assert.equal(sightSeats(withGlass, bare, 2), 2 - glass.rangeBonus,
    `${glass.name} did not bring him nearer`);
  // And the two cancel, which is the whole point of having both in the deck.
  assert.equal(sightSeats(withGlass, onHorse, 1), 1, 'the glass did not answer the horse');

  // What the guns ask is the same question, so the two must never disagree.
  for (const seats of [0, 1, 2, 3]) {
    for (const shooter of [bare, withGlass]) {
      for (const target of [bare, onHorse]) {
        assert.equal(
          inReach(shooter, target, 0, seats),
          sightSeats(shooter, target, seats) <= (DUEL_CARDS[shooter.weaponCard]?.reach ?? 1),
          `the gun and the tape disagree at ${seats} seats`,
        );
      }
    }
  }
});
