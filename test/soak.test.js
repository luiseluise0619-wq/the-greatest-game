// Rounds played end to end, with the rules checked on every tick.
//
// Everything else in this suite sets a situation up by hand and asserts on it.
// That finds what somebody thought to look for. This plays real rounds — bots
// dealing, drawing, shooting, dying, taking cards off each other — and asserts
// the handful of things that must be true of EVERY tick of EVERY round, which
// finds what nobody thought to look for.
//
// The invariants are the ones that cannot be true "mostly":
//
//   The deck is eighty cards. Not about eighty. Every card is in the draw
//   pile, the discard, somebody's hand, or face up in front of somebody, and
//   there is no fifth place for one to be.
//
//   The man with the floor is alive and is at the table.
//
//   Nobody is on negative health, holding more than the deck, sitting in
//   somebody else's seat, or standing at NaN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, PHASE } from '../shared/constants.js';
import { DECK_SIZE, DUEL_CARDS } from '../shared/deck.js';

const { Room } = await import('../server/room.js');

/** Every card in the game, wherever it currently is. */
function cardsInPlay(room) {
  if (!room.pile) return null;
  let n = room.pile.draw.length + room.pile.discard.length;
  for (const p of room.players.values()) {
    n += (p.duelHand || []).length;
    n += (p.gear || []).length;
    if (p.weaponCard) n += 1;
    if (p.hasDynamite) n += 1;
  }
  return n;
}

/** Everything that must hold on every tick, or say which one did not. */
function check(room, where) {
  const bad = [];

  if (room.duel && room.pile) {
    const n = cardsInPlay(room);
    if (n !== DECK_SIZE) bad.push(`${n} cards are accounted for, not ${DECK_SIZE}`);
  }

  const alive = [...room.players.values()].filter((p) => p.alive);
  if (room.turnHolder) {
    const h = room.players.get(room.turnHolder);
    if (!h) bad.push('the floor belongs to somebody who is not in the room');
    else if (!h.alive) bad.push(`${h.name} holds the floor and is dead`);
  }

  // The running order is what every screen at the table is drawn from, so a
  // dead man in it is a dead man being pointed at.
  if (room.duel && room.turn) {
    for (const id of room.turnMsg().order) {
      const p = room.players.get(id);
      if (!p) bad.push('the running order names somebody who is not in the room');
      else if (!p.alive) bad.push(`the running order still has ${p.name}, who is down`);
    }
  }

  const seats = new Map();
  for (const p of alive) {
    if (!Number.isFinite(p.health)) bad.push(`${p.name} is on ${p.health} health`);
    else if (p.health <= 0) bad.push(`${p.name} is alive on ${p.health} health`);
    else if (p.health > p.maxHealth) bad.push(`${p.name} is on ${p.health} of ${p.maxHealth}`);

    for (const k of ['x', 'y', 'z']) {
      if (!Number.isFinite(p.pos[k])) bad.push(`${p.name} is standing at ${k}=${p.pos[k]}`);
    }
    if (!Number.isFinite(p.yaw) || !Number.isFinite(p.pitch)) {
      bad.push(`${p.name} is facing ${p.yaw}/${p.pitch}`);
    }
    if ((p.duelHand || []).length > DECK_SIZE) {
      bad.push(`${p.name} is holding ${p.duelHand.length} cards`);
    }
    // Every card anywhere is a card that exists. A hand or a table with an id
    // in it that the deck has never heard of is a card invented by a bug.
    for (const id of [...(p.duelHand || []), ...(p.gear || []),
      ...(p.weaponCard ? [p.weaponCard] : [])]) {
      if (!DUEL_CARDS[id]) bad.push(`${p.name} is holding "${id}", which is not a card`);
    }
    if (room.duel && p.seat != null) {
      if (seats.has(p.seat)) bad.push(`${p.name} and ${seats.get(p.seat)} are in seat ${p.seat}`);
      seats.set(p.seat, p.name);
    }
  }

  // Seats are how far apart two men are, and the answer cannot depend on which
  // of them is asked, or come out negative, or exceed half a table.
  if (room.duel && alive.length > 1) {
    const [a, b] = alive;
    const ab = room.seatsBetween(a, b);
    const ba = room.seatsBetween(b, a);
    if (ab !== ba) bad.push(`${a.name} is ${ab} from ${b.name}, who is ${ba} from him`);
    if (ab != null && (ab < 0 || ab > alive.length)) bad.push(`they are ${ab} seats apart`);
  }

  assert.deepEqual(bad, [], `${where}:\n  ${bad.join('\n  ')}`);
}

function play({ mode, code, bots, rounds, secondsEach }) {
  TIMING.prep = 2; TIMING.combat = secondsEach; TIMING.endgame = 20; TIMING.results = 2;
  const clock = fakeClock();
  try {
    const room = new Room({ code, isPublic: false, mode });
    room.botFillTarget = bots;
    room.resetClock();
    const stub = stubClient();
    room.addConnection(stub.client);
    room.handleMessage(stub.client, { t: 'join', name: 'Tester' });

    let ticks = 0;
    for (let r = 0; r < rounds; r += 1) {
      room.beginMatch();
      // 20 ticks a second, and a tick is 50ms.
      const steps = (TIMING.prep + secondsEach + TIMING.endgame) * 20;
      for (let i = 0; i < steps; i += 1) {
        tick(clock, room, 1);
        ticks += 1;
        check(room, `${mode} round ${r + 1}, tick ${i}`);
        if (room.phase === PHASE.RESULTS) break;
      }
      check(room, `${mode} round ${r + 1}, at the end`);
    }
    return ticks;
  } finally { clock.restore(); }
}

test('the turn mode holds its own rules, round after round', () => {
  const ticks = play({ mode: MODES.DUEL, code: 'SOK1', bots: 6, rounds: 5, secondsEach: 200 });
  assert.ok(ticks > 1500, `only ${ticks} ticks were played`);
});

test('and at the smallest and largest tables', () => {
  // Three bots is the minimum a round starts with and seven is the maximum,
  // and both ends have their own arithmetic - the role table changes at eight
  // and the seating gets sharp when a table thins.
  for (const bots of [3, 7]) {
    play({ mode: MODES.DUEL, code: `SOK${bots}`, bots, rounds: 2, secondsEach: 200 });
  }
});

test('the free-for-all holds its own rules too', () => {
  const ticks = play({ mode: MODES.FREE, code: 'SOK2', bots: 6, rounds: 3, secondsEach: 160 });
  assert.ok(ticks > 1000, `only ${ticks} ticks were played`);
});
