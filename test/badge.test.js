// The star, and when a Sheriff decides to wear it.
//
// Pinning it on is the strongest single thing a Sheriff can do in the
// free-for-all: +45 max health AND a full heal, in one keypress. It is also
// permanent and it paints a target, which is the trade.
//
// The bots very nearly never did it. The decision was a clock alone - somewhere
// between thirty seconds and three minutes into combat, for the six Sheriffs in
// ten willing at all - and rounds average under four minutes while the Sheriff
// dies in two of every three. Most of them died before their number came up.
// The harness measured 0.27 stars a round: three rounds in four had nobody
// wearing one, and the mechanic the mode is built around barely fired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick } from './helpers.js';
import {
  TIMING, MODES, PHASE, SOCIAL, PLAYER, ROLES, VOICE_LINES,
} from '../shared/constants.js';

const { Room } = await import('../server/room.js');

function town({ bots = 6 } = {}) {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'STAR', isPublic: false, mode: MODES.FREE });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  room.beginMatch();
  tick(clock, room, 40);
  const sheriff = [...room.players.values()].find((p) => p.role === 'sheriff' && p.bot);
  return { room, clock, sheriff };
}

/**
 * A Sheriff bot, and the decision asked of him directly.
 *
 * Not by ticking the room: a bot that takes a bullet from another bot during
 * the tick has its health moved out from under the assertion, which made this
 * fail about one run in eight for a reason that had nothing to do with the
 * rule being measured.
 */
function aSheriff() {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'STAR', isPublic: false, mode: MODES.FREE });
  room.botFillTarget = 6;
  room.resetClock();
  room.beginMatch();
  tick(clock, room, 40);
  const s = [...room.players.values()].find((p) => p.role === 'sheriff' && p.bot);
  if (s) {
    s.badge = false;
    s.health = s.maxHealth;
    s.brain.badgeTimer = 0;
    s.brain.accusedOfCount = 0;
    s.brain.wantBadgeAt = 10_000;      // willing, but his clock is far off
  }
  return {
    room, clock, s,
    ask: () => s.brain.maybeBadge(Date.now() / 1000, 0.05),
    done: () => clock.restore(),
  };
}

test('the star is a lifeline, and a hurt Sheriff reaches for it', () => {
  const t = aSheriff();
  try {
    if (!t.s) return;                    // the human drew it; nothing to test
    t.ask();
    assert.equal(t.s.badge, false, 'he went loud with nothing happening to him');

    // Being taken apart is a reason, and it is one he can see.
    t.s.health = Math.round(t.s.maxHealth * 0.3);
    const before = t.s.health;
    t.ask();
    assert.equal(t.s.badge, true, 'he would have died with the lifeline in his pocket');
    assert.ok(t.s.health > before, `and it did not heal him (${before} -> ${t.s.health})`);
    assert.equal(t.s.health, t.s.maxHealth, 'the star is a full heal and was not');
    assert.equal(t.s.maxHealth,
      PLAYER.maxHealth + (ROLES.sheriff.bonusHealth || 0) + SOCIAL.badgeHealthBonus,
      'and it is worth what the star is worth');
  } finally { t.done(); }
});

test('and so does one the town has just named', () => {
  const t = aSheriff();
  try {
    if (!t.s) return;
    t.ask();
    assert.equal(t.s.badge, false);

    // Somebody put his name up in front of everybody. Hiding has stopped
    // working, so the armour is worth more than the secret.
    t.s.brain.accusedOfCount = 1;
    t.ask();
    assert.equal(t.s.badge, true, 'he was named in front of the town and stayed quiet');
  } finally { t.done(); }
});

test('a Sheriff who chose to stay a stranger still does, until it stops mattering', () => {
  const t = aSheriff();
  try {
    if (!t.s) return;
    t.s.brain.wantBadgeAt = Infinity;     // one of the four in ten
    t.s.brain.accusedOfCount = 1;
    t.s.health = Math.round(t.s.maxHealth * 0.4);
    t.ask();
    assert.equal(t.s.badge, false, 'the man who chose to stay hidden did not');

    // But at the last extremity it is a full heal, and a Sheriff who dies
    // holding it has kept a secret nobody will ever ask him about.
    t.s.health = Math.max(1, Math.round(t.s.maxHealth * 0.15));
    t.ask();
    assert.equal(t.s.badge, true, 'he died with a full heal in his pocket');
  } finally { t.done(); }
});

test('and the clock still works on its own', () => {
  // The reason-driven paths are additions, not a replacement: a Sheriff who is
  // unhurt, unnamed and willing still goes loud when his number comes up.
  const t = aSheriff();
  try {
    if (!t.s) return;
    t.s.brain.wantBadgeAt = 0.01;
    t.s.brain.badgeTimer = 0;
    t.ask();
    assert.equal(t.s.badge, true, 'his number came up and he ignored it');
  } finally { t.done(); }
});

test('the turn mode is untouched: the star is on at the bell', () => {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  try {
    const room = new Room({ code: 'STR2', isPublic: false, mode: MODES.DUEL });
    room.botFillTarget = 6;
    room.resetClock();
    room.beginMatch();
    tick(clock, room, 40);
    const s = [...room.players.values()].find((p) => p.role === 'sheriff');
    assert.ok(s, 'no Sheriff was dealt');
    assert.equal(s.badge, true, 'the star is dealt face up here and was not on');
    // And it is not armour there: the hits are already in DUEL.sheriffHealth.
    assert.ok(s.maxHealth < PLAYER.maxHealth, 'the table is counting hit points');
  } finally { clock.restore(); }
});

// ------------------------------------------------------------------- boots
//
// The other move the bots were not making. Crouching is the one answer this
// game has to the footstep channel: a crouched man's boots carry nine metres
// instead of twenty-two, and he is a shorter thing to shoot at. It costs speed,
// which is the trade.
//
// `me.crouch = false` sat in the movement step unconditionally, so every bot in
// town announced itself at twenty-two metres for the whole round while the
// counterplay the manual describes was available to players only.

test('a bot closing on somebody goes quiet, and pays for it in speed', () => {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  try {
    // Aggregated over rounds. How much stalking a single round contains is up
    // to where seven bots happen to wander, and one quiet round is not
    // evidence that the move is gone.
    let moving = 0, quiet = 0;
    const ever = new Set();
    for (let round = 0; round < 4; round += 1) {
      const room = new Room({ code: `BOT${round}`, isPublic: false, mode: MODES.FREE });
      room.botFillTarget = 7;
      room.resetClock();
      room.beginMatch();
      for (let i = 0; i < 3000; i += 1) {
        tick(clock, room, 1);
        for (const p of room.players.values()) {
          if (!p.alive || !p.bot) continue;
          if (p.moving) moving += 1;
          if (p.crouch) { quiet += 1; ever.add(`${round}:${p.id}`); }
          // Down on his heels and sprinting is not a thing a man does.
          assert.ok(!(p.crouch && p.sprint), `${p.name} is sprinting on his heels`);
        }
        if (room.phase === PHASE.RESULTS) break;
      }
    }

    assert.ok(moving > 2000, `the bots barely moved (${moving} ticks)`);
    assert.ok(ever.size >= 3, `only ${ever.size} bots ever went quiet`);
    // A stalk, not a state: on the last stretch, not all round. The floor is
    // deliberately low - what is being checked is that it happens at all and
    // is not permanent, not that it happens at any particular rate.
    const share = quiet / moving;
    assert.ok(share > 0 && share < 0.5,
      `${(share * 100).toFixed(1)}% of movement was crouched, which is not a stalk`);
  } finally { clock.restore(); }
});

test('and going quiet actually buys the quiet', () => {
  // The whole point: the range his boots carry is read off the gait, so if the
  // gait never says crouch the nine-metre figure in SOCIAL is decoration.
  assert.ok(SOCIAL.stepRange.crouch < SOCIAL.stepRange.walk,
    'crouching does not make a man quieter than walking');
  assert.ok(SOCIAL.stepInterval.crouch > SOCIAL.stepInterval.walk,
    'and does not slow his step down either');
  assert.ok(PLAYER.crouchSpeed < PLAYER.walkSpeed, 'and costs him nothing to do');
});

// ------------------------------------------------------------ the shout wheel
//
// T reaches the town and V reaches the street. The bots only ever used the
// first: they ANSWERED shouts — a `voice` event moves trust and suspicion — and
// never made one, so the whole local channel ran one way. A man calling out
// from the alley is a thing you are supposed to hear before you read what he
// said, and no bot had ever called out.

/** The bot brain, its self, and a neighbour standing inside earshot. */
function twoInEarshot(mode = MODES.FREE) {
  TIMING.prep = 1; TIMING.combat = 500; TIMING.endgame = 20; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'SHTX', isPublic: false, mode });
  room.botFillTarget = 5;
  room.resetClock();
  room.beginMatch();
  tick(clock, room, 40);
  const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
  const [me, other] = bots;
  me.pos = { x: 0, y: 0, z: 0 };
  other.pos = { x: 0, y: 0, z: 4 };
  for (const p of bots) if (p !== me && p !== other) p.pos = { x: 500, y: 0, z: 500 };
  // The two coin flips in the decision are not what is being measured.
  const realRandom = Math.random;
  Math.random = () => 0;
  const said = [];
  room.onVoice = (p, msg) => { said.push(msg.line); };
  return {
    room, clock, me, other, said,
    shout: () => { me.brain.lastShout = null; me.brain.maybeShout(Date.now() / 1000); },
    done: () => { Math.random = realRandom; clock.restore(); },
  };
}

test('a man being taken apart calls for help, and it reaches the street', () => {
  const t = twoInEarshot();
  try {
    t.me.health = Math.round(t.me.maxHealth * 0.2);
    t.shout();
    assert.deepEqual(t.said, ['help'], `he shouted ${t.said.join() || 'nothing'}`);
  } finally { t.done(); }
});

test('and a man with nobody near him does not call out at all', () => {
  const t = twoInEarshot();
  try {
    t.other.pos = { x: 0, y: 0, z: SOCIAL.shoutRange + 30 };
    t.me.health = Math.round(t.me.maxHealth * 0.2);
    t.shout();
    assert.deepEqual(t.said, [], 'he called for help across an empty town');
  } finally { t.done(); }
});

test('every line a bot can shout is a line the wheel has', () => {
  // A line the wheel does not carry is a line the client cannot translate and
  // the voice handler cannot weigh.
  const t = twoInEarshot();
  try {
    const cases = [
      () => { t.me.health = Math.round(t.me.maxHealth * 0.2); },
      () => { t.me.brain.protecteeThreat = t.other.id; t.me.brain.threatUntil = 1e12; },
      () => { t.me.badge = true; t.me.faction = 'law'; },
      () => { t.me.brain.suspicion.set(t.other.id, 1); t.me.brain.trust.clear(); },
      () => { t.me.brain.suspicion.set(t.other.id, 0); t.me.brain.trust.set(t.other.id, 1); },
    ];
    for (const set of cases) {
      t.said.length = 0;
      t.me.health = t.me.maxHealth;
      t.me.badge = false;
      t.me.brain.protecteeThreat = null;
      t.me.brain.suspicion.clear();
      t.me.brain.trust.clear();
      set();
      t.shout();
      for (const id of t.said) {
        assert.ok(VOICE_LINES.some((v) => v.id === id), `"${id}" is not on the wheel`);
      }
    }
    assert.ok(t.said.length >= 0);
  } finally { t.done(); }
});

test('a stuck condition does not become a stuck record', () => {
  // A badge is on for the rest of the round and a man he has decided is lying
  // stays a man he has decided is lying, so the same line is true every time
  // this is asked. Saying it every time is a bot repeating itself.
  const t = twoInEarshot();
  try {
    t.me.faction = 'law';
    t.me.badge = true;
    t.me.brain.lastShout = null;
    t.me.brain.maybeShout(Date.now() / 1000);
    const first = t.said.length;
    t.me.brain.maybeShout(Date.now() / 1000);
    assert.equal(t.said.length, first, `he said "${t.said[first]}" twice running`);
  } finally { t.done(); }
});

test('and the town-wide channel survives the street one', () => {
  // What a bot SAYS weighed against what it then does is half of the deduction
  // layer. A shout fired every time anybody was within earshot took chat to
  // zero - at a table, where everybody always is, permanently.
  TIMING.prep = 1; TIMING.combat = 400; TIMING.endgame = 20; TIMING.results = 5;
  const clock = fakeClock();
  try {
    let shouts = 0, said = 0;
    for (let round = 0; round < 3; round += 1) {
      const room = new Room({ code: `SHC${round}`, isPublic: false, mode: MODES.DUEL });
      room.botFillTarget = 6;
      room.resetClock();
      room.beginMatch();
      const realVoice = room.onVoice.bind(room);
      room.onVoice = (p, msg) => { shouts += 1; return realVoice(p, msg); };
      for (const b of room.players.values()) {
        if (!b.brain) continue;
        const realSay = b.brain.say.bind(b.brain);
        b.brain.say = (...a) => { said += 1; return realSay(...a); };
      }
      for (let i = 0; i < 4000; i += 1) {
        tick(clock, room, 1);
        if (room.phase === PHASE.RESULTS) break;
      }
    }
    // At a table every man is always inside earshot, which is the case that
    // broke it: if the shout wins every time, this is zero.
    assert.ok(said > 0, 'the bots stopped talking to the town entirely');
    assert.ok(said > shouts,
      `${shouts} shouts against ${said} things said to the town - the shout ate the chat`);
  } finally { clock.restore(); }
});
