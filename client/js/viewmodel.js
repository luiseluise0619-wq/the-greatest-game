// First-person weapon models, built from boxes and cylinders, plus the little
// animations that sell the gunplay: bob, sway, recoil kick, reload, aim-down.

import * as THREE from 'three';
import { WEAPONS } from '../../shared/constants.js';
import { motionScale } from './settings.js';

const STEEL = 0x7d7266;
const DARKSTEEL = 0x534b42;
const WOODCOL = 0x8a5a2e;
const BRASS = 0xbb9440;

function part(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}
function tube(r1, r2, len, color, x = 0, y = 0, z = 0, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 10), new THREE.MeshLambertMaterial({ color }));
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function buildRevolver() {
  const g = new THREE.Group();
  g.add(tube(0.020, 0.020, 0.20, STEEL, 0, 0.014, -0.145));     // barrel
  g.add(part(0.020, 0.016, 0.20, STEEL, 0, 0.032, -0.145));     // top strap
  g.add(part(0.040, 0.050, 0.11, DARKSTEEL, 0, 0.006, -0.015)); // frame
  const cyl = tube(0.038, 0.038, 0.085, STEEL, 0, 0.008, -0.03);
  g.add(cyl);
  const grip = part(0.036, 0.125, 0.062, WOODCOL, 0, -0.082, 0.055);
  grip.rotation.x = -0.32;                                      // raked grip
  g.add(grip);
  g.add(part(0.018, 0.038, 0.038, DARKSTEEL, 0, -0.032, 0.022));
  g.add(part(0.022, 0.030, 0.030, DARKSTEEL, 0, 0.040, 0.045)); // hammer
  g.add(part(0.008, 0.016, 0.02, DARKSTEEL, 0, 0.046, -0.238)); // front sight
  g.userData.cylinder = cyl;
  return g;
}

function buildShotgun() {
  const g = new THREE.Group();
  g.add(tube(0.019, 0.019, 0.48, DARKSTEEL, -0.021, 0.012, -0.20));
  g.add(tube(0.019, 0.019, 0.48, DARKSTEEL, 0.021, 0.012, -0.20));
  const breech = part(0.075, 0.05, 0.13, STEEL, 0, 0.005, 0.03);
  g.add(breech);
  g.add(part(0.055, 0.045, 0.20, WOODCOL, 0, -0.012, 0.16));    // stock
  g.add(part(0.05, 0.075, 0.05, WOODCOL, 0, -0.05, 0.075));     // grip
  g.add(part(0.016, 0.026, 0.03, BRASS, 0, 0.038, 0.02));       // hammers
  g.userData.breech = breech;
  return g;
}

function buildRifle() {
  const g = new THREE.Group();
  g.add(tube(0.014, 0.014, 0.62, DARKSTEEL, 0, 0.016, -0.28));
  g.add(part(0.028, 0.03, 0.26, WOODCOL, 0, 0.004, -0.16));     // forestock
  g.add(part(0.034, 0.055, 0.16, STEEL, 0, 0.0, 0.02));         // receiver
  g.add(part(0.03, 0.06, 0.26, WOODCOL, 0, -0.018, 0.19));      // butt
  const lever = part(0.02, 0.06, 0.05, BRASS, 0, -0.055, 0.045);
  g.add(lever);
  g.add(part(0.007, 0.016, 0.02, DARKSTEEL, 0, 0.036, -0.575)); // front sight
  g.add(part(0.02, 0.012, 0.02, DARKSTEEL, 0, 0.032, 0.075));   // rear sight
  g.userData.lever = lever;
  return g;
}

function buildDynamite() {
  const g = new THREE.Group();
  const red = 0xa8332a;
  for (let i = 0; i < 3; i++) {
    g.add(tube(0.026, 0.026, 0.17, red, (i - 1) * 0.052, 0, 0, 'z'));
  }
  g.add(part(0.16, 0.022, 0.06, 0x6b5a3a, 0, 0, 0));            // binding
  g.add(tube(0.005, 0.005, 0.1, 0x2c2822, 0, 0.05, -0.02, 'z'));
  return g;
}

function buildHand() {
  const g = new THREE.Group();
  g.add(part(0.05, 0.07, 0.08, 0xb98d68, 0, -0.055, 0.05));
  g.add(part(0.055, 0.055, 0.06, 0x7a5a3a, 0, -0.09, 0.055));   // cuff
  return g;
}

const BUILDERS = { revolver: buildRevolver, shotgun: buildShotgun, rifle: buildRifle };

export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);

    this.models = {};
    for (const key of Object.keys(BUILDERS)) {
      const m = BUILDERS[key]();
      m.add(buildHand());
      m.visible = false;
      this.root.add(m);
      this.models[key] = m;
    }
    this.dynamiteModel = buildDynamite();
    this.dynamiteModel.visible = false;
    this.root.add(this.dynamiteModel);

    this.current = 'revolver';
    this.models.revolver.visible = true;

    // Tuned against screenshots: any bigger and the barrel eats the crosshair.
    for (const m of Object.values(this.models)) m.scale.setScalar(0.66);
    this.dynamiteModel.scale.setScalar(0.8);
    this.basePos = new THREE.Vector3(0.185, -0.155, -0.30);
    this.adsPos = new THREE.Vector3(0.0, -0.048, -0.235);
    this.recoil = 0;
    this.recoilRot = 0;
    this.bob = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.reloadT = 0;
    this.reloadDur = 0;
    this.swapT = 0;
    this.adsAmount = 0;
    this.throwT = 0;

    this.flash = new THREE.PointLight(0xffbb66, 0, 12, 2);
    this.flash.position.set(0.165, -0.09, -0.72);
    camera.add(this.flash);

    this.flashSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshBasicMaterial({ color: 0xffd489, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.flashSprite.position.set(0.165, -0.11, -0.70);
    this.flashSprite.renderOrder = 999;
    camera.add(this.flashSprite);
  }

  setWeapon(key) {
    if (!this.models[key] || this.current === key) return;
    for (const k of Object.keys(this.models)) this.models[k].visible = k === key;
    this.current = key;
    this.swapT = 1;
  }

  startReload(duration) { this.reloadT = 1; this.reloadDur = Math.max(0.2, duration); }
  cancelReload() { this.reloadT = 0; }

  kick(weapon) {
    const w = WEAPONS[weapon] || WEAPONS.revolver;
    this.recoil = Math.min(0.09, 0.012 * w.recoil);
    this.recoilRot = 0.03 * w.recoil;
    this.flash.intensity = 6;
    this.flashSprite.material.opacity = 0.9;
    this.flashSprite.rotation.z = Math.random() * 6.28;
    this.flashSprite.scale.setScalar(0.7 + Math.random() * 0.7);
  }

  throwAnim() { this.throwT = 1; }

  addSway(dx, dy) {
    this.swayTarget.x = THREE.MathUtils.clamp(this.swayTarget.x - dx * 0.0016, -0.05, 0.05);
    this.swayTarget.y = THREE.MathUtils.clamp(this.swayTarget.y + dy * 0.0016, -0.05, 0.05);
  }

  update(dt, opts) {
    const { moving = false, sprinting = false, grounded = true, ads = false, speed = 0 } = opts;

    // Bob. Damped right down for anybody whose browser says moving pictures
    // are a problem - the gun still reacts, it just stops walking about.
    const m = motionScale(0.2);
    this.bob += dt * (sprinting ? 13 : 8.5) * (moving && grounded ? 1 : 0);
    const bobAmt = (moving && grounded ? (sprinting ? 0.022 : 0.012) : 0) * m;
    const bx = Math.cos(this.bob) * bobAmt;
    const by = Math.abs(Math.sin(this.bob)) * bobAmt * 0.8;

    // Sway lag
    this.swayTarget.multiplyScalar(1 - Math.min(1, dt * 6));
    this.sway.lerp(this.swayTarget, Math.min(1, dt * 12));
    if (m < 1) this.sway.multiplyScalar(m);

    // ADS blend (rifle only)
    const wantAds = ads && WEAPONS[this.current]?.ads ? 1 : 0;
    this.adsAmount += (wantAds - this.adsAmount) * Math.min(1, dt * 12);

    // Recoil decay
    this.recoil *= Math.max(0, 1 - dt * 9);
    this.recoilRot *= Math.max(0, 1 - dt * 9);
    this.flash.intensity *= Math.max(0, 1 - dt * 22);
    this.flashSprite.material.opacity *= Math.max(0, 1 - dt * 20);

    const model = this.models[this.current];
    if (!model) return;

    const base = this.basePos.clone().lerp(this.adsPos, this.adsAmount);
    model.position.set(
      base.x + bx + this.sway.x,
      base.y + by + this.sway.y,
      base.z + this.recoil,
    );
    // Angled across the screen when hip-firing, square-on when aiming.
    const cant = (1 - this.adsAmount) * 0.14;
    model.rotation.set(-this.recoilRot - cant * 0.35, cant, cant * 0.5);

    // Sprinting: drop the muzzle so it is obvious you cannot shoot right now.
    if (sprinting && moving && !ads) {
      model.rotation.x += 0.5;
      model.rotation.z = 0.35;
      model.position.y -= 0.05;
    } else {
      model.rotation.z = 0;
    }

    // Swap: rise from below.
    if (this.swapT > 0) {
      this.swapT = Math.max(0, this.swapT - dt * 3.2);
      model.position.y -= this.swapT * 0.32;
      model.rotation.x += this.swapT * 0.8;
    }

    // Reload: tip the gun over and work the action.
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt / this.reloadDur);
      const k = 1 - this.reloadT;                 // 0 -> 1 across the reload
      const arc = Math.sin(k * Math.PI);
      model.position.y -= arc * 0.16;
      model.position.x += arc * 0.05;
      model.rotation.z += arc * 0.9;
      model.rotation.x += arc * 0.35;
      if (model.userData.cylinder) model.userData.cylinder.rotation.z = k * Math.PI * 4;
      if (model.userData.breech) model.userData.breech.rotation.x = arc * 0.5;
      if (model.userData.lever) model.userData.lever.rotation.x = arc * 1.2;
    } else {
      if (model.userData.lever) model.userData.lever.rotation.x *= 0.8;
      if (model.userData.breech) model.userData.breech.rotation.x *= 0.8;
    }

    // Dynamite windup
    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt * 2.6);
      this.dynamiteModel.visible = true;
      const k = 1 - this.throwT;
      this.dynamiteModel.position.set(0.24 - k * 0.1, -0.2 + Math.sin(k * Math.PI) * 0.25, -0.34 + k * 0.2);
      this.dynamiteModel.rotation.set(k * 5, 0, k * 2);
    } else {
      this.dynamiteModel.visible = false;
    }

    this.flashSprite.visible = this.flashSprite.material.opacity > 0.01;
  }
}
