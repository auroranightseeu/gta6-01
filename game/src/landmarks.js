import * as THREE from 'three';
import { CITY } from './config.js';

// Solmar's landmarks: one per district, six in all. world.js reserves the lot at block
// (-50,0) for the Downtown tower; every other landmark takes the first free lot of the
// first block its district owns, so a landmark never grows through a facade. Data first,
// meshes second: the six towers are two instanced draws (shaft + warm crown), so the
// skyline gains height for two draw calls instead of twelve.
const LOT = 9; // lot centre inside a block (16 m lot, 2 m gap), as world.js lays them out
const OFFSETS = [[LOT, LOT], [-LOT, LOT], [LOT, -LOT], [-LOT, -LOT], [0, 0]];

// One style per district, keyed by the district name world.js already uses for the HUD.
// Heights are sized against the local skyline, not picked: world.js scales a block's towers
// by 1 + (1 - (|bx| + |bz|) / 200) * 1.6 and a tower reaches ~37 * that, so a landmark only
// reads if it clears its own district's tallest facade (downtown ~81 m, inner blocks ~66 m,
// the edge ~37 m).
const STYLE = {
  Downtown: { name: 'Vega Tower', h: 96, w: 13, color: 0x93b6c6, crown: 0xffcf87 },
  'Lighthouse Point': { name: 'Point Light', h: 52, w: 6, color: 0xf1e7d6, crown: 0xff7a45 },
  Promenade: { name: 'Promenade Arch', h: 48, w: 10, color: 0xe6d5bb, crown: 0xffd08a },
  Harbor: { name: 'Harbor Crane', h: 74, w: 7, color: 0xd2693a, crown: 0xffb347 },
  'Old Town': { name: 'Old Town Clock', h: 70, w: 7, color: 0xcbb79a, crown: 0xffe0a8 },
  Residential: { name: 'Hillcrest Flats', h: 42, w: 10, color: 0xd9c4ac, crown: 0xffdcae },
};

/** District landmark for a block coordinate: the six rules, tested in order. */
export function landmarkAt(bx, bz) {
  const ax = Math.abs(bx);
  const az = Math.abs(bz);
  let district = 'Residential';
  if (ax + az <= 50) district = 'Downtown';
  else if (bx <= -70 && bz <= -40) district = 'Lighthouse Point';
  else if (bz >= 60) district = 'Promenade';
  else if (bx <= -50) district = 'Harbor';
  else if (bx >= 50 && bz <= -20) district = 'Old Town';
  return { district, ...STYLE[district], bx, bz };
}

/** True when a footprint of half-width `r` at (x,z) clears every building AABB. */
function free(colliders, x, z, r) {
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return false;
  }
  return true;
}

/**
 * Build the six landmarks into `city` (data) and, when a scene is given, draw them as two
 * instanced meshes. Returns { list, group }: `list` is the resolved data the HUD or a shot
 * can read, `group` is what was added to the scene.
 */
export function createLandmarks(city, scene) {
  const list = [];
  const seen = new Set();
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      const def = landmarkAt(bx, bz);
      if (seen.has(def.district)) continue;
      seen.add(def.district);
      const r = def.w / 2;
      // Downtown takes world.js's reserved landmark lot (block -50,0, the +x/+z lot);
      // every other district takes the first lot of its block that is actually empty.
      const anchor = def.district === 'Downtown' ? [-50, 0] : [bx, bz];
      let x = anchor[0] + LOT;
      let z = anchor[1] + LOT;
      for (const [ox, oz] of OFFSETS) {
        if (free(city.colliders, anchor[0] + ox, anchor[1] + oz, r + 0.4)) {
          x = anchor[0] + ox;
          z = anchor[1] + oz;
          break;
        }
      }
      list.push({ ...def, x, z });
      city.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const shaft = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), list.length);
  const crown = new THREE.InstancedMesh(
    box,
    new THREE.MeshLambertMaterial({ color: 0xffd08a, emissive: 0xff9a3c, emissiveIntensity: 0.85 }),
    list.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();
  list.forEach((l, i) => {
    m.compose(p.set(l.x, l.h / 2, l.z), q, s.set(l.w, l.h, l.w));
    shaft.setMatrixAt(i, m);
    shaft.setColorAt(i, tint.setHex(l.color));
    m.compose(p.set(l.x, l.h + 0.9, l.z), q, s.set(l.w * 1.18, 1.8, l.w * 1.18));
    crown.setMatrixAt(i, m);
  });
  shaft.instanceMatrix.needsUpdate = true;
  crown.instanceMatrix.needsUpdate = true;
  if (shaft.instanceColor) shaft.instanceColor.needsUpdate = true;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  crown.castShadow = true;

  const group = new THREE.Group();
  group.add(shaft, crown);
  if (scene) scene.add(group);
  city.landmarks = { list, group };
  return city.landmarks;
}
