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
import { TIMING, MODES, PHASE, SOCIAL, PLAYER, ROLES } from '../shared/constants.js';

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

test('the star is a lifeline, and a hurt Sheriff reaches for it', () => {
  const { room, clock, sheriff } = town();
  try {
    if (!sheriff) return;                    // the human drew it; nothing to test
    // Willing, but his clock is a long way off - he would have died first.
    sheriff.badge = false;
    sheriff.brain.wantBadgeAt = 10_000;
    sheriff.brain.badgeTimer = 0;
    sheriff.brain.accusedOfCount = 0;

    // Unhurt: he stays a stranger.
    sheriff.health = sheriff.maxHealth;
    tick(clock, room, 20);
    assert.equal(sheriff.badge, false, 'he went loud with nothing happening to him');

    // Being taken apart is a reason, and it is one he can see.
    sheriff.health = Math.round(sheriff.maxHealth * 0.3);
    const before = sheriff.health;
    tick(clock, room, 20);
    assert.equal(sheriff.badge, true, 'he died with the lifeline in his pocket');
    assert.ok(sheriff.health > before, `and it did not heal him (${before} -> ${sheriff.health})`);
    assert.equal(sheriff.health, sheriff.maxHealth, 'the star is a full heal and was not');
    assert.equal(sheriff.maxHealth,
      PLAYER.maxHealth + (ROLES.sheriff.bonusHealth || 0) + SOCIAL.badgeHealthBonus,
      'and it is worth what the star is worth');
  } finally { clock.restore(); }
});

test('and so does one the town has just named', () => {
  const { room, clock, sheriff } = town();
  try {
    if (!sheriff) return;
    sheriff.badge = false;
    sheriff.brain.wantBadgeAt = 10_000;
    sheriff.brain.badgeTimer = 0;
    sheriff.brain.accusedOfCount = 0;
    sheriff.health = sheriff.maxHealth;
    tick(clock, room, 10);
    assert.equal(sheriff.badge, false);

    // Somebody put his name up in front of everybody. Hiding has stopped
    // working, so the armour is worth more than the secret.
    sheriff.brain.accusedOfCount = 1;
    tick(clock, room, 20);
    assert.equal(sheriff.badge, true, 'he was named in front of the town and stayed quiet');
  } finally { clock.restore(); }
});

test('a Sheriff who chose to stay a stranger still does, until it stops mattering', () => {
  const { room, clock, sheriff } = town();
  try {
    if (!sheriff) return;
    sheriff.badge = false;
    sheriff.brain.wantBadgeAt = Infinity;     // one of the four in ten
    sheriff.brain.badgeTimer = 0;
    sheriff.brain.accusedOfCount = 1;
    sheriff.health = Math.round(sheriff.maxHealth * 0.4);
    tick(clock, room, 20);
    assert.equal(sheriff.badge, false, 'the man who chose to stay hidden did not');

    // But at the last extremity it is a full heal, and a Sheriff who dies
    // holding it has kept a secret nobody will ever ask him about.
    sheriff.health = Math.max(1, Math.round(sheriff.maxHealth * 0.15));
    tick(clock, room, 20);
    assert.equal(sheriff.badge, true, 'he died with a full heal in his pocket');
  } finally { clock.restore(); }
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
