// Optional glTF character models.
//
// The game ships no art, so by default every gunhand is the procedural rig in
// players.js. Drop .glb files into client/models/ and describe them in
// client/models/characters.json and they are used instead - see the README in
// that folder for the schema.
//
// Two levels of support, so almost any rigged model works:
//   1. the model carries animation clips  -> we drive an AnimationMixer
//   2. it does not, but exposes named bones -> we drive those bones with the
//      exact same pose the procedural rig uses
// A model with neither still loads; it just stands there and slides.

import * as THREE from 'three';

// The loader and the skinned-mesh cloner are pulled in on demand rather than at
// module load. Almost nobody configures glTF models - the game ships none - so
// this is two fetches everyone else does not make, and it keeps this module
// importable outside a browser, which is what lets the render helpers next door
// be unit tested at all.
let GLTFLoader = null;
let cloneSkinned = null;
async function loadAddons() {
  if (GLTFLoader && cloneSkinned) return true;
  try {
    [{ GLTFLoader }, { clone: cloneSkinned }] = await Promise.all([
      import('/vendor/jsm/loaders/GLTFLoader.js'),
      import('/vendor/jsm/utils/SkeletonUtils.js'),
    ]);
    return true;
  } catch (err) {
    console.warn('[models] could not load the glTF addons - staying procedural', err);
    return false;
  }
}

const CONFIG_URL = '/client/models/characters.json';

/** character id -> { config, gltf } once loaded */
const loaded = new Map();
let config = null;
let readyPromise = null;

export function modelsReady() { return readyPromise || Promise.resolve(); }
export function hasModelFor(character) { return loaded.has(character); }

/**
 * Fetch the config and preload every model it names. Missing config, missing
 * files and broken models are all non-fatal: those characters stay procedural.
 */
export function initCharacterModels() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-cache' });
      if (!res.ok) return;
      config = await res.json();
    } catch {
      return;                                   // no config: procedural for everyone
    }
    const entries = Object.entries(config || {}).filter(([k]) => !k.startsWith('$'));
    if (!entries.length) return;

    if (!await loadAddons()) return;
    const loader = new GLTFLoader();
    await Promise.all(entries.map(async ([character, cfg]) => {
      if (!cfg || !cfg.url) return;
      try {
        const gltf = await loader.loadAsync(cfg.url);
        loaded.set(character, { cfg, gltf });
        console.info(`[models] ${character}: loaded ${cfg.url} (${gltf.animations.length} clips)`);
      } catch (err) {
        console.warn(`[models] ${character}: could not load ${cfg.url} - staying procedural`, err);
      }
    }));
  })();
  return readyPromise;
}

/**
 * Build a per-player instance of a configured model.
 * Returns null when that character has no model, so the caller falls back.
 */
export function makeModelRig(character) {
  const entry = loaded.get(character);
  if (!entry) return null;
  const { cfg, gltf } = entry;

  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  model.scale.setScalar(cfg.scale ?? 1);
  model.position.set(cfg.offset?.[0] ?? 0, cfg.offset?.[1] ?? 0, cfg.offset?.[2] ?? 0);
  // Models are authored facing every which way; ours face -Z.
  model.rotation.y = (cfg.rotationY ?? 0) * Math.PI / 180;
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  root.add(model);

  const rig = { root, model, cfg, mixer: null, actions: {}, current: null, bones: null, materials: [] };

  // How tall he actually came out. This game expects a man about 1.8m, and a
  // model authored in centimetres, inches or Blender units is the commonest
  // thing that goes wrong when somebody drops one in - it is also the hardest
  // to diagnose from the screen, because the answer looks like "my character
  // is a dot on the floor" or "my character is a wall" rather than like a
  // number being wrong. So measure it once and say what scale would fix it.
  measureOnce(character, model, cfg);

  model.traverse((o) => {
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!rig.materials.includes(m)) rig.materials.push(m);
      }
    }
  });

  if (gltf.animations?.length) {
    rig.mixer = new THREE.AnimationMixer(model);
    const byName = new Map(gltf.animations.map((c) => [c.name, c]));
    // What is actually in the file, for the warnings below. Somebody whose
    // config does not match should not have to open a glTF inspector to find
    // out what they were supposed to type: a real export's clips are called
    // things nobody would guess, and plenty of them are not called anything at
    // all - Khronos's own CesiumMan has exactly one clip and it is unnamed.
    const available = gltf.animations.map((c, i) => `${i}: ${c.name || '(unnamed)'}`);
    for (const [state, want] of Object.entries(cfg.clips || {})) {
      // An index is allowed as well as a name, which is the only thing that can
      // address a clip with no name.
      const clip = Number.isInteger(want) ? gltf.animations[want]
        : byName.get(want)
          || gltf.animations.find((c) => c.name.toLowerCase() === String(want).toLowerCase());
      if (!clip) {
        console.warn(`[models] ${character}: no clip "${want}" - this file has ${available.join(', ')}`);
        continue;
      }
      const action = rig.mixer.clipAction(clip);
      if (state === 'death') { action.loop = THREE.LoopOnce; action.clampWhenFinished = true; }
      // A stagger and a card going down are moments, not states: they play
      // once and hand the body back rather than looping until something else
      // interrupts them.
      if (state === 'hit' || state === 'play') { action.loop = THREE.LoopOnce; }
      rig.actions[state] = action;
    }
    // Nothing matched, and the file has exactly one clip. There is nothing to
    // choose between, so choose it: a man looping his only animation is a
    // better answer than a man standing rigid, and it is what somebody
    // dropping in a one-clip export meant to happen.
    if (!Object.keys(rig.actions).length && gltf.animations.length === 1 && !cfg.bones) {
      rig.actions.idle = rig.mixer.clipAction(gltf.animations[0]);
      console.info(`[models] ${character}: nothing matched, and the file has one clip (${available[0]}) - using it as idle`);
    }
    if (!Object.keys(rig.actions).length) {
      rig.mixer = null;
      if (!cfg.bones) {
        console.warn(`[models] ${character}: named no clip this file has (${available.join(', ')}) and gave no bone map - it will not animate`);
      }
    }
  }

  if (cfg.bones) {
    rig.bones = {};
    for (const [slot, boneName] of Object.entries(cfg.bones)) {
      const bone = model.getObjectByName(boneName);
      if (bone) rig.bones[slot] = bone;
      else console.warn(`[models] ${character}: no bone named "${boneName}"`);
    }
    // Remember the bind height so crouch and the death collapse are applied as
    // an offset rather than snapping the hips to the floor.
    rig.rootBoneBaseY = rig.bones.root ? rig.bones.root.position.y : 0;
  }

  if (cfg.gunBone) {
    rig.gunAttach = model.getObjectByName(cfg.gunBone) || null;
    if (!rig.gunAttach) console.warn(`[models] ${character}: no gun bone "${cfg.gunBone}"`);
  }
  if (cfg.starBone) rig.starAttach = model.getObjectByName(cfg.starBone) || null;

  return rig;
}

/** Crossfade to a named state ('idle' | 'walk' | 'run' | 'aim' | 'death'). */
/**
 * How big this model is as it was authored, in metres after `scale`.
 *
 * NOT Box3.setFromObject. On a skinned mesh that follows the live skeleton, so
 * it answers a different question every time depending on what pose the shared
 * skeleton happens to be holding - measured across four scales of the same
 * file it returned 1.8, 1.25, 10.4 and 31.2, which is not a measurement, it is
 * a number. And a confidently wrong suggestion is worse than no suggestion.
 *
 * The authored size is in the geometry, in bind pose, so read that: every
 * mesh's own bounding box, put through its transform relative to the model
 * root. Skinning cannot move it and neither can the animation.
 */
function measureModel(model) {
  model.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  let any = false;
  model.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return;
    // The mesh's own box, into the model's space, corner by corner so a
    // rotation on the way cannot shrink it.
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      ).applyMatrix4(m);
      box.expandByPoint(corner);
      any = true;
    }
  });
  if (!any) return null;
  // Back out to metres: the box is in the model's own space, and the model
  // carries the configured scale.
  const s = model.scale;
  box.min.multiply(s);
  box.max.multiply(s);
  return box;
}

/**
 * Exported for the test. Measuring a rigged model is the one thing in this
 * file that is arithmetic rather than plumbing, and it got the wrong answer
 * confidently once already.
 */
export const measureForTest = measureModel;

/** Characters already measured, so eight men do not print the same warning. */
const measured = new Set();

function measureOnce(character, model, cfg) {
  if (measured.has(character)) return;
  measured.add(character);
  const box = measureModel(model);
  if (!box || !Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return;
  const h = box.max.y - box.min.y;
  if (!(h > 0)) return;
  const WANT = 1.8;
  if (h > 1.2 && h < 2.6) {
    // Near enough. Say the number anyway - it is the one measurement anybody
    // configuring a model actually wants and it costs a line.
    console.info(`[models] ${character}: ${h.toFixed(2)}m tall`);
    return;
  }
  const fix = (cfg.scale ?? 1) * (WANT / h);
  console.warn(
    `[models] ${character}: ${h.toFixed(2)}m tall, and this town is built for a man about ${WANT}m. `
    + `Try "scale": ${Number(fix.toPrecision(3))} in characters.json.`,
  );
  // And whether his feet are anywhere near the floor, which `offset` is for.
  if (Math.abs(box.min.y) > 0.3) {
    console.warn(
      `[models] ${character}: his feet sit at y=${box.min.y.toFixed(2)} rather than 0 - `
      + `"offset": [0, ${Number((-box.min.y).toPrecision(3))}, 0] puts them on the ground.`,
    );
  }
}

export function playState(rig, state, fade = 0.22) {
  if (!rig.mixer) return false;
  const next = rig.actions[state] || rig.actions.idle;
  if (!next || next === rig.current) return !!next;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (rig.current) rig.current.fadeOut(fade);
  rig.current = next;
  return true;
}

/**
 * Drive a rigged model that came without clips, using the same pose the
 * procedural gunhand uses. Bone slots are the ones named in characters.json.
 */
export function applyPoseToBones(rig, pose) {
  const b = rig.bones;
  if (!b) return;
  const set = (bone, x = 0, y = 0, z = 0) => { if (bone) bone.rotation.set(x, y, z); };
  set(b.spine, pose.spine.x, 0, pose.spine.z);
  set(b.neck, pose.neck.x);
  set(b.hipL, pose.legL.hip);
  set(b.kneeL, pose.legL.knee);
  set(b.ankleL, pose.legL.ankle);
  set(b.hipR, pose.legR.hip);
  set(b.kneeR, pose.legR.knee);
  set(b.ankleR, pose.legR.ankle);
  set(b.shoulderL, pose.armL.shoulder, 0, pose.armL.z);
  set(b.elbowL, pose.armL.elbow);
  set(b.shoulderR, pose.armR.shoulder, 0, pose.armR.z);
  set(b.elbowR, pose.armR.elbow);
  if (b.root) b.root.position.y = rig.rootBoneBaseY + pose.rootY;
}
