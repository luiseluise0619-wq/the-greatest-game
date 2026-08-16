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
import { GLTFLoader } from '/vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '/vendor/jsm/utils/SkeletonUtils.js';

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
    for (const [state, clipName] of Object.entries(cfg.clips || {})) {
      const clip = byName.get(clipName) || gltf.animations.find((c) => c.name.toLowerCase() === String(clipName).toLowerCase());
      if (!clip) { console.warn(`[models] ${character}: no clip named "${clipName}"`); continue; }
      const action = rig.mixer.clipAction(clip);
      if (state === 'death') { action.loop = THREE.LoopOnce; action.clampWhenFinished = true; }
      rig.actions[state] = action;
    }
    if (!Object.keys(rig.actions).length) {
      rig.mixer = null;
      if (!cfg.bones) {
        console.warn(`[models] ${character}: file has clips but characters.json names none, and no bone map - it will not animate`);
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
