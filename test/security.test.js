// What a lying client cannot do. These are the invariants that separate
// "playable with friends" from "safe to put in front of strangers".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import {
  TIMING, PLAYER, VISION, SOCIAL, VOICE_LINES, MODES, PHASE, MAX_PLAYERS, WEAPONS,
} from '../shared/constants.js';
import MAP from '../shared/map.js';
import { C } from '../shared/protocol.js';
import { isBlocked } from '../shared/collision.js';

const { Room } = await import('../server/room.js');

function liveRoom({ bots = 6 } = {}) {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'SEC', isPublic: false, mode: MODES.FREE });
  room.botFillTarget = bots;
  room.resetClock();
  const stub = stubClient();
  room.addConnection(stub.client);
  room.handleMessage(stub.client, { t: 'join', name: 'Cheat' });
  room.beginMatch();
  tick(clock, room, 40);
  const me = [...room.players.values()].find((p) => !p.bot);
  freezeBots(room);
  return { room, clock, stub, me };
}

test('a client cannot teleport across the map', () => {
  const { room, clock, me } = liveRoom();
  try {
    me.pos = { x: 0, y: 0, z: 0 };
    room.onInput(me, { pos: { x: 60, y: 0, z: -18 }, yaw: 0, pitch: 0 });
    const moved = Math.hypot(me.pos.x, me.pos.z);
    assert.ok(moved < 5, `teleported ${moved.toFixed(1)}m in one input`);
  } finally { clock.restore(); }
});

test('a client cannot walk through a wall', () => {
  const { room, clock, me } = liveRoom();
  try {
    // Stand on Main Street outside the saloon and claim to be inside it.
    me.pos = { x: -26, y: 0, z: -6.4 };
    me.lastInputAt = Date.now() / 1000;
    for (let i = 0; i < 30; i++) {
      clock.advance(33);
      room.onInput(me, { pos: { x: -26, y: 0, z: me.pos.z - 0.3 }, yaw: 0, pitch: 0 });
    }
    assert.ok(me.pos.z > -8.4, `phased through the saloon wall to z=${me.pos.z.toFixed(2)}`);
  } finally { clock.restore(); }
});

test('the server never parks a player inside geometry', () => {
  const { room, clock, me } = liveRoom();
  try {
    me.lastInputAt = Date.now() / 1000;
    // Hammer the server with positions inside solid buildings.
    for (const target of [
      { x: -22, y: 0, z: -18 }, { x: 18, y: 0, z: -18 }, { x: 0, y: 0, z: 20 },
      { x: 46, y: 0, z: -34 }, { x: -31, y: 0, z: 15 },
    ]) {
      for (let i = 0; i < 20; i++) {
        clock.advance(33);
        room.onInput(me, { pos: target, yaw: 0, pitch: 0 });
      }
      assert.equal(
        isBlocked(me.pos.x, me.pos.y, me.pos.z, PLAYER.radius * 0.9, PLAYER.height * 0.9, MAP.solids),
        false,
        `server left the player stuck inside geometry at ${me.pos.x.toFixed(1)},${me.pos.z.toFixed(1)}`,
      );
    }
  } finally { clock.restore(); }
});

test('snapshots withhold players you cannot see', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 8 });
  try {
    // Alone in the mine chamber; everyone else scattered around town.
    me.pos = { x: 60, y: 0, z: -18 };
    const others = [...room.players.values()].filter((p) => p.bot);
    const spots = [
      { x: -22, z: -16 }, { x: 18, z: -18 }, { x: 0, z: 20 }, { x: -31, z: 15 },
      { x: 24, z: 18 }, { x: -45, z: 0 }, { x: 0, z: -30 },
    ];
    others.forEach((p, i) => { const s = spots[i % spots.length]; p.pos = { x: s.x, y: 0, z: s.z }; });
    // Let the corner-peek memory lapse first - it deliberately keeps somebody
    // on the wire briefly after they break line of sight.
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);
    stub.reset();
    tick(clock, room, 6);

    const snaps = stub.of('snap');
    assert.ok(snaps.length > 0);
    for (const s of snaps) {
      const leaked = s.ps.filter((e) => e.id !== me.id);
      assert.equal(leaked.length, 0, `snapshot carried ${leaked.length} players hidden behind buildings`);
    }
  } finally { clock.restore(); }
});

test('somebody standing in front of you is still sent', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 6 });
  try {
    me.pos = { x: -6, y: 0, z: 0 };
    const buddy = [...room.players.values()].find((p) => p.bot);
    buddy.pos = { x: -3, y: 0, z: 0 };            // three metres away on open street
    stub.reset();
    tick(clock, room, 4);
    const last = stub.last('snap');
    assert.ok(last.ps.some((e) => e.id === buddy.id), 'culled somebody in plain sight');
  } finally { clock.restore(); }
});

test('a gunshot from an unseen shooter arrives without a name', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 6 });
  try {
    // Close enough to hear - a revolver carries WEAPONS.revolver.noise metres -
    // and with the saloon between them.
    me.pos = { x: -6, y: 0, z: 0 };
    const shooter = [...room.players.values()].find((p) => p.bot);
    shooter.pos = { x: -22, y: 0, z: -20 };       // deep inside the saloon
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);   // let the peek memory lapse
    assert.equal(stub.last('snap').ps.some((e) => e.id === shooter.id), false,
      'test setup: he can see the man he is not supposed to be able to see');
    stub.reset();
    shooter.nextFireAt = 0; shooter.swapUntil = 0; shooter.reloading = null;
    room.onShoot(shooter, { dir: { x: 1, y: 0, z: 0 } });

    const shot = stub.last('shot');
    assert.ok(shot, 'the shot should still be heard');
    assert.equal(shot.id, undefined, 'named a shooter the player could not see');
  } finally { clock.restore(); }
});

test('and does not carry his exact position either', () => {
  // The same secret wearing different clothes. The name was stripped from a
  // shot fired by somebody you cannot see, and the coordinates were not - the
  // origin travelled exact to every socket in the round, so a modified client
  // could put a pin on every man in town every time he fired, through any
  // wall, out of packets it was entitled to receive. A whole wallhack built
  // from legitimate traffic.
  const { room, clock, stub, me } = liveRoom({ bots: 6 });
  try {
    me.pos = { x: -6, y: 0, z: 0 };
    const shooter = [...room.players.values()].find((p) => p.bot);
    shooter.pos = { x: -22, y: 0, z: -20 };
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);
    shooter.nextFireAt = 0; shooter.swapUntil = 0; shooter.reloading = null;

    // Fired repeatedly from a man standing perfectly still: if the origin were
    // honest, every one of these would name the same spot.
    const heard = [];
    for (let i = 0; i < 14; i++) {
      stub.reset();
      shooter.nextFireAt = 0;
      shooter.guns[shooter.slot].mag = 6;
      room.onShoot(shooter, { dir: { x: 1, y: 0, z: 0 } });
      const shot = stub.last('shot');
      if (shot) heard.push(shot);
    }
    assert.ok(heard.length >= 10, `only ${heard.length} of fourteen shots were heard at all`);
    assert.ok(heard.every((sh) => sh.id === undefined), 'one of them named him');

    const xs = heard.map((sh) => sh.o[0]);
    const zs = heard.map((sh) => sh.o[2]);
    assert.ok(new Set(xs).size > 1 || new Set(zs).size > 1,
      'every shot came back from the same exact spot - the origin is not fuzzed');
    const off = heard.map((sh) => Math.hypot(sh.o[0] - shooter.pos.x, sh.o[2] - shooter.pos.z));
    assert.ok(Math.max(...off) > 0.7,
      `the widest miss was ${Math.max(...off).toFixed(2)}m, which is a pin, not a direction`);
    assert.ok(Math.max(...off) < SOCIAL.shotFuzz * 2.5,
      'the fuzz is wide enough that a shot says nothing about where it came from');

    // But where the bullets landed is not fuzzed - dust off a wall is a thing
    // you can genuinely see, and it is what makes an unseen shot readable.
    assert.ok(heard.every((sh) => Array.isArray(sh.rays) && sh.rays.length),
      'the impacts went missing with the shooter');
  } finally { clock.restore(); }
});

test('and a shot on the far side of town is not heard at all', () => {
  // Every shot in the round used to reach every socket in it, whatever the
  // distance. A hundred and thirty metres of town is a lot of gunfire to be
  // told about.
  const { room, clock, stub, me } = liveRoom({ bots: 6 });
  try {
    me.pos = { x: 60, y: 0, z: -18 };             // deep in the mine
    const shooter = [...room.players.values()].find((p) => p.bot);
    shooter.pos = { x: -22, y: 0, z: -16 };       // inside the saloon, 82m off
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);
    stub.reset();
    shooter.nextFireAt = 0; shooter.swapUntil = 0; shooter.reloading = null;
    room.onShoot(shooter, { dir: { x: 1, y: 0, z: 0 } });
    assert.equal(stub.last('shot'), undefined,
      'a revolver eighty metres away was put on the wire');
  } finally { clock.restore(); }
});

test('breaking line of sight drops you off the wire, but not instantly', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 6 });
  try {
    const buddy = [...room.players.values()].find((p) => p.bot);
    me.pos = { x: -6, y: 0, z: 0 };
    buddy.pos = { x: -3, y: 0, z: 0 };
    tick(clock, room, 4);
    assert.ok(stub.last('snap').ps.some((e) => e.id === buddy.id), 'should be visible in the open');

    // Duck them deep inside the saloon.
    buddy.pos = { x: -22, y: 0, z: -20 };
    stub.reset();
    tick(clock, room, 2);
    assert.ok(
      stub.last('snap').ps.some((e) => e.id === buddy.id),
      'should linger briefly so corner-peeking does not strobe',
    );

    stub.reset();
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);
    assert.equal(
      stub.last('snap').ps.some((e) => e.id === buddy.id), false,
      'should be gone once the memory lapses',
    );
  } finally { clock.restore(); }
});

test('vision settings stay coherent', () => {
  assert.ok(VISION.near > PLAYER.radius * 2, 'the proximity floor must clear a player');
  assert.ok(VISION.far > 140, 'the rifle must still work at its own range');
  assert.ok(VISION.memory > 0 && VISION.memory < 2, 'visibility memory should be brief');
});

test('flooding inputs does not buy speed', () => {
  const { room, clock, me } = liveRoom();
  try {
    // Open ground on Main Street, so nothing here is a collision result.
    me.pos = { x: 0, y: 0, z: 0 };
    me.moveSlack = PLAYER.serverSlack;
    const start = { x: me.pos.x, z: me.pos.z };

    // One second of wall clock, but 500 input packets instead of the 30 a real
    // client sends. Each one asks to be a metre further down the street.
    for (let i = 0; i < 500; i++) {
      clock.advance(2);
      room.onInput(me, { pos: { x: me.pos.x + 1, y: 0, z: me.pos.z }, yaw: 0, pitch: 0 });
    }

    const moved = Math.hypot(me.pos.x - start.x, me.pos.z - start.z);
    // A second at the clamp is 12.5m, plus the slack budget. Anything near the
    // 500m the client asked for means the per-packet allowance is back.
    assert.ok(moved <= PLAYER.maxServerSpeed * 1.2 + PLAYER.serverSlack + 1,
      `flooding inputs moved ${moved.toFixed(1)}m in one second`);
  } finally { clock.restore(); }
});

test('the jitter budget still lets an honest client through', () => {
  const { room, clock, me } = liveRoom();
  try {
    me.pos = { x: 0, y: 0, z: 0 };
    me.moveSlack = PLAYER.serverSlack;
    // 30Hz, sprinting: what the real client actually produces.
    const perTick = PLAYER.sprintSpeed / 30;
    let asked = 0;
    for (let i = 0; i < 60; i++) {
      clock.advance(1000 / 30);
      asked += perTick;
      room.onInput(me, { pos: { x: me.pos.x + perTick, y: 0, z: me.pos.z }, yaw: 0, pitch: 0 });
    }
    const moved = me.pos.x;
    assert.ok(moved > asked * 0.97, `an honest sprint was clamped: asked ${asked.toFixed(1)}m, got ${moved.toFixed(1)}m`);
  } finally { clock.restore(); }
});

test('a sprint runs out, and the clamp comes down with it', () => {
  const { room, clock, me } = liveRoom();
  try {
    me.pos = { x: 0, y: 0, z: 0 };
    me.moveSlack = PLAYER.serverSlack;
    me.stamina = PLAYER.staminaMax;

    // Ask to sprint flat out, at the real 30Hz, for eight seconds - three more
    // than the tank holds.
    const step = PLAYER.sprintSpeed / 30;
    const marks = [];
    for (let i = 0; i < 30 * 8; i++) {
      const before = me.pos.x;
      clock.advance(1000 / 30);
      room.onInput(me, { pos: { x: me.pos.x + step, y: 0, z: me.pos.z }, yaw: 0, pitch: 0 });
      marks.push({ t: i / 30, gained: me.pos.x - before });
    }

    const early = marks.slice(15, 60).reduce((n, m) => n + m.gained, 0) / 45 * 30;
    const late = marks.slice(210, 240).reduce((n, m) => n + m.gained, 0) / 30 * 30;
    assert.ok(early > PLAYER.walkSpeed * 1.2, `a fresh sprint was clamped to ${early.toFixed(1)} m/s`);
    assert.ok(late < PLAYER.sprintSpeed * 0.95,
      `still sprinting at ${late.toFixed(1)} m/s after eight seconds on a five second tank`);
    assert.equal(me.stamina, 0, 'the tank never emptied');
  } finally { clock.restore(); }
});

test('resting refills the tank', () => {
  const { room, clock, me } = liveRoom();
  try {
    me.pos = { x: 0, y: 0, z: 0 };
    me.stamina = 0;
    for (let i = 0; i < 30 * 3; i++) {
      clock.advance(1000 / 30);
      room.onInput(me, { pos: { x: me.pos.x, y: 0, z: me.pos.z }, yaw: 0, pitch: 0 });
    }
    assert.ok(me.stamina > 2, `three seconds of standing still gave back ${me.stamina.toFixed(2)}s`);
  } finally { clock.restore(); }
});

test('an ability used out of sight does not name the player who used it', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 8 });
  try {
    const watcher = me;
    const actor = [...room.players.values()].find((p) => p.bot && p.alive);
    // Shut in the mine; the ability happens across town.
    watcher.pos = { x: 58, y: 0, z: -18 };
    actor.pos = { x: -26, y: 0, z: 18 };
    tick(clock, room, 20);                    // past VISION.memory
    assert.equal(room.visibleTo(watcher, Date.now() / 1000).has(actor.id), false,
      'test setup: the actor is visible anyway');

    stub.reset();
    actor.abilityReadyAt = 0;
    actor.character = 'scout';
    room.onAbility(actor);
    assert.equal(stub.of('ability').length, 0, 'an unseen ability was announced');
    assert.equal(JSON.stringify(stub.sent).includes(`"id":${actor.id}`), false);
  } finally { clock.restore(); }
});

test('an ability you can watch happen does name them, minus the private half', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 8 });
  try {
    const watcher = me;
    const actor = [...room.players.values()].find((p) => p.bot && p.alive);
    watcher.pos = { x: 0, y: 0, z: 0 };
    watcher.yaw = 0;
    actor.pos = { x: 0, y: 0, z: -5 };
    tick(clock, room, 2);
    stub.reset();
    actor.abilityReadyAt = 0;
    actor.character = 'gambler';
    room.onAbility(actor);

    const seen = stub.last('ability');
    assert.ok(seen, 'an ability in plain sight was withheld');
    assert.equal(seen.id, actor.id);
    // Which card the Gambler drew is their business until it does something.
    assert.equal(seen.boon, undefined, "somebody else learned the Gambler's boon");
    assert.equal(seen.label, undefined);
  } finally { clock.restore(); }
});

test('a pickup out of sight does not say whose hands it went into', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 8 });
  try {
    const watcher = me;
    const taker = [...room.players.values()].find((p) => p.bot && p.alive);
    watcher.pos = { x: 58, y: 0, z: -18 };
    const item = room.loot.find((l) => l.active);
    taker.pos = { x: item.x, y: item.y - 0.9, z: item.z };
    tick(clock, room, 20);

    stub.reset();
    room.onPickup(taker, { id: item.id });
    const picked = stub.last('picked');
    assert.ok(picked, 'the item vanishing should still reach everybody');
    assert.equal(picked.id, item.id);
    assert.equal(picked.by, undefined, 'an unseen pickup named the player who made it');
  } finally { clock.restore(); }
});

test('a shout carries across the street, not across the map', () => {
  const { room, clock, stub, me } = liveRoom({ bots: 8 });
  try {
    const listener = me;
    const shouter = [...room.players.values()].find((p) => p.bot && p.alive);
    listener.pos = { x: 0, y: 0, z: 0 };

    const shoutFrom = (dist) => {
      shouter.pos = { x: dist, y: 0, z: 0 };
      shouter.lastChatAt = 0;
      stub.reset();
      room.onVoice(shouter, { line: VOICE_LINES[0].id });
      return stub.of('chat').length;
    };

    assert.equal(shoutFrom(10), 1, 'a shout from across the street went unheard');
    assert.equal(shoutFrom(SOCIAL.shoutRange - 2), 1);
    assert.equal(shoutFrom(SOCIAL.shoutRange + 20), 0, 'a shout carried across the whole map');

    // The dead hear everything - they have nothing better to do.
    listener.alive = false;
    assert.equal(shoutFrom(120), 1, 'the dead should hear the whole town');
  } finally { clock.restore(); }
});

test('nothing a client can put on the wire gets past the door or breaks the room', () => {
  // Two layers, and this checks both. The socket layer in server/index.js
  // parses the frame, drops anything that is not an object with a string `t`,
  // and wraps the call in a try - so a malformed message cannot reach the room
  // and cannot take the process with it. The room itself then has to survive
  // every SHAPE of nonsense that does have a string `t`.
  //
  // Written after finding that a shot with an unusable direction used to spend
  // the card, a round out of the shared chamber and the magazine before the
  // direction was so much as looked at.
  const { room, clock, stub } = liveRoom();
  try {
    const before = room.players.size;

    // The door. Exactly what server/index.js lets through.
    const doorLets = (m) => !!m && typeof m.t === 'string';
    for (const shut of [null, undefined, 0, '', [], {}, { t: null }, { t: 7 }, { t: {} }]) {
      assert.equal(doorLets(shut), false, `the door let ${JSON.stringify(shut)} through`);
    }

    // And the room, for everything that does get through.
    const junk = [
      { t: 'nope' }, { t: '' },
      { t: C.SHOOT }, { t: C.SHOOT, dir: 'north' }, { t: C.SHOOT, dir: [0, 0, -1] },
      { t: C.SHOOT, dir: { x: 'a', y: 'b', z: 'c' } }, { t: C.SHOOT, dir: { x: NaN, y: 0, z: 1 } },
      { t: C.CARD }, { t: C.CARD, card: null }, { t: C.CARD, card: 123 },
      { t: C.CARD, card: 'nope' }, { t: C.CARD, card: 'panic', target: 99999 },
      { t: C.INPUT }, { t: C.INPUT, pos: null }, { t: C.INPUT, pos: { x: 'a', y: 0, z: 0 } },
      { t: C.INPUT, pos: { x: Infinity, y: 0, z: 0 } }, { t: C.INPUT, yaw: 'spin', pitch: {} },
      { t: C.PICKUP }, { t: C.PICKUP, id: -1 }, { t: C.PICKUP, id: 'x' },
      { t: C.ACCUSE }, { t: C.ACCUSE, target: null }, { t: C.ACCUSE, target: {} },
      { t: C.VOICE }, { t: C.VOICE, line: 'nope' },
      { t: C.CHAT }, { t: C.CHAT, text: null }, { t: C.CHAT, text: {} },
      { t: C.CHAT, text: 'x'.repeat(100000) },
      { t: C.THROW }, { t: C.THROW, dir: [1, 2, 3] },
      { t: C.SELFSHOT }, { t: C.BRACE }, { t: C.ABILITY }, { t: C.BADGE }, { t: C.RELOAD },
      { t: C.ADD_BOT, n: 'many' }, { t: C.ADD_BOT, n: -999 }, { t: C.ADD_BOT, n: 1e9 },
      { t: C.START, mode: 'nope' }, { t: C.RESTART },
      { t: 'join' }, { t: 'join', name: null }, { t: 'join', name: 'x'.repeat(10000) },
      { t: 'join', token: {} },
    ];
    for (const m of junk) {
      assert.ok(doorLets(m), `the door would have stopped ${JSON.stringify(m).slice(0, 40)}`);
      room.handleMessage(stub.client, m);      // must not throw
    }

    // And the town is still a town afterwards.
    assert.ok(room.players.size >= before, `the room lost ${before - room.players.size} people`);
    assert.ok(room.players.size <= MAX_PLAYERS, `the room grew to ${room.players.size}`);
    tick(clock, room, 200);
    assert.ok([PHASE.PREP, PHASE.COMBAT, PHASE.ENDGAME, PHASE.RESULTS].includes(room.phase),
      `the room ended up in ${room.phase}`);
  } finally { clock.restore(); }
});

test('a weapon slot is one of the guns you were dealt, not any key on an object', () => {
  // p.guns['__proto__'] is Object.prototype, which is very truthy, so the
  // existence check that gated this accepted any key on it - __proto__,
  // constructor, toString, valueOf. The player could not then fire, because
  // p.guns[p.slot].mag is undefined, but the string went into their own state
  // and out to every other player in the snapshot's `w` field, which is what
  // the room draws a weapon from. Nothing crashed, which is how it sat there.
  const { room, clock, stub, me } = liveRoom({ bots: 4 });
  try {
    const dealt = me.slot;
    for (const slot of ['__proto__', 'constructor', 'toString', 'valueOf',
      'hasOwnProperty', 'rifle', '', null, undefined, 0, {}, []]) {
      room.onSwap(me, { slot });
      assert.equal(me.slot, dealt,
        `a client asked for "${String(slot)}" and was handed it`);
    }
    // And the snapshot never carried one either.
    stub.reset();
    tick(clock, room, 4);
    for (const snap of stub.of('snap')) {
      for (const e of snap.ps) {
        assert.ok(Object.hasOwn(WEAPONS, e.w),
          `the wire carried a weapon called "${e.w}"`);
      }
    }

    // A gun he really does have still works, or the fix took the feature with it.
    me.guns.rifle = { mag: 5, reserve: 20 };
    room.onSwap(me, { slot: 'rifle' });
    assert.equal(me.slot, 'rifle', 'he could no longer pick up a second gun and use it');
  } finally { clock.restore(); }
});
