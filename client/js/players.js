// Remote gunhands.
//
// These are built at runtime out of capsules and surfaces of revolution rather
// than imported models - the project ships no art assets - but they are properly
// jointed: hip, knee, ankle, shoulder, elbow, neck. Limbs bend instead of
// pivoting as rigid blocks, coats flare, hat brims curve.
//
// Silhouette does the heavy lifting: every character has a different hat
// profile, coat length and build, because the whole social layer collapses if
// you cannot tell eight strangers apart across Main Street.

import * as THREE from 'three';
import { CHARACTERS } from '../../shared/constants.js';

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
    extras: ['satchel', 'specs'],
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
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const capsule = (r, len, key) =>
  cached(`cap${key}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphere = (r, key) =>
  cached(`sph${key}`, () => new THREE.SphereGeometry(r, 12, 9));

function latheGeo(key, pts, seg = 18) {
  return cached(key, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
}

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

  // Brim drawn as a thin shell that lifts at the rim.
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

/** Coat/duster/apron: a flared surface of revolution hanging from the waist. */
function buildCoat(look, mat) {
  const len = look.coatLen, flare = look.coatFlare;
  const top = 0.20 * look.build;
  const pts = [
    [top, 0],
    [top * 1.03, -len * 0.28],
    [top * flare * 0.82, -len * 0.62],
    [top * flare, -len * 0.94],
    [top * flare * 0.99, -len],
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

// ---------------------------------------------------------------------------
export class PlayerView {
  constructor(scene, id, name, character) {
    this.id = id;
    this.name = name;
    this.character = character;
    this.buffer = [];
    this.alive = true;
    this.deadAt = 0;
    this.walkPhase = Math.random() * 6;
    this.aimBlend = 0;

    const ch = CHARACTERS[character] || CHARACTERS.gunslinger;
    const look = LOOK[character] || LOOK.gunslinger;
    this.look = look;
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

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

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
      // Boot: shaft + sole + heel + toe, which is most of what reads as "cowboy".
      ankleG.add(mesh(capsule(0.078 * b, 0.11, `bt${b}`), leatherMat, 0.06));
      const sole = mesh(cached('sole', () => new THREE.BoxGeometry(0.115, 0.05, 0.30)), leatherMat, -0.01, 0, -0.05);
      ankleG.add(sole);
      ankleG.add(mesh(cached('heel', () => new THREE.BoxGeometry(0.1, 0.055, 0.08)), leatherMat, -0.045, 0, 0.07));
      ankleG.add(mesh(cached('spur', () => new THREE.TorusGeometry(0.045, 0.008, 4, 10)), steelMat, -0.02, 0, 0.115));

      kneeG.add(ankleG);
      hipG.add(kneeG);
      this.body.add(hipG);
      this.legs.push({ hip: hipG, knee: kneeG, ankle: ankleG, side });
    }

    // ---- Spine: everything above the waist pivots here.
    this.spine = new THREE.Group();
    this.spine.position.y = S.waist;
    this.body.add(this.spine);

    const torso = mesh(capsule(0.185 * b, 0.30, `to${b}`), shirtMat, 0.30);
    this.spine.add(torso);
    const chest = mesh(capsule(0.20 * b, 0.14, `ch${b}`), coatMat, 0.40);
    this.spine.add(chest);

    this.coat = buildCoat(look, coatMat);
    this.coat.position.y = 0.11;
    this.spine.add(this.coat);

    const belt = mesh(cached(`belt${b}`, () => new THREE.CylinderGeometry(0.196 * b, 0.196 * b, 0.06, 16)), accentMat, 0.10);
    this.spine.add(belt);

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

    // ---- Neck + head.
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
    for (const sx of [-1, 1]) {
      this.neck.add(mesh(sphere(0.017, 'eye'), M(0x2c2119, 0.6), 0.168, sx * 0.045, -0.094));
    }

    this.hat = buildHat(look.hat, hatMat, accentMat);
    this.hat.position.y = 0.212;
    this.hat.rotation.x = look.hat.tilt || 0;
    this.neck.add(this.hat);

    // ---- Costume extras: cheap, and they carry a lot of identification.
    const ex = new Set(look.extras);
    if (ex.has('scarf') || ex.has('cravat')) {
      const scarf = mesh(cached('scarf', () => new THREE.CylinderGeometry(0.088, 0.105, 0.10, 12)), accentMat, 0.505);
      this.spine.add(scarf);
      if (ex.has('cravat')) this.spine.add(mesh(cached('crav', () => new THREE.BoxGeometry(0.06, 0.14, 0.03)), accentMat, 0.44, 0, -0.14));
    }
    if (ex.has('vest')) {
      const vest = mesh(capsule(0.192 * b, 0.16, `vest${b}`), accentMat, 0.32);
      vest.scale.set(1, 1, 0.86);
      this.spine.add(vest);
    }
    if (ex.has('gunbelt')) {
      this.spine.add(mesh(cached('holster', () => new THREE.BoxGeometry(0.075, 0.19, 0.10)), leatherMat, 0.0, 0.185 * b, 0.03));
      const bando = mesh(cached('bandolier', () => new THREE.TorusGeometry(0.19, 0.022, 5, 14)), leatherMat, 0.31, 0, 0);
      bando.rotation.set(Math.PI / 2, 0, 0.6);
      this.spine.add(bando);
    }
    if (ex.has('satchel')) {
      const bag = mesh(cached('satchel', () => new THREE.BoxGeometry(0.20, 0.17, 0.10)), leatherMat, 0.12, side1(b), 0.16);
      this.spine.add(bag);
      const strap = mesh(cached('strap', () => new THREE.TorusGeometry(0.185, 0.015, 5, 14)), leatherMat, 0.33, 0, 0);
      strap.rotation.set(Math.PI / 2, 0, -0.55);
      this.spine.add(strap);
    }
    if (ex.has('apron')) {
      const ap = mesh(cached('apron', () => new THREE.BoxGeometry(0.30, 0.42, 0.03)), shirtMat, 0.18, 0, -0.18);
      this.spine.add(ap);
    }
    if (ex.has('specs')) {
      this.neck.add(mesh(cached('specs', () => new THREE.TorusGeometry(0.028, 0.005, 4, 10)), steelMat, 0.168, -0.045, -0.1));
      this.neck.add(mesh(cached('specs2', () => new THREE.TorusGeometry(0.028, 0.005, 4, 10)), steelMat, 0.168, 0.045, -0.1));
    }
    if (ex.has('feather')) {
      const f = mesh(cached('feather', () => new THREE.ConeGeometry(0.018, 0.19, 4)), accentMat, 0.30, 0.09, 0.05);
      f.rotation.set(0.4, 0, -0.45);
      this.neck.add(f);
    }
    if (ex.has('hair')) {
      const hair = mesh(sphere(0.105, 'hair'), M(0x2b2018, 0.95), 0.115, 0, 0.035);
      hair.scale.set(1.0, 0.95, 1.05);
      this.neck.add(hair);
      const tail = mesh(capsule(0.036, 0.16, 'tail'), M(0x2b2018, 0.95), 0.0, 0, 0.11);
      tail.rotation.x = -0.25;
      this.neck.add(tail);
    }
    if (ex.has('stubble')) {
      const st = mesh(cached('stub', () => new THREE.BoxGeometry(0.12, 0.045, 0.115)), M(0x4a3a2c, 0.98), 0.068, 0, -0.03);
      this.neck.add(st);
    }
    if (look.coat === 'fur') {
      const collar = mesh(cached('fur', () => new THREE.TorusGeometry(0.155, 0.055, 6, 16)), M(0x6b5a44, 0.99), 0.475);
      collar.rotation.x = Math.PI / 2;
      this.spine.add(collar);
    }

    // ---- Weapon in the right hand.
    this.gun = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x413a33, roughness: 0.55, metalness: 0.45 });
    this.gunBarrel = mesh(cached('gunbar', () => new THREE.CylinderGeometry(0.019, 0.019, 0.34, 8)), gunMat, 0, 0, -0.14);
    this.gunBarrel.rotation.x = Math.PI / 2;
    this.gun.add(this.gunBarrel);
    this.gun.add(mesh(cached('gunstock', () => new THREE.BoxGeometry(0.05, 0.085, 0.13)), M(0x6b4526, 0.9), -0.03, 0, 0.06));
    this.gun.position.set(0, -0.03, -0.05);
    this.arms.r.hand.add(this.gun);

    this.muzzle = new THREE.PointLight(0xffcc77, 0, 9, 2);
    this.muzzle.position.set(0, 0, -0.32);
    this.gun.add(this.muzzle);

    // ---- Sheriff's star: invisible until they pin it on, then everyone sees it.
    this.star = new THREE.Mesh(
      cached('star', () => new THREE.CylinderGeometry(0.055, 0.055, 0.014, 5)),
      new THREE.MeshStandardMaterial({ color: 0xf0cf6a, roughness: 0.3, metalness: 0.8, emissive: 0x3a2c08 }),
    );
    this.star.rotation.set(Math.PI / 2, 0, 0);
    this.star.position.set(-0.10, 0.40, -0.175);
    this.star.visible = false;
    this.spine.add(this.star);

    // ---- Scout reveal outline (this one is meant to draw through walls).
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

    scene.add(this.root);
  }

  push(state, time) {
    this.buffer.push({ ...state, t: time });
    if (this.buffer.length > 24) this.buffer.shift();
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
    this.star.visible = !!(c.st & 16);

    this.root.position.set(x, y, z);

    if (!this.alive) {
      // Bodies stay where they fell. Every corpse is a piece of evidence.
      if (wasAlive) this.deadAt = renderTime;
      const f = Math.min(1, (renderTime - this.deadAt) / 0.5);
      const e = 1 - (1 - f) * (1 - f);
      this.body.rotation.set(0, yaw, 0);
      this.body.position.y = 0;
      this.spine.rotation.set(-Math.PI / 2 * e, 0, 0.25 * e);
      this.spine.position.y = S.waist - 0.72 * e;
      for (const leg of this.legs) {
        leg.hip.rotation.x = -1.3 * e;
        leg.knee.rotation.x = 0.9 * e;
        leg.hip.position.y = S.hip - 0.78 * e;
      }
      this.arms.l.shoulder.rotation.set(0.6 * e, 0, -0.8 * e);
      this.arms.r.shoulder.rotation.set(0.4 * e, 0, 0.9 * e);
      this.tag.visible = false;
      this.outline.visible = false;
      this.muzzle.intensity = 0;
      return;
    }

    this.body.rotation.set(0, yaw, 0);

    // ---- Crouch
    const crouchAmt = crouch ? 1 : 0;
    this.crouchBlend = lerp(this.crouchBlend ?? 0, crouchAmt, Math.min(1, dt * 11));
    const cb = this.crouchBlend;

    // ---- Walk cycle. Knees only bend one way, which is what separates a walk
    // from a puppet on strings.
    const cadence = sprint ? 10.5 : 6.6;
    this.walkPhase += dt * cadence * (moving ? 1 : 0);
    const stride = moving ? (sprint ? 0.72 : 0.46) * (1 - cb * 0.55) : 0;
    const idle = Math.sin(renderTime * 1.5 + this.id) * 0.02;

    for (const leg of this.legs) {
      const p = this.walkPhase + (leg.side < 0 ? 0 : Math.PI);
      const swing = Math.sin(p) * stride;
      leg.hip.rotation.x = swing + cb * 0.95;
      leg.knee.rotation.x = Math.max(0, -Math.sin(p + 0.9)) * stride * 1.5 + cb * 1.55;
      leg.ankle.rotation.x = -leg.knee.rotation.x * 0.35 - swing * 0.25 - cb * 0.5;
      leg.hip.position.y = S.hip - cb * 0.33;
    }

    // Body bob and lean.
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * (sprint ? 0.035 : 0.018) : idle;
    this.spine.position.y = S.waist - cb * 0.42 + bob;
    this.spine.rotation.x = (sprint && moving ? 0.22 : 0.04) + cb * 0.28;
    this.spine.rotation.z = moving ? Math.sin(this.walkPhase) * 0.045 : 0;
    this.spine.rotation.y = 0;

    // Head tracks where they are looking.
    this.neck.rotation.x = -pitch * 0.55 - this.spine.rotation.x * 0.6;

    // ---- Arms. Aiming raises the gun arm toward the look direction; otherwise
    // the arms swing against the legs.
    // Low ready when idle, gun up when they are actually shooting. Anyone who
    // has raised their piece at you is worth noticing across the street.
    const aimTarget = firing ? 1 : (sprint && moving ? 0 : 0.22);
    this.aimBlend = lerp(this.aimBlend, aimTarget, Math.min(1, dt * 8));
    const ab = this.aimBlend;
    const swingA = Math.sin(this.walkPhase) * stride * 0.55;

    const r = this.arms.r;
    r.shoulder.rotation.x = lerp(-swingA - 0.02, -1.42 - pitch * 0.85, ab);
    r.shoulder.rotation.z = lerp(0.10, -0.10, ab);
    r.elbow.rotation.x = lerp(-0.42, -0.22, ab);

    const l = this.arms.l;
    // Two-handed grip when actually aiming, swinging free otherwise.
    l.shoulder.rotation.x = lerp(swingA - 0.02, -1.18 - pitch * 0.8, ab);
    l.shoulder.rotation.z = lerp(-0.10, 0.36, ab);
    l.elbow.rotation.x = lerp(-0.42, -0.66, ab);

    // Coat sways a little when they move.
    this.coat.rotation.x = -this.spine.rotation.x * 0.5 + (moving ? Math.sin(this.walkPhase * 2) * 0.03 : 0);

    this.muzzle.intensity = firing ? 5 : Math.max(0, this.muzzle.intensity - dt * 30);

    for (const m of this.mats) {
      if (m.transparent !== dusty) { m.transparent = dusty; m.needsUpdate = true; }
      m.opacity = dusty ? 0.42 : 1;
    }

    if (camera) {
      const d = camera.position.distanceTo(this.root.position);
      this.tag.visible = d < 34;
      this.tag.material.opacity = Math.max(0, Math.min(1, (34 - d) / 10));
      this.tag.position.y = 2.15 - cb * 0.42;
    }
  }

  setRevealed(on) { this.outline.visible = on && this.alive; }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    // Geometry is shared across every gunhand, so it is deliberately not disposed.
  }
}

function side1(b) { return 0.2 * b; }
function lerp(a, b, t) { return a + (b - a) * t; }
function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
