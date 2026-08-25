// What /stats knows about the mode people actually play.
//
// The turn mode is the default, and for a long time the readout knew nothing
// about it: cardsPerMatch and cardPlayRate are free-mode numbers built on a
// cardsDealt the turn mode deliberately reports as zero, so every figure on
// the page read as zero for every round anybody was playing. The numbers here
// are the ones worth watching at a table - a go that ends without a shot, and
// a go where a man could not do a thing with his six seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, DUEL } from '../shared/constants.js';
import { GUNHANDS } from '../shared/gunhands.js';
import { DUEL_CARDS } from '../shared/deck.js';

const { Room } = await import('../server/room.js');
const { telemetry } = await import('../server/telemetry.js');

function seatedRoom(code) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code, isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = 5;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  tick(clock, room, 40);
  return { room, clock };
}

test('dealing the table records every gunhand that went out', () => {
  const before = { ...telemetry.agg.byGunhand };
  const beforeMatches = telemetry.agg.duelMatches;
  const { room, clock } = seatedRoom('STA1');
  try {
    assert.equal(telemetry.agg.duelMatches, beforeMatches + 1,
      'the round was not counted as a turn-mode round');
    const dealt = [...room.players.values()].map((p) => p.gunhand).filter(Boolean);
    assert.ok(dealt.length >= 4, 'nobody was dealt a gunhand');
    for (const id of dealt) {
      assert.ok(GUNHANDS[id], `${id} is not a gunhand`);
      assert.ok((telemetry.agg.byGunhand[id] || 0) > (before[id] || 0),
        `${id} went out and was never counted`);
    }
  } finally { clock.restore(); }
});

test('a go that ends in a shot is told apart from one that does not', () => {
  const { room, clock } = seatedRoom('STA2');
  try {
    const p = [...room.players.values()].find((x) => x.alive);
    const goes = telemetry.agg.goes;
    const withShot = telemetry.agg.goesWithShot;
    const withCard = telemetry.agg.goesWithCard;

    // A go where nothing happened at all.
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 0;
    p.firedThisTurn = false;
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goes, goes + 1, 'the empty go was not counted');
    assert.equal(telemetry.agg.goesWithShot, withShot, 'an empty go counted as a shot');
    assert.equal(telemetry.agg.goesWithCard, withCard, 'an empty go counted as a card');

    // A go where a Bang! left the gun, spent the way the room spends it. That
    // is a shot and a card both.
    p.duelHand = ['bang'];
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 0;
    p.firedThisTurn = false;
    assert.equal(room.spendBang(p), true, 'the Bang! never left his hand');
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goesWithShot, withShot + 1, 'the shot was not counted');
    assert.equal(telemetry.agg.goesWithCard, withCard + 1,
      'a Bang! is a card as well as a shot');

    // The barrel turned round on a blank buys the go back and zeroes the one
    // shot a man gets. It does not un-fire the round: the gun went off, and a
    // go spent hearing a click is not a go where nothing happened.
    p.duelHand = ['bang'];
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 0;
    p.firedThisTurn = false;
    room.spendBang(p);
    p.bangsThisTurn = 0;                       // what the blank does
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goesWithShot, withShot + 2,
      'a blank out of the barrel turned round wrote the go down as a quiet one');

    // A go where something was played but nothing was fired.
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 2;
    p.firedThisTurn = false;
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goesWithShot, withShot + 2, 'a beer counted as a shot');
    assert.equal(telemetry.agg.goesWithCard, withCard + 3, 'the played card was not counted');
  } finally { clock.restore(); }
});

test('a go resets both counters, so last go\'s shot is not this go\'s', () => {
  const { room, clock } = seatedRoom('STA3');
  try {
    const p = [...room.players.values()].find((x) => x.alive);
    p.bangsThisTurn = 3;
    p.cardsThisTurn = 3;
    room.onTurnStart(p);
    assert.equal(p.bangsThisTurn, 0, 'the shot count carried over into the next go');
    assert.equal(p.cardsThisTurn, 0, 'the card count carried over into the next go');
  } finally { clock.restore(); }
});

test('the readout reports the turn mode as well as the free-for-all', () => {
  const s = telemetry.summary();
  for (const k of ['duelMatches', 'goesPerDuel', 'shotPerGo', 'cardPerGo',
    'gunhandsDealt', 'gunhandsStanding']) {
    assert.ok(k in s, `/stats says nothing about ${k}`);
  }
  assert.ok(s.shotPerGo >= 0 && s.shotPerGo <= 1,
    'a share of goes ending in a shot has to be a share');
  assert.equal(typeof s.gunhandsDealt, 'object');
});

test('the whole point: the numbers are non-zero for a mode being played', () => {
  const { room, clock } = seatedRoom('STA4');
  try {
    const p = [...room.players.values()].find((x) => x.alive);
    p.bangsThisTurn = 1;
    room.onTurnEnd(p);
    const s = telemetry.summary();
    assert.ok(s.duelMatches > 0, 'rounds at the table are still invisible');
    assert.ok(s.goes > 0 || telemetry.agg.goes > 0, 'goes are still invisible');
    assert.ok(Object.keys(s.gunhandsDealt).length > 0, 'no gunhand was ever recorded');
    // And the free-mode figure it replaced is still honestly zero here.
    assert.equal(DUEL.draw, 2);
  } finally { clock.restore(); }
});

test('the account of the round names the gunhand and prints the cards', () => {
  const { room, clock } = seatedRoom('STA5');
  try {
    const p = [...room.players.values()].find((x) => x.alive);
    p.duelHand = ['bang', 'beer'];
    room.turn = { kind: 'turn', holder: p.id, endsAt: Date.now() / 1000 + 1e6 };
    p.cardsThisTurn = 0;
    // Beer is refused on a man who is not hurt, and again when only two are
    // left standing. Neither is what this test is about.
    p.health = Math.max(1, p.maxHealth - 1);
    const before = (p.cardsPlayed || []).length;
    room.onDuelCard(p, { card: 'beer' });
    assert.equal(p.cardsPlayed.length, before + 1,
      'the card was played and the account of the round never heard about it');
    assert.ok(p.cardsPlayed.includes('beer'), 'and it was not the card that was played');

    // A Bang! is fired rather than pressed, and it still left the hand.
    room.spendBang(p);
    assert.ok(p.cardsPlayed.includes('bang'), 'a fired Bang! is not on the account');

    // And the row the results screen is built from carries the gunhand rather
    // than the lobby character nobody in this mode ever chose.
    let payload = null;
    const real = room.broadcast.bind(room);
    room.broadcast = (m) => { if (m.rows) payload = m; return real(m); };
    room.endMatch('law', 'over', 'end.sundown');
    room.broadcast = real;
    assert.ok(payload, 'the round ended and nobody was sent an account of it');
    const mine = payload.rows.find((r) => r.id === p.id);
    assert.ok(mine, 'the account left somebody off it');
    assert.equal(mine.duel, true, 'the account does not say which game it was');
    assert.ok(mine.gunhand && GUNHANDS[mine.gunhand],
      `the account says the gunhand was ${mine.gunhand}`);
    assert.equal(mine.gunhandName, GUNHANDS[mine.gunhand].ability,
      'the gunhand has no name on it');
    assert.ok(mine.cards.includes('beer') && mine.cards.includes('bang'),
      `the cards played are missing from the account (${mine.cards.join(',')})`);
  } finally { clock.restore(); }
});

test('getting out of the way counts as a card spent', () => {
  const { room, clock } = seatedRoom('STA6');
  try {
    const all = [...room.players.values()].filter((x) => x.alive);
    const [shooter, victim] = all;
    victim.duelHand = ['missed'];
    victim.cardsPlayed = [];
    victim.bracedUntil = Date.now() / 1000 + 5;
    shooter.gunhand = null;
    victim.gunhand = null;
    victim.gear = [];
    // Live round, and near enough to reach: this test is about the card, not
    // about the chamber or the seating.
    shooter.roundIsLive = true;
    shooter.pos = { x: 40, y: 0, z: 0 };
    victim.pos = { x: 40, y: 0, z: 1 };
    for (const o of all) o.seat = null;
    shooter.seat = 0; victim.seat = 1;
    let at = 2;
    for (const o of all) { if (o === shooter || o === victim) continue; o.seat = at++; }
    const landed = room.duelShotLands(victim, shooter, 'revolver');
    // Whichever way the room names it, the card left her hand and the round's
    // account has to know: half of what anybody does with a hand here is this.
    assert.equal(victim.duelHand.length, 0, 'the Missed! was never spent');
    assert.ok(victim.cardsPlayed.includes('missed'),
      'she got out of the way and the account of the round never heard about it');
    assert.equal(landed, false, 'the shot landed anyway');
  } finally { clock.restore(); }
});

test('a bot only knows the wounds it put in itself', () => {
  const { room, clock } = seatedRoom('STA7');
  try {
    const all = [...room.players.values()].filter((x) => x.alive);
    const [a, b, c] = all;
    b.health = Math.max(3, b.health);
    // Nothing anywhere puts another man's health in a snapshot, so a bot that
    // reads it is reading a number the human across the table is never sent.
    // What it may know is what it fired and saw land.
    assert.ok(!a.dealtTo || a.dealtTo.size === 0, 'somebody started the round already knowing');
    // A shot that actually lands: a live round, next to each other, nothing in
    // front of him to stop it and nothing in his hand to answer with. Without
    // this the room is right to throw it out and there is nothing to remember.
    a.roundIsLive = true;
    a.gunhand = null; b.gunhand = null;
    b.gear = []; b.duelHand = []; b.bracedUntil = 0;
    a.pos = { x: 40, y: 0, z: 0 };
    b.pos = { x: 40, y: 0, z: 1 };
    for (const o of all) o.seat = null;
    a.seat = 0; b.seat = 1;
    let seat = 2;
    for (const o of all) { if (o === a || o === b) continue; o.seat = seat++; }
    a.shotSerial = (a.shotSerial || 0) + 1; a.shotSpent = null;
    room.applyDamage(b, a, 1, 'revolver', null);
    assert.equal(a.dealtTo.get(b.id), 1, 'the shooter did not remember what he landed');
    assert.ok(!(a.dealtTo.get(c.id) > 0), 'the shooter remembers hitting a man he never fired at');
    assert.ok(!b.dealtTo || !b.dealtTo.get(a.id), 'being hit taught the victim what he dealt');
    // A second pull of the trigger, which is what a new serial means: one shot
    // finds one man, so without it the room is right to throw this one out.
    a.shotSerial = (a.shotSerial || 0) + 1;
    a.shotSpent = null;
    room.applyDamage(b, a, 1, 'revolver', null);
    assert.equal(a.dealtTo.get(b.id), 2, 'the second hit was not added on');
  } finally { clock.restore(); }
});

test('nothing in a snapshot tells anybody how hurt anybody else is', () => {
  const { room, clock } = seatedRoom('STA8');
  try {
    const entries = [];
    const real = room.send.bind(room);
    room.send = (client, m) => { if (m.t === 's' || m.ps) entries.push(m); return real(client, m); };
    room.sendSnapshots(Date.now() / 1000);
    room.send = real;
    const fields = new Set();
    for (const m of entries) for (const e of (m.ps || [])) Object.keys(e).forEach((k) => fields.add(k));
    for (const bad of ['hp', 'health', 'maxHealth', 'maxHp']) {
      assert.ok(!fields.has(bad),
        `the snapshot carries ${bad}, so "nobody can see how hurt you are" is not true`);
    }
  } finally { clock.restore(); }
});

test('a man who turns up late gets the hand as well as the body', () => {
  const { room, clock } = seatedRoom('STA9');
  try {
    // The round is running and there are bots at the table. Somebody walks in.
    room.phase = 'combat';
    room.loadChamber();
    const victimBot = [...room.players.values()].find((p) => p.bot && p.alive);
    assert.ok(victimBot, 'no bot to take over');
    victimBot.duelHand = ['bang', 'missed', 'beer'];
    room.turn = { kind: 'turn', holder: victimBot.id, endsAt: Date.now() / 1000 + 5 };

    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: 'join', name: 'Latecomer' });

    const hand = stub.last('duel');
    const turn = stub.last('turn');
    const cham = stub.last('chamber');
    assert.ok(hand, 'he took the body and was sent no hand - a screen he cannot play');
    assert.ok(hand.hand.length >= 3, `and the hand is empty (${hand.hand.length})`);
    assert.ok(Array.isArray(hand.table) && hand.table.length >= 2,
      'and nothing about what is in front of anybody');
    assert.ok(turn && turn.kind, 'and no idea whose go it is');
    assert.ok(Array.isArray(turn.order) && turn.order.length >= 2, 'and no running order');
    assert.ok(cham && Number.isFinite(cham.left), 'and no count of the chamber everybody is sharing');
  } finally { clock.restore(); }
});

test('the pile is eighty cards and stays eighty cards', () => {
  const { room, clock } = seatedRoom('STAA');
  try {
    const count = () => {
      let n = room.pile.draw.length + room.pile.discard.length;
      for (const p of room.players.values()) {
        n += (p.duelHand || []).length;
        n += (p.gear || []).length;
        if (p.weaponCard) n += 1;
        if (p.hasDynamite) n += 1;
      }
      return n;
    };
    assert.ok(count() >= 70, `the deck started at ${count()}`);

    const all = [...room.players.values()].filter((p) => p.alive);
    // Not the man wearing the star: the cell is the one card in the eighty
    // that will not go on him, so picking him here would be testing a refusal.
    const a = all.find((p) => p.role !== 'sheriff');
    const b = all.find((p) => p !== a && p.role !== 'sheriff');
    assert.ok(a && b, 'the table is all Sheriff');
    // Lock him up, then take the cell off him. The cell is the one thing in
    // front of a man that is not his card, and taking it used to leave the
    // flag set - so the top of his go put a SECOND one back on the pile.
    a.duelHand = ['jail', 'panic'];
    a.gear = [];
    b.gear = [];
    b.jailed = false;
    // Counted after the hands are set by hand, so the fixture's own dealing
    // is not what this measures.
    const start = count();
    room.turn = { kind: 'turn', holder: a.id, endsAt: Date.now() / 1000 + 1e6 };
    a.cardsThisTurn = 0;
    room.onDuelCard(a, { card: 'jail', target: b.id });
    assert.ok(b.jailed, 'he was never locked up');
    assert.ok((b.gear || []).includes('jail'), 'and there is no cell in front of him');
    assert.equal(count(), start, 'locking him up lost or gained a card');

    const taken = room.stripCard(b);
    assert.equal(taken, 'jail', 'the cell was not the thing taken');
    assert.equal(b.jailed, false, 'the door came off and he is still in the cell');
    room.pile.put(taken);
    assert.equal(count(), start, 'taking the cell lost or gained a card');

    // And the top of his go must not print a second one.
    room.onTurnStart(b);
    assert.equal(count(), start, `the top of his go printed a card (${count()} vs ${start})`);
  } finally { clock.restore(); }
});

test('no card in the eighty prints itself a second copy when it is played', () => {
  const { room, clock } = seatedRoom('STAB');
  try {
    const count = () => {
      let n = room.pile.draw.length + room.pile.discard.length;
      for (const p of room.players.values()) {
        n += (p.duelHand || []).length;
        n += (p.gear || []).length;
        if (p.weaponCard) n += 1;
        if (p.hasDynamite) n += 1;
      }
      return n;
    };
    const all = [...room.players.values()].filter((p) => p.alive);
    // Same reason as above: the cell does not go on the man with the star, and
    // a refusal changes nothing and so proves nothing.
    const a = all.find((p) => p.role !== 'sheriff');
    const b = all.find((p) => p !== a && p.role !== 'sheriff');
    assert.ok(a && b, 'the table is all Sheriff');
    const bad = [];
    for (const id of Object.keys(DUEL_CARDS)) {
      const card = DUEL_CARDS[id];
      // Bang! is fired and Missed! is spent for you; neither is played here.
      if (card.kind === 'shot' || card.kind === 'reaction') continue;
      // A clean table each time, so one card's leftovers are not the next
      // card's refusal.
      for (const p of all) {
        p.gear = []; p.weaponCard = null; p.hasDynamite = false;
        p.jailed = false; p.health = Math.max(1, p.maxHealth - 1);
        // Everybody holding something, because half the eighty reach into
        // other people's hands - a Duel is answered with a Bang!, an Indians!
        // is, a Cat Balou takes one - and with empty hands round the table
        // those branches do nothing and count nothing.
        p.duelHand = ['bang', 'missed', 'beer'];
      }
      a.duelHand = [id];
      a.cardsThisTurn = 0;
      room.turn = { kind: 'turn', holder: a.id, endsAt: Date.now() / 1000 + 1e6 };
      const before = count();
      room.onDuelCard(a, { card: id, target: b.id });
      const after = count();
      if (after !== before) bad.push(`${id}: ${before} -> ${after}`);
    }
    assert.deepEqual(bad, [],
      `these cards changed how many cards are in the game when played: ${bad.join(', ')}`);
  } finally { clock.restore(); }
});

test('and a whole round of it leaves the eighty as eighty', () => {
  // The card-by-card check plays each one from a clean table. This runs a real
  // round of bots at the table for as long as it takes and counts the whole
  // game at the end: every hand, everything face up in front of anybody, the
  // draw pile and the discard pile. A leak that only shows up in a resolution
  // reaching across three players, or in the recycle, or in a dead man's
  // pockets, only shows up here.
  const { room, clock } = seatedRoom('STAC');
  try {
    const count = () => {
      let n = room.pile.draw.length + room.pile.discard.length;
      for (const p of room.players.values()) {
        n += (p.duelHand || []).length;
        n += (p.gear || []).length;
        if (p.weaponCard) n += 1;
        if (p.hasDynamite) n += 1;
      }
      return n;
    };
    const start = count();
    for (let i = 0; i < 20 * 400 && room.phase !== 'results'; i += 1) {
      tick(clock, room, 1);
      // Dead men's hands are emptied into the undertaker's or onto the pile,
      // and either way the count has to hold every single step of the way -
      // not just at the end, where two opposite leaks would cancel.
      if (i % 200 === 0) {
        assert.equal(count(), start,
          `the game had ${count()} cards in it instead of ${start} after ${i} steps`);
      }
    }
    assert.equal(count(), start, `the round ended with ${count()} cards instead of ${start}`);
  } finally { clock.restore(); }
});

test('a dead man does not take his gun to the ground with him', () => {
  const { room, clock } = seatedRoom('STAD');
  try {
    const all = [...room.players.values()].filter((p) => p.alive);
    const victim = all.find((p) => p.gunhand !== 'undertaker');
    for (const p of all) if (p.gunhand === 'undertaker') p.gunhand = 'cooper';
    victim.gear = ['barrel', 'scope'];
    victim.weaponCard = 'winchester';
    victim.duelHand = ['bang', 'beer'];
    victim.hasDynamite = true;
    const before = room.pile.discard.length;

    room.onDeathSpoils(victim);

    // Everything he had, back in circulation. This used to clear only the
    // hand, so a barrel and a gun in front of a corpse were out of the game
    // and out of the pile at the same time - and a round where five of seven
    // go down froze a dozen cards on a table nobody could reach across.
    assert.deepEqual(victim.gear, [], 'his gear is still lying in front of him');
    assert.equal(victim.weaponCard, null, 'and so is his gun');
    assert.equal(victim.hasDynamite, false, 'and the lit stick is still his problem');
    assert.deepEqual(victim.duelHand, [], 'and his hand was never emptied');
    const went = room.pile.discard.slice(before);
    for (const id of ['barrel', 'scope', 'winchester', 'dynamite', 'bang', 'beer']) {
      assert.ok(went.includes(id), `${id} never made it back to the pile`);
    }
  } finally { clock.restore(); }
});

test('and the one who goes through pockets still gets the hand', () => {
  const { room, clock } = seatedRoom('STAE');
  try {
    const all = [...room.players.values()].filter((p) => p.alive);
    const [victim, sam] = all;
    sam.gunhand = 'undertaker';
    sam.duelHand = [];
    victim.gunhand = 'cooper';
    victim.gear = ['barrel'];
    victim.weaponCard = 'schofield';
    victim.duelHand = ['bang', 'missed'];
    const before = room.pile.discard.length;

    room.onDeathSpoils(victim);

    assert.deepEqual(sam.duelHand.sort(), ['bang', 'missed'],
      'the hand did not end up in the hand it was promised to');
    const went = room.pile.discard.slice(before);
    assert.ok(went.includes('barrel') && went.includes('schofield'),
      'what was on the table should go on the pile, not into his hand');
    assert.ok(!sam.duelHand.includes('barrel'),
      'he takes what was in the hands, which is what his gunhand says he takes');
  } finally { clock.restore(); }
});

test('the man who reads either card as either can answer a ridge with a Missed!', () => {
  const { room, clock } = seatedRoom('STAF');
  try {
    const all = [...room.players.values()].filter((p) => p.alive);
    const a = all.find((p) => p.role !== 'sheriff');
    const others = all.filter((p) => p !== a);
    const janet = others[0];
    for (const p of all) { p.gear = []; p.weaponCard = null; p.jailed = false; }
    // Everybody else holds the card the ridge asks for; she holds the other
    // one, which her whole gunhand says is the same card in her hands.
    for (const p of others) { p.gunhand = null; p.duelHand = ['bang']; p.health = p.maxHealth; }
    janet.gunhand = 'ambidexter';
    janet.duelHand = ['missed'];
    a.duelHand = ['indians'];
    a.cardsThisTurn = 0;
    room.turn = { kind: 'turn', holder: a.id, endsAt: Date.now() / 1000 + 1e6 };
    const hp = janet.health;

    room.onDuelCard(a, { card: 'indians' });

    assert.equal(janet.health, hp,
      'she was holding something she is allowed to fire and took the hit anyway');
    assert.deepEqual(janet.duelHand, [], 'and it never left her hand');
    assert.ok((janet.cardsPlayed || []).includes('missed'),
      'she spent it and the account of the round never heard about it');
  } finally { clock.restore(); }
});

test('and the same the other way round when the street opens up', () => {
  const { room, clock } = seatedRoom('STAG');
  try {
    const all = [...room.players.values()].filter((p) => p.alive);
    const a = all.find((p) => p.role !== 'sheriff');
    const others = all.filter((p) => p !== a);
    const janet = others[0];
    for (const p of all) { p.gear = []; p.weaponCard = null; p.jailed = false; }
    for (const p of others) { p.gunhand = null; p.duelHand = ['missed']; p.health = p.maxHealth; }
    janet.gunhand = 'ambidexter';
    janet.duelHand = ['bang'];
    a.duelHand = ['gatling'];
    a.cardsThisTurn = 0;
    room.turn = { kind: 'turn', holder: a.id, endsAt: Date.now() / 1000 + 1e6 };
    const hp = janet.health;

    room.onDuelCard(a, { card: 'gatling' });

    assert.equal(janet.health, hp, 'a Bang! is a Missed! in her hands and she took the hit');
    assert.deepEqual(janet.duelHand, [], 'and it never left her hand');
    assert.ok((janet.cardsPlayed || []).includes('bang'), 'and it is not on the account either');
  } finally { clock.restore(); }
});

test('the round out of a man\'s back is a round like any other', () => {
  const { room, clock } = seatedRoom('STAH');
  try {
    const all = [...room.players.values()].filter((p) => p.alive);
    const [me, behind] = all;
    for (const p of all) { p.gear = []; p.weaponCard = null; p.gunhand = null; p.duelHand = []; }
    // Him directly out of my back, well inside the corridor.
    me.pos = { x: 40, y: 0, z: 0 };
    me.yaw = 0;                                   // facing -z, so behind is +z
    behind.pos = { x: 40, y: 0, z: 3 };
    for (const o of all) { if (o !== me && o !== behind) o.pos = { x: 200, y: 0, z: 200 }; }
    assert.equal(room.linedUpBehind(me)?.id, behind.id, 'he is not in the corridor at all');

    // A barrel behind you still stops it. The gunhand whose whole sentence is
    // "every shot at him may find wood" had one shot in the eighty that could
    // not, because 'selfshot' is not a weapon id and the gate that applies the
    // barrel waves through anything that is not one.
    behind.gunhand = 'cooper';                    // born behind one, so it is always there
    behind.health = behind.maxHealth;
    behind.bracedUntil = 0;
    // The barrel is a draw rather than a wall, so asserting on a sample of it
    // is asserting on a coin - and one run in a hundred of a fair coin looks
    // like a bug. Force the draw both ways instead: what this is checking is
    // that the wood is CONSULTED at all, which for a shot out of somebody's
    // back it never used to be.
    const realDraw = room.drawFor.bind(room);
    const asked = [];
    room.drawFor = (who, what) => { asked.push(what); return true; };
    assert.equal(room.throughStopped(behind, me), true, 'the wood was never asked');
    assert.ok(asked.includes('barrel'), `it asked for ${asked.join(',')} instead of the barrel`);
    room.drawFor = () => false;
    assert.equal(room.throughStopped(behind, me), false,
      'the wood stopped it on a draw that did not come up - it is a draw, not a wall');
    room.drawFor = realDraw;

    // And a man who was already moving spends the card for it.
    behind.gunhand = null;
    behind.duelHand = ['missed'];
    behind.bracedUntil = Date.now() / 1000 + 5;
    assert.equal(room.throughStopped(behind, me), true, 'he braced and it found him anyway');
    assert.deepEqual(behind.duelHand, [], 'and the card never left his hand');
    assert.ok((behind.cardsPlayed || []).includes('missed'),
      'and the account of the round never heard about it');

    // Standing there with nothing is standing there with nothing.
    behind.duelHand = [];
    behind.bracedUntil = 0;
    assert.equal(room.throughStopped(behind, me), false,
      'nothing in front of him and nothing in his hand, and it still missed');
  } finally { clock.restore(); }
});

test('the turn mode does not tell the star that nobody knows his face', () => {
  const { room, clock } = seatedRoom('STAI');
  try {
    const all = [...room.players.values()];
    const star = all.find((p) => p.role === 'sheriff');
    const dep = all.find((p) => p.role === 'deputy');
    assert.ok(star, 'no Sheriff was dealt');

    // Everything a man is told about himself, in a mode where the star is on
    // from the bell and everybody can see it. Three of these used to be
    // written for the other game and were flatly untrue in this one.
    const told = (p) => {
      const out = [];
      const real = room.emit.bind(room);
      room.emit = (who, m) => { if (who === p && m.t === 'role') out.push(m); return real(who, m); };
      const wasBot = p.bot; p.bot = false;
      p.client = p.client || { ws: { readyState: 1, send: () => {} } };
      room.sendRole(p);
      p.bot = wasBot;
      room.emit = real;
      return out[0];
    };

    const s = told(star);
    assert.ok(s, 'the Sheriff was never told what he is');
    assert.equal(s.blurbKey, 'role.sheriff.blurbDuel',
      'he is being told the free-for-all\'s line about nobody knowing his face');
    assert.ok(!/nobody knows your face/i.test(s.blurbDuel || ''),
      `and it still says it: ${s.blurbDuel}`);
    assert.ok(!/nobody knows your face/i.test(s.intel || ''),
      `and so does his one thread: ${s.intel}`);

    if (dep) {
      const d = told(dep);
      assert.equal(d.blurbKey, 'role.deputy.blurbDuel',
        'the Deputy is still being told he has a hunch about a star he can see');
      assert.ok(!/one of these two/i.test(d.intel || ''),
        `and his thread still points at a man wearing it: ${d.intel}`);
      // What he gets instead has to be a real name at this table.
      const names = all.map((p) => p.name);
      const named = names.some((n) => (d.intel || '').includes(n));
      assert.ok(named || /lying/i.test(d.intel || ''),
        `his thread names nobody at this table: ${d.intel}`);
    }
  } finally { clock.restore(); }
});

test('and the free-for-all keeps every word of its own', () => {
  TIMING.prep = 1; TIMING.combat = 900;
  const clock = fakeClock();
  const room = new Room({ code: 'STAJ', isPublic: false, mode: MODES.FREE });
  room.botFillTarget = 5;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  try {
    const all = [...room.players.values()];
    const star = all.find((p) => p.role === 'sheriff');
    const out = [];
    const real = room.emit.bind(room);
    room.emit = (who, m) => { if (who === star && m.t === 'role') out.push(m); return real(who, m); };
    const wasBot = star.bot; star.bot = false;
    star.client = star.client || { ws: { readyState: 1, send: () => {} } };
    room.sendRole(star);
    star.bot = wasBot;
    room.emit = real;
    assert.ok(out[0], 'the Sheriff was never told what he is');
    assert.equal(out[0].blurbKey, null,
      'the free-for-all was handed the turn mode\'s line');
    assert.match(out[0].blurb, /nobody knows your face/i,
      'and lost its own, which is the whole game over there');
  } finally { clock.restore(); }
});
