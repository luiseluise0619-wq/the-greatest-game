// Axis-aligned collision + raycasting shared by the server simulation and the client.
// The world is a soup of AABBs (see shared/map.js); everything here works on that soup.

/**
 * Resolve an axis-aligned capsule-ish player box against the world, one axis at a
 * time, with a step-up allowance so stairs, porches and boardwalks are walkable.
 *
 * @param {{x:number,y:number,z:number}} pos  feet position (mutated copy returned)
 * @param {{x:number,y:number,z:number}} delta movement for this frame
 * @param {number} radius half-width of the player box
 * @param {number} height player height
 * @param {Array} solids world boxes
 * @param {number} stepHeight max ledge the player is lifted over
 * @returns {{x,y,z, grounded:boolean, hitWall:boolean, stepped:boolean}}
 */
export function moveAndCollide(pos, delta, radius, height, solids, stepHeight = 0.6) {
  let x = pos.x, y = pos.y, z = pos.z;
  let grounded = false;
  let hitWall = false;
  let stepped = false;

  // --- Y first: landing/head bonks are independent of horizontal sliding.
  y += delta.y;
  {
    const box = { x0: x - radius, x1: x + radius, y0: y, y1: y + height, z0: z - radius, z1: z + radius };
    for (const s of solids) {
      if (!overlaps(box, s)) continue;
      if (delta.y <= 0) {
        y = s.q[1];
        grounded = true;
      } else {
        y = s.p[1] - height;
      }
      box.y0 = y; box.y1 = y + height;
    }
  }
  if (y <= 0) { y = 0; grounded = true; }

  // --- Horizontal, per axis, with a step-up retry.
  for (const axis of ['x', 'z']) {
    const d = delta[axis];
    if (d === 0) continue;
    let nx = x, nz = z;
    if (axis === 'x') nx += d; else nz += d;

    const box = { x0: nx - radius, x1: nx + radius, y0: y, y1: y + height, z0: nz - radius, z1: nz + radius };
    let blocker = null;
    for (const s of solids) {
      if (overlaps(box, s)) { blocker = s; break; }
    }

    if (!blocker) {
      x = nx; z = nz;
      continue;
    }

    // Try stepping up onto the obstacle.
    const rise = blocker.q[1] - y;
    if (rise > 0 && rise <= stepHeight) {
      const lifted = { x0: box.x0, x1: box.x1, y0: blocker.q[1] + 0.01, y1: blocker.q[1] + 0.01 + height, z0: box.z0, z1: box.z1 };
      let clear = true;
      for (const s of solids) { if (overlaps(lifted, s)) { clear = false; break; } }
      if (clear) {
        y = blocker.q[1] + 0.01;
        x = nx; z = nz;
        grounded = true;
        stepped = true;
        continue;
      }
    }
    hitWall = true;
  }

  // Ground probe: are we standing on something right below us?
  if (!grounded) {
    const probe = { x0: x - radius, x1: x + radius, y0: y - 0.08, y1: y + 0.02, z0: z - radius, z1: z + radius };
    for (const s of solids) {
      if (overlaps(probe, s)) { grounded = true; y = Math.max(y, s.q[1]); break; }
    }
    if (y <= 0.001) grounded = true;
  }

  return { x, y, z, grounded, hitWall, stepped };
}

function overlaps(b, s) {
  return b.x0 < s.q[0] && b.x1 > s.p[0] &&
         b.y0 < s.q[1] && b.y1 > s.p[1] &&
         b.z0 < s.q[2] && b.z1 > s.p[2];
}

/** True if the player box at this position intersects any solid. */
export function isBlocked(x, y, z, radius, height, solids) {
  const b = { x0: x - radius, x1: x + radius, y0: y + 0.02, y1: y + height, z0: z - radius, z1: z + radius };
  for (const s of solids) if (overlaps(b, s)) return true;
  return false;
}

/**
 * Ray vs world. Returns the nearest hit {t, point, normal, box} or null.
 * Slab method, no acceleration structure - the map is a few hundred boxes and
 * this runs a handful of times per tick, which is plenty fast enough.
 */
export function raycastWorld(origin, dir, maxDist, solids) {
  let best = null;
  for (const s of solids) {
    if (s.noHit) continue;
    const h = rayBox(origin, dir, s, maxDist);
    if (h && (!best || h.t < best.t)) best = { ...h, box: s };
  }
  return best;
}

export function rayBox(o, d, s, maxDist) {
  let tmin = 0, tmax = maxDist;
  let nAxis = 0, nSign = 1;
  for (let a = 0; a < 3; a++) {
    const od = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const lo = s.p[a], hi = s.q[a];
    if (Math.abs(dd) < 1e-8) {
      if (od < lo || od > hi) return null;
      continue;
    }
    const inv = 1 / dd;
    let t1 = (lo - od) * inv;
    let t2 = (hi - od) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  const normal = { x: 0, y: 0, z: 0 };
  normal[['x', 'y', 'z'][nAxis]] = nSign;
  return {
    t: tmin,
    point: { x: o.x + d.x * tmin, y: o.y + d.y * tmin, z: o.z + d.z * tmin },
    normal,
  };
}

/** Ray vs an upright player capsule approximated as a box. */
export function rayPlayerBox(o, d, px, py, pz, radius, height, maxDist) {
  const s = { p: [px - radius, py, pz - radius], q: [px + radius, py + height, pz + radius] };
  return rayBox(o, d, s, maxDist);
}

/** Clear line between two points? Used for visibility, witnesses and nav links. */
export function lineOfSight(a, b, solids) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const hit = raycastWorld(a, dir, dist - 0.05, solids);
  return !hit;
}

export function dist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
