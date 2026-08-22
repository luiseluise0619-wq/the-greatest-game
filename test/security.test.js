// What a lying client cannot do. These are the invariants that separate
// "playable with friends" from "safe to put in front of strangers".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock, stubClient, tick, freezeBots } from './helpers.js';
import { TIMING, PLAYER, VISION } from '../shared/constants.js';
import MAP from '../shared/map.js';
import { isBlocked } from '../shared/collision.js';

const { Room } = await import('../server/room.js');

function liveRoom({ bots = 6 } = {}) {
  TIMING.prep = 1; TIMING.combat = 600; TIMING.endgame = 30; TIMING.results = 5;
  const clock = fakeClock();
  const room = new Room({ code: 'SEC', isPublic: false });
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
    me.pos = { x: 60, y: 0, z: -18 };             // deep in the mine
    const shooter = [...room.players.values()].find((p) => p.bot);
    shooter.pos = { x: -22, y: 0, z: -16 };       // inside the saloon
    tick(clock, room, Math.ceil(VISION.memory * 20) + 6);   // let the peek memory lapse
    stub.reset();
    shooter.nextFireAt = 0; shooter.swapUntil = 0; shooter.reloading = null;
    room.onShoot(shooter, { dir: { x: 1, y: 0, z: 0 } });

    const shot = stub.last('shot');
    assert.ok(shot, 'the shot should still be heard');
    assert.equal(shot.id, undefined, 'named a shooter the player could not see');
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
