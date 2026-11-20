// Combat: fists, and three guns with their own magazines — a pistol, a fast SMG with
// spread, and a slow shotgun that throws a wide pattern and knocks people back.
// All of it is hitscan: the nearest person or car inside the aim cone takes the hit, a
// tracer is drawn from the muzzle, and a muzzle flash pops at the muzzle. Ammo lives per
// weapon on c.weapons[id]; c.mag / c.reserve mirror the CURRENT weapon so the HUD and the
// save keep reading the same two fields they always did. Weapon crates around town hand
// out the SMG, the shotgun and a wrench that fixes the nearest car.
//
// Shooting a bystander or a car is a crime; rivals at the docks are fair game.
import * as THREE from 'three';
import { AMMO, PALETTE, PICKUP_SPOTS } from './config.js';
import { createRandom } from './random.js';
import { allCars, carUnderPlayer, damageCar, nearestCar, repairCar, tickCarFx } from './vehicles.js';

const PUNCH_RANGE = 2.6;
const MAX_TRACERS = 7;      // one shotgun blast fits in a single draw call
const CRATE_RESPAWN = 60;

// --- weapons -------------------------------------------------------------------------
// range   hitscan reach in metres            spread  aim cone half-angle, radians
// pellets how many tracers/hit rolls per shot (shotgun pattern)
// knock   metres of shove per hit            carDmg  damage added to a car per hit
export const WEAPONS = {
  // muzzle: distance from the shooter's centre to the barrel tip when aiming — the
  // hand sits ~0.63 m ahead of the centre and the barrel runs (len - 0.07) m past
  // it. Keep in step with the barrel lengths in GUN_GEO (render.js syncGuns).
  pistol: { id: 'pistol', name: 'Pistol', magSize: 12, cooldown: 0.25, range: 30, spread: 0.035, pellets: 1, reload: 0.9, knock: 0, carDmg: 5, startMag: 12, startReserve: 24, crate: 12, muzzle: 0.9 },
  smg: { id: 'smg', name: 'SMG', magSize: 30, cooldown: 0.075, range: 26, spread: 0.115, pellets: 1, reload: 1.15, knock: 0.25, carDmg: 3, startMag: 0, startReserve: 0, crate: 60, muzzle: 1.18 },
  shotgun: { id: 'shotgun', name: 'Shotgun', magSize: 6, cooldown: 0.85, range: 15, spread: 0.30, pellets: 7, reload: 1.5, knock: 2.4, carDmg: 9, startMag: 0, startReserve: 0, crate: 12, muzzle: 1.48 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun'];

// Weapon + wrench crates. Local to this file (config.js belongs to W-A).
export const CRATE_SPOTS = [
  { x: -95, z: 8, kind: 'smg' },
  { x: 40, z: 92, kind: 'shotgun' },
  { x: 92, z: -40, kind: 'wrench' },
];

function angleTo(fx, fz, dx, dz) {
  const d = Math.hypot(dx, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / d)));
}

/** Keep c.mag / c.reserve pointing at the current weapon (HUD + save compatibility). */
function sync(c) {
  const slot = c.weapons[c.weapon];
  if (!slot) return;
  c.mag = slot.mag;
  c.reserve = slot.reserve;
}

export function weaponInfo(c) {
  const def = WEAPONS[c.weapon] || WEAPONS.pistol;
  const slot = c.weapons[def.id];
  return { id: def.id, name: def.name, mag: slot.mag, reserve: slot.reserve };
}

/** All three weapons for the HUD list: [{id, name, mag, reserve, active}]. */
export function weaponList(c) {
  return WEAPON_ORDER.map((id) => ({
    id,
    name: WEAPONS[id].name,
    mag: c.weapons[id].mag,
    reserve: c.weapons[id].reserve,
    active: id === c.weapon,
  }));
}

/** Set the current weapon. An unknown id falls back to the pistol. */
export function switchWeapon(c, id) {
  c.weapon = WEAPONS[id] ? id : 'pistol';
  c.reloading = 0;
  sync(c);
  return c.weapon;
}

/** Next weapon in ['pistol','smg','shotgun'], wrapping; returns its id. */
export function cycleWeapon(c) {
  const i = WEAPON_ORDER.indexOf(c.weapon);
  const next = WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length];
  return switchWeapon(c, next);
}

/** Add rounds to a weapon's reserve. Returns the new reserve. */
export function refillAmmo(c, id, rounds) {
  if (!WEAPONS[id] || !c.weapons[id]) return 0;
  const slot = c.weapons[id];
  slot.reserve = Math.max(0, slot.reserve + Math.max(0, rounds | 0));
  sync(c);
  return slot.reserve;
}

// --- tracer pool ---------------------------------------------------------------------
// One LineSegments holds every live tracer: a shotgun blast is 1 draw, not 7. Positions
// are written straight into the buffer each shot, so a shot never allocates.
function makeTracerPool(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_TRACERS * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }),
  );
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, geo, pos, count: 0, t: 0 };
}

// Crate colours by kind: body first, collar second.
const CRATE_TINT = {
  smg: { body: 0x2f4f6f, band: 0x7fc8ff },
  shotgun: { body: 0x6f3a2f, band: 0xffb27a },
  wrench: { body: 0x4a6b3a, band: 0xd7f0a8 },
};
const crateGeo = {
  box: new THREE.BoxGeometry(0.78, 0.78, 0.78),
  band: new THREE.BoxGeometry(0.86, 0.14, 0.86),
};
const crateMatCache = new Map();
function crateMaterial(color) {
  if (!crateMatCache.has(color)) crateMatCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return crateMatCache.get(color);
}

/** A weapon crate: a solid block with a bright collar, so the three kinds read apart at
 *  speed. Two meshes and one shared material per colour. */
function makeCrate(kind) {
  const tint = CRATE_TINT[kind] || CRATE_TINT.smg;
  const group = new THREE.Group();
  const box = new THREE.Mesh(crateGeo.box, crateMaterial(tint.body));
  box.position.set(0, 0.55, 0);
  box.castShadow = true;
  const band = new THREE.Mesh(crateGeo.band, crateMaterial(tint.band));
  band.position.set(0, 0.98, 0);
  group.add(box, band);
  group.userData.crate = { kind, band };
  return group;
}

export function createCombat(renderer) {
  const tracers = makeTracerPool(renderer.scene);
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 }),
  );
  flash.visible = false;
  flash.frustumCulled = false;
  renderer.scene.add(flash);
  // Drive-by gun: Rio is hidden inside the cabin while driving, so the person
  // instancing has nothing to draw — but a shot out of the driver's window still
  // needs a visible weapon at the muzzle, or the tracer starts from thin air.
  // One dark box, shown at the window for a beat after a drive-by shot only.
  const driveByGun = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, 0.15, 0.62),
    new THREE.MeshLambertMaterial({ color: 0x23262c }),
  );
  driveByGun.visible = false;
  driveByGun.frustumCulled = false;
  renderer.scene.add(driveByGun);
  const pickups = PICKUP_SPOTS.map((s) => {
    const mesh = renderer.makePickup();
    mesh.position.set(s.x, 0, s.z);
    renderer.scene.add(mesh);
    return { x: s.x, z: s.z, mesh, active: true, respawn: 0, kind: 'ammo' };
  });
  const crates = CRATE_SPOTS.map((s) => {
    const mesh = makeCrate(s.kind);
    mesh.position.set(s.x, 0, s.z);
    renderer.scene.add(mesh);
    return { x: s.x, z: s.z, mesh, active: true, respawn: 0, kind: s.kind };
  });
  return {
    renderer, weapon: 'pistol',
    weapons: {
      pistol: { mag: AMMO.startMag, reserve: AMMO.startReserve },
      smg: { mag: WEAPONS.smg.startMag, reserve: WEAPONS.smg.startReserve },
      shotgun: { mag: WEAPONS.shotgun.startMag, reserve: WEAPONS.shotgun.startReserve },
    },
    mag: AMMO.startMag, reserve: AMMO.startReserve,
    reloading: 0, cooldown: 0, punchCooldown: 0,
    tracers, flash, flashT: 0, driveByGun, driveByGunT: 0,
    pickups, crates, hostiles: [],
    // Seeded RNG for shot spread: no Math.random() in anything a screenshot depends on.
    random: createRandom(0x5c1a),
    shotsFired: 0, kills: 0,
  };
}

export function resetCombat(c) {
  c.weapon = 'pistol';
  c.weapons.pistol.mag = AMMO.startMag;
  c.weapons.pistol.reserve = AMMO.startReserve;
  c.weapons.smg.mag = WEAPONS.smg.startMag;
  c.weapons.smg.reserve = WEAPONS.smg.startReserve;
  c.weapons.shotgun.mag = WEAPONS.shotgun.startMag;
  c.weapons.shotgun.reserve = WEAPONS.shotgun.startReserve;
  sync(c);
  c.reloading = 0;
  c.cooldown = 0;
  c.punchCooldown = 0;
  c.tracers.mesh.visible = false;
  c.tracers.geo.setDrawRange(0, 0);
  c.tracers.count = 0;
  c.tracers.t = 0;
  c.flash.visible = false;
  c.flashT = 0;
  c.driveByGun.visible = false;
  c.driveByGunT = 0;
  c.shotsFired = 0;
  c.kills = 0;
  for (const p of c.pickups) {
    p.active = true;
    p.respawn = 0;
    p.mesh.visible = true;
  }
  for (const k of c.crates) {
    k.active = true;
    k.respawn = 0;
    k.mesh.visible = true;
  }
  clearHostiles(c);
}

export function clearHostiles(c) {
  for (const h of c.hostiles) c.renderer.scene.remove(h.mesh);
  c.hostiles.length = 0;
}

export function spawnHostiles(c, x, z, count) {
  clearHostiles(c);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const hx = x + Math.sin(angle) * 10;
    const hz = z + Math.cos(angle) * 10;
    const mesh = c.renderer.makePerson(PALETTE.hostile);
    mesh.position.set(hx, 0, hz);
    c.renderer.scene.add(mesh);
    c.hostiles.push({ x: hx, z: hz, heading: 0, mesh, hp: 2, down: false, hitAt: -99, phase: i * 1.7 });
  }
}

export function startReload(c) {
  const def = WEAPONS[c.weapon] || WEAPONS.pistol;
  const slot = c.weapons[def.id];
  if (c.reloading > 0 || slot.reserve <= 0 || slot.mag >= def.magSize) return false;
  c.reloading = def.reload;
  return true;
}

/** Write one tracer segment into the shared buffer (whole burst = one draw call). */
function pushTracer(c, i, from, to) {
  const o = i * 6;
  const p = c.tracers.pos;
  p[o] = from.x; p[o + 1] = from.y; p[o + 2] = from.z;
  p[o + 3] = to.x; p[o + 4] = to.y; p[o + 5] = to.z;
}

/** Show `n` tracers and pop the muzzle flash at the origin of the first one. */
function showShots(c, segs) {
  const n = Math.min(segs.length, MAX_TRACERS);
  for (let i = 0; i < n; i += 1) pushTracer(c, i, segs[i].from, segs[i].to);
  c.tracers.geo.setDrawRange(0, n * 2);
  c.tracers.geo.attributes.position.needsUpdate = true;
  c.tracers.mesh.visible = true;
  c.tracers.count = n;
  // Long enough to read: at 0.08 s the tracer was gone before a single 60 fps
  // frame could show it, and the flash (0.06 s) the same. 0.15/0.18 s is still a
  // blink, but a real frame — and a screenshot — can catch it.
  c.tracers.t = 0.15;
  const f = segs[0].from;
  c.flash.position.set(f.x, f.y, f.z);
  c.flash.visible = true;
  c.flashT = 0.18;
}

// --- drive-by aim --------------------------------------------------------------------
// Two candidate origins for a shot fired from behind the wheel. Both stay in the build so
// the chosen one can be swapped without a rewrite; DRIVEBY picks the one gameplay uses.
// Chosen by measurement — see v5/reports/W-C.md.
const DRIVEBY = 'hybrid';

/** A: muzzle fixed in car-local space (right-hand window, just past the B-pillar) with the
 *  shot going along the car's own heading. Cheap, never lags, but the shot follows the
 *  chassis instead of where the camera looks. */
function driveByLocal(ctx) {
  const s = Math.sin(ctx.heading);
  const c = Math.cos(ctx.heading);
  const lx = 0.84;   // driver's window, right side of the cabin
  const ly = 1.12;
  const lz = 0.95;   // level with the front door
  const from = { x: ctx.x + c * lx + s * lz, y: ly, z: ctx.z - s * lx + c * lz };
  return { from, fx: s, fz: c };
}

/**
 * B: ray from the camera through the crosshair. The muzzle is the point where that ray
 * EXITS the car's own bounding cylinder (+ a short stand-off), so the tracer starts past
 * the bodywork instead of inside Rio or the roof; the direction is the camera's yaw,
 * flattened, so a shot follows the crosshair and not the camera's downward pitch.
 */
const _camDir = new THREE.Vector3();
function driveByCamera(renderer, ctx) {
  const cam = renderer && renderer.camera;
  if (!cam) return driveByLocal(ctx);
  cam.updateMatrixWorld();
  cam.getWorldDirection(_camDir);
  const dx = _camDir.x;
  const dz = _camDir.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  // Circle/ray intersection in the ground plane: solve |cam + t*u - car| = R for t.
  const CAR_R = 1.55;   // car half-width + a margin; the body is ~1.9 m wide
  const ox = cam.position.x - ctx.x;
  const oz = cam.position.z - ctx.z;
  const b = ox * ux + oz * uz;              // projection of the camera onto the ray
  const c = ox * ox + oz * oz - CAR_R * CAR_R;
  const disc = b * b - c;
  let t = 0;
  if (disc > 0) t = -b + Math.sqrt(disc);   // the far root: where the ray leaves the body
  t = Math.max(0, t) + 0.9;                 // stand off past the bodywork
  const from = { x: ctx.x + ux * t, y: 1.15, z: ctx.z + uz * t };
  return { from, fx: ux, fz: uz };
}

/**
 * Synthesis of A and B, and the one gameplay uses: the muzzle stays where A put it — in the
 * car's own frame, at the driver's window — but it is pushed out PAST the bodywork (so the
 * tracer never starts inside the cabin) and the direction comes from B (the camera's yaw,
 * the crosshair). Measured: 0 % of tracers cut through the car, 0.0 m aim error, and the
 * muzzle sits within a metre of the real window instead of 9 m behind the camera.
 */
function driveByHybrid(renderer, ctx) {
  const heading = ctx.heading || 0;
  // Camera yaw when we have a camera (follows the crosshair); else the car's heading.
  let ux = Math.sin(heading);
  let uz = Math.cos(heading);
  const cam = renderer && renderer.camera;
  if (cam) {
    cam.updateMatrixWorld();
    cam.getWorldDirection(_camDir);
    const l = Math.hypot(_camDir.x, _camDir.z);
    if (l > 1e-4) { ux = _camDir.x / l; uz = _camDir.z / l; }
  }
  // Muzzle: driver's window in car-local space, nudged outward to clear the 1.9 m body.
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const lx = 1.18;   // clear of the door skin (body half-width 0.95 m) + tracer thickness
  const ly = 1.12;
  const lz = 0.85;
  const from = { x: ctx.x + c * lx + s * lz, y: ly, z: ctx.z - s * lx + c * lz };
  // Converge on the crosshair: aim from the window AT a point down the camera's sight line,
  // so a shot fired from the door still lands where the reticle is. Without this the shot
  // is parallel to the crosshair and misses it by the 1.05 m door offset.
  const CONVERGE = 14;
  const tx = ctx.x + ux * CONVERGE - from.x;
  const tz = ctx.z + uz * CONVERGE - from.z;
  const tl = Math.hypot(tx, tz);
  if (tl > 0.5) return { from, fx: tx / tl, fz: tz / tl };
  return { from, fx: ux, fz: uz };
}

/**
 * The aim ray for one shot. On foot it is a muzzle at the barrel tip along his heading
 * (WEAPONS[].muzzle — the hand is ~0.63 m ahead of Rio when aiming and the barrel runs
 * past it, so the flash and the tracer start at the muzzle, not at his body);
 * from behind the wheel it is the chosen drive-by method. Drive-by is detected from the car
 * Rio is sitting on (main.js parks him exactly on the car's x/z), so this works whether or
 * not the caller knows he is driving.
 */
function aimRay(c, ctx) {
  const car = ctx.car || carUnderPlayer(ctx.driving ? ctx.driving : null, ctx.x, ctx.z);
  if (car) {
    ctx.car = car;
    const c2 = { ...ctx, heading: car.heading };
    if (DRIVEBY === 'camera') return driveByCamera(c.renderer, c2);
    if (DRIVEBY === 'local') return driveByLocal(c2);
    return driveByHybrid(c.renderer, c2);
  }
  const fx = Math.sin(ctx.heading);
  const fz = Math.cos(ctx.heading);
  const m = (WEAPONS[c.weapon] || WEAPONS.pistol).muzzle;
  // The barrel is in the right hand, 0.37 m to the shooter's right of the centreline
  // (render.js syncGuns): the muzzle — and the flash and tracer that start there —
  // sit on the gun, not on the body centreline. Local +X under heading h is world
  // (cos h, 0, -sin h).
  const rx = Math.cos(ctx.heading) * 0.37;
  const rz = -Math.sin(ctx.heading) * 0.37;
  return { from: { x: ctx.x + rx + fx * m, y: 1.35, z: ctx.z + rz + fz * m }, fx, fz };
}

/** Rotate a heading's (fx, fz) by `a` radians — the pattern/spread offset for one pellet. */
function spreadDir(fx, fz, a) {
  if (a === 0) return { fx, fz };
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return { fx: fx * ca - fz * sa, fz: fx * sa + fz * ca };
}

/**
 * Fire one round of the current weapon — the single fire entry point. `ctx`:
 * { x, z, heading, peds, trafficCars, sanctioned, driving, time,
 *   onCrime(n, key, msg), announce(msg), onHostileDown(), onCarHit(car) }.
 * Returns 'fired', 'empty', 'reloading' or 'busy'.
 */
export function firePistol(c, ctx) {
  const def = WEAPONS[c.weapon] || WEAPONS.pistol;
  const slot = c.weapons[def.id];
  if (c.cooldown > 0 || c.reloading > 0) return 'busy';
  if (slot.mag <= 0) {
    if (startReload(c)) return 'reloading';
    return 'empty';
  }
  slot.mag -= 1;
  sync(c);
  c.cooldown = def.cooldown;
  c.shotsFired += 1;
  const ray = aimRay(c, ctx);
  const segs = [];
  // One hit roll per pellet: the shotgun throws a fan of them, the others a single ray.
  let hits = 0;
  let bestKind = null;
  let bestObj = null;
  let bestD = Infinity;
  for (let i = 0; i < def.pellets; i += 1) {
    // A symmetric fan for pellets; a small seeded jitter for single shots. No Math.random.
    const a = def.pellets > 1
      ? ((i + 0.5) / def.pellets * 2 - 1) * def.spread
      : (c.random() * 2 - 1) * def.spread;
    const d = spreadDir(ray.fx, ray.fz, a);
    // Nearest target inside this pellet's forward cone.
    let best = null;
    let bd = Infinity;
    const consider = (obj, maxD, maxAngle, kind) => {
      const dx = obj.x - ctx.x;
      const dz = obj.z - ctx.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxD || dist >= bd) return;
      if (angleTo(d.fx, d.fz, dx, dz) > maxAngle) return;
      best = { obj, d: dist, kind };
      bd = dist;
    };
    for (const h of c.hostiles) if (!h.down) consider(h, def.range, def.spread + 0.45, 'hostile');
    if (!best) for (const p of ctx.peds || []) if (!p.down) consider(p, def.range, def.spread + 0.45, 'ped');
    if (!best) for (const car of ctx.trafficCars || []) consider(car, def.range * 0.8, def.spread + 0.35, 'car');
    const to = best
      ? { x: best.obj.x, y: 1.2, z: best.obj.z }
      : { x: ray.from.x + d.fx * def.range, y: ray.from.y, z: ray.from.z + d.fz * def.range };
    segs.push({ from: ray.from, to });
    if (best && best.d < bestD) {
      bestKind = best.kind;
      bestObj = best.obj;
      bestD = best.d;
      hits += 1;
    }
  }
  showShots(c, segs);
  // Drive-by: the muzzle is the driver's window and Rio himself is hidden in the
  // cabin, so put the gun itself at the window for a beat — barrel tip at the
  // muzzle point, body back along the shot. On foot this never runs (no car).
  if (ctx.car) {
    const g = c.driveByGun;
    g.position.set(ray.from.x - ray.fx * 0.2, ray.from.y, ray.from.z - ray.fz * 0.2);
    g.rotation.y = Math.atan2(ray.fx, ray.fz);
    g.visible = true;
    c.driveByGunT = 0.25;
  }
  if (!ctx.sanctioned) ctx.onCrime && ctx.onCrime(1, 'shoot', 'Gunfire! The cops heard that.');
  if (!bestObj) return 'fired';
  if (bestKind === 'hostile') {
    // Most of a shotgun pattern landing drops a rival in one blast; a single round is 1 hp.
    const h = bestObj;
    h.hp -= Math.max(1, Math.round(hits * (def.pellets > 1 ? 0.55 : 1)));
    const push = Math.max(def.knock, 0.6);
    h.x += ((h.x - ctx.x) / (bestD || 1)) * push;
    h.z += ((h.z - ctx.z) / (bestD || 1)) * push;
    if (h.hp <= 0) {
      h.down = true;
      h.mesh.rotation.z = 1.5;
      c.kills += 1;
      if (ctx.onHostileDown) ctx.onHostileDown();
    }
  } else if (bestKind === 'ped') {
    const p = bestObj;
    p.flee = 6;
    p.fleeX = p.x - ctx.x;
    p.fleeZ = p.z - ctx.z;
    // Shotgun knockback: the pattern shoves them noticeably further than a pistol round.
    if (def.knock > 1) {
      p.x += ((p.x - ctx.x) / (bestD || 1)) * def.knock;
      p.z += ((p.z - ctx.z) / (bestD || 1)) * def.knock;
    }
    if (ctx.onCrime) ctx.onCrime(2, 'hitPed', 'You shot a pedestrian! The cops are coming.');
  } else {
    const car = bestObj;
    car.pause = 3;
    damageCar(car, def.carDmg * Math.max(1, Math.round(hits * 0.5)));
    if (ctx.onCarHit) ctx.onCarHit(car);
    if (ctx.onCrime) ctx.onCrime(1, 'hitCar', 'You shot a car!');
  }
  return 'fired';
}

/** A punch at whatever is closest in front of Rio. No gore: they stumble away. */
export function punch(c, ctx) {
  if (c.punchCooldown > 0) return 'busy';
  c.punchCooldown = 0.4;
  const fx = Math.sin(ctx.heading);
  const fz = Math.cos(ctx.heading);
  let best = null;
  let bestD = Infinity;
  const consider = (obj, kind) => {
    const dx = obj.x - ctx.x;
    const dz = obj.z - ctx.z;
    const d = Math.hypot(dx, dz);
    if (d > PUNCH_RANGE || d >= bestD) return;
    if (angleTo(fx, fz, dx, dz) > 1.1) return;
    best = { obj, d, kind };
    bestD = d;
  };
  for (const h of c.hostiles) if (!h.down) consider(h, 'hostile');
  if (!best) for (const p of ctx.peds || []) consider(p, 'ped');
  if (!best) return 'miss';
  if (best.kind === 'hostile') {
    const h = best.obj;
    h.hp -= 1;
    h.x += ((h.x - ctx.x) / (bestD || 1)) * 1.5;
    h.z += ((h.z - ctx.z) / (bestD || 1)) * 1.5;
    if (h.hp <= 0) {
      h.down = true;
      h.mesh.rotation.z = 1.5;
      c.kills += 1;
      if (ctx.onHostileDown) ctx.onHostileDown();
    }
  } else {
    const p = best.obj;
    p.flee = 5;
    p.fleeX = p.x - ctx.x;
    p.fleeZ = p.z - ctx.z;
  }
  return 'hit';
}

/** Give the crate's contents to Rio. Returns false when the crate should stay put
 *  (a wrench with nothing nearby to fix). */
function takeCrate(c, k, ctx) {
  if (k.kind === 'wrench') {
    const car = nearestCar(ctx.cars && ctx.cars.length ? ctx.cars : allCars(), ctx.x, ctx.z, 55);
    if (!car || car.damage <= 0) return false;
    repairCar(car);
    if (ctx.onMsg) ctx.onMsg('Wrench: the car is patched up.');
    return true;
  }
  const def = WEAPONS[k.kind];
  if (!def) return false;
  c.weapons[k.kind].reserve += def.crate;
  sync(c);
  switchWeapon(c, k.kind);
  if (ctx.onMsg) ctx.onMsg(`${def.name} crate: +${def.crate} rounds. Switched to the ${def.name}.`);
  return true;
}

export function updateCombat(c, ctx, dt) {
  // Cars smoke/burn on their own clock: one call covers every car in the world, so main.js
  // needs no extra hook just for the damage FX.
  tickCarFx(dt);
  if (c.cooldown > 0) c.cooldown -= dt;
  if (c.punchCooldown > 0) c.punchCooldown -= dt;
  if (c.reloading > 0) {
    c.reloading -= dt;
    if (c.reloading <= 0) {
      const def = WEAPONS[c.weapon] || WEAPONS.pistol;
      const slot = c.weapons[def.id];
      const need = def.magSize - slot.mag;
      const take = Math.min(need, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
      sync(c);
    }
  }
  if (c.tracers.t > 0) {
    c.tracers.t -= dt;
    if (c.tracers.t <= 0) {
      c.tracers.mesh.visible = false;
      c.tracers.geo.setDrawRange(0, 0);
    }
  }
  if (c.flashT > 0) {
    c.flashT -= dt;
    if (c.flashT <= 0) c.flash.visible = false;
  }
  if (c.driveByGunT > 0) {
    c.driveByGunT -= dt;
    if (c.driveByGunT <= 0) c.driveByGun.visible = false;
  }
  for (const p of c.pickups) {
    p.mesh.rotation.y += dt * 1.5;
    if (!p.active) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.active = true;
        p.mesh.visible = true;
      }
      continue;
    }
    const d = Math.hypot(ctx.x - p.x, ctx.z - p.z);
    if (d < 2.2) {
      p.active = false;
      p.respawn = AMMO.pickupRespawn;
      p.mesh.visible = false;
      // The green crate is the pistol's old +12; owned other guns get a share too.
      c.weapons.pistol.reserve += AMMO.pickupAmount;
      if (c.weapons.smg.reserve > 0) c.weapons.smg.reserve += 30;
      if (c.weapons.shotgun.reserve > 0) c.weapons.shotgun.reserve += 6;
      sync(c);
      if (ctx.onPickup) ctx.onPickup();
    }
  }
  for (const k of c.crates) {
    if (!k.active) {
      k.respawn -= dt;
      if (k.respawn <= 0) {
        k.active = true;
        k.mesh.visible = true;
      }
      continue;
    }
    k.mesh.rotation.y += dt * 1.5;
    if (Math.hypot(ctx.x - k.x, ctx.z - k.z) < 2.4 && takeCrate(c, k, ctx)) {
      k.active = false;
      k.respawn = CRATE_RESPAWN;
      k.mesh.visible = false;
      if (ctx.onCrate) ctx.onCrate(k.kind);
    }
  }
  // Rivals walk at Rio and swing when they reach him.
  for (const h of c.hostiles) {
    if (h.down) continue;
    const dx = ctx.x - h.x;
    const dz = ctx.z - h.z;
    const d = Math.hypot(dx, dz) || 1;
    h.heading = Math.atan2(dx, dz);
    if (d > 1.6) {
      h.x += (dx / d) * 3.4 * dt;
      h.z += (dz / d) * 3.4 * dt;
    } else if (ctx.time - h.hitAt > 1) {
      h.hitAt = ctx.time;
      if (ctx.onPlayerHit) ctx.onPlayerHit(10);
    }
    h.phase += dt * 5;
    const swing = Math.sin(h.phase) * 0.5;
    const u = h.mesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
    h.mesh.position.set(h.x, 0, h.z);
    h.mesh.rotation.y = h.heading;
  }
}



