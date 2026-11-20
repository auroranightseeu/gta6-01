// Solmar's layout, generated from a seed: no drawing and no browser in here, just data.
// Buildings sit on 2x2 lots inside each 36 m block; roads, lamps, palms and parked-car spots
// are placed the same way, so one seed always builds the same city. Collision is circle-vs-AABB.
// v5 adds street furniture (signals, benches, planters, hydrants, bins, railings, beach
// umbrellas) as plain data. That pass uses its own hash PRNG, NOT the city's seeded `random()`,
// so the building layout of an existing seed is bit-identical to before.
import { CITY, PALETTE, PARKED_CARS } from './config.js';

const LOT = 16; // lot size inside a block; lots sit 2 m apart, 2 m inside the block edge
const WALK = 8.4; // how far out from a road centreline prop posts stand (kerb line at 7)

/** Small deterministic PRNG for cosmetics; isolated from the city's seeded stream. */
function hashRandom(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

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
          if (bx === -50 && bz === 0 && lx === 1 && lz === 1) continue; // reserve a downtown landmark lot
          const district = Math.abs(bx) + Math.abs(bz) <= 50 ? 'downtown' : bx <= -50 ? 'harbor' : 'residential';
          const palette = PALETTE.districtFacades[district];
          const color = palette[Math.floor(random() * palette.length)];
          buildings.push({ x, z, w, d, h, color, district, landmark: district === 'downtown' && bx === -50 && bz === 0 });
          colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        }
      }
      if (random() < 0.6) {
        const px = bx + (random() - 0.5) * 28;
        const pz = bz + (random() - 0.5) * 28;
        // Keep a palm out of a building footprint so it never grows through a wall.
        if (!insideBuilding(colliders, px, pz, 1.4)) palms.push({ x: px, z: pz });
      }
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
  const props = createProps(colliders, buildings);
  return { buildings, colliders, lamps, palms, parkedSpots, bound: CITY.bound, props };
}

/** True when (x, z) is inside (or within margin of) any building footprint. */
function insideBuilding(colliders, x, z, margin) {
  for (const c of colliders) {
    if (x > c.minX - margin && x < c.maxX + margin && z > c.minZ - margin && z < c.maxZ + margin) return true;
  }
  return false;
}

/**
 * Street furniture, placed on the 1-2 m kerb strip of each block and along the beach.
 * Everything here is drawn as ONE merged mesh by render.js, so the count is free; the
 * point of the data is a believable, repeatable scatter. Signals sit on a corner of every
 * intersection, alternating corners so the whole grid reads as signalised.
 */
function createProps(colliders, buildings) {
  const props = { signals: [], benches: [], planters: [], hydrants: [], bins: [], rails: [], umbrellas: [] };
  const free = (x, z, m = 0.7) => !insideBuilding(colliders, x, z, m);

  // Traffic signals: one corner post per intersection, arm over the road.
  let n = 0;
  for (const ix of CITY.roadLines) {
    for (const iz of CITY.roadLines) {
      const sx = n % 2 === 0 ? 1 : -1;
      const sz = (n >> 1) % 2 === 0 ? 1 : -1;
      n += 1;
      // Alternate which road the head faces so the grid is not all identical.
      const alongX = n % 3 !== 0;
      props.signals.push({
        x: ix + sx * WALK,
        z: iz + sz * WALK,
        axis: alongX ? 'x' : 'z',
        dir: alongX ? -sx : -sz,     // arm reaches over the other road
        face: sz,                    // side the head faces
        state: (n % 3 === 0) ? 2 : (n % 2 === 0 ? 1 : 0), // 0 red, 1 amber, 2 green
      });
    }
  }

  // Benches, planters, hydrants and bins along the kerb of each block. A block spans
  // +/-18 m around its centre; the road edge is exactly at 18, so props sit in the last
  // 1.6 m of pavement. Hash-seeded: stable and isolated from the city's RNG stream.
  let bi = 0;
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      const rnd = hashRandom(((bx + 140) * 7919) ^ ((bz + 140) * 104729) ^ 0x5f3a);
      for (const [side, axis] of [[-1, 'z'], [1, 'z'], [-1, 'x'], [1, 'x']]) {
        bi += 1;
        const t = (rnd() * 2 - 1) * 13;        // along the block edge, clear of the corners
        const off = 16.5 + rnd() * 1.1;        // 16.5..17.6 m from the block centre
        let x;
        let z;
        let rot;                               // rotation about Y so props face the road
        if (axis === 'z') {
          x = bx + side * off;
          z = bz + t;
          rot = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          x = bx + t;
          z = bz + side * off;
          rot = side > 0 ? 0 : Math.PI;
        }
        if (!free(x, z, 0.6)) continue;
        const roll = rnd();
        if (roll < 0.4) props.benches.push({ x, z, rot });
        else if (roll < 0.62) props.planters.push({ x, z, rot });
        else if (roll < 0.82) props.bins.push({ x, z, rot });
        else props.hydrants.push({ x, z, rot });
      }
    }
  }

  // Beach: a railing along the promenade edge and a scatter of parasols on the sand.
  for (let z = -128; z <= 128; z += 4) {
    // Leave the harbour mouth open at the docks.
    if (z > 8 && z < 44) continue;
    props.rails.push({ x: -131.4, z });
  }
  const rnd = hashRandom(0x51c0de);
  for (let i = 0; i < 14; i += 1) {
    props.umbrellas.push({
      x: -134.2 - rnd() * 3.2,
      z: -120 + i * 17 + rnd() * 6,
      tilt: (rnd() - 0.5) * 0.16,
      color: [0xe8614a, 0x2f9d8f, 0xf2b134, 0xe9e2cf][i % 4],
    });
  }
  return props;
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

// --- Place names (HUD) --------------------------------------------------------------
// Six districts, tested in this order, and the street grid's names. The rules are data,
// not drawing, so the HUD and any future minimap label agree on one answer.
// Downtown is the centre diamond (|x| + |z| <= 50, which is also the landmark block at
// -50,0); Lighthouse Point claims the south-west sea corner before Harbor does; the
// Promenade runs along the south beach; Harbor is the rest of the west edge; Old Town is
// the north-east quarter; everything else is Residential.
const AVENUE_NAMES = {
  '-125': 'Lighthouse Way', '-75': 'Harbor Blvd', '-25': 'Solmar Ave',
  25: 'Coral Ave', 75: 'Sunset Blvd', 125: 'Marina Dr',
};
const STREET_NAMES = {
  '-125': 'Northgate St', '-75': 'Market St', '-25': 'Central St',
  25: 'Plaza St', 75: 'Promenade St', 125: 'Beachfront Ave',
};

/** District name for a world position (see the order above). */
export function districtAt(x, z) {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax + az <= 50) return 'Downtown';
  if (x <= -70 && z <= -40) return 'Lighthouse Point';
  if (z >= 60) return 'Promenade';
  if (x <= -50) return 'Harbor';
  if (x >= 50 && z <= -20) return 'Old Town';
  return 'Residential';
}

/**
 * Nearest road centreline to `v`. A position exactly between two roads (x = 0 is 25 m
 * from both -25 and 25) is a tie, and a tie is broken toward the LARGER coordinate so the
 * answer is stable and never depends on the loop order.
 */
function nearestRoad(v) {
  let best = CITY.roadLines[0];
  let bestD = Math.abs(best - v);
  for (const line of CITY.roadLines) {
    const d = Math.abs(line - v);
    if (d < bestD || (d === bestD && line > best)) {
      best = line;
      bestD = d;
    }
  }
  return best;
}

/** "Solmar Ave & Central St": the avenue (x) and street (z) a position sits nearest. */
export function streetAt(x, z) {
  return `${AVENUE_NAMES[nearestRoad(x)]} & ${STREET_NAMES[nearestRoad(z)]}`;
}
