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
import { seatAt, TABLE } from '../shared/map.js';

const r1 = (n) => Math.round(n * 10) / 10;

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

test('the feet are nailed down for the whole round, and heads are not', () => {
  // This game is played standing at a table. The mark you were dealt is the
  // mark you keep, and that is where the whole of the original's sense of
  // distance comes from - the man next to you is one away and the man opposite
  // is not. An earlier version of this mode let everybody walk a
  // hundred-and-thirty-metre town between goes, which took that away.
  const { room, clock } = duelRoom();
  try {
    const living = [...room.players.values()].filter((p) => p.alive);
    const walker = living[0];
    for (const kind of ['turn', 'reposition']) {
      room.turn = { kind, holder: kind === 'turn' ? living[1].id : null, endsAt: 1e12 };
      const stood = { ...walker.pos };
      for (let i = 1; i <= 10; i++) {
        walker.lastInputAt = null;
        room.onInput(walker, { pos: { x: stood.x + i, y: stood.y, z: stood.z }, yaw: 2, pitch: 0.3 });
      }
      assert.deepEqual(
        { x: walker.pos.x, z: walker.pos.z }, { x: stood.x, z: stood.z },
        `somebody walked ten metres during a ${kind}`,
      );
      assert.equal(walker.yaw, 2, 'and could not even look about while standing there');
      assert.equal(walker.moving, false);
    }
  } finally { clock.restore(); }
});

test('everybody is dealt a mark round the table, and it faces the table', () => {
  // A room at the moment of the deal and not a tick later: heads turn from
  // then on, which is the whole of what anybody may still do with themselves.
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'SEAT', isPublic: false, mode: MODES.DUEL });
    room.botFillTarget = 6;
    room.resetClock();
    room.beginMatch();
    const all = [...room.players.values()];
    const seatsGiven = all.map((p) => p.seat).sort((a, b) => a - b);
    assert.deepEqual(seatsGiven, all.map((_, i) => i), 'somebody was not given a mark');
    for (const p of all) {
      const want = seatAt(p.seat, all.length);
      assert.equal(r1(p.pos.x), r1(want.x), `seat ${p.seat} is not where it should be`);
      assert.equal(r1(p.pos.z), r1(want.z));
      // Looking at the middle: the way from here to the table and the way this
      // man is facing are the same way.
      const toTable = Math.atan2(-(TABLE.x - p.pos.x), -(TABLE.z - p.pos.z));
      assert.ok(Math.abs(((p.yaw - toTable + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.02,
        `seat ${p.seat} has its back to the table`);
    }
    // And nobody is standing on anybody.
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 1.4,
          'two men were dealt the same mark');
      }
    }
  } finally { clock.restore(); }
});

test('the man next to you is one away, and a dead man closes the circle', () => {
  const { room, clock } = duelRoom({ bots: 6 });
  try {
    const ring = room.seated();
    assert.equal(ring.length, 6, 'the table is not the size it was asked for');
    assert.equal(room.seatsBetween(ring[0], ring[1]), 1, 'the man next to him was not next to him');
    assert.equal(room.seatsBetween(ring[0], ring[5]), 1, 'and the table did not go round');
    assert.equal(room.seatsBetween(ring[0], ring[3]), 3, 'the far side of the table moved');

    // He goes down and the two either side of him become neighbours.
    ring[1].alive = false;
    assert.equal(room.seated().length, 5);
    assert.equal(room.seatsBetween(ring[0], ring[2]), 1, 'the circle did not close over him');
    assert.equal(room.seatsBetween(ring[0], ring[3]), 2);
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

test('there is no second kind of dynamite lying in a shed', () => {
  // The card's blast is the one cause allowed past the one-hit rule, because
  // three hits is what the card says. A thrown stick carries the same cause,
  // so a looted one was worth about a hundred hits to a man who has four.
  const { room, clock, plain } = duelRoom();
  try {
    plain();
    assert.deepEqual(room.loot.filter((l) => l.type === 'dynamite'), [],
      'a stick of it was lying about in a game where it is a card');
    // And the free-for-all keeps its shed.
    const free = new Room({ code: 'SHED', isPublic: false, mode: MODES.FREE });
    assert.ok(free.loot.some((l) => l.type === 'dynamite'),
      'the free-for-all lost the dynamite it is built around');
  } finally { clock.restore(); }
});

test('a refresh mid-round hands the whole game back', () => {
  // A reload used to give you your body, your role and six information cards
  // the turn mode does not use, and none of your eighty. You came back to an
  // empty screen in a game where the hand IS the ammunition.
  const { room, clock, stub, me } = duelRoom();
  try {
    const p = me();
    const token = p.token;
    const hand = [...p.duelHand];
    room.turn = { kind: 'turn', holder: p.id, endsAt: Date.now() / 1000 + 4 };
    room.chamber = [true, false, true];
    room.chamberMix = { live: 2, blank: 1 };

    // The tab goes away and a new one comes back with the same token.
    room.removeConnection(stub.client);
    const back = stubClient();
    room.addConnection(back.client);
    room.handleMessage(back.client, { t: 'join', name: 'Tester', token });

    const dealt = back.last('duel');
    assert.ok(dealt, 'he came back and was never told what he was holding');
    assert.deepEqual(dealt.hand, hand, 'and it was not the hand he left with');

    const turn = back.last('turn');
    assert.ok(turn, 'nor whose go it was');
    assert.equal(turn.holder, p.id);
    assert.deepEqual(turn.order, room.turnOrder.filter((id) => room.players.get(id)?.alive));

    const cham = back.last('chamber');
    assert.ok(cham, 'nor what was left in the chamber');
    assert.equal(cham.left, 3);
    assert.equal(cham.live, 2, 'and not what went into it either');
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
