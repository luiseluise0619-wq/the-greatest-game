// Bots at the table.
//
// Five of the six men in a town are bots, so whether the turn mode is a game
// or a screensaver is entirely a question of what they do with a go. Four
// things have to be true of them, and none of them were before:
//
//   Their feet obey the same rule everybody else's do. Bot movement never went
//   near the input handler that nails players down, so for a while the humans
//   stood at their marks while the bots walked circles round them.
//
//   They play the eighty cards - a gun that reaches further, something to
//   stand behind, a cell for the man they like least.
//
//   They draw before they fire, so the man on the other end gets the same
//   warning a player would have to give him.
//
//   And they take that warning when it is pointed at them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import { TIMING, MODES, DUEL } from '../shared/constants.js';
import { DUEL_CARDS } from '../shared/deck.js';

const { Room } = await import('../server/room.js');

const secs = (clock, room, n) => tick(clock, room, Math.round(n * 20));

function town({ bots = 5 } = {}) {
  TIMING.prep = 1; TIMING.combat = 900; TIMING.endgame = 60; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'BOTS', isPublic: false, mode: MODES.DUEL });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  secs(clock, room, 2);
  return {
    room, clock, stub,
    // Roles are dealt at random and half of them would not draw on this man at
    // all, which is the point of the free-for-all and noise here. So the two
    // sides of every test below are set against each other on purpose.
    // Sixteen gunhands, and half of them change the answer to the question
    // these tests are asking - one stands a step further out than the tape
    // says, one is behind a barrel, one takes two Missed! to get away from.
    // So the two men in a test are dealt none of them.
    // Distance is seats round a table. Two men in a test are next to each
    // other unless it says otherwise, which is inside a belt gun's reach.
    seats: (a, b, n = 1) => {
      for (const o of room.players.values()) o.seat = null;
      a.seat = 0; b.seat = n;
      let at = 1;
      for (const o of room.players.values()) {
        if (o === a || o === b) continue;
        while (at === n) at += 1;
        o.seat = at++;
      }
    },
    feud: (a, b) => {
      a.gunhand = null; b.gunhand = null;
      a.role = 'outlaw'; a.faction = 'outlaw';
      a.brain.knownFriends.clear();
      a.brain.protectee = null;
      a.brain.sheriffGuess = b.id;
      a.brain.sheriffCertain = true;
      a.brain.suspicion.set(b.id, 1);
      a.brain.aggression = 1;
      a.pitch = 0;
    },
    bots: () => [...room.players.values()].filter((p) => p.bot && p.alive),
    turn: (p) => {
      room.turnPtr = room.turnOrder.indexOf(p.id);
      room.turn = { kind: 'turn', holder: p.id, endsAt: Date.now() / 1000 + 1e6 };
      p.bangsThisTurn = 0;
    },
  };
}

test('a bot stands at the mark it was dealt, and never leaves it', () => {
  // This game is played at a table. There is no walk between goes and there
  // never was meant to be one: where you stand is dealt to you and it is what
  // "distance" means for the rest of the round. An earlier version of the mode
  // gave everybody fifteen seconds of open town between goes, and the fork
  // that handles a turn only came into effect once the bell rang - so until it
  // did, every bot walked off its mark using the other game's brain.
  const { room, clock, bots, turn } = town();
  try {
    const [a] = bots();
    turn(a);
    // Somewhere to want to be, so standing still is a decision and not simply
    // having nothing to do.
    for (const p of bots()) {
      p.brain.goal = { x: 60, z: 60 };
      p.brain.path = [];
    }
    const stood = bots().map((p) => ({ id: p.id, x: p.pos.x, z: p.pos.z, seat: p.seat }));
    assert.ok(stood.every((s) => s.seat != null), 'somebody was never given a mark');

    for (const kind of ['turn', 'reposition']) {
      room.turn = { kind, holder: kind === 'turn' ? a.id : null, endsAt: Date.now() / 1000 + 1e6 };
      secs(clock, room, 3);
      for (const was of stood) {
        const p = room.players.get(was.id);
        const moved = Math.hypot(p.pos.x - was.x, p.pos.z - was.z);
        assert.ok(moved < 0.5, `a bot walked ${moved.toFixed(1)}m during a ${kind}`);
      }
    }
    // And heads still turn, which is the whole of what anybody may do with
    // themselves on somebody else's go.
    assert.ok(bots().some((p) => Number.isFinite(p.yaw)), 'nobody has a head');
  } finally { clock.restore(); }
});

test('a bot plays the eighty rather than sitting on them', () => {
  const { room, clock, bots, turn } = town();
  try {
    const bot = bots()[0];
    turn(bot);
    // A gun that reaches five times as far as the one in his hand. There is no
    // reading of this game in which that stays in the hand.
    //
    // No Bang! in the hand on purpose. With one he sometimes fired it, and if
    // the man he fired at was the one who takes a card back off whoever hits
    // him, the barrel he had just put down came straight off the table again -
    // so the check failed on a game that had done everything right. One flake
    // in thirty. This test is about whether he plays what is worth playing.
    bot.duelHand = ['winchester', 'missed', 'barrel'];
    bot.weaponCard = null;
    bot.brain.nextDuelActAt = 0;
    secs(clock, room, 2);
    assert.equal(bot.weaponCard, 'winchester', 'he held a Winchester and drew with a belt gun');
    assert.ok(!bot.duelHand.includes('winchester'));
    secs(clock, room, 2);
    assert.ok((bot.gear || []).includes('barrel'), 'and never got behind anything');
  } finally { clock.restore(); }
});

test('a bot draws before it fires, and the draw is the warning', () => {
  const { room, clock, bots, turn, feud, seats } = town();
  try {
    const [shooter, mark] = bots();
    for (const p of bots()) { p.pos = { x: 900, y: 0, z: 900 }; }
    // Well clear of the table the mode is played round, so nothing between
    // these two is a piece of furniture.
    turn(shooter);
    shooter.pos = { x: 40, y: 0, z: 0 };
    shooter.yaw = Math.PI;                 // looking down +z, where the mark is
    mark.pos = { x: 40, y: 0, z: 12 };
    mark.duelHand = [];
    mark.gear = [];
    shooter.duelHand = ['bang'];
    // Somebody he actually wants dead, so this measures the draw and not the
    // decision - bots do not shoot strangers here any more than anywhere else.
    feud(shooter, mark);
    seats(shooter, mark);
    // And a live round, because whether this one is live is another test's
    // question and here it would only make this one flaky.
    room.chamber = [true, true, true];

    // Inside the draw, nothing has happened yet.
    tick(clock, room, 8);
    assert.deepEqual(shooter.duelHand, ['bang'], 'the shot went off before anybody could see it coming');
    assert.equal(room.aimedAt, mark.id, 'and the man on the end of it was never told');

    secs(clock, room, 3);
    assert.deepEqual(shooter.duelHand, [], 'a steady barrel never fired');
    assert.equal(mark.health, mark.maxHealth - 1, 'and it hit nobody');
  } finally { clock.restore(); }
});

test('a bot with a card in its hand moves when a gun stops on it', () => {
  const { room, clock, bots, turn, feud, seats } = town();
  try {
    const [shooter, mark] = bots();
    for (const p of bots()) { p.pos = { x: 900, y: 0, z: 900 }; }
    // Well clear of the table the mode is played round, so nothing between
    // these two is a piece of furniture.
    turn(shooter);
    shooter.pos = { x: 40, y: 0, z: 0 };
    shooter.yaw = Math.PI;
    mark.pos = { x: 40, y: 0, z: 12 };
    mark.gear = [];
    // Nothing to fire, so the barrel levels and stays levelled: what is being
    // measured is the man on the other end, not what happens to him.
    shooter.duelHand = [];
    feud(shooter, mark);
    seats(shooter, mark);
    mark.brain.skill = 1;
    mark.duelHand = ['missed'];

    // It is a nerve check rather than a rule, so it is counted rather than
    // asserted: twelve times a gun stops on him and he should move most of them.
    let moved = 0;
    for (let round = 0; round < 12; round++) {
      mark.bracedUntil = 0;
      mark.brain.braceRolled = false;
      mark.brain.braceAt = 0;
      room.aimedAt = null;
      shooter.aimAt = null;
      for (let i = 0; i < 20; i++) {
        tick(clock, room, 1);
        if ((mark.bracedUntil || 0) > Date.now() / 1000) { moved += 1; break; }
      }
    }
    assert.ok(moved >= 6, `a gun stopped on him twelve times and he moved ${moved}`);

    // And with nothing to spend, ducking is not a thing he can do at all.
    mark.duelHand = [];
    mark.bracedUntil = 0;
    mark.brain.braceRolled = false;
    room.aimedAt = null;
    shooter.aimAt = null;
    secs(clock, room, 2);
    assert.ok(!((mark.bracedUntil || 0) > Date.now() / 1000),
      'he got out of the way with an empty hand');
    assert.ok(DUEL.drawTime > 0 && DUEL_CARDS.missed);
  } finally { clock.restore(); }
});
