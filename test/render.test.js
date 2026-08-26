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
  const declaredFor = (want) => [...rules.entries()]
    .filter(([sel]) => sel === want
      || sel.split(/\s+/).some((part) => part === want || part.startsWith(`${want}:`)))
    .map(([, body]) => body).join('');

  const overTheWorld = [
    '#phaseLabel', '#timer', '#standing', '#objective',
    '#weaponName', '#ammo', '#dynCount', '#healthNum',
    // The killcam plays over the street too, and its own caption - who killed
    // you and where - was the palest thing on the screen.
    '.kcTop b', '.kcTop span', '.kcName', '.kcSkip',
  ];
  for (const sel of overTheWorld) {
    const decl = declaredFor(sel);
    assert.ok(decl, `${sel} is in the HUD and the stylesheet has never heard of it`);
    assert.ok(/text-shadow|background/.test(decl),
      `${sel} is written straight onto the world with nothing to lift it off`);
  }
});

// ---------------------------------------------------------------- the body
//
// The mode this game is played in by default has nobody walking. Everyone is
// dealt a mark and stands on it for the whole round, so the walk cycle that is
// most of players.js never runs — and for four minutes eight men stood
// perfectly still while the round they were in happened entirely on a HUD.
//
// Everything below is the body saying what the HUD was saying alone. It is
// tested here rather than looked at because it is the most intricate maths in
// the client, and because "does the arm move" is a question with an answer.
const { computePose, poseState } = await import('../client/js/players.js');

/** A man standing still, doing nothing, with nothing happening to him. */
const still = (over = {}) => ({
  crouch: false, moving: false, sprint: false, firing: false,
  pitch: 0, renderTime: 5, dying: 0, ...over,
});

/** Run a pose forward a few frames so the blends have somewhere to get to. */
function settle(a, f, frames = 40) {
  let pose = null;
  for (let i = 0; i < frames; i += 1) {
    pose = computePose(a, { ...f, renderTime: 5 + i / 60 }, 1 / 60);
  }
  return pose;
}

test('a man standing still is not a fencepost', () => {
  // Breath, and a weight change from one foot to the other every few seconds.
  // Without this the default mode is a diorama.
  const a = poseState(7);
  const seen = new Set();
  for (let i = 0; i < 600; i += 1) {
    const p = computePose(a, still({ renderTime: i / 30 }), 1 / 30);
    seen.add(p.rootY.toFixed(4));
  }
  assert.ok(seen.size > 20, `a man stood perfectly still for twenty seconds (${seen.size} poses)`);

  // And the weight really does change sides rather than drifting one way.
  const b = poseState(11);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 3000; i += 1) {
    const p = computePose(b, still({ renderTime: i / 30 }), 1 / 30);
    lo = Math.min(lo, p.spine.z); hi = Math.max(hi, p.spine.z);
  }
  assert.ok(lo < -0.005 && hi > 0.005, `his weight never changed feet (${lo} to ${hi})`);
});

test('a hit lands on the body, not only on the health bar', () => {
  const a = poseState(3);
  const calm = settle(a, still());
  const b = poseState(3);
  settle(b, still());
  const struck = computePose(b, still({ sinceHit: 0.12 }), 1 / 60);

  assert.ok(struck.spine.x < calm.spine.x - 0.05, 'nothing in him moved when he was shot');
  assert.ok(struck.neck.x > calm.neck.x + 0.05, 'and his head stayed level through it');
  assert.ok(struck.armR.shoulder < calm.armR.shoulder - 0.05, 'and his gun arm never moved');

  // And it is over quickly - a stagger, not a state.
  const after = computePose(b, still({ sinceHit: 1.2 }), 1 / 60);
  assert.ok(Math.abs(after.spine.x - calm.spine.x) < 0.02, 'he never straightened up again');
});

test('the draw is a movement, not a fade', () => {
  // The gun coming up is the only warning anybody at a table gets, so it has to
  // arrive rather than appear. It overshoots and settles, the way a hand does.
  const a = poseState(5);
  settle(a, still());
  const low = computePose(a, still(), 1 / 60).armR.shoulder;

  const b = poseState(5);
  settle(b, still());
  let peak = 0;
  const track = [];
  for (let i = 0; i < 60; i += 1) {
    const p = computePose(b, still({ gunUp: true, sinceDraw: i / 60, renderTime: 5 + i / 60 }), 1 / 60);
    track.push(p.armR.shoulder);
    peak = Math.min(peak, p.armR.shoulder);
  }
  const settled = track[track.length - 1];
  assert.ok(settled < low - 0.5, `the gun never came up (${low} -> ${settled})`);
  assert.ok(peak < settled - 0.01, 'it faded into position instead of arriving');
});

test('a card leaves the hand that is not holding the gun', () => {
  // Both men the same age in frames, or the aim blend is still converging in
  // one of them and the difference measured is that rather than the card.
  const a = poseState(9);
  settle(a, still({ gunUp: true }));
  const calm = computePose(a, still({ gunUp: true }), 1 / 60);
  const b = poseState(9);
  settle(b, still({ gunUp: true }));
  const playing = computePose(b, still({ gunUp: true, sincePlayed: 0.25 }), 1 / 60);

  assert.ok(playing.armL.shoulder < calm.armL.shoulder - 0.2,
    'a card was played and nobody moved');
  assert.ok(Math.abs(playing.armR.shoulder - calm.armR.shoulder) < 1e-9,
    'and it moved the hand holding the gun');
});

test('the man whose floor it is stands like it', () => {
  const a = poseState(2);
  const watching = settle(a, still());
  const b = poseState(2);
  const holding = settle(b, still({ onFloor: true }));
  assert.ok(holding.spine.x > watching.spine.x + 0.02,
    'the man with the only live gun in town stood exactly like the men watching him');
});

test('every joint stays a number, whatever happens at once', () => {
  // These are fed to a rotation, and one NaN is a limb that vanishes.
  const a = poseState(13);
  const wild = {
    crouch: true, moving: true, sprint: true, firing: true, pitch: -1.2,
    renderTime: 400, dying: 0.5, sinceHit: 0.01, sinceDraw: 0.02,
    sincePlayed: 0.03, onFloor: true, gunUp: true,
  };
  for (let i = 0; i < 120; i += 1) {
    const p = computePose(a, { ...wild, renderTime: 400 + i / 60 }, 1 / 60);
    const flat = [p.rootY, p.spine.x, p.spine.z, p.neck.x, p.coatSway,
      ...[p.legL, p.legR].flatMap((l) => [l.hip, l.knee, l.ankle, l.drop]),
      ...[p.armL, p.armR].flatMap((r) => [r.shoulder, r.elbow, r.z])];
    for (const n of flat) assert.ok(Number.isFinite(n), `a joint came out ${n}`);
  }
});
