// The turn mode.
//
// The card game this is modelled on is played round a table: you take your go,
// everybody watches, and the only reason you can shoot anybody is that it is
// your turn. There is no table in a first-person game and eight people are all
// moving at once, so the thing that gets rationed is the trigger rather than
// the movement - and a round alternates between everybody walking at once and
// nobody walking at all.
//
// Three rules carry the whole mode, and all three are here: one gun is live at
// a time, feet are nailed down while it is, and a hit is worth a hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { PHASE, TIMING, DUEL, MODES } from '../shared/constants.js';

const { Room } = await import('../server/room.js');

/** Seconds, rather than the 50ms slices `tick` counts in. */
const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function duelRoom({ bots = 5, prep = 1 } = {}) {
  TIMING.prep = prep; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'DUEL', isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  secs(clock, room, prep + 1);
  freezeBots(room);
  return {
    room, clock, stub,
    me: () => [...room.players.values()].find((p) => !p.bot),
    // Sixteen gunhands, and one of them stands behind a barrel he did not have
    // to find while another is a step further out than the tape says. Every
    // test in this file is about the rules the sixteen bend, so it measures
    // them on men who are not bending any.
    plain: () => {
      for (const p of room.players.values()) {
        p.gunhand = null;
        p.maxHealth = p.role === 'sheriff' ? DUEL.sheriffHealth : DUEL.health;
        p.health = p.maxHealth;
      }
    },
  };
}

test('a hit is worth a hit, and the star is worth one more', () => {
  const { room, clock, plain } = duelRoom();
  try {
    plain();
    for (const p of room.players.values()) {
      const want = p.role === 'sheriff' ? DUEL.sheriffHealth : DUEL.health;
      assert.equal(p.maxHealth, want, `${p.role} started on ${p.maxHealth}`);
      assert.equal(p.health, want);
    }
    // Whatever the gun says, one landed shot is one hit off the four. Close
    // enough to reach and holding nothing to answer it with, so that what is
    // being measured here is the damage and only the damage.
    const [a, b] = [...room.players.values()];
    room.turn = { kind: 'turn', holder: a.id, endsAt: 1e12 };
    a.pos = { x: 0, y: 0, z: 0 };
    b.pos = { x: 0, y: 0, z: 6 };
    b.duelHand = []; b.gear = [];
    room.applyDamage(b, a, 58, 'shot', null, 'head');
    assert.equal(b.health, b.maxHealth - 1, 'a rifle round to the head took more than a hit');
    room.applyDamage(b, a, 3, 'shot', null, 'leg');
    assert.equal(b.health, b.maxHealth - 2, 'a graze took less than a hit');
  } finally { clock.restore(); }
});

test('you are shown your hand at the deal, not when your go comes round', () => {
  // The walk before the first turn is the walk you pick your ground on, and
  // where to stand is decided by what your gun reaches - which is a card.
  const { room, clock, stub, me } = duelRoom();
  try {
    const dealt = stub.last('duel');
    assert.ok(dealt, 'the round started and nobody was shown what they were holding');
    assert.deepEqual(dealt.hand, me().duelHand);
    assert.equal(dealt.hand.length, me().maxHealth, 'a hand the size of your health');
    assert.equal(dealt.limit, me().health);
    assert.ok(dealt.reach > 0, 'no idea how far the gun goes');
    assert.ok(Array.isArray(dealt.table) && dealt.table.length >= 2,
      'the gear in front of everybody else is public and was not sent');
  } finally { clock.restore(); }
});

test('the town takes it in turns, with a walk in between', () => {
  const { room, clock } = duelRoom({ bots: 5 });
  try {
    assert.equal(room.turnOrder.length, 5, 'everybody is in the running order');
    assert.equal(room.turn.kind, 'reposition', 'a round of turns opens with a walk');

    // One full lap: a walk, then one go each, then a walk again.
    const seen = [];
    for (let i = 0; i < 70 * 20; i++) {
      tick(clock, room, 1);
      const now = room.turn.kind === 'turn' ? room.turn.holder : 'walk';
      if (seen[seen.length - 1] !== now) seen.push(now);
    }
    assert.equal(seen[0], 'walk');
    const lap = seen.slice(1, 1 + room.turnOrder.length);
    assert.deepEqual(lap, room.turnOrder, 'the turns did not go round in the order everybody was shown');
    assert.equal(seen[1 + room.turnOrder.length], 'walk', 'the lap did not end in a walk');
  } finally { clock.restore(); }
});

test('one gun is live at a time, and during a walk none are', () => {
  const { room, clock } = duelRoom();
  try {
    const living = [...room.players.values()].filter((p) => p.alive);
    // Everybody armed and everybody's gun cooled off, so the only thing left
    // deciding who may fire is whose go it is.
    for (const p of living) { p.duelHand = ['bang']; p.bangsThisTurn = 0; p.nextFireAt = 0; }
    for (const holder of living) {
      room.turn = { kind: 'turn', holder: holder.id, endsAt: 1e12 };
      const armed = living.filter((p) => room.canFire(p)).map((p) => p.id);
      assert.deepEqual(armed, [holder.id], `${armed.length} guns were live on one go`);
    }
    room.turn = { kind: 'reposition', holder: null, endsAt: 1e12 };
    assert.deepEqual(living.filter((p) => room.canFire(p)), [], 'somebody could shoot during the walk');
  } finally { clock.restore(); }
});

test('a shot out of turn does nothing at all', () => {
  const { room, clock } = duelRoom();
  try {
    const [a, b] = [...room.players.values()];
    room.turn = { kind: 'turn', holder: b.id, endsAt: 1e12 };
    const before = b.health;
    // Straight at the handler, the way a modified client would.
    for (let i = 0; i < 20; i++) room.onShoot(a, { dir: [0, 0, -1] });
    assert.equal(b.health, before, 'a player fired twenty rounds on somebody else\'s go');
    assert.equal(a.guns[a.slot].mag, 6, 'and it cost them ammunition to do it');
  } finally { clock.restore(); }
});

test('feet are nailed down for a turn, and heads are not', () => {
  const { room, clock } = duelRoom();
  try {
    const living = [...room.players.values()].filter((p) => p.alive);
    const walker = living[0];
    room.turn = { kind: 'turn', holder: living[1].id, endsAt: 1e12 };
    const stood = { ...walker.pos };
    for (let i = 1; i <= 10; i++) {
      walker.lastInputAt = null;
      room.onInput(walker, { pos: { x: stood.x + i, y: stood.y, z: stood.z }, yaw: 2, pitch: 0.3 });
    }
    assert.deepEqual(
      { x: walker.pos.x, z: walker.pos.z }, { x: stood.x, z: stood.z },
      'somebody walked ten metres during a turn',
    );
    assert.equal(walker.yaw, 2, 'and could not even look about while standing there');
    assert.equal(walker.moving, false);

    // The walk gives the feet back.
    room.turn = { kind: 'reposition', holder: null, endsAt: 1e12 };
    walker.lastInputAt = null;
    room.onInput(walker, { pos: { x: stood.x + 1, y: stood.y, z: stood.z } });
    assert.notEqual(walker.pos.x, stood.x, 'the walk did not give the feet back');
  } finally { clock.restore(); }
});

test('a dead player is passed over rather than waited for', () => {
  const { room, clock } = duelRoom({ bots: 5 });
  try {
    const order = room.turnOrder;
    const doomed = room.players.get(order[2]);
    doomed.alive = false;
    room.turnPtr = 0;
    room.turn = { kind: 'turn', holder: order[0], endsAt: 0 };
    room.advanceTurn(1000);
    assert.equal(room.turn.holder, order[1]);
    room.advanceTurn(1000);
    assert.equal(room.turn.holder, order[3], 'the round waited six seconds for a corpse');
  } finally { clock.restore(); }
});

test('the free-for-all is still the free-for-all', () => {
  // The mode is a mode. Asking for the old one has to get the old one, whole.
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'FREE', isPublic: false, mode: MODES.FREE });
    room.botFillTarget = 5;
    room.resetClock();
    room.beginMatch();
    secs(clock, room, 2);
    assert.equal(room.turn, null, 'the free-for-all grew turns');
    assert.deepEqual(room.turnOrder, []);
    const living = [...room.players.values()].filter((p) => p.alive);
    assert.ok(living.every((p) => p.maxHealth >= 100), 'the free-for-all lost its health');
    assert.ok(living.filter((p) => room.canFire(p)).length > 1, 'the free-for-all rationed the trigger');
  } finally { clock.restore(); }
});
