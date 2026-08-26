// Remote gunhands.
//
// Two rigs, one pose. `computePose()` works out where every joint should be for
// this frame; it is then applied either to the procedural gunhand built below
// (capsules and surfaces of revolution, since the project ships no art) or to a
// glTF model you dropped into client/models/ - see charmodels.js.
//
// Silhouette does the heavy lifting either way: every character has a different
// hat profile, coat length and build, because the whole social layer collapses
// if you cannot tell eight strangers apart across Main Street.

import * as THREE from 'three';
import { CHARACTERS } from '../../shared/constants.js';
import { makeModelRig, playState, applyPoseToBones } from './charmodels.js';

// ---------------------------------------------------------------------------
// Skeleton proportions, in metres, for a 1.8m gunhand standing at y=0.
// ---------------------------------------------------------------------------
const S = {
  hip: 0.94, knee: 0.52, ankle: 0.155,
  waist: 0.94, chest: 1.22, shoulder: 1.42, neck: 1.50, head: 1.635,
  hipWidth: 0.105, shoulderWidth: 0.195,
  thigh: 0.42, shin: 0.365, upperArm: 0.28, forearm: 0.25,
};

// Per-character costume. This is the identification system, not decoration.
const LOOK = {
  gunslinger: {
    build: 1.04, coat: 'duster', coatLen: 0.66, coatFlare: 1.5,
    hat: { brim: 0.315, crown: 0.165, dent: 0.55 },
    extras: ['gunbelt', 'stubble'],
  },
  medic: {
    build: 0.94, coat: 'apron', coatLen: 0.46, coatFlare: 1.1,
    hat: { brim: 0.165, crown: 0.205, dent: 0.15, round: true },   // bowler
    extras: ['satchel', 'specs', 'apron'],
  },
  scout: {
    build: 0.95, coat: 'jacket', coatLen: 0.24, coatFlare: 1.2,
    hat: { brim: 0.255, crown: 0.10, dent: 0.35, tilt: 0.16 },
    extras: ['feather', 'scarf'],
  },
  duelist: {
    build: 1.02, coat: 'frock', coatLen: 0.60, coatFlare: 1.15,
    hat: { brim: 0.225, crown: 0.275, dent: 0.25 },                // tall crown
    extras: ['cravat'],
  },
  gambler: {
    build: 1.00, coat: 'frock', coatLen: 0.50, coatFlare: 1.35,
    hat: { brim: 0.285, crown: 0.185, dent: 0.1, flat: true },
    extras: ['vest', 'cravat'],
  },
  tracker: {
    build: 1.07, coat: 'fur', coatLen: 0.44, coatFlare: 1.3,
    hat: { brim: 0.33, crown: 0.105, dent: 0.5, tilt: 0.1 },       // wide and low
    extras: ['hair', 'satchel'],
  },
};

// ---------------------------------------------------------------------------
// Geometry cache - eight players share one set of shapes.
// ---------------------------------------------------------------------------
const geoCache = new Map();
/** Everything computePose carries between frames, for one man. */
export function poseState(seed = Math.random() * 100) {
  return {
    walkPhase: seed % 6,
    aimBlend: 0,
    crouchBlend: 0,
    floorBlend: 0,
    hitAt: -99, drewAt: -99, playedAt: -99,
    idleSeed: seed,
    shiftAt: 0, shift: 0, shiftTo: 0,
  };
}

function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const capsule = (r, len, key) => cached(`cap${key}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphere = (r, key) => cached(`sph${key}`, () => new THREE.SphereGeometry(r, 12, 9));
const latheGeo = (key, pts, seg = 18) =>
  cached(key, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));

/** A hat: curved brim with an upturned edge, dented crown. */
function buildHat(cfg, hatMat, accentMat) {
  const g = new THREE.Group();
  const br = cfg.brim, cr = 0.128, ch = cfg.crown;
  const key = `${br}_${ch}_${cfg.dent}_${cfg.flat ? 'f' : ''}${cfg.round ? 'r' : ''}`;

  const crownPts = cfg.round
    ? [[0, ch], [cr * 0.55, ch * 0.99], [cr * 0.9, ch * 0.82], [cr, ch * 0.4], [cr, 0]]
    : cfg.flat
      ? [[0, ch], [cr * 0.95, ch], [cr, ch * 0.9], [cr, 0]]
      : [[0, ch * (1 - cfg.dent * 0.22)], [cr * 0.42, ch], [cr * 0.86, ch * 0.96], [cr, ch * 0.55], [cr, 0]];
  const crown = new THREE.Mesh(latheGeo(`crown${key}`, crownPts), hatMat);
  crown.castShadow = true;
  g.add(crown);

  const brimPts = [
    [cr * 0.99, 0.014], [br * 0.62, -0.008], [br * 0.9, 0.006], [br, 0.038],
    [br * 0.985, 0.05], [br * 0.88, 0.028], [br * 0.6, 0.014], [cr * 0.99, 0.036],
  ];
  const brim = new THREE.Mesh(latheGeo(`brim${key}`, brimPts), hatMat);
  brim.castShadow = true;
  brim.material.side = THREE.DoubleSide;
  g.add(brim);

  const band = new THREE.Mesh(
    cached(`band${cr}`, () => new THREE.CylinderGeometry(cr * 1.03, cr * 1.03, 0.035, 16)),
    accentMat,
  );
  band.position.y = 0.045;
  g.add(band);
  return g;
}

/**
 * How readable somebody's name is from here.
 *
 * The dust cloud is the whole reason this is a function: it drops a player's
 * body to 42% opacity, and a floating name tag at full strength over the top of
 * that gave the boon away completely - you could not see the man but you could
 * read his name. In a game about not knowing who somebody is, the dust takes
 * the name with it.
 */
export const TAG_RANGE = 34;

export function tagOpacity(dist, dusty, maxDist = TAG_RANGE) {
  if (dusty) return 0;
  return Math.max(0, Math.min(1, (maxDist - dist) / 10));
}

/** Coat/duster/apron: a flared surface of revolution hanging from the waist. */
function buildCoat(look, mat) {
  const len = look.coatLen, flare = look.coatFlare;
  const top = 0.20 * look.build;
  const pts = [
    [top, 0], [top * 1.03, -len * 0.28], [top * flare * 0.82, -len * 0.62],
    [top * flare, -len * 0.94], [top * flare * 0.99, -len],
  ];
  const m = new THREE.Mesh(latheGeo(`coat${len}${flare}${top}`, pts, 20), mat);
  m.material.side = THREE.DoubleSide;
  m.castShadow = true;
  return m;
}

function nameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(8,6,4,0.9)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#efe2c6';
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  // depthTest stays ON: a name you can read through a wall is a wallhack.
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  spr.scale.set(2.6, 0.65, 1);
  return spr;
}

function gunMesh() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x413a33, roughness: 0.55, metalness: 0.45 });
  const barrel = new THREE.Mesh(cached('gunbar', () => new THREE.CylinderGeometry(0.019, 0.019, 0.34, 8)), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.14;
  barrel.castShadow = true;
  const stock = new THREE.Mesh(
    cached('gunstock', () => new THREE.BoxGeometry(0.05, 0.085, 0.13)),
    new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.9 }),
  );
  stock.position.set(0, -0.03, 0.06);
  g.add(barrel, stock);
  return g;
}

// ---------------------------------------------------------------------------
/**
 * Where every joint should be this frame.
 *
 * A free function over an explicit state object rather than a method, for two
 * reasons. It is rig-independent on purpose - the same numbers drive the
 * procedural gunhand and a bone-mapped glTF model - and it is the most
 * intricate maths in the client, which in this repo means it is tested on plain
 * node like everything else rather than looked at.
 *
 * `a` is the avatar's own carried state (walk phase, blends, when he was last
 * hit); `f` is this frame's facts.
 */
export function computePose(a, f, dt) {
  const {
    crouch, moving, sprint, firing, pitch, renderTime, dying,
    sinceHit = 99, sinceDraw = 99, sincePlayed = 99, onFloor = false, gunUp = false,
  } = f;

  a.crouchBlend = lerp(a.crouchBlend, crouch ? 1 : 0, Math.min(1, dt * 11));
  const cb = a.crouchBlend;

  const cadence = sprint ? 10.5 : 6.6;
  a.walkPhase += dt * cadence * (moving ? 1 : 0);
  const stride = moving ? (sprint ? 0.72 : 0.46) * (1 - cb * 0.55) : 0;

  // Standing still is not standing frozen. In the mode this game is played in
  // most, nobody walks for the whole round - so this, and not the walk cycle
  // below it, is what a player actually watches for four minutes. Breath, a
  // slow weight change from one foot to the other, and a small amount of him
  // that is never quite still.
  const seed = a.idleSeed;
  const breath = Math.sin(renderTime * 1.35 + seed) * 0.014
    + Math.sin(renderTime * 2.9 + seed * 1.7) * 0.004;
  if (renderTime > a.shiftAt) {
    a.shiftAt = renderTime + 3.5 + Math.random() * 5;
    a.shiftTo = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
  }
  a.shift = lerp(a.shift, moving ? 0 : (a.shiftTo || 0), Math.min(1, dt * 1.6));
  const idle = breath;

  // The draw. This used to be a blend from one number to another, which is a
  // gun that fades into position - and the draw is the ONE warning anybody at
  // a table gets, so it has to be a movement with a beginning and an end. It
  // overshoots and settles, the way a hand does.
  const rising = gunUp || firing;
  const want = rising ? 1 : (sprint && moving ? 0 : 0.22);
  a.aimBlend = lerp(a.aimBlend, want, Math.min(1, dt * (rising ? 16 : 7)));
  // A quarter second of settle on top, so the barrel arrives rather than
  // appearing. Only on the way up: nobody snaps a gun back down.
  const settle = sinceDraw < 0.45 && rising
    ? Math.sin(sinceDraw * 22) * Math.max(0, 1 - sinceDraw / 0.45) * 0.09 : 0;
  const ab = Math.min(1.06, a.aimBlend + settle);

  // A hit landed. Two tenths of a second of a man losing the argument with
  // it: the shoulder goes back, the head snaps, the knees give a little.
  const flinch = sinceHit < 0.34
    ? Math.sin((sinceHit / 0.34) * Math.PI) * (1 - sinceHit / 0.34) * 1.6 : 0;

  // A card going down on the table. Public, and until now silent.
  const play = sincePlayed < 0.5
    ? Math.sin((sincePlayed / 0.5) * Math.PI) : 0;

  // The floor is his. Squared up over it, weight forward, rather than the
  // same idle as the seven men watching him.
  a.floorBlend = lerp(a.floorBlend, onFloor ? 1 : 0, Math.min(1, dt * 4));
  const fb = a.floorBlend;

  const swingA = Math.sin(a.walkPhase) * stride * 0.55;

  const leg = (phaseOffset, side) => {
    const p = a.walkPhase + phaseOffset;
    const swing = Math.sin(p) * stride;
    const knee = Math.max(0, -Math.sin(p + 0.9)) * stride * 1.5 + cb * 1.55;
    // Standing: the weight is on one foot and it changes every few seconds,
    // which is the difference between a man waiting and a fencepost. The
    // loaded leg straightens and the other takes a little bend.
    const load = moving ? 0 : a.shift * side;
    return {
      hip: swing + cb * 0.95 - load * 0.05 + fb * 0.06,
      knee: knee + (moving ? 0 : Math.max(0, -load) * 0.16 + fb * 0.10) + flinch * 0.18,
      ankle: -knee * 0.35 - swing * 0.25 - cb * 0.5,
      drop: cb * 0.33 + (moving ? 0 : Math.max(0, load) * 0.012) + flinch * 0.03,
    };
  };

  const bob = moving ? Math.abs(Math.sin(a.walkPhase)) * (sprint ? 0.035 : 0.018) : idle;

  const pose = {
    crouch: cb,
    dying: dying || 0,
    rootY: -cb * 0.42 + bob - flinch * 0.04,
    spine: {
      // Forward over the gun while the floor is his; back and away from the
      // hit that just landed.
      x: (sprint && moving ? 0.22 : 0.04) + cb * 0.28 + fb * 0.07 - flinch * 0.20,
      // The weight change reads on the hips more than anywhere else.
      z: (moving ? Math.sin(a.walkPhase) * 0.045 : a.shift * 0.035)
        + flinch * 0.09,
    },
    neck: { x: 0 },
    legL: leg(0, 1),
    legR: leg(Math.PI, -1),
    armR: {
      shoulder: lerp(-swingA - 0.02, -1.42 - pitch * 0.85, ab) - flinch * 0.30,
      elbow: lerp(-0.42, -0.22, ab) - flinch * 0.22,
      z: lerp(0.10, -0.10, ab),
    },
    armL: {
      // The off hand is the one that puts a card down, so the gesture lives
      // here and never fights the arm holding the gun.
      shoulder: lerp(swingA - 0.02, -1.18 - pitch * 0.8, ab) - play * 0.85 - flinch * 0.18,
      elbow: lerp(-0.42, -0.66, ab) + play * 0.55,
      z: lerp(-0.10, 0.36, ab) - play * 0.30,
    },
    coatSway: (moving ? Math.sin(a.walkPhase * 2) * 0.03 : a.shift * 0.02)
      - flinch * 0.05,
  };
  // The head goes with the hit rather than staying level through it, and a
  // small amount of it is never quite still.
  pose.neck.x = -pitch * 0.55 - pose.spine.x * 0.6 + flinch * 0.42
    + (moving ? 0 : Math.sin(renderTime * 0.9 + seed * 2.3) * 0.02);

  if (pose.dying > 0) {
    const e = pose.dying;
    pose.spine.x = lerp(pose.spine.x, -Math.PI / 2, e);
    pose.spine.z = lerp(pose.spine.z, 0.25, e);
    pose.rootY = lerp(pose.rootY, -0.72, e);
    for (const l of [pose.legL, pose.legR]) {
      l.hip = lerp(l.hip, -1.3, e);
      l.knee = lerp(l.knee, 0.9, e);
      l.ankle = lerp(l.ankle, 0, e);
      l.drop = lerp(l.drop, 0.78, e);
    }
    pose.armL.shoulder = lerp(pose.armL.shoulder, 0.6, e);
    pose.armL.z = lerp(pose.armL.z, -0.8, e);
    pose.armR.shoulder = lerp(pose.armR.shoulder, 0.4, e);
    pose.armR.z = lerp(pose.armR.z, 0.9, e);
  }
  return pose;
}

export class PlayerView {
  constructor(scene, id, name, character) {
    this.id = id;
    this.name = name;
    this.character = character;
    this.buffer = [];
    this.alive = true;
    this.deadAt = 0;
    this.mats = [];
    // Everything the pose carries between frames, in one place, so the maths
    // that reads it can live outside this class and be tested. All of it is
    // body language rather than position, and all of it exists because of the
    // mode this game is played in most: nobody walks at a table, so the walk
    // cycle that is most of this file never runs there, and for four minutes
    // eight men stood perfectly still while the round they were in happened
    // entirely on a HUD.
    Object.assign(this, poseState(Math.random() * 100));
    this.gunUp = false;

    const ch = CHARACTERS[character] || CHARACTERS.gunslinger;
    const look = LOOK[character] || LOOK.gunslinger;
    this.look = look;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    // A configured glTF model wins; otherwise we build the gunhand ourselves.
    this.modelRig = makeModelRig(character);
    if (this.modelRig) this._useModelRig();
    else this._buildProcedural(ch, look);

    this._attachCommon(name);
    scene.add(this.root);
  }

  // -------------------------------------------------------------- model rig
  _useModelRig() {
    const rig = this.modelRig;
    this.body.add(rig.root);

    // Per-instance materials so one player's dust cloud does not fade everyone
    // sharing that model.
    const seen = new Map();
    rig.model.traverse((o) => {
      if (!o.material) return;
      const swap = (m) => {
        let c = seen.get(m);
        if (!c) { c = m.clone(); seen.set(m, c); }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    this.mats = [...seen.values()];
    this.ownMaterials = true;

    this.gun = null;
    if (rig.gunAttach) {
      this.gun = gunMesh();
      rig.gunAttach.add(this.gun);
    }
    // Muzzle lighting comes from the shared pool in effects.js, so the scene's
    // light count never changes when players are culled.
    this.muzzle = null;
  }

  // ------------------------------------------------------------- procedural
  _buildProcedural(ch, look) {
    const b = look.build;
    const coatC = new THREE.Color(ch.coat);
    const M = (color, rough = 0.92) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 });

    const coatMat = M(coatC);
    const hatMat = M(new THREE.Color(ch.hat));
    const accentMat = M(new THREE.Color(ch.accent), 0.8);
    const shirtMat = M(coatC.clone().lerp(new THREE.Color(0xf0e4cc), 0.55));
    const pantsMat = M(coatC.clone().multiplyScalar(0.42));
    const leatherMat = M(0x4a3524, 0.85);
    const skinMat = M(0xc19570, 0.95);
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x6b6157, roughness: 0.5, metalness: 0.6 });
    this.mats = [coatMat, hatMat, accentMat, shirtMat, pantsMat, leatherMat, skinMat, steelMat];
    this.ownMaterials = true;

    const mesh = (geo, mat, y = 0, x = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // ---- Legs: hip -> knee -> ankle, so the walk cycle actually bends.
    this.legs = [];
    for (const side of [-1, 1]) {
      const hipG = new THREE.Group();
      hipG.position.set(side * S.hipWidth * b, S.hip, 0);
      hipG.add(mesh(capsule(0.092 * b, S.thigh * 0.72, `th${b}`), pantsMat, -S.thigh * 0.5));

      const kneeG = new THREE.Group();
      kneeG.position.y = -S.thigh;
      kneeG.add(mesh(capsule(0.074 * b, S.shin * 0.7, `sh${b}`), pantsMat, -S.shin * 0.5));

      const ankleG = new THREE.Group();
      ankleG.position.y = -S.shin;
      ankleG.add(mesh(capsule(0.078 * b, 0.11, `bt${b}`), leatherMat, 0.06));
      ankleG.add(mesh(cached('sole', () => new THREE.BoxGeometry(0.115, 0.05, 0.30)), leatherMat, -0.01, 0, -0.05));
      ankleG.add(mesh(cached('heel', () => new THREE.BoxGeometry(0.1, 0.055, 0.08)), leatherMat, -0.045, 0, 0.07));
      ankleG.add(mesh(cached('spur', () => new THREE.TorusGeometry(0.045, 0.008, 4, 10)), steelMat, -0.02, 0, 0.115));

      kneeG.add(ankleG);
      hipG.add(kneeG);
      this.body.add(hipG);
      this.legs.push({ hip: hipG, knee: kneeG, ankle: ankleG, side });
    }

    // ---- Spine
    this.spine = new THREE.Group();
    this.spine.position.y = S.waist;
    this.body.add(this.spine);
    this.spine.add(mesh(capsule(0.185 * b, 0.30, `to${b}`), shirtMat, 0.30));
    this.spine.add(mesh(capsule(0.20 * b, 0.14, `ch${b}`), coatMat, 0.40));

    this.coat = buildCoat(look, coatMat);
    this.coat.position.y = 0.11;
    this.spine.add(this.coat);
    this.spine.add(mesh(cached(`belt${b}`, () => new THREE.CylinderGeometry(0.196 * b, 0.196 * b, 0.06, 16)), accentMat, 0.10));

    // ---- Arms: shoulder -> elbow -> hand.
    this.arms = {};
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * S.shoulderWidth * b, S.shoulder - S.waist, 0);
      sh.add(mesh(capsule(0.062 * b, S.upperArm * 0.62, `ua${b}`), coatMat, -S.upperArm * 0.5));

      const el = new THREE.Group();
      el.position.y = -S.upperArm;
      el.add(mesh(capsule(0.052 * b, S.forearm * 0.62, `fa${b}`), coatMat, -S.forearm * 0.5));

      const hand = new THREE.Group();
      hand.position.y = -S.forearm;
      hand.add(mesh(sphere(0.052, 'hand'), skinMat));
      el.add(hand);
      sh.add(el);
      this.spine.add(sh);
      this.arms[side < 0 ? 'l' : 'r'] = { shoulder: sh, elbow: el, hand };
    }

    // ---- Neck + head
    this.neck = new THREE.Group();
    this.neck.position.y = S.neck - S.waist;
    this.spine.add(this.neck);
    this.neck.add(mesh(capsule(0.045, 0.05, 'neck'), skinMat, 0.03));

    const head = mesh(sphere(0.113, 'head'), skinMat, 0.135);
    head.scale.set(0.93, 1.1, 1.0);
    this.neck.add(head);
    this.neck.add(mesh(cached('jaw', () => new THREE.BoxGeometry(0.135, 0.075, 0.13)), skinMat, 0.085, 0, -0.018));
    const nose = mesh(cached('nose', () => new THREE.ConeGeometry(0.021, 0.055, 6)), skinMat, 0.128, 0, -0.108);
    nose.rotation.set(-Math.PI / 2, 0, 0);
    this.neck.add(nose);
    const eyeMat = M(0x2c2119, 0.6);
    this.mats.push(eyeMat);
    for (const sx of [-1, 1]) this.neck.add(mesh(sphere(0.017, 'eye'), eyeMat, 0.168, sx * 0.045, -0.094));

    this.hat = buildHat(look.hat, hatMat, accentMat);
    this.hat.position.y = 0.212;
    this.hat.rotation.x = look.hat.tilt || 0;
    this.neck.add(this.hat);

    // ---- Costume extras: cheap, and they carry a lot of identification.
    const ex = new Set(look.extras);
    if (ex.has('scarf') || ex.has('cravat')) {
      this.spine.add(mesh(cached('scarf', () => new THREE.CylinderGeometry(0.088, 0.105, 0.10, 12)), accentMat, 0.505));
      if (ex.has('cravat')) this.spine.add(mesh(cached('crav', () => new THREE.BoxGeometry(0.06, 0.14, 0.03)), accentMat, 0.44, 0, -0.14));
    }
    if (ex.has('vest')) {
      const vest = mesh(capsule(0.192 * b, 0.16, `vest${b}`), accentMat, 0.32);
      vest.scale.set(1, 1, 0.86);
      this.spine.add(vest);
    }
    if (ex.has('gunbelt')) {
      this.spine.add(mesh(cached('holster', () => new THREE.BoxGeometry(0.075, 0.19, 0.10)), leatherMat, 0.0, 0.185 * b, 0.03));
      const bando = mesh(cached('bandolier', () => new THREE.TorusGeometry(0.19, 0.022, 5, 14)), leatherMat, 0.31);
      bando.rotation.set(Math.PI / 2, 0, 0.6);
      this.spine.add(bando);
    }
    if (ex.has('satchel')) {
      this.spine.add(mesh(cached('satchel', () => new THREE.BoxGeometry(0.20, 0.17, 0.10)), leatherMat, 0.12, 0.2 * b, 0.16));
      const strap = mesh(cached('strap', () => new THREE.TorusGeometry(0.185, 0.015, 5, 14)), leatherMat, 0.33);
      strap.rotation.set(Math.PI / 2, 0, -0.55);
      this.spine.add(strap);
    }
    if (ex.has('apron')) {
      this.spine.add(mesh(cached('apron', () => new THREE.BoxGeometry(0.30, 0.42, 0.03)), shirtMat, 0.18, 0, -0.18));
    }
    if (ex.has('specs')) {
      for (const sx of [-1, 1]) {
        this.neck.add(mesh(cached('specs', () => new THREE.TorusGeometry(0.028, 0.005, 4, 10)), steelMat, 0.168, sx * 0.045, -0.1));
      }
    }
    if (ex.has('feather')) {
      const f = mesh(cached('feather', () => new THREE.ConeGeometry(0.018, 0.19, 4)), accentMat, 0.30, 0.09, 0.05);
      f.rotation.set(0.4, 0, -0.45);
      this.neck.add(f);
    }
    if (ex.has('hair')) {
      const hairMat = M(0x2b2018, 0.95);
      this.mats.push(hairMat);
      const hair = mesh(sphere(0.105, 'hair'), hairMat, 0.115, 0, 0.035);
      hair.scale.set(1.0, 0.95, 1.05);
      this.neck.add(hair);
      const tail = mesh(capsule(0.036, 0.16, 'tail'), hairMat, 0, 0, 0.11);
      tail.rotation.x = -0.25;
      this.neck.add(tail);
    }
    if (ex.has('stubble')) {
      const stubMat = M(0x4a3a2c, 0.98);
      this.mats.push(stubMat);
      this.neck.add(mesh(cached('stub', () => new THREE.BoxGeometry(0.12, 0.045, 0.115)), stubMat, 0.068, 0, -0.03));
    }
    if (look.coat === 'fur') {
      const furMat = M(0x6b5a44, 0.99);
      this.mats.push(furMat);
      const collar = mesh(cached('fur', () => new THREE.TorusGeometry(0.155, 0.055, 6, 16)), furMat, 0.475);
      collar.rotation.x = Math.PI / 2;
      this.spine.add(collar);
    }

    // ---- Weapon in the right hand.
    this.gun = gunMesh();
    this.gun.position.set(0, -0.03, -0.05);
    this.arms.r.hand.add(this.gun);
    this.muzzle = null;   // see effects.flashAt()
  }

  // ------------------------------------------------------------ shared bits
  _attachCommon(name) {
    // Sheriff's star: invisible until they pin it on, then everyone sees it.
    this.star = new THREE.Mesh(
      cached('star', () => new THREE.CylinderGeometry(0.055, 0.055, 0.014, 5)),
      new THREE.MeshStandardMaterial({ color: 0xf0cf6a, roughness: 0.3, metalness: 0.8, emissive: 0x3a2c08 }),
    );
    this.star.rotation.set(Math.PI / 2, 0, 0);
    this.star.visible = false;
    if (this.modelRig?.starAttach) {
      this.modelRig.starAttach.add(this.star);
    } else if (this.spine) {
      this.star.position.set(-0.10, 0.40, -0.175);
      this.spine.add(this.star);
    } else {
      this.star.position.set(-0.10, 1.34, -0.175);
      this.body.add(this.star);
    }

    // Scout reveal outline (this one is meant to draw through walls).
    this.outline = new THREE.Mesh(
      cached('outline', () => new THREE.CapsuleGeometry(0.42, 1.0, 4, 10)),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.3, depthTest: false, side: THREE.BackSide }),
    );
    this.outline.position.y = 0.95;
    this.outline.visible = false;
    this.outline.renderOrder = 800;
    this.root.add(this.outline);

    this.tag = nameSprite(name);
    this.tag.position.y = 2.15;
    this.root.add(this.tag);
  }

  push(state, time) {
    // Coming back into view after being culled: drop the stale history so the
    // avatar appears where it is rather than sliding across the map to get there.
    const last = this.buffer[this.buffer.length - 1];
    if (last && time - last.t > 0.5) this.buffer.length = 0;
    this.buffer.push({ ...state, t: time });
    if (this.buffer.length > 24) this.buffer.shift();
  }

  /** Out of sight: the server stops sending them, so stop drawing them. */
  setVisible(on) {
    this.root.visible = on;
  }

  // ----------------------------------------------------------------- pose
    computePose(f, dt) { return computePose(this, f, dt); }

  applyProcedural(pose) {
    for (const l of [{ g: this.legs[0], p: pose.legL }, { g: this.legs[1], p: pose.legR }]) {
      l.g.hip.rotation.x = l.p.hip;
      l.g.knee.rotation.x = l.p.knee;
      l.g.ankle.rotation.x = l.p.ankle;
      l.g.hip.position.y = S.hip - l.p.drop;
    }
    this.spine.position.y = S.waist + pose.rootY;
    this.spine.rotation.set(pose.spine.x, 0, pose.spine.z);
    this.neck.rotation.x = pose.neck.x;
    this.arms.r.shoulder.rotation.set(pose.armR.shoulder, 0, pose.armR.z);
    this.arms.r.elbow.rotation.x = pose.armR.elbow;
    this.arms.l.shoulder.rotation.set(pose.armL.shoulder, 0, pose.armL.z);
    this.arms.l.elbow.rotation.x = pose.armL.elbow;
    this.coat.rotation.x = -pose.spine.x * 0.5 + pose.coatSway;
  }

  applyModel(pose, dt, f) {
    const rig = this.modelRig;
    if (rig.mixer) {
      // A hit and a card are moments, so they win while they last; then the gun
      // being UP, which at a table is the whole of a man's go and used to be
      // read off `firing` - a bit that is true for an eighth of a second after
      // a trigger. A configured model spent the round in `idle` for the same
      // reason the procedural rig did.
      const state = f.dying ? 'death'
        : (f.sinceHit < 0.34 && rig.actions.hit) ? 'hit'
        : (f.sincePlayed < 0.5 && rig.actions.play) ? 'play'
        : f.moving ? (f.sprint ? 'run' : 'walk')
        : ((f.gunUp || f.firing) && rig.actions.aim) ? 'aim' : 'idle';
      playState(rig, state);
      rig.mixer.update(dt);
    } else if (rig.bones) {
      applyPoseToBones(rig, pose);
    }
    // Root height comes from the pose so crouch and the death collapse read
    // correctly - but a bone map already moved the hips, so do not double it.
    if (!rig.bones?.root && (!rig.mixer || !rig.actions.death || !f.dying)) {
      rig.root.position.y = pose.rootY * (rig.mixer ? 0.4 : 1);
    }
    if (rig.mixer && f.dying && !rig.actions.death) {
      rig.root.rotation.x = -Math.PI / 2 * pose.dying;
      rig.root.position.y = -0.72 * pose.dying;
    }
  }

  /** Renders ~100ms in the past and interpolates: smooth without feeling floaty. */
  update(renderTime, dt, camera) {
    const b = this.buffer;
    if (!b.length) return;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= renderTime && b[i + 1].t >= renderTime) { a = b[i]; c = b[i + 1]; break; }
    }
    const span = c.t - a.t;
    const k = span > 0.0001 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;

    const x = a.x + (c.x - a.x) * k;
    const y = a.y + (c.y - a.y) * k;
    const z = a.z + (c.z - a.z) * k;
    const yaw = a.yw + shortAngle(a.yw, c.yw) * k;
    const pitch = a.pt + (c.pt - a.pt) * k;

    const wasAlive = this.alive;
    this.alive = !(c.st & 32);
    const crouch = !!(c.st & 1);
    const moving = !!(c.st & 4);
    const sprint = !!(c.st & 2);
    const dusty = !!(c.st & 8);
    const firing = !!(c.st & 64);
    const hit = !!(c.st & 128);
    this.star.visible = !!(c.st & 16);
    // A hit is a moment, and the bit stays up for a quarter of a second, so
    // the flinch is fired on the EDGE rather than held down for the whole of it.
    if (hit && !this.wasHit) this.hitAt = renderTime;
    this.wasHit = hit;

    this.root.position.set(x, y, z);
    this.body.rotation.set(0, yaw, 0);

    if (!this.alive && wasAlive) this.deadAt = renderTime;
    // Bodies stay where they fell. Every corpse is a piece of evidence.
    const dyingRaw = this.alive ? 0 : Math.min(1, (renderTime - this.deadAt) / 0.5);
    const dying = dyingRaw > 0 ? 1 - (1 - dyingRaw) * (1 - dyingRaw) : 0;

    const flags = {
      crouch, moving: moving && this.alive, sprint, firing: firing && this.alive,
      pitch, renderTime, dying,
      // How long since the three things a man's body should say out loud.
      sinceHit: renderTime - this.hitAt,
      sinceDraw: renderTime - this.drewAt,
      sincePlayed: renderTime - this.playedAt,
      // The floor is his, so he is squared up over it rather than idling.
      onFloor: !!this.onFloor,
      // And the gun is up, which at a table is the only warning anybody gets.
      gunUp: !!this.gunUp,
    };
    const pose = this.computePose(flags, dt);
    if (this.modelRig) this.applyModel(pose, dt, flags);
    else this.applyProcedural(pose);

    if (this.muzzle) {
      this.muzzle.intensity = (firing && this.alive) ? 5 : Math.max(0, this.muzzle.intensity - dt * 30);
    }

    for (const m of this.mats) {
      if (m.transparent !== dusty) { m.transparent = dusty; m.needsUpdate = true; }
      m.opacity = dusty ? 0.42 : 1;
    }

    if (!this.alive) {
      this.tag.visible = false;
      this.outline.visible = false;
      return;
    }
    if (camera) {
      const d = camera.position.distanceTo(this.root.position);
      const op = tagOpacity(d, dusty);
      this.tag.visible = op > 0;
      this.tag.material.opacity = op;
      this.tag.position.y = 2.15 - pose.crouch * 0.42;
    }
  }

  setRevealed(on) { this.outline.visible = on && this.alive; }

  /**
   * Whose go it is, and whether his gun is up.
   *
   * Neither of these is in the snapshot, and neither needs to be: the turn
   * packet already tells every screen whose floor it is, and at a table a man
   * with the floor is holding the only live gun in town. Sending it again as a
   * bit would be the same fact on the wire twice, and the second copy is the
   * one that goes out of date.
   */
  setFloor(mine, gunUp) {
    if (gunUp && !this.gunUp) this.drewAt = performance.now() / 1000;
    this.onFloor = mine;
    this.gunUp = gunUp;
  }

  /**
   * A card left this man's hand. The table readout says how many everybody is
   * holding, so a count that went down is a card played - which is public, and
   * was the one thing in the whole mode that happened with nobody moving.
   */
  cardsNow(n) {
    if (this.cardCount != null && n < this.cardCount) {
      this.playedAt = performance.now() / 1000;
    }
    this.cardCount = n;
  }

  dispose(scene) {
    scene.remove(this.root);
    if (this.tag?.material?.map) this.tag.material.map.dispose();
    this.tag?.material?.dispose();
    this.outline?.material?.dispose();
    this.star?.material?.dispose();
    if (this.ownMaterials) for (const m of this.mats) m.dispose();
    // Geometry is shared across every gunhand, so it is deliberately not disposed.
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
