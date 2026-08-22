// The Deck. Six cards, two dealt per round, and not one of them shoots anybody.
//
// Every card in this game edits what the town is allowed to KNOW, so these
// tests are mostly about the absence of information: a hitmarker that must not
// fire, a name that must not reach the feed, a killcam that must not be sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { PHASE, TIMING, CARDS, CARD_ORDER, CARD_DEAL, SOCIAL } from '../shared/constants.js';

const { Room } = await import('../server/room.js');
const { BotBrain } = await import('../server/bots.js');

function makeRoom({ bots = 6, prep = 1, combat = 400 } = {}) {
  TIMING.prep = prep; TIMING.combat = combat; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'TEST', isPublic: false });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Tester' });
  return { room, clock, stub, me: () => [...room.players.values()].find((p) => !p.bot) };
}

/** Roll a room into live combat with the bots parked where the test puts them. */
function intoCombat(room, clock) {
  room.beginMatch();
  tick(clock, room, 40);
  assert.equal(room.phase, PHASE.COMBAT);
  freezeBots(room);
  // Bots hold cards too; a bot playing one mid-test would muddy the assertions.
  for (const p of room.players.values()) if (p.bot) p.hand = [];
}

/** Hand a player one specific card, ignoring what they were dealt. */
function give(room, p, id) {
  p.hand = [id];
  p.lastCardAt = 0;
  room.onCard(p, { card: id });
  assert.equal(p.hand.length, 0, `${id} was not accepted`);
}

test('every player is dealt a real hand, and nobody sees anybody else\'s', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 8 });
  try {
    room.beginMatch();
    for (const p of room.players.values()) {
      assert.equal(p.hand.length, CARD_DEAL);
      assert.equal(new Set(p.hand).size, CARD_DEAL, 'dealt the same card twice');
      assert.ok(p.hand.every((id) => CARDS[id]), 'dealt a card that does not exist');
    }
    const cards = stub.last('cards');
    assert.deepEqual(cards.hand, me().hand, 'the client was told the wrong hand');
    assert.deepEqual(cards.armed, []);
    // Only ever one hand on the wire: our own.
    assert.equal(stub.of('cards').length, 1);
    const others = [...room.players.values()].filter((p) => p.bot);
    const wire = JSON.stringify(stub.sent);
    for (const o of others) {
      for (const id of o.hand) {
        // Their card ids may coincide with ours; what must never appear is a
        // message carrying somebody else's name next to a hand.
        assert.equal(wire.includes(`"${o.name}","hand"`), false);
        assert.ok(CARDS[id]);
      }
    }
  } finally { clock.restore(); }
});

test('hands are re-dealt each round and nothing carries over', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    give(room, p, 'barrel');
    assert.ok(p.armed.has('barrel'));
    room.beginMatch();
    assert.equal(p.armed.size, 0, 'an armed card survived into the next round');
    assert.equal(p.hand.length, CARD_DEAL);
    assert.equal(p.cardsPlayed.length, 0);
  } finally { clock.restore(); }
});

test('you cannot play a card you were not dealt, or the same card twice', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    p.hand = ['barrel'];
    room.onCard(p, { card: 'witness' });
    assert.equal(p.armed.size, 0, 'played a card that was never in hand');
    room.onCard(p, { card: 'nonsense' });
    assert.equal(p.armed.size, 0);

    p.lastCardAt = 0;
    room.onCard(p, { card: 'barrel' });
    assert.ok(p.armed.has('barrel'));
    p.armed.delete('barrel');
    p.lastCardAt = 0;
    room.onCard(p, { card: 'barrel' });
    assert.equal(p.armed.size, 0, 'the same card was played twice');
  } finally { clock.restore(); }
});

test('two cards cannot be dumped in the same instant', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    p.hand = ['barrel', 'ledger'];
    p.lastCardAt = 0;
    room.onCard(p, { card: 'barrel' });
    room.onCard(p, { card: 'ledger' });
    assert.deepEqual(p.hand, ['ledger'], 'the cooldown did not hold');
    clock.advance(SOCIAL.cardCooldown * 1000 + 100);
    room.onCard(p, { card: 'ledger' });
    assert.deepEqual(p.hand, []);
  } finally { clock.restore(); }
});

test('the Rain Barrel eats a shot AND the shooter\'s confirmation', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const shooter = me();
    const victim = [...room.players.values()].find((p) => p.bot && p.alive);
    give(room, victim, 'barrel');

    const before = victim.health;
    stub.reset();
    room.applyDamage(victim, shooter, 40, 'revolver', null);
    assert.equal(victim.health, before, 'the barrel let damage through');
    assert.equal(stub.of('hit').length, 0, 'the shooter got a hitmarker off a barrel');
    assert.equal(victim.armed.has('barrel'), false, 'the barrel was not spent');

    // ...and it is gone: the next bullet after the burst window lands.
    clock.advance((CARDS.barrel.soak + 0.1) * 1000);
    room.applyDamage(victim, shooter, 40, 'revolver', null);
    assert.ok(victim.health < before, 'the barrel soaked a second shot');
  } finally { clock.restore(); }
});

test('the Rain Barrel soaks a whole shotgun burst, not one pellet', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const shooter = me();
    const victim = [...room.players.values()].find((p) => p.bot && p.alive);
    give(room, victim, 'barrel');
    const before = victim.health;
    for (let i = 0; i < 9; i++) room.applyDamage(victim, shooter, 12, 'shotgun', null);
    assert.equal(victim.health, before, 'pellets got through behind the first one');
  } finally { clock.restore(); }
});

test('Buy a Witness erases the kill from the victim, the town and the killcam', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    tick(clock, room, 20 * 6);              // fill the replay history
    const victim = me();
    const killer = [...room.players.values()].find((p) => p.bot && p.alive);
    // Stand them face to face: normally the most witnessed kill possible.
    victim.pos = { x: 0, y: 0, z: 0 };
    killer.pos = { x: 0, y: 0, z: 3 };
    give(room, killer, 'witness');

    stub.reset();
    room.applyDamage(victim, killer, 999, 'revolver', null);

    const kill = stub.last('kill');
    assert.ok(kill, 'the body still has to be announced');
    assert.equal(kill.youDied, true);
    assert.equal(kill.witnessed, false);
    assert.equal(kill.killerName, null, 'the victim was told who shot them anyway');
    assert.equal(kill.killer, null);
    assert.equal(kill.victimRole, victim.role, 'the dead still reveal their role');
    assert.equal(stub.of('replay').length, 0, 'a killcam leaked the bought kill');
    assert.equal(killer.armed.has('witness'), false, 'the card was not spent');
    assert.equal(killer.kills, 1, 'the killer should still be credited');
  } finally { clock.restore(); }
});

test('Dead Man\'s Ledger names a killer you never saw', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const reader = me();
    const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
    const [victim, killer] = bots;
    // Reader is shut in the mine; the killing happens across town.
    reader.pos = { x: 58, y: 0, z: -18 };
    victim.pos = { x: 0, y: 0, z: 20 };
    killer.pos = { x: 2, y: 0, z: 22 };
    tick(clock, room, 2);

    give(room, reader, 'ledger');
    stub.reset();
    room.applyDamage(victim, killer, 999, 'revolver', null);

    const kill = stub.last('kill');
    assert.equal(kill.killerName, killer.name, 'the ledger did not pay out');
    assert.equal(kill.witnessed, true);
    assert.equal(reader.armed.has('ledger'), false, 'the ledger was not spent');
  } finally { clock.restore(); }
});

test('a bought kill leaves nothing for the ledger to read', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const reader = me();
    const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
    const [victim, killer] = bots;
    reader.pos = { x: 58, y: 0, z: -18 };
    victim.pos = { x: 0, y: 0, z: 20 };
    killer.pos = { x: 2, y: 0, z: 22 };
    tick(clock, room, 2);

    give(room, reader, 'ledger');
    give(room, killer, 'witness');
    stub.reset();
    room.applyDamage(victim, killer, 999, 'revolver', null);

    const kill = stub.last('kill');
    assert.equal(kill.killerName, null, 'the ledger beat a bought witness');
    // Nothing was written, so the card is still in play for the next death.
    assert.equal(reader.armed.has('ledger'), true, 'the ledger burned on an erased kill');
  } finally { clock.restore(); }
});

test('Cover Your Tracks sweeps the old prints and stops the new ones', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    const mine = () => room.footprints.filter((f) => f.g === p.trailGroup).length;
    p.moving = true;
    for (let i = 0; i < 6; i++) {
      p.lastFootprintAt = 0;
      tick(clock, room, 1);
    }
    assert.ok(mine() > 0, 'the player left no prints to sweep');
    const othersBefore = room.footprints.length - mine();

    give(room, p, 'tracks');
    assert.equal(mine(), 0, 'old prints survived the sweep');
    assert.equal(room.footprints.length, othersBefore, 'the sweep took other people\'s prints too');

    for (let i = 0; i < 6; i++) {
      p.lastFootprintAt = 0;
      tick(clock, room, 1);
    }
    assert.equal(mine(), 0, 'still leaving prints after covering tracks');

    // And it wears off.
    clock.advance((CARDS.tracks.duration + 1) * 1000);
    p.lastFootprintAt = 0;
    tick(clock, room, 1);
    assert.ok(mine() > 0, 'the sweep never expired');
  } finally { clock.restore(); }
});

test('the Wanted Poster answers only the player who nailed it up', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    const witness = stubClient();
    room.addConnection(witness.client);
    room.handleMessage(witness.client, { t: 'join', name: 'Bystander' });
    const bystander = [...room.players.values()].find((x) => x.name === 'Bystander');

    const sheriff = [...room.players.values()].find((x) => x.role === 'sheriff' && x.bot)
      || [...room.players.values()].find((x) => x.bot);
    // Face them across open ground in the town square, with nobody else in the
    // way - the poster resolves against whoever is actually down the barrel.
    for (const o of room.players.values()) o.pos = { x: 120, y: 0, z: 120 };
    p.pos = { x: 0, y: 0, z: 6 }; p.yaw = 0; p.pitch = 0;
    sheriff.pos = { x: 0, y: 0, z: 1 };
    bystander.pos = { x: 40, y: 0, z: 40 };
    assert.equal(room.playerInCrosshair(p, CARDS.poster.range), sheriff, 'test setup: nobody in the crosshair');

    stub.reset(); witness.reset();
    give(room, p, 'poster');

    // The town hears that a poster went up, and who put it there.
    const public_ = witness.of('feed');
    assert.equal(public_.length, 1);
    assert.ok(public_[0].text.includes(p.name) && public_[0].text.includes(sheriff.name));
    // But the ANSWER is private, and the target's role is never on the wire.
    assert.equal(public_[0].text.includes('star'), false, 'the answer leaked to the town');
    const mine = stub.of('feed').map((f) => f.text).join(' | ');
    assert.ok(/wears the star|does not wear the star/.test(mine), 'the poster never answered');
    assert.equal(
      /wears the star/.test(mine) && !/does not wear the star/.test(mine),
      sheriff.role === 'sheriff',
      'the poster gave the wrong answer',
    );
  } finally { clock.restore(); }
});

test('the Wanted Poster refuses to resolve with nobody in the crosshair', () => {
  const { room, clock, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    p.pos = { x: 0, y: 0, z: 6 }; p.yaw = 0; p.pitch = -1.4;   // staring at his boots
    for (const o of room.players.values()) if (o !== p) o.pos = { x: 120, y: 0, z: 120 };
    p.hand = ['poster'];
    p.lastCardAt = 0;
    room.onCard(p, { card: 'poster' });
    assert.deepEqual(p.hand, ['poster'], 'the card was burned on nobody');
  } finally { clock.restore(); }
});

test('the Long Glass puts a face on a shot fired across town', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    const shooter = [...room.players.values()].find((x) => x.bot && x.alive);
    // Well outside anything the visibility cull would ever send.
    p.pos = { x: 58, y: 0, z: -18 };
    shooter.pos = { x: -26, y: 0, z: 18 };
    tick(clock, room, 20);                  // past VISION.memory, so nobody is remembered
    assert.equal(room.visibleTo(p, Date.now() / 1000).has(shooter.id), false, 'test setup: they are visible anyway');

    give(room, p, 'spyglass');
    shooter.nextFireAt = 0; shooter.swapUntil = 0;
    room.onShoot(shooter, { dir: { x: 0, y: 0, z: -1 } });
    stub.reset();
    tick(clock, room, 1);

    const snap = stub.last('snap');
    assert.ok(snap.reveal && snap.reveal.includes(shooter.id), 'the glass did not light up the shooter');
    assert.ok(snap.ps.some((e) => e.id === shooter.id), 'the shooter was revealed but never sent');

    // And it fades: the mark is seconds, not the rest of the round.
    clock.advance((CARDS.spyglass.mark + 1) * 1000);
    stub.reset();
    tick(clock, room, 1);
    const later = stub.last('snap');
    assert.ok(!later.reveal || !later.reveal.includes(shooter.id), 'the mark never faded');
  } finally { clock.restore(); }
});

test('the aftermath screen is the first place a silent card is ever named', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const p = me();
    const other = stubClient();
    room.addConnection(other.client);
    room.handleMessage(other.client, { t: 'join', name: 'Bystander' });

    other.reset();
    give(room, p, 'witness');
    assert.equal(
      JSON.stringify(other.sent).includes('witness'), false,
      'a silent card was announced to the room as it was played',
    );

    room.endMatch('law', 'test');
    const results = other.last('results');
    const entry = results.timeline.find((e) => e.type === 'card');
    assert.ok(entry, 'the round never recorded the card');
    assert.equal(entry.card, 'witness');
    assert.equal(entry.who, p.name);
    assert.equal(entry.secret, true);
    const row = results.rows.find((r) => r.name === p.name);
    assert.deepEqual(row.cards, ['witness']);
  } finally { clock.restore(); }
});

test('a bot holding the Long Glass gets the name, but not a place to run to', () => {
  const { room, clock } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
    const [watcher, shooter] = bots;
    // intoCombat freezes the bots, so give this one its brain back by hand.
    watcher.brain = new BotBrain(room, watcher);
    watcher.pos = { x: 58, y: 0, z: -18 };
    shooter.pos = { x: -26, y: 0, z: 18 };          // ~90m away, well out of earshot
    watcher.hand = ['spyglass'];
    watcher.lastCardAt = 0;
    room.onCard(watcher, { card: 'spyglass' });
    assert.ok(watcher.glassUntil > 0, 'the card did not take');

    const shot = () => watcher.brain.onEvent('gunshot', {
      pos: { x: shooter.pos.x, y: 1.6, z: shooter.pos.z },
      shooter, weapon: { noise: 45 },
    });

    const before = watcher.brain.susOf(shooter.id);
    shot();
    const seen = watcher.brain.lastSeen.get(shooter.id);
    assert.ok(seen, 'the glass named nobody for the bot');
    assert.equal(Math.round(seen.x), Math.round(shooter.pos.x), 'the place should be exact');
    assert.ok(watcher.brain.susOf(shooter.id) > before, 'the bot learned nothing from it');
    // Identity, not a summons: a shot this far off is still not somewhere to go.
    assert.equal(watcher.brain.noise, null, 'the glass turned a distant shot into a destination');

    // And it cannot stack: emptying a magazine is one lead, not six.
    const after = watcher.brain.susOf(shooter.id);
    for (let i = 0; i < 6; i++) shot();
    assert.equal(watcher.brain.susOf(shooter.id), after, 'suspicion stacked once per bullet');

    // Once the glass runs out the same shot is neither seen nor heard.
    watcher.glassUntil = 0;
    watcher.brain.lastSeen.delete(shooter.id);
    shot();
    assert.equal(watcher.brain.lastSeen.has(shooter.id), false, 'the glass never expired');
    assert.equal(watcher.brain.noise, null, 'a shot 90m away should not even be heard');
  } finally { clock.restore(); }
});

test('every card in the deck has a face cut for it', async () => {
  // cardart.js only touches the DOM inside its draw functions, so Node can
  // import it and check the press has a block for every card in the deck.
  const { PRINTABLE } = await import('../client/js/cardart.js');
  for (const id of CARD_ORDER) {
    assert.ok(PRINTABLE.includes(id), `${id} would print a blank face`);
  }
  assert.equal(PRINTABLE.length, CARD_ORDER.length, 'the press has a block nothing uses');
});

test('every card carries the text its face is set from', () => {
  for (const id of CARD_ORDER) {
    const c = CARDS[id];
    assert.ok(c.name && c.flavour, `${id} is missing its lettering`);
    assert.ok(['armed', 'instant', 'timed'].includes(c.kind), `${id} has no play kind`);
    assert.ok(c.rules && c.rules.length > 40, `${id} needs a printed rules line`);
    // The rules line is set at 21px across 424px of card; much past this and it
    // runs into the flavour text at the foot.
    assert.ok(c.rules.length <= 96, `${id}'s rules line will not fit on the card`);
    assert.ok(c.flavour.length <= 90, `${id}'s flavour line will not fit on the card`);
    assert.ok(['none', 'aim'].includes(c.target), `${id} has an unknown targeting mode`);
  }
});

test('the deck is our own: no card deals damage or heals', () => {
  // A guard rail for the design rule, not for the code: if somebody ever adds a
  // card that shoots, this fails and they have to argue with it.
  for (const id of CARD_ORDER) {
    const c = CARDS[id];
    assert.ok(c.desc.length > 40, `${id} needs a real description`);
    assert.equal(/\bdamage\b|\bheal(s|ing)?\b|\bhealth\b/i.test(c.desc), false,
      `${id} looks like a combat card - the deck only edits information`);
  }
});

// ---------------------------------------------------------------------------
// Boots. Not a card, but the same information rule: physical and anonymous.
// ---------------------------------------------------------------------------

test('a step is heard nearby, and never carries a name', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const listener = me();
    const walker = [...room.players.values()].find((p) => p.bot && p.alive);
    listener.pos = { x: 0, y: 0, z: 0 };
    walker.pos = { x: 8, y: 0, z: 0 };
    walker.moving = true;
    walker.crouch = false;
    walker.sprint = false;
    walker.lastStepAt = 0;

    stub.reset();
    room.stepSound(walker, Date.now() / 1000);
    const steps = stub.of('step');
    assert.equal(steps.length, 1, 'a walker 8m away should be audible');
    assert.equal(steps[0].id, undefined, 'a step named the person who took it');
    assert.equal(steps[0].n, undefined);
    // A place, but a loose one - a direction, not a pin.
    const off = Math.hypot(steps[0].x - walker.pos.x, steps[0].z - walker.pos.z);
    assert.ok(off > 0, 'the step position was exact');
    assert.ok(off <= SOCIAL.stepFuzz * 1.5, `the step landed ${off.toFixed(1)}m from the walker`);
  } finally { clock.restore(); }
});

test('boots do not carry across town, and crouching kills them', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const listener = me();
    const walker = [...room.players.values()].find((p) => p.bot && p.alive);
    listener.pos = { x: 0, y: 0, z: 0 };
    walker.moving = true;

    const stepsAt = (dist, opts = {}) => {
      walker.pos = { x: dist, y: 0, z: 0 };
      walker.crouch = !!opts.crouch;
      walker.sprint = !!opts.sprint;
      walker.character = opts.character || 'gunslinger';
      walker.lastStepAt = 0;
      stub.reset();
      room.stepSound(walker, Date.now() / 1000);
      return stub.of('step').length;
    };

    assert.equal(stepsAt(60), 0, 'a walker 60m away was audible');
    assert.equal(stepsAt(15), 1, 'a walker 15m away was not');
    assert.equal(stepsAt(28, { sprint: true }), 1, 'running should carry further than walking');
    assert.equal(stepsAt(28), 0, 'walking carried as far as running');
    assert.equal(stepsAt(15, { crouch: true }), 0, 'crouching is the counterplay and it did nothing');
    // The Lookout's whole passive.
    assert.equal(stepsAt(15, { character: 'scout' }), 0, "the Lookout's boots carry as far as anyone's");
    assert.equal(stepsAt(11, { character: 'scout' }), 1, 'the Lookout went completely silent');
  } finally { clock.restore(); }
});

test('a step is paced by the gait, not by the tick rate', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 6 });
  try {
    intoCombat(room, clock);
    const listener = me();
    const walker = [...room.players.values()].find((p) => p.bot && p.alive);
    listener.pos = { x: 0, y: 0, z: 0 };
    walker.pos = { x: 6, y: 0, z: 0 };
    walker.moving = true;
    walker.lastStepAt = 0;
    stub.reset();
    // Two seconds of ticks. At the walking cadence that is four or five steps,
    // not the forty ticks that went past.
    for (let i = 0; i < 40; i++) { clock.advance(50); room.stepSound(walker, Date.now() / 1000); }
    const n = stub.of('step').length;
    const expected = 2 / SOCIAL.stepInterval.walk;
    assert.ok(Math.abs(n - expected) <= 1.5, `${n} steps in two seconds, expected about ${expected.toFixed(1)}`);
  } finally { clock.restore(); }
});

test('bots have ears, so crouching past one is worth something', () => {
  const { room, clock } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
    const [listener, walker] = bots;
    listener.brain = new BotBrain(room, listener);
    listener.brain.paranoia = 1;              // take the dice out of it
    listener.pos = { x: 0, y: 0, z: 0 };
    walker.moving = true;
    walker.character = 'gunslinger';

    const walkPast = (dist, crouch) => {
      walker.pos = { x: dist, y: 0, z: 0 };
      walker.crouch = crouch;
      walker.sprint = false;
      walker.lastStepAt = 0;
      listener.brain.noise = null;
      // Advance between steps: the step timer would swallow all but the first,
      // and one step is a coin flip by design.
      for (let i = 0; i < 14; i++) {
        clock.advance(500);
        walker.lastStepAt = 0;
        room.stepSound(walker, Date.now() / 1000);
      }
      return listener.brain.noise;
    };

    const heard = walkPast(12, false);
    assert.ok(heard, 'a bot never heard somebody walk past at 12m');
    assert.equal(heard.shooter, null, 'a footstep told a bot who it was');
    assert.equal(heard.soft, true, 'a footstep counted as hard evidence');

    assert.equal(walkPast(12, true), null, 'crouching past a bot did nothing');
    assert.equal(walkPast(90, false), null, 'a bot heard boots from across town');
  } finally { clock.restore(); }
});

test('gunfire outranks boots as a lead', () => {
  const { room, clock } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const bots = [...room.players.values()].filter((p) => p.bot && p.alive);
    const [listener, walker] = bots;
    listener.brain = new BotBrain(room, listener);
    listener.brain.paranoia = 1;
    listener.pos = { x: 0, y: 0, z: 0 };

    // A shot, then somebody strolling about nearby.
    listener.brain.onEvent('gunshot', {
      pos: { x: 20, y: 1.6, z: 0 }, shooter: walker, weapon: { noise: 45 },
    });
    const fromShot = { ...listener.brain.noise };
    assert.equal(fromShot.soft, undefined, 'a gunshot came through as a soft lead');

    walker.pos = { x: -8, y: 0, z: 0 };
    walker.moving = true; walker.crouch = false; walker.sprint = false;
    for (let i = 0; i < 14; i++) {
      clock.advance(200);
      walker.lastStepAt = 0;
      room.stepSound(walker, Date.now() / 1000);
    }
    assert.equal(listener.brain.noise.x, fromShot.x, 'footsteps overwrote a fresh gunshot lead');
  } finally { clock.restore(); }
});

test('a busy round cannot push the cards off its own account', () => {
  const { room, clock, stub, me } = makeRoom({ bots: 8 });
  try {
    intoCombat(room, clock);
    const p = me();
    give(room, p, 'witness');

    // Forty accusations later - which a chatty lobby of bots manages easily.
    const others = [...room.players.values()].filter((o) => o !== p && o.alive);
    for (let i = 0; i < 40; i++) {
      const from = others[i % others.length];
      const target = others[(i + 1) % others.length];
      from.lastAccuseAt = 0;
      room.onAccuse(from, { target: target.id });
    }
    assert.ok(room.timeline.length > 24, 'test setup: not enough noise');

    room.endMatch('law', 'test');
    const timeline = stub.last('results').timeline;
    const card = timeline.find((e) => e.type === 'card' && e.who === p.name);
    assert.ok(card, 'the round forgot the card that was played in it');
    assert.equal(card.card, 'witness');
    assert.ok(timeline.length <= 40, `the account ran to ${timeline.length} entries`);
    // The recent noise is still there too.
    assert.ok(timeline.some((e) => e.type === 'accuse'), 'the account dropped everything else');
  } finally { clock.restore(); }
});
