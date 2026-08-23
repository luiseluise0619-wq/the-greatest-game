// The handful of rendering decisions that are really game rules wearing a
// costume. Anything that decides how much somebody can be identified from
// belongs in a test, not in the middle of a draw call.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tagOpacity, TAG_RANGE } = await import('../client/js/players.js');

test('a name tag fades out with distance and is gone past its range', () => {
  assert.equal(tagOpacity(0, false), 1, 'somebody in your face should be named');
  assert.equal(tagOpacity(TAG_RANGE, false), 0, 'a name was readable at the edge of its range');
  assert.equal(tagOpacity(TAG_RANGE + 50, false), 0);
  // Monotonic: no distance is easier to read than a closer one.
  let last = Infinity;
  for (let d = 0; d <= TAG_RANGE + 5; d += 0.5) {
    const op = tagOpacity(d, false);
    assert.ok(op <= last + 1e-9, `the tag got brighter going from ${d - 0.5}m to ${d}m`);
    assert.ok(op >= 0 && op <= 1);
    last = op;
  }
});

test('the dust cloud takes the name with it', () => {
  // The Gambler's dust boon drops a player's body to 42% opacity. A name tag at
  // full strength over the top of that gave the whole thing away: you could not
  // see the man, but you could read who he was.
  for (const d of [0, 1, 10, 33]) {
    assert.equal(tagOpacity(d, true), 0, `a dusty player was still named at ${d}m`);
  }
});

test('every material the map asks for is one the town knows how to draw', async () => {
  // world.js falls back to plain wood for an unknown tag, silently. Adding a
  // material in map.js and forgetting to give it a look is therefore invisible
  // until somebody notices the church is made of planks.
  const MAP = (await import('../shared/map.js')).default;
  const { MATS } = await import('../client/js/world.js');

  const used = new Set(MAP.solids.map((b) => b.mat));
  for (const tag of used) {
    assert.ok(MATS[tag], `the map is built out of "${tag}" and nothing knows what that looks like`);
  }
  // ...and nothing in the palette is dead weight.
  for (const tag of Object.keys(MATS)) {
    assert.ok(used.has(tag), `nothing in the town is made of "${tag}"`);
  }
});

test('nothing the HUD writes over the world is left to fend for itself', async () => {
  // Every one of these sits on top of the game, and half this town is sunlit
  // adobe. A pale letter on a pale wall is unreadable, so each needs either a
  // shadow under it or something opaque behind it. This is a real thing that
  // happened: the phase, the head count, the objective line and the weapon
  // name were the four that had neither.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../client/css/style.css', import.meta.url), 'utf8');

  // Selector -> the declarations of every rule that names it, joined.
  const rules = new Map();
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const one of sel.split(',')) {
      const key = one.trim();
      if (!key) continue;
      rules.set(key, (rules.get(key) || '') + body);
    }
  }
  const declaredFor = (id) => [...rules.entries()]
    .filter(([sel]) => sel.split(/\s+/).some((part) => part === id || part.startsWith(`${id}:`)))
    .map(([, body]) => body).join('');

  const overTheWorld = [
    '#phaseLabel', '#timer', '#standing', '#objective',
    '#weaponName', '#ammo', '#dynCount', '#healthNum',
  ];
  for (const id of overTheWorld) {
    const decl = declaredFor(id);
    assert.ok(decl, `${id} is in the HUD and the stylesheet has never heard of it`);
    assert.ok(/text-shadow|background/.test(decl),
      `${id} is written straight onto the world with nothing to lift it off`);
  }
});
