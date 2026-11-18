// Solmar's layout, generated from a seed: no drawing and no browser in here, just data.
// Buildings sit on 2x2 lots inside each 36 m block; roads, lamps, palms and parked-car spots
// are placed the same way, so one seed always builds the same city. Collision is circle-vs-AABB.
import { CITY, PALETTE, PARKED_CARS } from './config.js';

const LOT = 16; // lot size inside a block; lots sit 2 m apart, 2 m inside the block edge

export function createCity(random) {
  const buildings = [];
  const colliders = [];
  const lamps = [];
  const palms = [];
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      // Taller towers near the centre, lower blocks at the edge.
      const centre = 1 + (1 - (Math.abs(bx) + Math.abs(bz)) / 200) * 1.6;
      for (let lx = -1; lx <= 1; lx += 2) {
        for (let lz = -1; lz <= 1; lz += 2) {
          if (random() < 0.3) continue; // empty lot: a yard, a car park, breathing room
          const w = LOT * (0.7 + random() * 0.3);
          const d = LOT * (0.7 + random() * 0.3);
          const h = (7 + random() * random() * 30) * centre;
          const x = bx + lx * (LOT / 2 + 1);
          const z = bz + lz * (LOT / 2 + 1);
          const color = PALETTE.facades[Math.floor(random() * PALETTE.facades.length)];
          buildings.push({ x, z, w, d, h, color });
          colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        }
      }
      if (random() < 0.6) palms.push({ x: bx + (random() - 0.5) * 28, z: bz + (random() - 0.5) * 28 });
    }
  }
  // Lamps on alternating intersection corners.
  for (const lx of CITY.roadLines) {
    for (const lz of CITY.roadLines) {
      if ((lx + lz) % 100 === 0) lamps.push({ x: lx + 8.5, z: lz + 8.5 });
    }
  }
  // Parked cars along road edges, parallel to the road, clear of intersections.
  const parkedSpots = [];
  for (let i = 0; i < PARKED_CARS; i += 1) {
    const line = CITY.roadLines[Math.floor(random() * CITY.roadLines.length)];
    const along = (random() * 2 - 1) * 110;
    const side = random() < 0.5 ? -1 : 1;
    const vertical = random() < 0.5;
    const x = vertical ? line + side * 5.4 : along;
    const z = vertical ? along : line + side * 5.4;
    // Intersections sit where the along-coordinate is 25 (mod 50); keep clear of them.
    const m = ((along % 50) + 50) % 50;
    if (Math.abs(m - 25) < 11) { i -= 1; continue; }
    parkedSpots.push({
      x, z, heading: vertical ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      color: PALETTE.carColors[Math.floor(random() * PALETTE.carColors.length)],
    });
  }
  return { buildings, colliders, lamps, palms, parkedSpots, bound: CITY.bound };
}

/** Push a circle out of every building AABB and the city edge; true when it hit something. */
export function resolveCircle(p, r, city) {
  let hit = false;
  for (const c of city.colliders) {
    const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r;
      p.z = cz + (dz / d) * r;
    } else {
      // Centre inside the box: shove out along the shallowest side.
      const pushL = p.x - c.minX + r, pushR = c.maxX - p.x + r;
      const pushT = p.z - c.minZ + r, pushB = c.maxZ - p.z + r;
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) p.x = c.minX - r;
      else if (m === pushR) p.x = c.maxX + r;
      else if (m === pushT) p.z = c.minZ - r;
      else p.z = c.maxZ + r;
    }
  }
  const b = city.bound - r;
  if (p.x < -b) { p.x = -b; hit = true; }
  if (p.x > b) { p.x = b; hit = true; }
  if (p.z < -b) { p.z = -b; hit = true; }
  if (p.z > b) { p.z = b; hit = true; }
  return hit;
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
