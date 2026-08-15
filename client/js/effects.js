// Tracers, impacts, dynamite, footprints and the world's pickups.

import * as THREE from 'three';

const TRACER_LIFE = 0.075;
const up = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.sparks = [];
    this.blasts = [];
    this.prints = [];
    this.decals = [];
    this.lootMeshes = new Map();

    this.tracerGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.9, depthWrite: false });

    this.sparkGeo = new THREE.SphereGeometry(0.035, 4, 3);
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0xd9c39a, transparent: true, opacity: 0.85, depthWrite: false });
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x8f2418, transparent: true, opacity: 0.9, depthWrite: false });

    this.printGeo = new THREE.PlaneGeometry(0.2, 0.34);
    this.printMat = new THREE.MeshBasicMaterial({
      color: 0x3a2a18, transparent: true, opacity: 0.5, depthWrite: false,
    });

    this.lootRingGeo = new THREE.RingGeometry(0.3, 0.42, 16);
  }

  // -------------------------------------------------------------- gunfire
  tracer(from, to) {
    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.1) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    mesh.position.copy(a);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    mesh.renderOrder = 700;
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: TRACER_LIFE });
  }

  impact(point, isFlesh = false) {
    const mat = isFlesh ? this.bloodMat : this.dustMat;
    for (let i = 0; i < (isFlesh ? 7 : 5); i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat.clone());
      m.position.set(point[0], point[1], point[2]);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        Math.random() * 2.6,
        (Math.random() - 0.5) * 3.2,
      );
      this.scene.add(m);
      this.sparks.push({ mesh: m, v, life: 0.42 + Math.random() * 0.3 });
    }
  }

  explosion(pos) {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    ball.position.set(pos.x, pos.y, pos.z);
    this.scene.add(ball);
    const light = new THREE.PointLight(0xffa040, 60, 30, 2);
    light.position.copy(ball.position);
    this.scene.add(light);
    this.blasts.push({ mesh: ball, light, life: 0.55, max: 0.55 });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.dustMat.clone());
      m.position.copy(ball.position);
      m.scale.setScalar(2 + Math.random() * 3);
      this.sparks.push({
        mesh: m, life: 0.9 + Math.random() * 0.7,
        v: new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 8, (Math.random() - 0.5) * 14),
      });
      this.scene.add(m);
    }
  }

  // ------------------------------------------------------------ footprints
  showFootprints(list, duration) {
    this.clearFootprints();
    for (const [x, y, z] of list) {
      const m = new THREE.Mesh(this.printGeo, this.printMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI;
      m.position.set(x, y + 0.03, z);
      this.scene.add(m);
      this.prints.push({ mesh: m, life: duration });
    }
  }

  clearFootprints() {
    for (const p of this.prints) this.scene.remove(p.mesh);
    this.prints.length = 0;
  }

  // ----------------------------------------------------------------- loot
  syncLoot(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      if (!this.lootMeshes.has(it.id)) this.lootMeshes.set(it.id, this.makeLoot(it));
    }
    for (const [id, mesh] of [...this.lootMeshes]) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.lootMeshes.delete(id);
      }
    }
  }

  removeLoot(id) {
    const m = this.lootMeshes.get(id);
    if (m) { this.scene.remove(m); this.lootMeshes.delete(id); }
  }

  makeLoot(it) {
    const g = new THREE.Group();
    g.position.set(it.x, it.y, it.z);
    g.userData = { type: it.type, base: it.y };

    const metal = new THREE.MeshLambertMaterial({ color: 0x4a423a });
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a5632 });
    const brass = new THREE.MeshLambertMaterial({ color: 0xc9a24a });

    if (it.type === 'shotgun') {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.72), metal);
      barrel.position.z = -0.12;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.34), wood);
      stock.position.set(0, -0.03, 0.3);
      g.add(barrel, stock);
    } else if (it.type === 'rifle') {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.95), metal);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.4), wood);
      stock.position.set(0, -0.04, 0.42);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.1), brass);
      lever.position.set(0, -0.09, 0.16);
      g.add(barrel, stock, lever);
    } else if (it.type === 'ammo') {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.3), wood);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.32), brass);
      strap.position.y = 0.06;
      g.add(crate, strap);
    } else if (it.type === 'whiskey') {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x8a5a1e }));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0x6b4415 }));
      neck.position.y = 0.21;
      g.add(bottle, neck);
    } else if (it.type === 'dynamite') {
      const red = new THREE.MeshLambertMaterial({ color: 0xa8332a });
      for (let i = 0; i < 3; i++) {
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 7), red);
        stick.position.set((i - 1) * 0.1, 0, 0);
        g.add(stick);
      }
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 4), new THREE.MeshLambertMaterial({ color: 0x2f2a22 }));
      fuse.position.y = 0.2;
      g.add(fuse);
    }

    const ring = new THREE.Mesh(this.lootRingGeo, new THREE.MeshBasicMaterial({
      color: 0xf0d189, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.18;
    g.add(ring);

    this.scene.add(g);
    return g;
  }

  nearestLoot(camPos, maxDist = 2.4) {
    let best = null, bd = maxDist * maxDist;
    for (const [id, g] of this.lootMeshes) {
      const d = g.position.distanceToSquared(camPos);
      if (d < bd) { bd = d; best = { id, type: g.userData.type, dist: Math.sqrt(d) }; }
    }
    return best;
  }

  // --------------------------------------------------------------- update
  update(dt, t) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.mesh.material.opacity = Math.max(0, tr.life / TRACER_LIFE) * 0.9;
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        tr.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.v.y -= 16 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.material.opacity = Math.max(0, s.life) * 1.4;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.mesh.scale.setScalar(0.6 + k * 6.4);
      b.mesh.material.opacity = Math.max(0, 1 - k) * 0.95;
      b.light.intensity = Math.max(0, 1 - k) * 60;
      if (b.life <= 0) {
        this.scene.remove(b.mesh); this.scene.remove(b.light);
        b.mesh.material.dispose(); b.mesh.geometry.dispose();
        this.blasts.splice(i, 1);
      }
    }
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const p = this.prints[i];
      p.life -= dt;
      p.mesh.material.opacity = Math.min(0.5, Math.max(0, p.life) * 0.5);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.prints.splice(i, 1);
      }
    }
    for (const g of this.lootMeshes.values()) {
      g.rotation.y += dt * 1.1;
      g.position.y = g.userData.base + 0.34 + Math.sin(t * 1.8 + g.position.x) * 0.06;
    }
  }
}
