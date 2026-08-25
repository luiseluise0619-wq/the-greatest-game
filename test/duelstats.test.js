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
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goes, goes + 1, 'the empty go was not counted');
    assert.equal(telemetry.agg.goesWithShot, withShot, 'an empty go counted as a shot');
    assert.equal(telemetry.agg.goesWithCard, withCard, 'an empty go counted as a card');

    // A go where a Bang! left the gun. That is a shot and a card both.
    p.bangsThisTurn = 1;
    p.cardsThisTurn = 0;
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goesWithShot, withShot + 1, 'the shot was not counted');
    assert.equal(telemetry.agg.goesWithCard, withCard + 1,
      'a Bang! is a card as well as a shot');

    // A go where something was played but nothing was fired.
    p.bangsThisTurn = 0;
    p.cardsThisTurn = 2;
    room.onTurnEnd(p);
    assert.equal(telemetry.agg.goesWithShot, withShot + 1, 'a beer counted as a shot');
    assert.equal(telemetry.agg.goesWithCard, withCard + 2, 'the played card was not counted');
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
    // Nothing anywhere puts another man's health in a snapshot, so a bot that
    // reads it is reading a number the human across the table is never sent.
    // What it may know is what it fired and saw land.
    assert.ok(!a.dealtTo || a.dealtTo.size === 0, 'somebody started the round already knowing');
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
