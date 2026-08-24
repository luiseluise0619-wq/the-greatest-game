// PERDITION FLATS - the one map of the prototype.
//
// The whole town is expressed as axis-aligned boxes so the server and the client
// agree on collision and line of sight without shipping any art assets. Materials
// are just tags; the client turns them into procedurally generated textures.
//
// Layout (x east, z south, y up):
//
//        WINDMILL / DESERT                    MINE HILL
//   +--------------------------------------------------+
//   |   SALOON    SHERIFF    GENERAL STORE   >- MINE    |   north row (z < -8)
//   |=========== MAIN STREET (z -6 .. 6) ==============|
//   |   STABLE      CHURCH        CEMETERY             |   south row (z > 8)
//   +--------------------------------------------------+
//                  DESERT OUTSKIRTS
//
// Every rooftop is reachable: STEP_RISE is kept under PLAYER.stepHeight so the
// stair helpers below produce geometry the movement code can actually walk up.

const STEP_RISE = 0.58;   // must stay < PLAYER.stepHeight (0.62)

const solids = [];
const lamps = [];
const props = [];

let boxId = 0;
function box(p, q, mat, opts = {}) {
  const b = {
    id: boxId++,
    p: [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])],
    q: [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])],
    mat,
    ...opts,
  };
  solids.push(b);
  return b;
}

// A wall with holes cut in it (doors, windows, mine mouths).
// axis 'x' -> the wall runs along x at a fixed z. axis 'z' -> runs along z at fixed x.
function wall(axis, fixed, from, to, y0, y1, t, mat, openings = []) {
  const half = t / 2;
  const sorted = openings.slice().sort((a, b) => a.c0 - b.c0);
  let cursor = Math.min(from, to);
  const end = Math.max(from, to);
  const put = (c0, c1, ry0, ry1) => {
    if (c1 - c0 < 0.02 || ry1 - ry0 < 0.02) return;
    if (axis === 'x') box([c0, ry0, fixed - half], [c1, ry1, fixed + half], mat);
    else box([fixed - half, ry0, c0], [fixed + half, ry1, c1], mat);
  };
  for (const o of sorted) {
    put(cursor, o.c0, y0, y1);
    if (o.y0 > y0) put(o.c0, o.c1, y0, o.y0);
    if (o.y1 < y1) put(o.c0, o.c1, o.y1, y1);
    cursor = o.c1;
  }
  put(cursor, end, y0, y1);
}

/** Hollow building: four walls with openings, a walkable roof slab, an interior lamp. */
function building(o) {
  const {
    x0, z0, x1, z1,
    h = 4.8, t = 0.32,
    mat = 'plank', roofMat = 'roof',
    roofT = 0.36, overhang = 0.45,
    openings = {},
    lamp = true, lampY = null, lampColor = 0xffb46a, lampIntensity = 1.0,
    roof = true,
  } = o;

  wall('x', z0, x0, x1, 0, h, t, mat, openings.N || []);
  wall('x', z1, x0, x1, 0, h, t, mat, openings.S || []);
  wall('z', x0, z0, z1, 0, h, t, mat, openings.W || []);
  wall('z', x1, z0, z1, 0, h, t, mat, openings.E || []);

  if (roof) box([x0 - overhang, h, z0 - overhang], [x1 + overhang, h + roofT, z1 + overhang], roofMat);
  if (lamp) {
    lamps.push({
      x: (x0 + x1) / 2, y: lampY ?? h - 0.9, z: (z0 + z1) / 2,
      color: lampColor, intensity: lampIntensity, distance: Math.max(x1 - x0, z1 - z0) * 1.6,
    });
  }
  return { x0, z0, x1, z1, h, roofY: h + roofT };
}

/**
 * A run of steps climbing from baseY. Each step is a solid box, so the movement
 * code's step-up handles them; returns the height of the top step.
 */
function steps(x, z, dirX, dirZ, count, baseY = 0, rise = STEP_RISE, run = 0.85, width = 2.0, mat = 'wood') {
  const hw = width / 2;
  for (let i = 0; i < count; i++) {
    const cx = x + dirX * run * i;
    const cz = z + dirZ * run * i;
    const ax0 = dirX ? Math.min(cx, cx + dirX * run) : cx - hw;
    const ax1 = dirX ? Math.max(cx, cx + dirX * run) : cx + hw;
    const az0 = dirZ ? Math.min(cz, cz + dirZ * run) : cz - hw;
    const az1 = dirZ ? Math.max(cz, cz + dirZ * run) : cz + hw;
    box([ax0, 0, az0], [ax1, baseY + rise * (i + 1), az1], mat);
  }
  return baseY + rise * count;
}

/** Same, but each step floats at height (used on balconies, where a pillar would look wrong). */
function floatSteps(x, z, dirX, dirZ, count, baseY, rise = STEP_RISE, run = 0.8, width = 1.6, mat = 'crate') {
  const hw = width / 2;
  for (let i = 0; i < count; i++) {
    const cx = x + dirX * run * i;
    const cz = z + dirZ * run * i;
    const ax0 = dirX ? Math.min(cx, cx + dirX * run) : cx - hw;
    const ax1 = dirX ? Math.max(cx, cx + dirX * run) : cx + hw;
    const az0 = dirZ ? Math.min(cz, cz + dirZ * run) : cz - hw;
    const az1 = dirZ ? Math.max(cz, cz + dirZ * run) : cz + hw;
    box([ax0, baseY + rise * i - 0.3, az0], [ax1, baseY + rise * (i + 1), az1], mat);
  }
  return baseY + rise * count;
}

/**
 * Covered boardwalk. `doors` lists x-ranges that must stay clear - a post in the
 * middle of a doorway is the kind of thing you only notice when somebody tries
 * to run through it under fire.
 */
function porch(x0, z0, x1, z1, doors = [], deckY = 0.28, postH = 3.2) {
  box([x0, 0, z0], [x1, deckY, z1], 'boardwalk');
  const span = x1 - x0;
  const n = Math.max(2, Math.round(span / 3.6));
  const zc = (z0 + z1) / 2;
  for (let i = 0; i <= n; i++) {
    const px = x0 + (span * i) / n;
    if (doors.some(([a, b]) => px > a - 0.75 && px < b + 0.75)) continue;
    box([px - 0.11, deckY, zc - 0.11], [px + 0.11, postH, zc + 0.11], 'wood');
  }
  box([x0 - 0.2, postH, z0 - 0.1], [x1 + 0.2, postH + 0.22, z1 + 0.35], 'awning');
}

function crate(x, z, s = 1.0, y = 0, mat = 'crate') {
  box([x - s / 2, y, z - s / 2], [x + s / 2, y + s, z + s / 2], mat);
}
function barrel(x, z, y = 0, r = 0.45, h = 1.15) {
  box([x - r, y, z - r], [x + r, y + h, z + r], 'barrel', { round: true });
}
function grave(x, z, w = 0.7, h = 1.0) {
  box([x - w / 2, 0, z - 0.12], [x + w / 2, h, z + 0.12], 'grave');
}
function rock(x, z, w, h, d) {
  box([x - w / 2, 0, z - d / 2], [x + w / 2, h, z + d / 2], 'rock', { rough: true });
}
function cactus(x, z, h = 2.6) {
  box([x - 0.28, 0, z - 0.28], [x + 0.28, h, z + 0.28], 'cactus');
  props.push({ type: 'cactusArm', x, z, h });
}
function fence(x0, z0, x1, z1, h = 1.15, mat = 'fence') {
  if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) box([x0, 0, z0 - 0.08], [x1, h, z0 + 0.08], mat);
  else box([x0 - 0.08, 0, z0], [x0 + 0.08, h, z1], mat);
}
function wagon(x, z, alongZ = false) {
  if (alongZ) {
    box([x - 1.3, 0.55, z - 2.6], [x + 1.3, 1.85, z + 2.6], 'wagon');
    for (const [wx, wz] of [[-1.25, -1.8], [1.25, -1.8], [-1.25, 1.8], [1.25, 1.8]]) {
      box([x + wx - 0.2, 0, z + wz - 0.4], [x + wx + 0.2, 1.1, z + wz + 0.4], 'wheel');
    }
  } else {
    box([x - 2.6, 0.55, z - 1.3], [x + 2.6, 1.85, z + 1.3], 'wagon');
    for (const [wx, wz] of [[-1.8, -1.25], [-1.8, 1.25], [1.8, -1.25], [1.8, 1.25]]) {
      box([x + wx - 0.4, 0, z + wz - 0.2], [x + wx + 0.4, 1.1, z + wz + 0.2], 'wheel');
    }
  }
}

// ---------------------------------------------------------------------------
// BOUNDS - mesa walls hemming the valley in.
// ---------------------------------------------------------------------------
export const WORLD_BOUNDS = { min: -74, max: 74 };
const B = WORLD_BOUNDS;
// A continuous canyon wall (so the horizon line stays clean) with taller buttes
// rising behind it to break up the silhouette.
const RIM = 28;
box([B.min - 20, 0, B.min - 20], [B.min, RIM, B.max + 20], 'cliff');
box([B.max, 0, B.min - 20], [B.max + 20, RIM, B.max + 20], 'cliff');
box([B.min, 0, B.min - 20], [B.max, RIM, B.min], 'cliff');
box([B.min, 0, B.max], [B.max, RIM, B.max + 20], 'cliff');
for (let i = 0; i < 7; i++) {
  const t = B.min + ((B.max - B.min) * (i + 0.5)) / 7;
  const w = 16 + ((i * 31) % 5) * 5;
  const h = RIM + 6 + ((i * 17) % 4) * 7;
  box([B.min - 22, 0, t - w / 2], [B.min - 3, h, t + w / 2], 'cliff');
  box([B.max + 3, 0, t - w / 2], [B.max + 22, h - 4, t + w / 2], 'cliff');
  box([t - w / 2, 0, B.min - 22], [t + w / 2, h - 2, B.min - 3], 'cliff');
  box([t - w / 2, 0, B.max + 3], [t + w / 2, h + 2, B.max + 22], 'cliff');
}

// ---------------------------------------------------------------------------
// MAIN STREET
// ---------------------------------------------------------------------------
porch(-32, -8.6, -12, -6.4, [[-24.0, -20.6]]);      // saloon doors
porch(-9, -8.6, 5, -6.4, [[-3.4, -0.6]]);            // office door
porch(9, -8.6, 27, -6.4, [[16.2, 19.4]]);            // store door

box([-26, 0, -4.4], [-20, 0.95, -3.4], 'trough');
box([2, 0, 3.2], [8, 0.95, 4.2], 'trough');
box([-14.1, 0, -1.4], [-13.5, 1.25, 2.6], 'wood');       // hitching rail

wagon(-38, 0.5);
wagon(30, -1.5, true);
barrel(-11.5, -5.6); barrel(-10.4, -5.0); barrel(7.6, -5.4);
barrel(28.2, -5.4); barrel(27.1, -4.6); barrel(-33.2, -4.8);
crate(-12.6, 4.2, 1.1); crate(-11.6, 3.4, 0.9);
crate(16, 5.4, 1.2); crate(17.1, 5.0, 1.0);
crate(-2.5, 6.0, 1.1); crate(-3.6, 5.4, 0.9);

// ---------------------------------------------------------------------------
// SALOON - the social heart. Two rooms, a bar, a balcony over the street.
// ---------------------------------------------------------------------------
const SALOON_H = 5.4;
building({
  x0: -32, z0: -26, x1: -12, z1: -8, h: SALOON_H, mat: 'plank',
  lampY: 4.2, lampIntensity: 1.4, lampColor: 0xffa552,
  openings: {
    S: [
      { c0: -24.0, c1: -20.6, y0: 0, y1: 2.9 },        // swinging doors
      { c0: -30.0, c1: -27.4, y0: 1.15, y1: 2.75 },
      { c0: -18.0, c1: -15.4, y0: 1.15, y1: 2.75 },
    ],
    N: [{ c0: -26.4, c1: -23.6, y0: 0, y1: 2.6 }],      // back door to the alley
    W: [{ c0: -21.0, c1: -18.2, y0: 1.2, y1: 2.7 }],
    E: [{ c0: -22.5, c1: -19.5, y0: 0, y1: 2.6 }],      // side door
  },
});
box([-31.2, 0, -24.5], [-29.6, 1.15, -12.5], 'bar');
box([-31.86, 1.4, -24.5], [-31.3, 3.4, -12.5], 'shelf');
wall('z', -19.5, -25.6, -8.4, 0, SALOON_H, 0.28, 'plank', [{ c0: -16.5, c1: -13.6, y0: 0, y1: 2.6 }]);
box([-17.4, 0, -14.4], [-14.6, 0.85, -11.6], 'table');
box([-24.6, 0, -13.6], [-22.0, 0.85, -11.0], 'table');
box([-27.6, 0.9, -20.4], [-27.0, 2.0, -17.8], 'table');   // flipped table = cover
box([-24.4, 0, -25.2], [-21.0, 1.35, -23.6], 'piano');

// Balcony over the street, wrapping round the west side.
box([-34.4, 3.4, -8.9], [-14.0, 3.66, -6.2], 'boardwalk');
box([-34.4, 3.66, -6.55], [-14.0, 4.45, -6.2], 'railing');
box([-34.4, 3.4, -22.0], [-32.5, 3.66, -8.8], 'boardwalk');
box([-34.55, 3.66, -22.0], [-34.4, 4.45, -6.2], 'railing');
steps(-36.6, -8.4, 0, -1, 7, 0, 0.55, 1.0, 2.4);          // street -> balcony
// Balcony -> saloon roof (roof top = 5.76).
floatSteps(-33.6, -13.0, 0, -1, 4, 3.66, 0.55, 0.9, 1.5);
box([-33.9, 5.66, -18.2], [-32.3, 5.86, -14.6], 'wood');  // landing plank onto the roof

// ---------------------------------------------------------------------------
// SHERIFF'S OFFICE - jail cells, gun rack, the landmark everyone watches.
// ---------------------------------------------------------------------------
const OFFICE = building({
  x0: -9, z0: -22, x1: 5, z1: -8, h: 4.6, mat: 'adobe', roofMat: 'roofTile',
  lampY: 3.6, lampColor: 0xffc27a,
  openings: {
    S: [
      { c0: -3.4, c1: -0.6, y0: 0, y1: 2.7 },
      { c0: -7.6, c1: -5.4, y0: 1.2, y1: 2.6 },
      { c0: 1.6, c1: 3.8, y0: 1.2, y1: 2.6 },
    ],
    N: [{ c0: -6.4, c1: -4.6, y0: 1.4, y1: 2.5 }],
    E: [{ c0: -20.4, c1: -18.0, y0: 0, y1: 2.6 }],
  },
});
for (let i = 0; i < 9; i++) {
  const bx = -8.6 + i * 0.62;
  box([bx, 0, -15.2], [bx + 0.14, 3.0, -15.06], 'bars');   // you can be seen, not shot
}
box([-8.84, 0, -21.84], [-3.2, 0.45, -15.2], 'floorStone');
box([-8.6, 0.45, -21.4], [-6.6, 1.05, -19.2], 'cot');
box([-2.6, 0, -13.6], [1.4, 0.9, -11.2], 'table');
box([2.4, 1.2, -21.7], [4.4, 2.6, -21.0], 'shelf');        // gun rack
box([-9.45, 4.96, -22.45], [5.45, 5.16, -20.6], 'railing');
// Alley steps up to the office roof (top 4.96).
steps(6.4, -11.0, 0, -1, 9, 0, 0.56, 0.85, 1.9);
box([5.0, 4.9, -19.2], [6.9, 5.06, -16.4], 'wood');        // landing onto the roof

// ---------------------------------------------------------------------------
// GENERAL STORE - deepest interior, best loot, worst escape routes.
// ---------------------------------------------------------------------------
const STORE = building({
  x0: 10, z0: -24, x1: 27, z1: -8, h: 5.0, mat: 'plankLight',
  lampY: 4.0, lampIntensity: 1.25,
  openings: {
    S: [
      { c0: 16.2, c1: 19.4, y0: 0, y1: 2.8 },
      { c0: 11.4, c1: 14.2, y0: 1.2, y1: 2.8 },
      { c0: 21.6, c1: 24.6, y0: 1.2, y1: 2.8 },
    ],
    N: [{ c0: 17.0, c1: 19.6, y0: 0, y1: 2.6 }],
    W: [{ c0: -20.0, c1: -17.4, y0: 0, y1: 2.6 }],
  },
});
for (let i = 0; i < 3; i++) {
  const sx = 12.6 + i * 4.4;
  box([sx, 0, -22.4], [sx + 1.0, 2.2, -14.0], 'shelf');
}
box([24.4, 0, -22.6], [26.2, 1.1, -12.0], 'bar');
box([11.0, 0, -12.6], [14.4, 1.6, -10.4], 'crate');
box([11.2, 1.6, -12.2], [13.0, 2.55, -10.8], 'crate');
box([9.55, 5.36, -24.4], [27.45, 5.56, -22.9], 'railing');
// Back-alley steps to the store roof (top 5.36).
steps(29.6, -22.0, -0, -1, 10, 0, 0.56, 0.85, 1.9);
box([27.2, 5.3, -18.0], [29.8, 5.46, -15.2], 'wood');

// Rooftop plank bridges: saloon -> office -> store. Rooftops own the street.
box([-12.4, 5.30, -20.4], [-9.2, 5.50, -18.4], 'wood');   // saloon roof (5.76) -> office roof (4.96)
box([5.2, 5.00, -21.4], [9.7, 5.20, -19.4], 'wood');      // office roof -> store roof (5.36)

// ---------------------------------------------------------------------------
// STABLE - open sided, hay bales, sightline down the whole south row.
// ---------------------------------------------------------------------------
const STABLE_H = 5.0;
box([-40.32, 0, 8], [-40, STABLE_H, 22], 'plankDark');
wall('x', 22, -40, -22, 0, STABLE_H, 0.32, 'plankDark', [{ c0: -34, c1: -28, y0: 0, y1: 3.2 }]);
wall('z', -22, 8, 22, 0, STABLE_H, 0.32, 'plankDark', [{ c0: 11, c1: 15, y0: 0, y1: 3.2 }]);
for (let i = 0; i <= 4; i++) box([-40 + i * 4.5 - 0.15, 0, 7.85], [-40 + i * 4.5 + 0.15, STABLE_H, 8.15], 'wood');
box([-40.6, STABLE_H, 7.4], [-21.4, STABLE_H + 0.36, 22.6], 'roof');
lamps.push({ x: -31, y: 4.0, z: 15, color: 0xffb46a, intensity: 0.95, distance: 24 });
for (let i = 0; i < 4; i++) {
  const sz = 10 + i * 3.2;
  box([-39.9, 0, sz], [-33.0, 1.5, sz + 0.28], 'plankDark');
}
box([-27.5, 0, 10.2], [-25.5, 1.6, 12.2], 'hay');
box([-27.4, 1.6, 10.4], [-25.7, 2.9, 12.0], 'hay');
box([-24.0, 0, 17.5], [-22.2, 1.6, 19.5], 'hay');
steps(-20.4, 20.6, 0, -1, 10, 0, 0.56, 0.85, 2.0);        // outside east wall -> stable roof (5.36)
box([-21.9, 5.3, -0 + 14.0], [-20.0, 5.46, 16.8], 'wood');

// ---------------------------------------------------------------------------
// CHURCH - tallest building, long nave, walkable roof and steeple mass.
// ---------------------------------------------------------------------------
const CHURCH_H = 7.2;
building({
  x0: -8, z0: 11, x1: 8, z1: 29, h: CHURCH_H, mat: 'plankWhite', roofMat: 'roofDark',
  lampY: 5.4, lampColor: 0xcfd8ff, lampIntensity: 0.95,
  openings: {
    N: [{ c0: -1.8, c1: 1.8, y0: 0, y1: 3.4 }],
    W: [{ c0: 15, c1: 17, y0: 2.0, y1: 4.6 }, { c0: 21, c1: 23, y0: 2.0, y1: 4.6 }],
    E: [{ c0: 15, c1: 17, y0: 2.0, y1: 4.6 }, { c0: 21, c1: 23, y0: 2.0, y1: 4.6 }],
    S: [{ c0: -2.0, c1: 2.0, y0: 2.2, y1: 5.0 }],
  },
});
for (let i = 0; i < 6; i++) {
  const pz = 14.5 + i * 2.3;
  box([-6.2, 0, pz], [-1.0, 0.95, pz + 0.5], 'pew');
  box([1.0, 0, pz], [6.2, 0.95, pz + 0.5], 'pew');
}
box([-2.4, 0, 27.0], [2.4, 1.0, 28.2], 'altar');
// Steeple mass on the roof (roof top 7.56) + bell.
box([-2.6, 7.56, 11.9], [2.6, 12.6, 15.1], 'plankWhite');
box([-3.1, 12.6, 11.4], [3.1, 13.0, 15.6], 'roofDark');
box([-0.36, 10.6, 11.6], [0.36, 11.6, 11.95], 'bell');
box([-8.45, 7.56, 10.55], [8.45, 7.86, 11.1], 'railing');
box([-8.45, 7.56, 28.9], [8.45, 7.86, 29.45], 'railing');
// East-side steps to the church roof.
steps(9.4, 28.4, 0, -1, 14, 0, 0.56, 0.85, 1.9);
box([8.2, 7.5, 20.2], [10.0, 7.66, 17.6], 'wood');

// ---------------------------------------------------------------------------
// CEMETERY - low cover, long lines, the classic showdown ground.
// ---------------------------------------------------------------------------
// Gates: without gaps this is a sealed box nobody can ever walk into.
fence(14, 10, 22, 10);            // north fence, gate at x 22..26 facing the street
fence(26, 10, 36, 10);
fence(14, 26, 36, 26);
fence(14, 10, 14, 16);             // west fence, gate at z 16..19
fence(14, 19, 14, 26);
fence(36, 10, 36, 26);
// Gateposts, so the openings read as gates rather than gaps.
for (const [gx, gz] of [[22, 10], [26, 10], [14, 16], [14, 19]]) {
  box([gx - 0.13, 0, gz - 0.13], [gx + 0.13, 1.65, gz + 0.13], 'wood');
}
for (const [gx, gz] of [
  [17, 13], [20.5, 13], [24, 13.5], [27.5, 13], [31, 13.5],
  [17.5, 17], [21, 17.5], [24.5, 17], [28, 17.5], [32, 17],
  [18, 21.5], [22, 21], [25.5, 21.5], [29, 21], [33, 21.5],
  [19.5, 24.5], [26, 24.5], [33.5, 24.5],
]) grave(gx, gz, 0.7 + ((gx * 7) % 5) * 0.1, 0.85 + ((gz * 3) % 4) * 0.18);
building({
  x0: 26, z0: 22.0, x1: 32, z1: 27.0, h: 3.6, mat: 'stone', roofMat: 'stone',
  lamp: false, openings: { N: [{ c0: 28.2, c1: 30.0, y0: 0, y1: 2.4 }] },
});
grave(15.5, 11.5, 1.4, 1.7);
box([34.0, 0, 11.0], [35.2, 2.8, 12.2], 'stone');

// ---------------------------------------------------------------------------
// MINE - dark tunnel, one chamber, two mouths. The ambush spot.
// ---------------------------------------------------------------------------
rock(46, -34, 26, 9, 18);
rock(40, -44, 22, 8, 14);
rock(54, -2, 16, 7, 12);
box([36, 0, -20.5], [56, 0.35, -20.0], 'rail');
box([36, 0, -16.0], [56, 0.35, -15.5], 'rail');
wall('x', -21.6, 34, 52, 0, 4.2, 0.5, 'rockWall', []);
wall('x', -14.4, 34, 52, 0, 4.2, 0.5, 'rockWall', [{ c0: 44, c1: 47.4, y0: 0, y1: 3.0 }]);
box([34, 4.2, -22.0], [52.5, 4.9, -14.0], 'rockWall');
building({
  x0: 52, z0: -26, x1: 64, z1: -10, h: 4.6, mat: 'rockWall', roofMat: 'rockWall',
  lampY: 3.4, lampColor: 0xff9944, lampIntensity: 0.85,
  openings: { W: [{ c0: -21.4, c1: -14.6, y0: 0, y1: 4.0 }] },
});
box([56, 0, -22.6], [58.4, 1.4, -20.2], 'crate');
box([60.0, 0, -14.6], [62.0, 2.2, -11.6], 'rock');
box([53.0, 0, -12.8], [55.4, 1.05, -11.0], 'oreCart');
lamps.push({ x: 44, y: 3.2, z: -18, color: 0xff8a3c, intensity: 0.75, distance: 18 });
box([34.4, 0, -22.6], [35.2, 6.4, -21.8], 'wood');
box([34.4, 0, -14.6], [35.2, 6.4, -13.8], 'wood');
box([34.0, 6.4, -22.8], [35.6, 7.0, -13.6], 'wood');

// ---------------------------------------------------------------------------
// BACK ALLEYS - the flanking network behind the north row.
// ---------------------------------------------------------------------------
fence(-34, -34, -12, -34, 1.9, 'plankDark');
fence(10, -34, 28, -34, 1.9, 'plankDark');
crate(-20, -30, 1.2); crate(-21.2, -30.7, 1.0); crate(-20.4, -31.5, 1.0, 1.2);
barrel(-6.5, -24.6); barrel(-5.4, -25.4); barrel(2.6, -26.0);
crate(14, -28.5, 1.3); crate(15.4, -29.3, 1.1);
box([7.2, 0, -30.0], [9.0, 2.6, -24.0], 'plankDark');
building({
  x0: -1.6, z0: -31.6, x1: 0.6, z1: -29.4, h: 2.6, mat: 'plankDark', roofMat: 'roof', lamp: false,
  openings: { S: [{ c0: -1.3, c1: -0.2, y0: 0, y1: 2.1 }] },
});

// ---------------------------------------------------------------------------
// WATER TOWER + WINDMILL - two sniper perches, both exposed on the climb.
// ---------------------------------------------------------------------------
for (const [lx, lz] of [[-47.2, -3.2], [-42.8, -3.2], [-47.2, 1.2], [-42.8, 1.2]]) {
  box([lx - 0.2, 0, lz - 0.2], [lx + 0.2, 8.4, lz + 0.2], 'wood');
}
box([-49.4, 8.4, -5.4], [-40.6, 8.7, 3.4], 'wood');
box([-47.6, 8.7, -3.6], [-42.4, 12.2, 1.6], 'tank');
box([-49.4, 8.7, 3.05], [-40.6, 9.5, 3.4], 'railing');
box([-49.4, 8.7, -5.4], [-40.6, 9.5, -5.05], 'railing');
steps(-52.0, -1.0, 1, 0, 15, 0, 0.56, 0.72, 2.2);

box([-52.4, 0, -40.4], [-51.6, 9.0, -39.6], 'wood');
box([-53.6, 0, -41.6], [-50.4, 0.4, -38.4], 'wood');
props.push({ type: 'windmill', x: -52, z: -40, y: 9.0 });

rock(-60, -22, 9, 4.5, 7);
rock(-64, 12, 12, 6, 10);
rock(-40, 46, 14, 5.5, 11);
rock(8, 50, 16, 6.5, 12);
rock(48, 32, 13, 5, 10);
rock(62, 12, 10, 4, 9);
rock(-14, -54, 15, 6, 12);
rock(24, -52, 11, 4.5, 9);

for (const [cx, cz] of [
  [-56, -8], [-50, 20], [-44, 30], [-18, 38], [-4, 44], [12, 36], [30, 38],
  [42, 14], [52, 22], [58, -36], [-60, -34], [-36, -44], [4, -44], [36, -44],
  [66, -2], [-66, 4], [-30, 52], [18, 56], [-58, 44], [60, 46],
]) cactus(cx, cz, 2.0 + ((Math.abs(cx) * 13 + Math.abs(cz) * 7) % 5) * 0.35);

for (const [rx, rz, rw, rh, rd] of [
  [-46, -28, 4, 1.6, 3], [-24, -44, 5, 2.0, 4], [10, -40, 4.5, 1.8, 3.5],
  [42, -6, 4, 1.7, 3.2], [38, 36, 5, 2.1, 4], [-12, 46, 4.5, 1.9, 3.6],
  [-52, 8, 4.2, 1.7, 3.4], [22, 44, 4, 1.6, 3], [-34, 36, 4.4, 1.8, 3.2],
  [-56, 34, 5, 2.2, 4], [50, -46, 4.6, 1.9, 3.8],
]) rock(rx, rz, rw, rh, rd);

// ---------------------------------------------------------------------------
// ZONES - kill-feed location hints ("...someone died near the stable").
//
// `prep` is the word that goes in front of the name in a sentence, because the
// feed says "died <somewhere>" and English does not use one preposition for
// every place: you are IN the Saloon, ON Main Street and AT the water tower.
// Defaults to "in", which is right for most of this town.
// ---------------------------------------------------------------------------
//
// `id` is what the place is called when it is not being called anything: the
// name on the wire is English prose and a Korean feed cannot use it, so a
// client that needs to say the place somewhere else looks the id up instead.
// ---------------------------------------------------------------------------
// THE TABLE
//
// The card game is played round one, and that is not decoration: the seating is
// the brake on the whole thing. A starting gun reaches the man next to you, so
// most of the gang physically cannot shoot the Sheriff for several turns, and
// where you happen to be sitting is the hand you were dealt as much as the
// cards are.
//
// The first cut of the turn mode had everybody walking a hundred-and-thirty
// metre town between goes, which took that brake clean off - the gang could
// close on the star from anywhere, every lap. So: a table, in the middle of
// Main Street, with a mark on the ground for every man at it. Nobody walks.
//
// Distance is seats, the short way round, exactly as the original counts it.
// ---------------------------------------------------------------------------
export const TABLE = {
  x: -4, z: 0,             // the middle of Main Street, outside the Sheriff's office
  radius: 3.6,             // the table itself
  standing: 5.6,           // how far out the marks are
  height: 1.02,
};

/** Where the nth of `count` men stands, and which way he is facing. */
export function seatAt(i, count) {
  const a = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
  const x = TABLE.x + Math.cos(a) * TABLE.standing;
  const z = TABLE.z + Math.sin(a) * TABLE.standing;
  // Facing the middle. yaw 0 looks down -z, so this is the angle back to centre.
  const yaw = Math.atan2(-(TABLE.x - x), -(TABLE.z - z));
  return { x, y: 0, z, yaw };
}

/**
 * How many seats apart two men are, counted the short way round - which is the
 * whole of what "distance" means in the card game. Only the living are counted,
 * because a man who is down is out of the circle and the two either side of him
 * become neighbours.
 */
export function seatsApart(a, b, count) {
  if (a == null || b == null || count < 2) return Infinity;
  const d = Math.abs(a - b) % count;
  return Math.min(d, count - d);
}

// The table itself, and the ring of ground round it people stand on.
box([TABLE.x - TABLE.radius, 0.92, TABLE.z - TABLE.radius],
  [TABLE.x + TABLE.radius, TABLE.height, TABLE.z + TABLE.radius], 'wood');
for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  box([TABLE.x + dx * (TABLE.radius - 0.7) - 0.14, 0, TABLE.z + dz * (TABLE.radius - 0.7) - 0.14],
    [TABLE.x + dx * (TABLE.radius - 0.7) + 0.14, 0.92, TABLE.z + dz * (TABLE.radius - 0.7) + 0.14], 'wood');
}
props.push({ type: 'table', x: TABLE.x, z: TABLE.z, r: TABLE.radius, y: TABLE.height });

export const ZONES = [
  { id: 'saloon', name: 'the Saloon', x0: -33, z0: -27, x1: -11, z1: -7 },
  { id: 'office', name: "the Sheriff's Office", x0: -10, z0: -23, x1: 6, z1: -7 },
  { id: 'store', name: 'the General Store', x0: 9, z0: -25, x1: 28, z1: -7 },
  { id: 'mine', name: 'the Mine', x0: 33, z0: -27, x1: 65, z1: -13 },
  { id: 'stable', name: 'the Stable', x0: -41, z0: 7, x1: -21, z1: 23 },
  { id: 'church', name: 'the Church', x0: -9, z0: 10, x1: 9, z1: 30 },
  { id: 'cemetery', name: 'the Cemetery', x0: 13, z0: 9, x1: 37, z1: 27 },
  { id: 'main', name: 'Main Street', prep: 'on', x0: -42, z0: -7, x1: 33, z1: 7 },
  { id: 'alleys', name: 'the back alleys', x0: -36, z0: -35, x1: 30, z1: -25 },
  { id: 'tower', name: 'the water tower', prep: 'at', x0: -53, z0: -6, x1: -40, z1: 4 },
];

/** The flats beyond the last building, which are not a zone but are a place. */
export const OUTSKIRTS = 'the desert outskirts';
export const FLATS = 'the flats';

export function zoneAt(x, z, y = 0) {
  let nearest = null, nearestD = Infinity;
  for (const zn of ZONES) {
    if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) {
      return y > 4.9 ? `the rooftops above ${zn.name}` : zn.name;
    }
    // Distance to the rectangle, so a body in the lot behind the store still
    // reports somewhere a player can actually go and look.
    const dx = Math.max(zn.x0 - x, 0, x - zn.x1);
    const dz = Math.max(zn.z0 - z, 0, z - zn.z1);
    const d = Math.hypot(dx, dz);
    if (d < nearestD) { nearestD = d; nearest = zn; }
  }
  if (nearest && nearestD < 16) return `just outside ${nearest.name}`;
  if (nearest && nearestD < 34) return `the ground between ${nearest.name} and ${FLATS}`;
  return OUTSKIRTS;
}

/**
 * Take a place back apart into what it is made of, so another language can put
 * it together its own way. The wire carries the English phrase - it is what the
 * playtest log wants and what a place is called - and Korean cannot use it: the
 * preposition goes on the end there and the word order goes the other way.
 *
 * Returns { kind, ids } where kind is one of in / outside / roof / between /
 * outskirts, and ids are zone ids, or null if this is not a place we know.
 */
export function placeParts(place) {
  const p = String(place || '');
  if (!p) return null;
  if (p === OUTSKIRTS) return { kind: 'outskirts', ids: [] };
  const idOf = (name) => ZONES.find((z) => z.name === name)?.id || null;
  const shapes = [
    ['just outside ', 'outside'],
    ['the rooftops above ', 'roof'],
  ];
  for (const [prefix, kind] of shapes) {
    if (p.startsWith(prefix)) {
      const id = idOf(p.slice(prefix.length));
      return id ? { kind, ids: [id] } : null;
    }
  }
  if (p.startsWith('the ground between ')) {
    const rest = p.slice('the ground between '.length);
    const at = rest.lastIndexOf(' and ');
    if (at < 0) return null;
    const id = idOf(rest.slice(0, at));
    const other = rest.slice(at + 5);
    return id ? { kind: 'between', ids: [id], with: other === FLATS ? 'flats' : null } : null;
  }
  const id = idOf(p);
  return id ? { kind: 'in', ids: [id] } : null;
}

/**
 * A place, as it reads after a verb: "died <this>", "a shot <this>".
 *
 * zoneAt returns the place itself, because that is what goes on the wire and
 * into the playtest log, and "just outside the Church" is a place rather than a
 * phrase. But four things in the HUD write it into a sentence, and three of the
 * five shapes zoneAt can produce already begin with their own preposition -
 * which is how the feed came to announce that somebody had died IN JUST OUTSIDE
 * the Church.
 */
export function placePhrase(place) {
  const p = String(place || '');
  if (!p) return '';
  if (p.startsWith('just outside ')) return p;                    // already a phrase
  if (p.startsWith('the rooftops above ')) return `on ${p}`;
  if (p.startsWith('the ground between ')) return `on ${p}`;
  const zone = ZONES.find((z) => z.name === p);
  return `${zone?.prep || 'in'} ${p}`;
}

// ---------------------------------------------------------------------------
// SPAWNS + LOOT
// ---------------------------------------------------------------------------
export const SPAWNS = [
  { x: -46, y: 0, z: -16, yaw: 2.3 },
  { x: -32, y: 0, z: 32, yaw: -1.0 },
  { x: 0, y: 0, z: 40, yaw: Math.PI },
  { x: 30, y: 0, z: 34, yaw: -2.4 },
  { x: 46, y: 0, z: 6, yaw: 1.9 },
  { x: 27.9, y: 0, z: -41.9, yaw: 2.6 },
  { x: 6, y: 0, z: -42, yaw: 0.2 },
  { x: -28, y: 0, z: -42, yaw: 0.6 },
  { x: -58, y: 0, z: 24, yaw: -0.9 },
  { x: 60, y: 0, z: 26, yaw: -2.1 },
];

// Everyone starts with a revolver; everything else has to be found.
export const LOOT_SPAWNS = [
  { x: -30.4, y: 1.15, z: -18.0, type: 'shotgun' },
  { x: -16.0, y: 0.85, z: -13.0, type: 'whiskey' },
  { x: -23.4, y: 0.85, z: -12.4, type: 'ammo' },
  { x: -33.4, y: 3.66, z: -10.5, type: 'ammo' },
  { x: 3.4, y: 2.65, z: -21.3, type: 'rifle' },      // on top of the gun rack
  { x: -0.6, y: 0.9, z: -12.4, type: 'ammo' },
  { x: -7.6, y: 1.08, z: -20.3, type: 'whiskey' },   // on the cell cot
  { x: 13.1, y: 2.2, z: -17.0, type: 'ammo' },
  { x: 17.5, y: 2.2, z: -20.0, type: 'shotgun' },
  { x: 21.9, y: 2.2, z: -16.0, type: 'dynamite' },
  { x: 25.3, y: 1.1, z: -16.0, type: 'whiskey' },
  { x: -26.5, y: 2.9, z: 11.2, type: 'rifle' },
  { x: -36.5, y: 0.2, z: 21.0, type: 'ammo' },
  { x: -23.1, y: 1.6, z: 18.5, type: 'dynamite' },
  { x: 0.0, y: 1.0, z: 27.6, type: 'whiskey' },
  { x: -5.4, y: 0.2, z: 16.0, type: 'ammo' },
  { x: 5.0, y: 7.86, z: 13.5, type: 'rifle' },      // church roof
  { x: 29.0, y: 0.2, z: 25.0, type: 'shotgun' },    // mausoleum
  { x: 22.0, y: 0.2, z: 19.0, type: 'ammo' },
  { x: 57.2, y: 1.4, z: -21.4, type: 'dynamite' },
  { x: 58.5, y: 0.2, z: -12.5, type: 'rifle' },
  { x: 44.0, y: 0.2, z: -17.8, type: 'ammo' },
  { x: 54.2, y: 1.05, z: -11.9, type: 'whiskey' },
  { x: -38.0, y: 1.85, z: 0.5, type: 'ammo' },
  { x: 30.0, y: 1.85, z: -1.5, type: 'dynamite' },
  { x: -20.4, y: 1.2, z: -30.6, type: 'ammo' },
  { x: 14.6, y: 1.3, z: -28.5, type: 'shotgun' },
  { x: -45.0, y: 8.75, z: 2.5, type: 'rifle' },      // water tower deck     // water tower
  { x: -0.5, y: 0.2, z: -30.5, type: 'whiskey' },   // outhouse
  { x: -52.0, y: 0.45, z: -37.4, type: 'ammo' },
  { x: 18.5, y: 5.56, z: -16.0, type: 'ammo' },     // store roof
  { x: -22.0, y: 5.76, z: -17.0, type: 'whiskey' }, // saloon roof
];

// ---------------------------------------------------------------------------
// NAV GRAPH - hand-placed waypoints; links computed by line of sight at load.
// ---------------------------------------------------------------------------
export const NAV_NODES = [
  { x: -44, z: 1 }, { x: -38, z: 3 }, { x: -34, z: -2 }, { x: -28, z: 1 },
  { x: -22, z: -2 }, { x: -16, z: 2 }, { x: -10, z: -1 }, { x: -4, z: 2 },
  { x: 2, z: -1 }, { x: 8, z: 2 }, { x: 14, z: -1 }, { x: 20, z: 2 },
  { x: 26, z: -2 }, { x: 32, z: 1 },
  { x: -22, z: -10 }, { x: -22, z: -16 }, { x: -28.5, z: -14 }, { x: -16, z: -12 },
  { x: -25, z: -23 }, { x: -16, z: -22 },
  { x: -2, z: -10 }, { x: -2, z: -13.5 }, { x: -6, z: -18 }, { x: 2, z: -19 },
  { x: 18, z: -10 }, { x: 18, z: -12.6 }, { x: 12, z: -20 }, { x: 20.8, z: -19.4 }, { x: 25.4, z: -10.5 },
  { x: -30, z: -30 }, { x: -18, z: -29 }, { x: -6, z: -28 }, { x: 4, z: -29 },
  { x: 16, z: -30 }, { x: 26, z: -28 }, { x: 7.5, z: -12 }, { x: -9.8, z: -12.4 },
  { x: 36, z: -18 }, { x: 44, z: -18 }, { x: 46, z: -11 }, { x: 54, z: -18 }, { x: 60, z: -13 },
  { x: -30, z: 10.5 }, { x: -31, z: 16 }, { x: -36, z: 20 }, { x: -24, z: 20 }, { x: -18, z: 14 },
  { x: 0, z: 9 }, { x: 0, z: 13 }, { x: 0, z: 22 }, { x: -5, z: 26 }, { x: 5, z: 26 },
  { x: 17, z: 12 }, { x: 24, z: 16 }, { x: 31, z: 14 }, { x: 29, z: 24 }, { x: 20, z: 24 },
  { x: -46, z: -14 }, { x: -49, z: 8 }, { x: -46, z: 24 }, { x: -34, z: 32 },
  { x: -14, z: 34 }, { x: 8, z: 34 }, { x: 30, z: 32 }, { x: 44, z: 20 },
  { x: 52, z: 4 }, { x: 32.4, z: -31.5 }, { x: 18.4, z: -41.2 }, { x: -4, z: -40 },
  { x: -26, z: -40 }, { x: -46, z: -32 }, { x: -58, z: -12 }, { x: -56, z: 30 },
  // Rooftops / perches
  { x: -22, z: -17, y: 5.76 }, { x: -14, z: -19, y: 5.76 }, { x: -2, z: -19, y: 4.96 },
  { x: 13, z: -16, y: 5.36 }, { x: 24, z: -16, y: 5.36 }, { x: -45, z: -0.5, y: 8.7 },
  { x: -31, z: 15, y: 5.36 }, { x: 5.5, z: 20, y: 7.86 }, { x: -33.4, z: -10, y: 3.66 },
];

export const MAP = {
  name: 'Perdition Flats',
  solids,
  lamps,
  props,
  table: TABLE,
  spawns: SPAWNS,
  loot: LOOT_SPAWNS,
  nav: NAV_NODES,
  zones: ZONES,
  bounds: WORLD_BOUNDS,
};

export default MAP;
