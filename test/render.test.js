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
