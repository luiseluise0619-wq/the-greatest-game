// The map and the maths every other system is built on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import MAP, { zoneAt, SPAWNS, LOOT_SPAWNS, NAV_NODES, ZONES } from '../shared/map.js';
import { moveAndCollide, raycastWorld, lineOfSight, isBlocked } from '../shared/collision.js';
import {
  PLAYER, ROLE_TABLE, MIN_PLAYERS, MAX_PLAYERS, rolesForPlayerCount, WEAPONS,
  stepStamina, canSprint, swapTime, CHARACTERS, VISION,
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

test('every place the town is supposed to have is real and can be stood in', () => {
  // The brief asked for these by name. A zone the kill feed can name but nobody
  // can walk to is worse than no zone at all: it sends people looking for a
  // body in a place that does not exist.
  const wanted = [
    'the Saloon', "the Sheriff's Office", 'the General Store', 'the Stable',
    'the Church', 'the Cemetery', 'the Mine', 'Main Street', 'the back alleys',
  ];
  for (const name of wanted) {
    const zone = ZONES.find((z) => z.name === name);
    assert.ok(zone, `the town has no ${name}`);

    // Somewhere inside it has to be standable, or it is scenery.
    let standable = 0;
    for (let x = zone.x0 + 1; x <= zone.x1 - 1; x += 2) {
      for (let z = zone.z0 + 1; z <= zone.z1 - 1; z += 2) {
        if (!isBlocked(x, 0.1, z, PLAYER.radius, PLAYER.height, MAP.solids)) standable++;
      }
    }
    assert.ok(standable > 3, `${name} has almost nowhere to stand (${standable} spots)`);
    // ...and it must report itself, not a neighbour.
    const cx = (zone.x0 + zone.x1) / 2, cz = (zone.z0 + zone.z1) / 2;
    assert.equal(zoneAt(cx, cz, 0), name, `standing in the middle of ${name} reports somewhere else`);
  }

  // The other two the brief named are not rectangles: one is a height, the
  // other is everything that is not the town.
  const roof = zoneAt(0, 20, 9);
  assert.ok(roof.includes('rooftops'), `up on the church roof reads as "${roof}"`);
  assert.equal(zoneAt(400, 400, 0), 'the desert outskirts');
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

test('the swap lockout is one rule, not two', () => {
  // The client predicts it and the server enforces it. A client that thought it
  // was shorter would fire shots the server threw away: a flash, a bang, a round
  // off the counter, and no bullet anywhere.
  for (const slot of Object.keys(WEAPONS)) {
    for (const character of Object.keys(CHARACTERS)) {
      const t = swapTime(slot, character);
      assert.ok(t > 0, `${character} bringing up a ${slot} takes no time at all`);
      assert.ok(t <= WEAPONS[slot].swapTime, `${character} is slower than the gun's own swap time`);
    }
  }
  // Hair Trigger is the only thing that moves it, and it halves it.
  assert.equal(swapTime('rifle', 'gunslinger'), WEAPONS.rifle.swapTime * 0.5);
  assert.equal(swapTime('rifle', 'medic'), WEAPONS.rifle.swapTime);
  // Nonsense in, zero out, rather than NaN into somebody's fire timer.
  assert.equal(swapTime('trebuchet', 'medic'), 0);
});

test('a bot cannot see as far as a player can shoot', () => {
  // Bots noticing everything the renderer draws would take the roofs and the
  // long lines down Main Street away from human players entirely. The gap is
  // the point, so it should not close by accident.
  assert.ok(VISION.botSight < VISION.far, 'bots see as far as the game sends');
  const longest = Math.max(...Object.values(WEAPONS).map((w) => w.falloffEnd));
  assert.ok(VISION.botSight < longest,
    `a bot notices you at ${VISION.botSight}m and the longest gun still bites at ${longest}m`);
  assert.ok(VISION.botSight > 40, 'bots this blind would never find anybody');
});

test('nothing in shared/ reaches for Node', async () => {
  // shared/ is imported by the browser as-is, with no build step. One
  // `process.env` in here and the module fails to evaluate, which does not
  // break a test - it breaks the entire game, silently, for every player.
  const { readFile } = await import('node:fs/promises');
  const files = ['constants.js', 'map.js', 'collision.js', 'protocol.js'];
  for (const f of files) {
    const src = await readFile(new URL(`../shared/${f}`, import.meta.url), 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const nodeism of ['process.', 'require(', '__dirname', 'node:']) {
      assert.equal(stripped.includes(nodeism), false,
        `shared/${f} uses ${nodeism} - the browser imports this file directly`);
    }
  }
});

test('everywhere in town reads as a place a sentence can end with', async () => {
  // The feed writes "died <place>", and zoneAt has five shapes, three of which
  // already begin with a word of their own. Gluing "in " onto the front of all
  // of them announced that somebody had died IN JUST OUTSIDE the Church.
  const { zoneAt, placePhrase, ZONES, bounds } = await import('../shared/map.js')
    .then((m) => ({ ...m, bounds: m.default.bounds }));

  const STARTS = ['in ', 'on ', 'at ', 'just outside '];
  const seen = new Set();
  for (let x = bounds.min; x <= bounds.max; x += 3) {
    for (let z = bounds.min; z <= bounds.max; z += 3) {
      for (const y of [0, 6]) {
        const place = zoneAt(x, z, y);
        const phrase = placePhrase(place);
        seen.add(phrase.replace(/the \w+ between .* and/, 'the X between Y and'));
        assert.ok(STARTS.some((s) => phrase.startsWith(s)),
          `"died ${phrase}" at ${x},${z} starts with nothing`);
        // Two prepositions in a row is the bug this exists for.
        assert.ok(!/^(in|on|at) (in|on|at|just) /.test(phrase),
          `"died ${phrase}" says it twice`);
        assert.ok(phrase.endsWith(place), `the phrase lost the place: "${phrase}" / "${place}"`);
      }
    }
  }
  assert.ok(seen.size >= 5, `only ${seen.size} kinds of place turned up: ${[...seen]}`);

  // And the two zones that do not take "in" keep the word they were given.
  assert.equal(placePhrase('Main Street'), 'on Main Street');
  assert.equal(placePhrase('the water tower'), 'at the water tower');
  for (const z of ZONES) {
    assert.ok(placePhrase(z.name).endsWith(z.name), `${z.name} lost its own name`);
  }
  // Nothing at all is still nothing, not "in undefined".
  assert.equal(placePhrase(undefined), '');
  assert.equal(placePhrase(''), '');
});
