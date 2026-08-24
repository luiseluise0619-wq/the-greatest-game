// Builds the town in three.js straight from shared/map.js.
//
// There are no art assets anywhere in this project: every material below is a
// canvas painted at runtime. That keeps the repo tiny and the look consistent -
// stylised, dusty, readable at a glance, which matters when you are trying to
// identify a silhouette across Main Street.

import * as THREE from 'three';
import MAP from '../../shared/map.js';

const texCache = new Map();
const windmills = [];

function canvasTex(key, size, draw, repeat = 1) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function noise(g, size, alpha, scale = 1, tint = '0,0,0') {
  for (let i = 0; i < size * size * 0.22 * scale; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    g.fillStyle = `rgba(${tint},${Math.random() * alpha})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Vertical or horizontal planking with grain and gaps. */
function planks(base, dark, vertical, count = 6) {
  return (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const step = s / count;
    for (let i = 0; i < count; i++) {
      const shade = 0.86 + Math.random() * 0.28;
      g.fillStyle = shadeHex(base, shade);
      if (vertical) g.fillRect(i * step, 0, step - 1.5, s);
      else g.fillRect(0, i * step, s, step - 1.5);
      // grain
      g.strokeStyle = `rgba(0,0,0,0.10)`;
      g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        if (vertical) {
          const x = i * step + Math.random() * step;
          g.moveTo(x, 0); g.bezierCurveTo(x + 4, s * 0.3, x - 4, s * 0.7, x, s);
        } else {
          const y = i * step + Math.random() * step;
          g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + 4, s * 0.7, y - 4, s, y);
        }
        g.stroke();
      }
    }
    g.fillStyle = dark;
    for (let i = 0; i <= count; i++) {
      if (vertical) g.fillRect(i * step - 1, 0, 2, s);
      else g.fillRect(0, i * step - 1, s, 2);
    }
    noise(g, s, 0.16);
  };
}

function shadeHex(hex, mult) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * mult) | 0;
  const gg = Math.min(255, ((n >> 8) & 255) * mult) | 0;
  const b = Math.min(255, (n & 255) * mult) | 0;
  return `rgb(${r},${gg},${b})`;
}

function rough(base, spots, spotColor) {
  return (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < spots; i++) {
      g.fillStyle = spotColor;
      g.globalAlpha = 0.1 + Math.random() * 0.35;
      g.beginPath();
      g.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 22, 3 + Math.random() * 18, Math.random() * 3, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    noise(g, s, 0.22);
  };
}

function shingles(base, dark) {
  return (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const rows = 9, h = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (s / 14);
      for (let c = -1; c < 8; c++) {
        g.fillStyle = shadeHex(base, 0.82 + Math.random() * 0.36);
        g.fillRect(off + c * (s / 7) + 1, r * h + 1, s / 7 - 2, h - 2);
      }
    }
    g.fillStyle = dark;
    for (let r = 0; r <= rows; r++) g.fillRect(0, r * h - 1, s, 2);
    noise(g, s, 0.2);
  };
}

// tag -> material description
const MATS = {
  plank:      { c: 0x8a6440, tex: planks('#8a6440', '#4d371f', true, 7) },
  plankLight: { c: 0xa78257, tex: planks('#a78257', '#5f452a', true, 8) },
  plankDark:  { c: 0x5f4529, tex: planks('#5f4529', '#31220f', true, 6) },
  plankWhite: { c: 0xd8cdb4, tex: planks('#d8cdb4', '#9a8e73', true, 9) },
  wood:       { c: 0x74532f, tex: planks('#74532f', '#402c16', false, 4) },
  boardwalk:  { c: 0x7d5c38, tex: planks('#7d5c38', '#452f19', false, 9) },
  awning:     { c: 0x9b3f34, tex: planks('#9b3f34', '#5e241d', true, 10) },
  railing:    { c: 0x6b4c2c, tex: planks('#6b4c2c', '#3a2713', false, 3) },
  adobe:      { c: 0xc2a276, tex: rough('#c2a276', 70, '#9a7b52') },
  stone:      { c: 0x9a938a, tex: rough('#9a938a', 90, '#6f6a63') },
  floorStone: { c: 0x8a837a, tex: rough('#8a837a', 90, '#615c56') },
  rock:       { c: 0xa98d6b, tex: rough('#a98d6b', 120, '#7a6248') },
  rockWall:   { c: 0x6d5a45, tex: rough('#6d5a45', 140, '#463726') },
  cliff:      { c: 0xc3a07a, tex: rough('#c3a07a', 120, '#9d7d5c') },
  roof:       { c: 0x6a4c34, tex: shingles('#6a4c34', '#3c2a1a') },
  roofTile:   { c: 0xa85f42, tex: shingles('#a85f42', '#6d3624') },
  roofDark:   { c: 0x4b4038, tex: shingles('#4b4038', '#2a231d') },
  crate:      { c: 0x9c7746, tex: planks('#9c7746', '#5a4325', false, 4) },
  barrel:     { c: 0x7b5730, tex: planks('#7b5730', '#412c15', false, 7) },
  bar:        { c: 0x5c3a22, tex: planks('#5c3a22', '#2f1c0e', false, 5) },
  shelf:      { c: 0x6d4b2c, tex: planks('#6d4b2c', '#3b2714', false, 6) },
  table:      { c: 0x69472a, tex: planks('#69472a', '#382312', false, 5) },
  pew:        { c: 0x7a5a38, tex: planks('#7a5a38', '#42301c', false, 4) },
  altar:      { c: 0xc9bda2, tex: rough('#c9bda2', 40, '#9d907a') },
  piano:      { c: 0x33241a, tex: rough('#33241a', 30, '#1a1109') },
  cot:        { c: 0x8f8570, tex: rough('#8f8570', 40, '#6b634f') },
  hay:        { c: 0xc9a94e, tex: rough('#c9a94e', 160, '#a3862f') },
  grave:      { c: 0x9d968b, tex: rough('#9d968b', 60, '#736c62') },
  fence:      { c: 0x6f5636, tex: planks('#6f5636', '#3e2c17', true, 12) },
  trough:     { c: 0x5b4227, tex: planks('#5b4227', '#31210f', false, 4) },
  wagon:      { c: 0x77583a, tex: planks('#77583a', '#412d19', false, 6) },
  wheel:      { c: 0x4a3520, tex: rough('#4a3520', 20, '#2a1c0d') },
  bars:       { c: 0x3c3a36, tex: null },
  tank:       { c: 0x6e6257, tex: planks('#6e6257', '#453d35', false, 8) },
  rail:       { c: 0x59504a, tex: null },
  oreCart:    { c: 0x574c42, tex: rough('#574c42', 30, '#332c26') },
  bell:       { c: 0xb8913f, tex: null },
  cactus:     { c: 0x5c7a48, tex: rough('#5c7a48', 60, '#3f5730') },
};

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // --- sky: a cheap gradient dome, warm at the horizon.
  const skyGeo = new THREE.SphereGeometry(600, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f74a8) },
      mid: { value: new THREE.Color(0xc4a274) },
      bot: { value: new THREE.Color(0xe4c088) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vP; uniform vec3 top, mid, bot;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(mix(bot, mid, smoothstep(-0.08, 0.16, h)), top, smoothstep(0.12, 0.62, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xdcbe93, 38, 168);

  // --- lights: low warm sun + cool sky bounce. Long shadows read as late afternoon.
  const sun = new THREE.DirectionalLight(0xffdcae, 2.5);
  sun.position.set(-70, 78, 46);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
  sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0016;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd2ee, 0xb08a56, 0.85));
  scene.add(new THREE.AmbientLight(0xffe6c4, 0.32));

  // --- ground
  const groundTex = canvasTex('ground', 512, rough('#d6b98a', 420, '#c1a375'), 150);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ map: groundTex, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // A dirt track down Main Street so the street reads as a street.
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 15),
    new THREE.MeshLambertMaterial({ map: canvasTex('road', 256, rough('#b99a6d', 220, '#9c8055'), 14), transparent: true, opacity: 0.95 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(-5, 0.01, 0);
  road.receiveShadow = true;
  group.add(road);

  // --- the town itself: one merged mesh per material tag keeps draw calls sane.
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const byMat = new Map();
  for (const b of MAP.solids) {
    if (b.mat === 'cliff') continue;                 // drawn separately, no shadows
    // Some solids are the collision shape for something drawn by hand - the
    // table is a box to a bullet and a round board to look at - so they say so
    // rather than being drawn twice.
    if (b.unseen) continue;
    if (!byMat.has(b.mat)) byMat.set(b.mat, []);
    byMat.get(b.mat).push(b);
  }

  for (const [tag, boxes] of byMat) {
    const desc = MATS[tag] || MATS.wood;
    const mat = new THREE.MeshLambertMaterial({
      color: desc.c,
      map: desc.tex ? canvasTex(tag, 128, desc.tex, 1) : null,
    });
    if (mat.map) mat.color.setHex(0xffffff);
    const mesh = new THREE.InstancedMesh(unit, mat, boxes.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      const sx = b.q[0] - b.p[0], sy = b.q[1] - b.p[1], sz = b.q[2] - b.p[2];
      m.makeScale(sx, sy, sz);
      m.setPosition((b.p[0] + b.q[0]) / 2, (b.p[1] + b.q[1]) / 2, (b.p[2] + b.q[2]) / 2);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Cliffs: big, unlit-ish, no shadow work.
  const cliffs = MAP.solids.filter((b) => b.mat === 'cliff');
  const cliffMat = new THREE.MeshLambertMaterial({ map: canvasTex('cliff', 256, MATS.cliff.tex, 10) });
  const cliffMesh = new THREE.InstancedMesh(unit, cliffMat, cliffs.length);
  const cm = new THREE.Matrix4();
  cliffs.forEach((b, i) => {
    cm.makeScale(b.q[0] - b.p[0], b.q[1] - b.p[1], b.q[2] - b.p[2]);
    cm.setPosition((b.p[0] + b.q[0]) / 2, (b.p[1] + b.q[1]) / 2, (b.p[2] + b.q[2]) / 2);
    cliffMesh.setMatrixAt(i, cm);
  });
  cliffMesh.instanceMatrix.needsUpdate = true;
  group.add(cliffMesh);

  // --- interior lamps so buildings are readable from the doorway.
  for (const l of MAP.lamps) {
    const light = new THREE.PointLight(l.color, l.intensity * 1.6, l.distance || 20, 1.6);
    light.position.set(l.x, l.y, l.z);
    group.add(light);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshBasicMaterial({ color: l.color }),
    );
    bulb.position.copy(light.position);
    group.add(bulb);
  }

  // --- decorative props (cactus arms, windmill blades)
  const cactusMat = new THREE.MeshLambertMaterial({ color: 0x5c7a48 });
  for (const p of MAP.props) {
    if (p.type === 'cactusArm') {
      for (const side of [-1, 1]) {
        if (Math.random() < 0.35) continue;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.24), cactusMat);
        arm.position.set(p.x + side * 0.42, p.h * 0.58, p.z);
        arm.castShadow = true;
        group.add(arm);
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.24, p.h * 0.3, 0.24), cactusMat);
        up.position.set(p.x + side * 0.72, p.h * 0.72, p.z);
        up.castShadow = true;
        group.add(up);
      }
    } else if (p.type === 'table') {
      // The table the turn mode is played round. A plank top on a frame, with
      // the marks everybody stands on burnt into the dirt around it - so that
      // where you were dealt is a thing you can see rather than a number.
      const topMat = new THREE.MeshLambertMaterial({ color: 0x6b4c2e });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.98, 0.16, 22), topMat);
      top.position.set(p.x, p.y - 0.08, p.z);
      top.castShadow = true; top.receiveShadow = true;
      group.add(top);
      const rimMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.09, 6, 26), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(p.x, p.y - 0.02, p.z);
      group.add(rim);
      // Planks across the top, so it reads as boards rather than a disc.
      for (let i = -3; i <= 3; i++) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(p.r * 1.9, 0.01, 0.035),
          new THREE.MeshLambertMaterial({ color: 0x4a3320 }),
        );
        line.position.set(p.x, p.y + 0.005, p.z + i * (p.r / 3.6));
        group.add(line);
      }
      const legMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, p.y - 0.1, 0.16), legMat);
        leg.position.set(p.x + dx * (p.r - 0.7), (p.y - 0.1) / 2, p.z + dz * (p.r - 0.7));
        leg.castShadow = true;
        group.add(leg);
      }
      const markMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1c, transparent: true, opacity: 0.5 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const mark = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.52, 18), markMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(p.x + Math.cos(a) * p.standing, 0.02, p.z + Math.sin(a) * p.standing);
        group.add(mark);
      }
    } else if (p.type === 'windmill') {
      const hub = new THREE.Group();
      hub.position.set(p.x, p.y, p.z + 0.5);
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0x8a7350, side: THREE.DoubleSide });
      for (let i = 0; i < 8; i++) {
        const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 2.4), bladeMat);
        blade.position.set(Math.cos((i / 8) * 7) * 1.35, Math.sin((i / 8) * 7) * 1.35, 0);
        blade.rotation.z = (i / 8) * 7 + Math.PI / 2;
        hub.add(blade);
      }
      group.add(hub);
      windmills.push(hub);
    }
  }

  // --- floating dust motes, thickest low down where the light catches them.
  const dustCount = 900;
  const dustGeo = new THREE.BufferGeometry();
  const dp = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 150;
    dp[i * 3 + 1] = Math.random() * Math.random() * 14 + 0.2;
    dp[i * 3 + 2] = (Math.random() - 0.5) * 150;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xf4dcb4, size: 0.075, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  group.add(dust);

  return { group, sun, dust, windmills };
}

export function animateWorld(world, dt, t, camera) {
  for (const w of world.windmills) w.rotation.z += dt * 0.55;
  // Keep the dust field centred on the player so it never runs out.
  if (world.dust && camera) {
    world.dust.position.x = Math.round(camera.position.x / 150) * 150;
    world.dust.position.z = Math.round(camera.position.z / 150) * 150;
    world.dust.rotation.y = t * 0.008;
  }
}

export { MATS };
