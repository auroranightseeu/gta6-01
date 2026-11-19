// Wanted + police: stars 1-5, police cars that spawn at the city edge and chase Rio
// on foot and in a car, the cool-off that drops a star when every police car is far
// away for a while, and the air unit that lifts off at four stars: a procedural
// helicopter with a searchlight that follows Rio, keeps the ground units pressing
// and puts the whole block under a light. Busted is a police car catching Rio on
// foot at close range.
import * as THREE from 'three';
import { CITY, POLICE } from './config.js';
import { resolveCircle } from './world.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- Air unit tuning (local: config.js is another worker's file) -------------------
// Placement was measured against the game's own chase camera (62 deg FOV, pitch
// 0.30, 8.4 m back), which only sees ~21 deg above horizontal. An aircraft at
// 24 m and 52 m ahead projects to NDC y 0.94 — half of it clipped off the top of
// the frame — so altitude is the thing that decides legibility, not distance.
// 11 m up and 20 m ahead projects to y 0.82 with the whole aircraft inside the
// frame and a 78 px hull / 213 px rotor disc. It flies along the road corridor at
// that height and climbs only to clear a roof it actually has to cross.
// (Both controllers and every number are in reports/W-B.md.)
const HELI = {
  minWanted: 4,        // stars at which the air unit launches
  alt: 10,             // base hover altitude in metres
  lead: 22,            // how far ahead of Rio it holds station
  leadSide: 5,         // how far it weaves to one side of that line
  weaveRate: 0.22,     // rad/s of the side-to-side weave
  spawnAlt: 46,        // it enters high and settles down
  descend: 16,         // max vertical m/s while settling in
  climb: 22,           // max vertical m/s climbing over a tower
  roofPad: 9,          // clearance kept above any roof it has to fly over
  maxSpeed: 46,        // max horizontal m/s (keeps it from snapping around)
  smoothH: 2.2,        // exponential follow rate, horizontal (1/s)
  smoothV: 1.8,        // exponential follow rate, vertical (1/s)
  turn: 2.0,           // rad/s of yaw
  leaveTime: 1.4,      // seconds of climb-out after the stars drop
  respawnTight: 46,    // police cars further than this respawn nearer while lit
  decayRate: 0.55,     // cool-off runs at this fraction while the light is on
};

const _down = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();

// --- Pursuit formation -------------------------------------------------------------
// Before this, every cruiser steered straight at Rio's exact position, so four cars
// converged on one point and ended up inside each other. Measured on the staged cover
// frame (?shot=chase&seed=1): pairwise gaps of 0.91 m, 1.60 m, 1.84 m, 2.25 m, 2.30 m,
// 2.50 m between cars ~4.4 m long — the cover screenshot showed one melted blob of
// livery. Each cruiser now takes a SLOT (trail / flank-left / flank-right / back), holds
// a following distance on its slot, and gets a hard minimum-separation shove as a
// backstop so two cars can never occupy the same ground.
const SEP = {
  minGap: 5.2,     // metres of centre-to-centre clearance: > car length, so no overlap
  push: 9.0,       // m/s of separation shove at zero distance
  // Slots sit AHEAD of Rio, because that is where a pursuit is both realistic and visible:
  // interceptors run him down from the front to box him in, and the chase camera looks
  // forward over his shoulder. An earlier version put the slots behind him, which was
  // geometrically tidy but pushed three of four cruisers off the back of the camera and
  // emptied the cover frame — measured, 1 of 4 in frame, and that one sitting on Rio.
  slots: [
    { ahead: 15, side: 0 },      // lead interceptor, straight ahead
    { ahead: 10, side: -6.5 },   // flank left
    { ahead: 10, side: 6.5 },    // flank right
    { ahead: 23, side: -2.0 },   // second echelon
  ],
};

/** World point for a slot, given Rio's position and heading. */
function slotPoint(slot, x, z, heading) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // "ahead" is positive = in front of Rio along his direction of travel.
  return {
    x: x + fx * slot.ahead - fz * slot.side,
    z: z + fz * slot.ahead + fx * slot.side,
  };
}

/**
 * The direction Rio is travelling, for the formation to orient on. No caller passes a
 * heading, and it must not be guessed from a single frame (a stationary player has none),
 * so track the displacement between calls and keep the last real heading when he stops.
 */
function formationHeading(police, x, z) {
  if (police.formX !== undefined) {
    const dx = x - police.formX;
    const dz = z - police.formZ;
    if (Math.hypot(dx, dz) > 0.05) police.formHeading = Math.atan2(dx, dz);
  }
  police.formX = x;
  police.formZ = z;
  return police.formHeading || 0;
}

/** Concatenate a handful of transformed geometries into one (one draw call). */
function mergeParts(parts) {
  const geos = [];
  let total = 0;
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (part.matrix) g.applyMatrix4(part.matrix);
    total += g.attributes.position.count;
    geos.push(g);
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let at = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, at * 3);
    nor.set(g.attributes.normal.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/** A translation+rotation matrix for mergeParts. */
function at(x, y, z, rotY = 0, rotX = 0, rotZ = 0) {
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ));
  m.setPosition(x, y, z);
  return m;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/**
 * The helicopter: six merged meshes, not dozens. Body, livery stripe, canopy,
 * main rotor, tail rotor, searchlight cone + ground pool. Built once in
 * createPolice() and simply hidden until four stars.
 */
function buildHeli(renderer) {
  const group = new THREE.Group();
  group.visible = false;

  const shell = new THREE.MeshLambertMaterial({ color: 0xdfe4ea, emissive: 0x2a3038 });
  const navy = new THREE.MeshLambertMaterial({ color: 0x1d2b40, emissive: 0x080d16 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x2f5768, emissive: 0x13303c });

  // Hull: fuselage, nose, engine deck, tail boom, fin, stabiliser, skids, mast.
  const hull = mergeParts([
    { geo: box(1.7, 1.25, 3.4), matrix: at(0, 0, 0.25) },
    { geo: box(1.35, 0.95, 1.1), matrix: at(0, -0.08, 2.05) },
    { geo: box(1.15, 0.5, 1.5), matrix: at(0, 0.84, -0.15) },
    { geo: box(0.28, 0.3, 0.5), matrix: at(0, 1.18, 0.7) },
    { geo: box(0.4, 0.4, 3.6), matrix: at(0, 0.32, -3.2) },
    { geo: box(0.2, 1.35, 1.0), matrix: at(0, 0.9, -4.5) },
    { geo: box(1.7, 0.1, 0.44), matrix: at(0, 0.46, -4.15) },
    { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.55, 8), matrix: at(0, 1.15, 0) },
    // Searchlight housing under the nose: the beam visibly comes out of something.
    { geo: new THREE.CylinderGeometry(0.34, 0.26, 0.4, 10, 1), matrix: at(0, -0.82, 1.5, 0, Math.PI * 0.06) },
    { geo: box(0.13, 0.1, 2.9), matrix: at(-0.86, -1.02, 0.1) },
    { geo: box(0.13, 0.1, 2.9), matrix: at(0.86, -1.02, 0.1) },
    // Skid struts: two per side, angled in from the hull so the gear looks carried.
    { geo: box(0.1, 0.62, 0.1), matrix: at(-0.7, -0.72, 1.0) },
    { geo: box(0.1, 0.62, 0.1), matrix: at(0.7, -0.72, 1.0) },
    { geo: box(0.1, 0.62, 0.1), matrix: at(-0.7, -0.72, -0.75) },
    { geo: box(0.1, 0.62, 0.1), matrix: at(0.7, -0.72, -0.75) },
    { geo: box(0.16, 0.2, 0.16), matrix: at(0.55, -0.55, -2.9) },
  ]);

  // Livery: a dark band round the cabin, door patches and the tail number block.
  const trim = mergeParts([
    { geo: box(1.74, 0.26, 1.9), matrix: at(0, -0.16, 0.4) },
    { geo: box(1.42, 0.3, 0.1), matrix: at(0, 0.06, 1.98) },
    { geo: box(0.16, 0.42, 0.62), matrix: at(-0.87, 0.16, -0.5) },
    { geo: box(0.16, 0.42, 0.62), matrix: at(0.87, 0.16, -0.5) },
    { geo: box(0.34, 0.3, 0.08), matrix: at(0, 0.55, -4.6) },
  ]);

  const canopy = new THREE.Mesh(box(1.5, 0.62, 1.15), glass);
  canopy.position.set(0, 0.42, 1.62);

  // Main rotor: two blades crossed, spun about Y.
  const rotor = new THREE.Mesh(mergeParts([
    { geo: box(9.2, 0.07, 0.3), matrix: at(0, 0, 0) },
    { geo: box(9.2, 0.07, 0.3), matrix: at(0, 0, 0, Math.PI / 2) },
    { geo: new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), matrix: at(0, 0.04, 0) },
  ]), navy);
  rotor.position.set(0, 1.44, 0);

  // Tail rotor: two blades crossed, spun about X, facing sideways at the fin.
  const tailRotor = new THREE.Mesh(mergeParts([
    { geo: box(0.09, 1.5, 0.26), matrix: at(0, 0, 0) },
    { geo: box(0.09, 0.26, 1.5), matrix: at(0, 0, 0) },
    { geo: new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), matrix: at(0, 0, 0, 0, 0) },
  ]), navy);
  tailRotor.position.set(0.44, 0.9, -4.55);

  const body = new THREE.Mesh(hull, shell);
  const stripe = new THREE.Mesh(trim, navy);
  group.add(body, stripe, canopy, rotor, tailRotor);
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
  renderer.scene.add(group);

  // The searchlight: an additive cone with its apex on the helicopter, aimed at Rio.
  const coneGeo = new THREE.ConeGeometry(1, 1, 14, 1, true);
  coneGeo.translate(0, -0.5, 0);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    color: 0xfff3bd, transparent: true, opacity: 0.13, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  cone.visible = false;
  cone.frustumCulled = false;
  renderer.scene.add(cone);

  // A soft pool of light on the street where the beam lands.
  const poolGeo = new THREE.CircleGeometry(1, 20);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.2, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  pool.visible = false;
  pool.frustumCulled = false;
  renderer.scene.add(pool);

  // A small emissive lens in the searchlight housing, so the beam has a visible source.
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff6d0, toneMapped: false }),
  );
  lens.position.set(0, -1.02, 1.62);
  group.add(lens);

  // A faint translucent rotor disc: at hover altitude the blades alone vanish, the
  // disc is what says "these are turning".
  const discGeo = new THREE.CircleGeometry(4.6, 24);
  discGeo.rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
    color: 0x2a3648, transparent: true, opacity: 0.22, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  disc.position.set(0, 1.44, 0);
  disc.frustumCulled = false;
  group.add(disc);

  // The light bar on the belly: the aircraft has to read as police, not as news.
  const beacons = new THREE.Mesh(mergeParts([
    { geo: box(0.34, 0.12, 0.24), matrix: at(-0.34, -0.68, -0.55) },
    { geo: box(0.34, 0.12, 0.24), matrix: at(0.34, -0.68, -0.55) },
  ]), new THREE.MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false }));
  group.add(beacons);

  return { group, body, stripe, canopy, rotor, tailRotor, cone, pool, lens, disc, beacons };
}

export function createPolice(renderer) {
  // `heli` is a live state object main.js and the HUD read: never null.
  const heli = {
    active: false, x: 0, y: 0, z: 0,
    state: 'off',
    mode: 'lead',
    angle: 0, heading: 0, faceHeading: 0, weave: 0.5, t: 0,
    px: 0, pz: 0, vx: 0, vz: 0, seeded: false,
  };
  Object.assign(heli, buildHeli(renderer));
  return { cars: [], roadblockCars: [], roadblockLevel: 0, renderer, hiddenTimer: 0, heli };
}

/** Make one police car at (x, z) and add it to the chase list. */
export function spawnPoliceCar(police, x, z, city) {
  const mesh = police.renderer.makePoliceCar();
  police.renderer.scene.add(mesh);
  const car = {
    x, z, heading: 0, speed: 0, mesh, phase: Math.random() * 2,
    lastDist: Infinity, stuckT: 0, stuckCheck: 0, detourT: 0, detourSide: 1,
  };
  resolveCircle(car, 1.7, city);
  mesh.position.set(car.x, 0, car.z);
  police.cars.push(car);
  return car;
}

/** Take every police car, roadblock and the air unit off the map. */
export function clearPolice(police) {
  for (const car of police.cars) police.renderer.scene.remove(car.mesh);
  for (const car of police.roadblockCars) police.renderer.scene.remove(car.mesh);
  police.cars.length = 0;
  police.roadblockCars.length = 0;
  police.roadblockLevel = 0;
  police.hiddenTimer = 0;
  const h = police.heli;
  if (h) {
    h.active = false;
    h.state = 'off';
    h.t = 0;
    h.seeded = false;
    if (h.group) h.group.visible = false;
    if (h.cone) h.cone.visible = false;
    if (h.pool) h.pool.visible = false;
  }
}

function spawnPoint(px, pz, random) {
  // A point ~spawnDist from the player, snapped onto the nearest road line so the
  // car arrives on a road, clamped inside the city and pushed out of buildings.
  const angle = random() * Math.PI * 2;
  let x = px + Math.sin(angle) * POLICE.spawnDist;
  let z = pz + Math.cos(angle) * POLICE.spawnDist;
  x = clamp(x, -CITY.bound + 6, CITY.bound - 6);
  z = clamp(z, -CITY.bound + 6, CITY.bound - 6);
  if (Math.abs(x - px) > Math.abs(z - pz)) {
    let best = CITY.roadLines[0];
    for (const line of CITY.roadLines) {
      if (Math.abs(line - x) < Math.abs(best - x)) best = line;
    }
    x = best;
  } else {
    let best = CITY.roadLines[0];
    for (const line of CITY.roadLines) {
      if (Math.abs(line - z) < Math.abs(best - z)) best = line;
    }
    z = best;
  }
  return { x, z };
}

function removePoliceCar(police, car) {
  police.renderer.scene.remove(car.mesh);
  const i = police.cars.indexOf(car);
  if (i >= 0) police.cars.splice(i, 1);
}

function syncRoadblock(police, ctx) {
  const level = ctx.wanted >= 4 ? ctx.wanted : 0;
  if (level === police.roadblockLevel) return;
  for (const car of police.roadblockCars) police.renderer.scene.remove(car.mesh);
  police.roadblockCars.length = 0;
  police.roadblockLevel = level;
  if (!level) return;
  const x = CITY.roadLines.reduce((best, line) => Math.abs(line - ctx.x) < Math.abs(best - ctx.x) ? line : best, CITY.roadLines[0]);
  const z = clamp(ctx.z + (ctx.speed >= 0 ? 34 : -34), -CITY.bound + 6, CITY.bound - 6);
  for (const [offset, heading] of [[-2.3, Math.PI / 2], [2.3, -Math.PI / 2]]) {
    const mesh = police.renderer.makePoliceCar();
    mesh.position.set(x + offset, 0, z);
    mesh.rotation.y = heading;
    police.renderer.scene.add(mesh);
    police.roadblockCars.push({ mesh, x: x + offset, z, heading });
  }
}

/**
 * Pick where the air unit wants to be this frame. Two controllers were built and
 * measured against the game's real chase camera (see reports/W-B.md):
 *   'lead'  — hold a point ahead of Rio along his heading, weaving gently to one
 *             side, so the aircraft and its light sit in the windscreen view. WINNER:
 *             in frame 100% of a 20 s chase.
 *   'orbit' — circle Rio at a fixed radius. Rejected: the chase camera only sees
 *             ~21 deg above the horizon, so most of the loop is behind the player
 *             and off frame, and the radius collapsed to 1.8 m at speed.
 * `mode` keeps the loser switchable for the record.
 */
function heliTarget(h, ctx, dt) {
  const sp = Math.hypot(h.vx, h.vz);
  if (sp > 1.2) h.faceHeading = Math.atan2(h.vx, h.vz);
  if (h.mode === 'orbit') {
    h.angle += 0.3 * dt;
    return { x: ctx.x + Math.sin(h.angle) * 22, z: ctx.z + Math.cos(h.angle) * 22 };
  }
  // Heading Rio is travelling in (or the way he faces when standing still).
  const fx = Math.sin(h.faceHeading);
  const fz = Math.cos(h.faceHeading);
  h.weave += HELI.weaveRate * dt;
  const side = Math.sin(h.weave) * HELI.leadSide;
  // Feed-forward: an exponential follow of a moving target settles v/smoothH
  // metres behind it — at 18 m/s that is 8 m, which pulled the aircraft onto the
  // car's roof and out of the top of the frame. Leading by that same amount makes
  // the station exact at any speed.
  const ffx = clamp(h.vx / HELI.smoothH, -26, 26);
  const ffz = clamp(h.vz / HELI.smoothH, -26, 26);
  // Perpendicular offset, so it drifts across the road rather than tailgating.
  return {
    x: ctx.x + fx * HELI.lead + fz * side + ffx,
    z: ctx.z + fz * HELI.lead - fx * side + ffz,
  };
}

/** Highest roof near (x, z), so the aircraft can fly over towers instead of through. */
function roofHeight(ctx, x, z) {
  const city = ctx.city;
  if (!city || !city.buildings) return 0;
  let h = 0;
  const pad = 9;
  for (const b of city.buildings) {
    if (b.h > h && x >= b.x - b.w / 2 - pad && x <= b.x + b.w / 2 + pad
      && z >= b.z - b.d / 2 - pad && z <= b.z + b.d / 2 + pad) h = b.h;
  }
  return h;
}

/**
 * The air unit. Lifts off at four stars, holds station ahead of and above Rio,
 * aims its searchlight down at him, climbs out and hides when the stars drop.
 * Position is smoothed exponentially (frame-rate independent) and capped in speed,
 * so it never snaps or pops between frames.
 */
function updateHeli(police, ctx, dt) {
  const h = police.heli;
  if (!h) return;
  const wanted = ctx.wanted || 0;

  // Player velocity, smoothed: the lead point and the beam lead both use it.
  const dx = ctx.x - h.px;
  const dz = ctx.z - h.pz;
  h.px = ctx.x;
  h.pz = ctx.z;
  if (dt > 0) {
    const k = 1 - Math.exp(-4 * dt);
    h.vx += (dx / dt - h.vx) * k;
    h.vz += (dz / dt - h.vz) * k;
  }

  if (wanted < HELI.minWanted) {
    if (h.state === 'leave') {
      // Climb out and fade, then disappear: no popping. `active` is already false,
      // so the HUD and the audio loop stop the moment the stars drop.
      h.t += dt;
      h.y += HELI.climb * dt;
      h.x += (ctx.x - h.x) * 0.4 * dt;
      h.z += (ctx.z - h.z) * 0.4 * dt;
      const f = Math.max(0, 1 - h.t / HELI.leaveTime);
      h.cone.material.opacity = 0.13 * f;
      h.pool.material.opacity = 0.2 * f;
      h.rotor.rotation.y += dt * 26;
      h.tailRotor.rotation.x += dt * 40;
      if (h.beacons) h.beacons.material.color.setHex(0x581410);
      h.group.position.set(h.x, h.y, h.z);
      if (h.t >= HELI.leaveTime) {
        h.state = 'off';
        h.group.visible = false;
        h.cone.visible = false;
        h.pool.visible = false;
      }
      return;
    }
    if (h.state === 'off') return;
    // Running when the stars drop: switch to the climb-out.
    h.state = 'leave';
    h.t = 0;
    h.active = false;
    return;
  }

  if (h.state === 'off') {
    // Lift-off: come in from further up the road, high, and slide back onto
    // station. It must never spawn behind Rio: flying forward from behind makes it
    // pass straight over his head (measured 1.4 m at closest approach), which
    // snaps the aircraft through the top of the frame.
    h.seeded = true;
    h.angle = (ctx.random ? ctx.random() : 0.5) * Math.PI * 2;
    h.weave = h.angle;
    h.faceHeading = Math.atan2(ctx.x - h.px, ctx.z - h.pz);
    const hx = Math.sin(h.faceHeading);
    const hz = Math.cos(h.faceHeading);
    h.x = ctx.x + hx * HELI.lead * 1.6;
    h.z = ctx.z + hz * HELI.lead * 1.6;
    h.y = HELI.spawnAlt;
    h.heading = h.faceHeading + Math.PI;
    h.vx = 0;
    h.vz = 0;
    h.px = ctx.x;
    h.pz = ctx.z;
    h.t = 0;
    h.state = 'enter';
    h.active = true;
    h.group.visible = true;
    h.cone.visible = true;
    h.pool.visible = true;
    h.cone.material.opacity = 0.13;
    h.pool.material.opacity = 0.2;
    h.group.position.set(h.x, h.y, h.z);
    return;
  }

  h.active = true;
  h.t += dt;

  // Stars came back while it was climbing out: re-assert the airframe and beam,
  // otherwise it would keep fading and stay in the 'leave' state forever.
  if (h.state === 'leave') {
    h.state = 'hover';
    h.group.visible = true;
    h.cone.visible = true;
    h.pool.visible = true;
    h.cone.material.opacity = 0.13;
    h.pool.material.opacity = 0.2;
  }

  const tgt = heliTarget(h, ctx, dt);
  // Exponential smoothing toward the target, then a speed cap so a sudden change of
  // target (or a player who teleports) slides instead of snapping.
  const kx = 1 - Math.exp(-HELI.smoothH * dt);
  let nx = h.x + (tgt.x - h.x) * kx;
  let nz = h.z + (tgt.z - h.z) * kx;
  const sx = nx - h.x;
  const sz = nz - h.z;
  const stepLen = Math.hypot(sx, sz);
  const maxStep = HELI.maxSpeed * dt;
  if (stepLen > maxStep && stepLen > 1e-6) {
    nx = h.x + (sx / stepLen) * maxStep;
    nz = h.z + (sz / stepLen) * maxStep;
  }
  h.x = nx;
  h.z = nz;

  // Vertical: hold station above Rio, but never fly into a tower. The wanted
  // altitude is the base hover plus whatever roof it has to clear.
  const clear = roofHeight(ctx, h.x, h.z) + HELI.roofPad;
  const wantY = Math.max(HELI.alt, clear);
  let dy = (wantY - h.y) * (1 - Math.exp(-HELI.smoothV * dt));
  const rate = (wantY < h.y ? HELI.descend : HELI.climb) * dt;
  if (Math.abs(dy) > rate) dy = Math.sign(dy) * rate;
  h.y = Math.max(8, h.y + dy);
  if (h.state === 'enter' && Math.abs(h.y - wantY) < 3) h.state = 'hover';

  // Face travel; when hovering nearly still, face Rio.
  const moveSpeed = dt > 0 ? stepLen / dt : 0;
  const wantYaw = moveSpeed > 0.8 ? Math.atan2(sx, sz) : Math.atan2(ctx.x - h.x, ctx.z - h.z);
  let dh = wantYaw - h.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  h.heading += clamp(dh, -HELI.turn * dt, HELI.turn * dt);

  h.group.position.set(h.x, h.y, h.z);
  h.group.rotation.y = h.heading;
  // Rotors are tied to dt, so their speed does not depend on the frame rate.
  h.rotor.rotation.y += dt * 26;
  h.tailRotor.rotation.x += dt * 40;
  // Belly beacons blink red, about three times a second, in step with the rotor.
  if (h.beacons) {
    const on = Math.floor(h.t * 3) % 2 === 0;
    h.beacons.material.color.setHex(on ? 0xff3a2a : 0x581410);
  }

  // Searchlight: apex on the belly, aimed a little ahead of Rio's feet.
  const aimX = ctx.x + h.vx * 0.25;
  const aimZ = ctx.z + h.vz * 0.25;
  const ax = aimX - h.x;
  const ay = 0.5 - (h.y - 1.0);
  const az = aimZ - h.z;
  const dist = Math.hypot(ax, ay, az) || 1;
  _dir.set(ax / dist, ay / dist, az / dist);
  h.cone.position.set(h.x, h.y - 1.0, h.z);
  h.cone.quaternion.setFromUnitVectors(_down, _dir);
  const spread = 2.2 + dist * 0.15;
  h.cone.scale.set(spread, dist, spread);
  h.pool.position.set(aimX, 0.07, aimZ);
  const poolR = Math.max(2.5, spread * 1.35);
  h.pool.scale.set(poolR, 1, poolR);
}

/**
 * Chase + cool-off. `ctx` is { x, z, driving, speed, wanted, time, city, random,
 * onBusted }. Returns nothing; mutates ctx.wanted via ctx.setWanted(n).
 * One police car per wanted star, up to maxActive; cars too far away respawn nearer.
 */
export function updatePolice(police, ctx, dt) {
  const wanted = ctx.wanted;
  syncRoadblock(police, ctx);
  updateHeli(police, ctx, dt);
  // While the air unit's light is on Rio the ground units stay on him: nothing is
  // counted as "lost", so no star cools off, and a car that strays gets pulled back.
  const lit = police.heli ? police.heli.active : false;
  const want = Math.min(wanted, POLICE.maxActive);
  while (police.cars.length < want) {
    const p = spawnPoint(ctx.x, ctx.z, ctx.random);
    spawnPoliceCar(police, p.x, p.z, ctx.city);
  }
  while (police.cars.length > want) {
    removePoliceCar(police, police.cars[police.cars.length - 1]);
  }
  let nearest = Infinity;
  const fHeading = formationHeading(police, ctx.x, ctx.z);
  for (let ci = 0; ci < police.cars.length; ci += 1) {
    const car = police.cars[ci];
    const d = Math.hypot(car.x - ctx.x, car.z - ctx.z);
    if (d < nearest) nearest = d;
    // A car that lost Rio completely reappears nearer the action. While the air
    // unit has Rio lit it pulls them back sooner, so the pressure holds.
    if (d > (lit ? HELI.respawnTight : POLICE.tooFar)) {
      const p = spawnPoint(ctx.x, ctx.z, ctx.random);
      car.x = p.x;
      car.z = p.z;
      car.speed = 0;
      resolveCircle(car, 1.7, ctx.city);
    }
    car.slot = ci % SEP.slots.length;
    const targetHeading = (() => {
      // Stuck? A police car steering straight at Rio grinds against a building
      // face forever: the wall push cancels its forward motion. If the distance
      // to Rio has not shrunk for 2 s, detour for 3 s toward a point 30 m to
      // one side of Rio, which carries the car around the end of the obstacle.
      // Aiming for its SLOT rather than Rio's own point is what keeps a four-car
      // pursuit spread out instead of piled on one spot.
      const slot = slotPoint(SEP.slots[car.slot], ctx.x, ctx.z, fHeading);
      let tx = slot.x;
      let tz = slot.z;
      if (car.detourT > 0) {
        car.detourT -= dt;
        const dx = ctx.x - car.x;
        const dz = ctx.z - car.z;
        const len = Math.hypot(dx, dz) || 1;
        tx = ctx.x + (-dz / len) * 30 * car.detourSide;
        tz = ctx.z + (dx / len) * 30 * car.detourSide;
        if (car.detourT <= 0) {
          car.lastDist = d;
          car.stuckT = 0;
        }
      } else {
        car.stuckCheck += dt;
        if (car.stuckCheck >= 0.5) {
          car.stuckCheck = 0;
          if (d < car.lastDist - 1) {
            car.lastDist = d;
            car.stuckT = 0;
          } else {
            car.stuckT += 0.5;
          }
        }
        if (car.stuckT > 2) {
          car.detourT = 3;
          car.detourSide *= -1;
          car.stuckT = 0;
        }
      }
      return Math.atan2(tx - car.x, tz - car.z);
    })();
    let dh = targetHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car.heading += clamp(dh, -POLICE.turn * dt, POLICE.turn * dt);
    // Close in fast, then match Rio's pace so the chase lasts instead of ending
    // in a ram every few seconds.
    const cruise = Math.min(POLICE.cruise + POLICE.perStar * wanted, POLICE.maxSpeed);
    const wantSpeed = d < 9 ? Math.max(6, Math.abs(ctx.speed || 0) * 0.9) : cruise;
    car.speed += (wantSpeed - car.speed) * Math.min(1, dt * 1.5);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    resolveCircle(car, 1.7, ctx.city);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    const spin = (car.speed * dt) / 0.36;
    for (const w of car.mesh.userData.wheels) w.rotation.x += spin;
    // Flash the light bar: red and blue alternate about four times a second.
    car.phase += dt;
    const redOn = Math.floor(car.phase * 4) % 2 === 0;
    car.mesh.userData.lightR.material.color.setHex(redOn ? 0xff2a2a : 0x5c1010);
    car.mesh.userData.lightB.material.color.setHex(redOn ? 0x101c5c : 0x2a6bff);
  }
  // Hard separation backstop. The slots above spread the pursuit out in normal driving;
  // this pass guarantees the invariant even when cars are shoved by a wall, spawn on top
  // of each other, or converge on a corner: no two cruisers closer than SEP.minGap. It
  // pushes each car half the shortfall along the line between them, then re-resolves
  // against buildings so a shove can never put a car inside a wall.
  for (let i = 0; i < police.cars.length; i += 1) {
    for (let j = i + 1; j < police.cars.length; j += 1) {
      const a = police.cars[i];
      const b = police.cars[j];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let dist = Math.hypot(dx, dz);
      if (dist >= SEP.minGap) continue;
      if (dist < 1e-3) {
        // Exactly coincident: pick a deterministic direction so the frame is stable.
        dx = Math.sin(i + j);
        dz = Math.cos(i + j);
        dist = 1;
      }
      const short = (SEP.minGap - Math.hypot(b.x - a.x, b.z - a.z)) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      a.x -= nx * short;
      a.z -= nz * short;
      b.x += nx * short;
      b.z += nz * short;
      resolveCircle(a, 1.7, ctx.city);
      resolveCircle(b, 1.7, ctx.city);
      // Re-place the meshes the shove moved.
      a.mesh.position.set(a.x, 0, a.z);
      b.mesh.position.set(b.x, 0, b.z);
    }
  }
  // Cool-off: no police car in sight for a while drops one star, then the timer
  // restarts for the next star. Being seen resets the timer. With the searchlight
  // on Rio he is never "lost": the timer only creeps, so a wanted 4-5 hold takes
  // most of twice as long to shake off.
  if (wanted > 0) {
    if (nearest > POLICE.sightDist) {
      police.hiddenTimer += dt * (lit ? HELI.decayRate : 1);
      const need = POLICE.decayBase + POLICE.decayPerStar * wanted;
      if (police.hiddenTimer >= need) {
        police.hiddenTimer = 0;
        ctx.setWanted(wanted - 1);
      }
    } else {
      police.hiddenTimer = 0;
    }
  } else {
    police.hiddenTimer = 0;
  }
  // Busted: on foot, a police car closes in while Rio is slow or standing still.
  if (wanted > 0 && !ctx.driving && nearest < POLICE.bustDist && Math.abs(ctx.speed || 0) < POLICE.bustSpeed) {
    ctx.onBusted();
  }
}
