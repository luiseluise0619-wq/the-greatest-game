// The handful of rendering decisions that are really game rules wearing a
// costume. Anything that decides how much somebody can be identified from
// belongs in a test, not in the middle of a draw call.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { tagOpacity, TAG_RANGE } = await import('../client/js/players.js');

const { readFile } = await import('node:fs/promises');
const HTML = await readFile(new URL('../client/index.html', import.meta.url), 'utf8');

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

// ------------------------------------------------------------ dropped-in models
//
// The one thing in the glTF path that is arithmetic rather than plumbing: how
// tall the model somebody dropped in actually came out. The console prints it
// and suggests the `scale` that would fix it, and a confidently wrong
// suggestion is worse than no suggestion at all.
//
// The obvious implementation — Box3.setFromObject — is the wrong one. On a
// skinned mesh that follows the live skeleton, so it answers a different
// question depending on what pose the shared skeleton happens to be holding:
// measured across four scales of the same file it returned 1.8, 1.25, 10.4 and
// 31.2 metres. Not a measurement, just a number. This reads the authored
// geometry in bind pose instead, where skinning cannot reach it.
const { measureForTest } = await import('../client/js/charmodels.js');
const THREE = await import('three');

/** A man-shaped thing, feet on the floor, at a given scale. */
function dummy(scale = 1, { feetAt = 0, height = 1.8, rot = 0 } = {}) {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, height, 0.3));
  mesh.position.y = feetAt + height / 2;
  mesh.rotation.y = rot;
  root.add(mesh);
  root.scale.setScalar(scale);
  return root;
}

test('a dropped-in model is measured in metres, and the number tracks scale', () => {
  // Relative, because a geometry's bounding box is single-precision floats and
  // a hundredfold scale carries that error up with it. What is being checked
  // is that the number tracks, not that it is exact to the micron.
  for (const s of [0.01, 1, 2, 5, 100]) {
    const box = measureForTest(dummy(s));
    const h = box.max.y - box.min.y;
    assert.ok(Math.abs(h - 1.8 * s) < 1.8 * s * 1e-5,
      `at scale ${s} a 1.8m man measured ${h} — the suggestion built on this would be wrong`);
    assert.ok(Math.abs(box.min.y) < 1e-5 * Math.max(1, s), `and his feet were at ${box.min.y}`);
  }
});

test('and it says where the feet are, which is what offset is for', () => {
  const box = measureForTest(dummy(1, { feetAt: -0.6 }));
  assert.ok(Math.abs(box.min.y + 0.6) < 1e-6, `feet measured at ${box.min.y}, not -0.6`);
  assert.ok(Math.abs((box.max.y - box.min.y) - 1.8) < 1e-6, 'and the height moved with them');
});

test('a rotation on the way down cannot shrink the man', () => {
  // The box is built corner by corner rather than from min/max directly, so a
  // model whose mesh is turned inside its own hierarchy still measures 1.8m
  // rather than something narrower.
  const h = (rot) => {
    const box = measureForTest(dummy(1, { rot }));
    return box.max.y - box.min.y;
  };
  for (const rot of [0, Math.PI / 4, Math.PI / 2, 1.1]) {
    assert.ok(Math.abs(h(rot) - 1.8) < 1e-6, `turned ${rot} radians he measured ${h(rot)}m`);
  }
});

test('nothing to measure is answered with nothing, not with a guess', () => {
  assert.equal(measureForTest(new THREE.Group()), null,
    'an empty model produced a measurement, and a suggestion would follow it');
});

test('the parts of the page a screen reader has to hear are announced', () => {
  // This is a first-person game played through pointer lock, and no amount of
  // markup makes mouse-look accessible. The lobby, the menus and everything the
  // town SAYS are ordinary HTML, though, and they were silent: no live regions
  // anywhere, so a screen reader announced none of the feed, none of the chat,
  // and neither of the two banners that exist specifically to tell somebody
  // that something has gone wrong.
  const live = {
    feed: 'polite',          // what the town says happened
    chatLog: 'polite',       // what people said
    menuStatus: 'polite',    // wrong room code, connection state
    netBanner: 'assertive',  // the socket has gone
    deadBanner: 'assertive', // and so have you
  };
  for (const [id, level] of Object.entries(live)) {
    const el = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(HTML);
    assert.ok(el, `#${id} is gone from the page`);
    assert.match(el[0], new RegExp(`aria-live="${level}"`),
      `#${id} says things and nothing announces them`);
  }
});

test('nothing that is only an icon is unlabelled', () => {
  // A button whose whole face is "−" reads as "minus".
  for (const id of ['botMinus', 'botPlus', 'joinCode', 'chatInput']) {
    const el = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(HTML);
    assert.ok(el, `#${id} is gone from the page`);
    assert.match(el[0], /aria-label="/, `#${id} has no name to read out`);
    // And that name is a user-facing string like any other, so it goes through
    // the overlay rather than being English for ever.
    assert.match(el[0], /data-i18n-aria="/,
      `#${id} has a label and it is English whatever language you asked for`);
  }
});
