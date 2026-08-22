// Player settings. The store is local to the browser, but the part that decides
// what a stored value is allowed to be is pure, so it belongs in this suite:
// everything in here comes back out of localStorage, which anybody can edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { sanitise, DEFAULTS, LIMITS } = await import('../client/js/settings.js');

test('an empty or missing store gives the defaults', () => {
  for (const input of [undefined, null, 0, '', 'nonsense', []]) {
    assert.deepEqual(sanitise(input), DEFAULTS, `${JSON.stringify(input)} should fall back`);
  }
});

test('nothing out of storage can push a setting past its limits', () => {
  const wild = sanitise({
    sensitivity: 9999, fov: -400, volume: 12, adsScale: 0,
    invertY: 'yes', muted: 1, showFps: 'no',
  });
  assert.equal(wild.sensitivity, LIMITS.sensitivity.max);
  assert.equal(wild.fov, LIMITS.fov.min);
  assert.equal(wild.volume, 1);
  assert.ok(wild.adsScale >= 0.2, 'a zero ads scale would freeze the mouse down the sights');
  // Truthiness, not the raw value: a checkbox is a boolean by the time it lands.
  assert.equal(wild.invertY, true);
  assert.equal(wild.muted, true);
  assert.equal(wild.showFps, true);
});

test('garbage in one field does not take the others down with it', () => {
  const s = sanitise({ sensitivity: 'fast', fov: 92, volume: NaN });
  assert.equal(s.sensitivity, DEFAULTS.sensitivity, 'a bad number falls back on its own');
  assert.equal(s.fov, 92, 'a good neighbour survives');
  assert.equal(s.volume, DEFAULTS.volume);
});

test('the field of view stays a whole number of degrees', () => {
  assert.equal(sanitise({ fov: 88.7 }).fov, 89);
  assert.equal(Number.isInteger(sanitise({ fov: 70.2 }).fov), true);
});

test('every default sits inside its own slider', () => {
  for (const [key, lim] of Object.entries(LIMITS)) {
    assert.ok(DEFAULTS[key] >= lim.min && DEFAULTS[key] <= lim.max,
      `the default ${key} is not reachable with the ${key} control`);
  }
  // Round tripping a default must be a no-op, or the panel drifts on every load.
  assert.deepEqual(sanitise(DEFAULTS), DEFAULTS);
});
