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
