// Remote gunhands: stylised, low-poly, and above all *identifiable*.
//
// Silhouette does the work here. Every character has a different hat profile and
// coat colour, because the entire social layer collapses if you cannot tell at a
// glance which of eight strangers just stepped out of the saloon.

import * as THREE from 'three';
import { CHARACTERS, PLAYER } from '../../shared/constants.js';

const HATS = {
  gunslinger: { brim: 0.40, crown: 0.20, crownR: 0.155, tilt: 0.05 },
  medic:      { brim: 0.26, crown: 0.24, crownR: 0.150, tilt: 0.0 },   // bowler
  scout:      { brim: 0.33, crown: 0.12, crownR: 0.160, tilt: 0.16 },  // flat, pushed back
  duelist:    { brim: 0.30, crown: 0.34, crownR: 0.140, tilt: 0.0 },   // tall crown
  gambler:    { brim: 0.35, crown: 0.30, crownR: 0.165, tilt: -0.08 },
  tracker:    { brim: 0.36, crown: 0.14, crownR: 0.175, tilt: 0.10 },  // wide and low
};

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

export class PlayerView {
  constructor(scene, id, name, character) {
    this.id = id;
    this.name = name;
    this.character = character;
    this.buffer = [];
    this.alive = true;
    this.deadAt = 0;

    const ch = CHARACTERS[character] || CHARACTERS.gunslinger;
    const coat = new THREE.Color(ch.coat);
    const hatCol = new THREE.Color(ch.hat);
    const accent = new THREE.Color(ch.accent);

    const skin = new THREE.MeshLambertMaterial({ color: 0xb98d68 });
    const coatMat = new THREE.MeshLambertMaterial({ color: coat });
    const hatMat = new THREE.MeshLambertMaterial({ color: hatCol });
    const accentMat = new THREE.MeshLambertMaterial({ color: accent });
    const pantsMat = new THREE.MeshLambertMaterial({ color: coat.clone().multiplyScalar(0.55) });
    this.mats = [coatMat, hatMat, accentMat, pantsMat, skin];

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const box = (w, h, d, mat, y, x = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    // Legs
    this.legL = box(0.19, 0.82, 0.22, pantsMat, -0.41, -0.13);
    this.legR = box(0.19, 0.82, 0.22, pantsMat, -0.41, 0.13);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.82;
    this.hips.add(this.legL, this.legR);
    this.body.add(this.hips);

    // Torso + coat skirt (the flare that reads as a duster from distance)
    this.body.add(box(0.52, 0.62, 0.32, coatMat, 1.13));
    const skirt = box(0.56, 0.34, 0.36, coatMat, 0.72);
    skirt.scale.set(1.0, 1.0, 1.0);
    this.body.add(skirt);
    this.body.add(box(0.56, 0.09, 0.34, accentMat, 0.86));      // belt / sash

    // Arms
    this.armL = box(0.14, 0.56, 0.16, coatMat, -0.2);
    this.armR = box(0.14, 0.56, 0.16, coatMat, -0.2);
    this.shoulderL = new THREE.Group(); this.shoulderL.position.set(-0.33, 1.36, 0);
    this.shoulderR = new THREE.Group(); this.shoulderR.position.set(0.33, 1.36, 0);
    this.shoulderL.add(this.armL); this.shoulderR.add(this.armR);
    this.body.add(this.shoulderL, this.shoulderR);

    // Head + hat
    this.head = new THREE.Group();
    this.head.position.y = 1.5;
    this.head.add(box(0.24, 0.26, 0.24, skin, 0.09));
    const h = HATS[character] || HATS.gunslinger;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(h.brim, h.brim, 0.035, 12), hatMat);
    brim.position.y = 0.23; brim.castShadow = true;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(h.crownR * 0.92, h.crownR, h.crown, 12), hatMat);
    crown.position.y = 0.23 + h.crown / 2; crown.castShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(h.crownR * 1.02, h.crownR * 1.02, 0.04, 12), accentMat);
    band.position.y = 0.26;
    const hat = new THREE.Group();
    hat.add(brim, crown, band);
    hat.rotation.x = h.tilt;
    this.head.add(hat);
    this.body.add(this.head);

    // Gun in the right hand, so you can see what they are carrying.
    this.gun = new THREE.Group();
    this.gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.44), new THREE.MeshLambertMaterial({ color: 0x3b332c }));
    this.gunMesh.position.z = -0.2;
    this.gun.add(this.gunMesh);
    this.gun.position.set(0.33, 1.24, -0.1);
    this.body.add(this.gun);

    // Sheriff's star - only shows once they pin it on, and then everyone sees it.
    this.star = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.03, 5),
      new THREE.MeshBasicMaterial({ color: 0xf0cf6a }),
    );
    this.star.rotation.x = Math.PI / 2;
    this.star.position.set(-0.16, 1.22, -0.18);
    this.star.visible = false;
    this.body.add(this.star);

    // Scout reveal outline (drawn through walls).
    this.outline = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.85, 0.55),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.32, depthTest: false, side: THREE.BackSide }),
    );
    this.outline.position.y = 0.93;
    this.outline.visible = false;
    this.outline.renderOrder = 800;
    this.root.add(this.outline);

    this.tag = nameSprite(name);
    this.tag.position.y = 2.15;
    this.root.add(this.tag);

    this.muzzle = new THREE.PointLight(0xffcc77, 0, 9, 2);
    this.muzzle.position.set(0.33, 1.24, -0.5);
    this.body.add(this.muzzle);

    scene.add(this.root);
    this.walkPhase = Math.random() * 6;
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
    this.star.visible = !!(c.st & 16);

    this.root.position.set(x, y, z);

    if (!this.alive) {
      // Bodies stay where they fell. Every corpse is a piece of evidence.
      if (wasAlive) this.deadAt = renderTime;
      const fall = Math.min(1, (renderTime - this.deadAt) / 0.45);
      this.body.rotation.set(-Math.PI / 2 * fall, yaw, 0, 'YXZ');
      this.body.position.y = -0.05 * fall;
      this.tag.visible = false;
      this.outline.visible = false;
      this.muzzle.intensity = 0;
      return;
    }

    this.body.rotation.set(0, yaw, 0);
    this.body.position.y = crouch ? -0.5 : 0;
    this.head.rotation.x = -pitch * 0.7;
    this.gun.rotation.x = -pitch;

    // Walk cycle
    const speed = moving ? (sprint ? 11 : 7) : 0;
    this.walkPhase += dt * speed;
    const swing = moving ? Math.sin(this.walkPhase) * (sprint ? 0.75 : 0.5) : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.shoulderL.rotation.x = -swing * 0.55;
    if (!moving) {
      this.legL.rotation.x *= 0.9;
      this.legR.rotation.x *= 0.9;
    }

    // Muzzle flash from the shooting bit
    this.muzzle.intensity = (c.st & 64) ? 5 : Math.max(0, this.muzzle.intensity - dt * 30);

    for (const m of this.mats) {
      if (m.transparent !== dusty) { m.transparent = dusty; m.needsUpdate = true; }
      m.opacity = dusty ? 0.42 : 1;
    }

    if (camera) {
      const d = camera.position.distanceTo(this.root.position);
      this.tag.visible = d < 34;
      this.tag.material.opacity = Math.max(0, Math.min(1, (34 - d) / 10));
      this.tag.position.y = crouch ? 1.6 : 2.15;
    }
  }

  setRevealed(on) { this.outline.visible = on && this.alive; }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map) o.material.map.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
