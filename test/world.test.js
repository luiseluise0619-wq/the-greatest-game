// The map and the maths every other system is built on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import MAP, { zoneAt, SPAWNS, LOOT_SPAWNS, NAV_NODES } from '../shared/map.js';
import { moveAndCollide, raycastWorld, lineOfSight, isBlocked } from '../shared/collision.js';
import {
  PLAYER, ROLE_TABLE, MIN_PLAYERS, MAX_PLAYERS, rolesForPlayerCount, WEAPONS,
  stepStamina, canSprint,
} from '../shared/constants.js';

test('map is well formed', () => {
  assert.ok(MAP.solids.length > 300, 'town should have real geometry');
  for (const b of MAP.solids) {
    for (let a = 0; a < 3; a++) {
      assert.ok(b.q[a] > b.p[a], `box ${b.id} (${b.mat}) is inside out on axis ${a}`);
      assert.ok(Number.isFinite(b.p[a]) && Number.isFinite(b.q[a]), `box ${b.id} has non-finite bounds`);
    }
  }
});

test('nobody spawns inside a wall', () => {
  for (const s of SPAWNS) {
    assert.equal(
      isBlocked(s.x, s.y, s.z, PLAYER.radius, PLAYER.height, MAP.solids),
      false,
      `spawn ${s.x},${s.z} is buried in geometry`,
    );
  }
});

test('no loot is buried inside the map', () => {
  // Loot is deliberately placed on bars, shelves and wagon beds, so we check the
  // item's own position is in open air rather than demanding clear floor.
  for (const l of LOOT_SPAWNS) {
    const buried = isBlocked(l.x, l.y + 0.25, l.z, 0.08, 0.2, MAP.solids);
    assert.equal(buried, false, `${l.type} at ${l.x},${l.y},${l.z} is embedded in geometry`);
  }
});

test('walls stop movement', () => {
  // Straight into a solid stretch of the saloon's south wall (x -26 is between
  // the door and the window), walked in realistic per-frame steps.
  let cur = { x: -26, y: 0, z: -6.5 };
  for (let i = 0; i < 24; i++) {
    cur = moveAndCollide(cur, { x: 0, y: 0, z: -0.2 }, PLAYER.radius, PLAYER.height, MAP.solids, PLAYER.stepHeight);
  }
  assert.ok(cur.z > -8.5, `walked through the saloon wall to z=${cur.z}`);
});

test('doorways let you through', () => {
  // The saloon's front door gap is at x -24..-20.6.
  let cur = { x: -22.3, y: 0, z: -6.5 };
  for (let i = 0; i < 24; i++) {
    cur = moveAndCollide(cur, { x: 0, y: 0, z: -0.2 }, PLAYER.radius, PLAYER.height, MAP.solids, PLAYER.stepHeight);
  }
  assert.ok(cur.z < -9, `could not walk through the saloon door, stopped at z=${cur.z}`);
});

test('line of sight is blocked by buildings and clear down the street', () => {
  const inSaloon = { x: -22, y: 1.6, z: -16 };
  const inStore = { x: 18, y: 1.6, z: -16 };
  assert.equal(lineOfSight(inSaloon, inStore, MAP.solids), false, 'saw through two buildings');

  const westStreet = { x: -30, y: 1.6, z: 0 };
  const eastStreet = { x: 20, y: 1.6, z: 0 };
  assert.equal(lineOfSight(westStreet, eastStreet, MAP.solids), true, 'Main Street should be a sightline');
});

test('raycast reports a hit in front of a wall, not behind it', () => {
  const hit = raycastWorld({ x: -22, y: 1.5, z: -6 }, { x: 0, y: 0, z: -1 }, 40, MAP.solids);
  assert.ok(hit, 'ray into the saloon wall found nothing');
  assert.ok(hit.t > 0 && hit.t < 40);
});

test('kill locations always name somewhere a player can go', () => {
  for (const [x, z] of [[0, 0], [-22, -16], [50, -18], [0, 20], [-70, 70], [65, -65], [0, 45]]) {
    const name = zoneAt(x, z, 0);
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 3, `zone name for ${x},${z} is useless: "${name}"`);
  }
});

test('role tables are balanced and complete', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const roles = rolesForPlayerCount(n);
    assert.equal(roles.length, n, `${n} players got ${roles.length} roles`);
    assert.equal(roles.filter((r) => r === 'sheriff').length, 1, `${n} players must have exactly one Sheriff`);
    assert.ok(roles.filter((r) => r === 'outlaw').length >= 1, `${n} players need Outlaws`);
    assert.ok(roles.filter((r) => r === 'renegade').length <= 1, `${n} players have too many Renegades`);
  }
  assert.deepEqual(Object.keys(ROLE_TABLE).map(Number).sort((a, b) => a - b), [4, 5, 6, 7, 8]);
});

test('nav graph reaches the whole town', () => {
  const nodes = NAV_NODES.filter((n) => !n.y || n.y < 1);
  const links = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
      if (d > 26) continue;
      if (!lineOfSight({ x: nodes[i].x, y: 1.1, z: nodes[i].z }, { x: nodes[j].x, y: 1.1, z: nodes[j].z }, MAP.solids)) continue;
      links[i].push(j); links[j].push(i);
    }
  }
  // Every node must link to something, or a bot that picks it as a destination
  // can never path there and will stand still for the rest of the round.
  const orphans = nodes.filter((n, i) => links[i].length === 0);
  assert.deepEqual(orphans, [], `nav nodes with no neighbours: ${orphans.map((n) => `${n.x},${n.z}`).join(' ')}`);

  // And the graph must be one connected town, not islands.
  const start = links.findIndex((l) => l.length > 0);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) for (const n of links[queue.pop()]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  assert.equal(seen.size, nodes.length, `only ${seen.size}/${nodes.length} nav nodes are reachable`);
});

test('every weapon is internally consistent', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.equal(w.id, id);
    assert.ok(w.magSize > 0 && w.reserve >= 0);
    assert.ok(w.falloffEnd > w.falloffStart, `${id} falloff is inverted`);
    assert.ok(w.range >= w.falloffStart, `${id} falls off past its own range`);
    assert.ok(w.fireInterval > 0 && w.reloadTime > 0);
    assert.ok(w.pellets >= 1);
  }
});

test('the sprint budget is a real constraint and always recovers', () => {
  // A tank that empties in less than a couple of seconds is a nuisance rather
  // than a decision, and one that refills faster than it drains is not a budget.
  assert.ok(PLAYER.staminaMax >= 3, 'a sprint shorter than three seconds is just a stutter');
  assert.ok(PLAYER.staminaRegen > 0 && PLAYER.staminaRegen < 1,
    'stamina must come back, but slower than it goes');
  assert.ok(PLAYER.staminaResume > 0 && PLAYER.staminaResume < PLAYER.staminaMax,
    'the resume threshold has to be reachable');

  // Drain it flat out at 60Hz, then walk it back.
  let s = PLAYER.staminaMax;
  let ticks = 0;
  while (s > 0 && ticks < 10000) { s = stepStamina(s, true, 1 / 60); ticks += 1; }
  assert.ok(Math.abs(ticks / 60 - PLAYER.staminaMax) < 0.1,
    `a full tank lasted ${(ticks / 60).toFixed(2)}s instead of ${PLAYER.staminaMax}s`);
  assert.equal(canSprint(s, true), false, 'an empty tank kept running');
  assert.equal(canSprint(s, false), false, 'an empty tank could start a new run');

  ticks = 0;
  while (!canSprint(s, false) && ticks < 10000) { s = stepStamina(s, false, 1 / 60); ticks += 1; }
  assert.ok(ticks < 10000, 'stamina never recovered enough to run again');
  assert.ok(s <= PLAYER.staminaMax, 'stamina overfilled');

  // And it never goes out of range whatever it is handed.
  for (const bad of [undefined, null, NaN, -50, 1e9]) {
    const out = stepStamina(bad, true, 0.05);
    assert.ok(out >= 0 && out <= PLAYER.staminaMax, `stepStamina(${bad}) escaped its range`);
  }
});
