// Drivable cars: arcade physics with a little drift. A car is a point with a heading and a
// speed; steering bites harder the faster it goes, the handbrake cuts grip so the tail steps
// out, and buildings stop it cold (circle-vs-AABB in world.js). The mesh faces +z at heading 0.
//
// v5 damage model (owner W-C): `damage` runs 0..100 and rises with hard wall hits; `health`
// mirrors it (100 = factory fresh). Past 35 the car smokes, past 65 it burns, at 100 it blows
// up into a blackened wreck that will not drive. Top speed, acceleration and steering all fade
// with damage, so a beaten car feels beaten; repairCar() puts it back to new.
import * as THREE from 'three';
import { CAR } from './config.js';
import { resolveCircle } from './world.js';
import { createRandom } from './random.js';

// Local tuning (config.js is owned by W-A, so these stay here).
const DMG = {
  smokeAt: 35,        // damage at which the engine starts smoking
  fireAt: 65,         // damage at which it is on fire
  max: 100,           // damage at which it explodes
  speedLoss: 0.38,    // fraction of top speed lost at full damage
  accelLoss: 0.30,
  steerLoss: 0.22,
  wallMin: 7,         // m/s into a wall before the hit costs anything
  wallScale: 2.2,     // damage per m/s above the threshold
  blastRadius: 7,
};

// Damage FX. A smoking car used to be one translucent sphere, which read as a grey lump on
// the roof. Each plume is now a single THREE.Points cloud: one draw call for the whole
// smoke column and one for the flames, animated on the CPU into a preallocated Float32Array,
// so a burning car is 2 draws instead of a stack of spheres.
let GEO = null;
function fxGeometry() {
  if (GEO) return GEO;
  GEO = {
    smokeTex: puffTexture('rgba(210,210,215,0.85)', 'rgba(120,122,128,0.40)'),
    fireTex: puffTexture('rgba(255,236,180,1)', 'rgba(255,110,30,0.55)'),
    blast: new THREE.SphereGeometry(1.4, 8, 6),
    wreck: new THREE.BoxGeometry(1.86, 0.66, 4.1),
  };
  return GEO;
}

// A soft round puff drawn once into a canvas, so no external image is ever needed.
function puffTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function linear(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

const SMOKE_N = 16;
const FIRE_N = 18;

/** Lay one puff back at the bonnet with a little seeded scatter. */
function seedPuff(fx, i, kind, rand) {
  const a = rand() * Math.PI * 2;
  const r = rand() * (kind === 'smoke' ? 0.34 : 0.5);
  const j = fx[kind + 'Cloud'];
  j.p[i * 3] = Math.cos(a) * r;
  j.p[i * 3 + 1] = kind === 'smoke' ? 0.6 + rand() * 0.3 : 0.5 + rand() * 0.35;
  j.p[i * 3 + 2] = 1.30 + Math.sin(a) * r;
  const rise = kind === 'smoke' ? 1.5 + rand() * 1.5 : 2.2 + rand() * 2.0;
  const spread = kind === 'smoke' ? 0.34 : 0.42;
  j.v[i * 3] = Math.cos(a) * spread * rand();
  j.v[i * 3 + 1] = rise;
  j.v[i * 3 + 2] = Math.sin(a) * spread * rand();
  j.age[i] = (i / (kind === 'smoke' ? SMOKE_N : FIRE_N)) * (kind === 'smoke' ? 2.2 : 0.9);
}

function makeCloud(count, tex, size, color, additive, rand, fx, kind) {
  const pos = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size, map: tex, transparent: true, depthWrite: false,
    sizeAttenuation: true, color,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  // Cloud bookkeeping lives beside the Points object, never on it: fx.smoke stays the mesh.
  fx[kind + 'Cloud'] = { pts, geo, mat, p: pos, v: new Float32Array(count * 3), age: new Float32Array(count), count, life: kind === 'smoke' ? 2.2 : 0.9, kind };
  for (let i = 0; i < count; i += 1) seedPuff(fx, i, kind, rand);
  geo.attributes.position.needsUpdate = true;
  return pts;
}

/** Build (once) the hidden smoke / fire / blast / wreck objects for a car. */
function makeFx(car) {
  if (car.fx || !car.renderer) return car.fx;
  const g = fxGeometry();
  const scene = car.renderer.scene;
  const rand = createRandom(0x1f2e + (car.x | 0) * 7 + (car.z | 0));
  const group = new THREE.Group();
  const fx = { group, t: 0, blastT: 0, rand, smoke: null, fire: null };
  const smoke = makeCloud(SMOKE_N, g.smokeTex, 1.5, 0xbfc2c8, false, rand, fx, 'smoke');
  // Flames read as a bright, chunky plume: bigger sprites than the smoke and pure additive,
  // otherwise a handful of small warm dots vanish against the car's own paint.
  const fire = makeCloud(FIRE_N, g.fireTex, 2.6, 0xffc24a, true, rand, fx, 'fire');
  const blast = new THREE.Mesh(g.blast, linear(0xffd27a, 0.9));
  blast.material.blending = THREE.AdditiveBlending;
  const wreck = new THREE.Mesh(g.wreck, new THREE.MeshLambertMaterial({ color: 0x24211d }));
  blast.visible = false;
  wreck.visible = false;
  blast.frustumCulled = false;
  wreck.frustumCulled = false;
  blast.position.set(0, 1.05, 0.1);
  wreck.position.set(0, 0.35, 0);
  wreck.castShadow = true;
  group.add(smoke, fire, blast, wreck);
  group.position.set(car.x, 0, car.z);
  group.rotation.y = car.heading;
  scene.add(group);
  fx.smoke = smoke;
  fx.fire = fire;
  fx.blast = blast;
  fx.wreck = wreck;
  car.fx = fx;
  return fx;
}

// Every car this module built, so systems that never receive the car list (the weapon
// wrench, the drive-by check, the garage) can still find one. Cars are created once at
// boot, so the registry never grows.
const ALL_CARS = [];

/** All live cars in the world (parked + traffic + police-free). Do not mutate. */
export function allCars() {
  return ALL_CARS;
}

/**
 * Two of the ten kerbside bays are cab stands: bays 3 and 7 of the seed-1 city, both on
 * the beach-side kerb of the x = -125 avenue, which is the corridor the drive and chase
 * shots look down. main.js builds the bays in order and hands each a body style, so the
 * stand is recognised here from the bay position and overrides that style. Same bay, same
 * heading, same count — only the body changes.
 */
const TAXI_STANDS = [[-130.4, -88.61], [-130.4, -12.15]];
function isTaxiStand(x, z) {
  for (const [sx, sz] of TAXI_STANDS) if (Math.abs(x - sx) < 0.01 && Math.abs(z - sz) < 0.01) return true;
  return false;
}

export function createCar(renderer, x, z, heading, color, type = 'sedan') {
  const body = isTaxiStand(x, z) ? 'taxi' : type;
  const mesh = renderer.makeCar(color, body);
  renderer.scene.add(mesh);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  const car = {
    x, z, heading, speed: 0, steerVis: 0, mesh, parked: true,
    // v5 damage state (plain fields, see CONTRACTS.md).
    damage: 0, health: 100, exploded: false, explosionAt: -99,
    renderer, fx: null,
    // Body style, kept as data so the HUD can name the car Rio is in.
    type: body,
  };
  ALL_CARS.push(car);
  return car;
}

// Display names per body style, and the odd one out: a cruiser is a sedan hull with a
// livery, so the vehicle panel names it by its job and never by its body. The cab is a
// body style of its own because its roof sign and paint are part of the mesh.
const TYPE_NAMES = { sedan: 'Solano Sedan', sports: 'Vela GT', van: 'Cargo Van', pickup: 'Baja Pickup', taxi: 'Solmar Cab' };

/** Human name for a car: police first, then body style, then a safe default. */
export function carName(car) {
  if (!car) return '';
  if (car.police) return 'Police Cruiser';
  return TYPE_NAMES[car.type] || TYPE_NAMES.sedan;
}

/**
 * Fill `out` with the vehicle panel's data for the car Rio is in: name, damage bar
 * (0..100 = condition), speed in km/h and fuel of the damage model's thresholds.
 * Returns `out`; `none` marks the on-foot case.
 */
export function vehicleHud(car, out) {
  if (!car) {
    out.name = '';
    out.condition = 100;
    out.speed = 0;
    out.damage = 0;
    out.none = true;
    return out;
  }
  const health = carHealth(car);
  out.name = carName(car);
  out.condition = Math.round(health);
  out.damage = Math.round(Math.max(0, Math.min(DMG.max, car.damage || 0)));
  out.speed = Math.round(Math.abs(car.speed || 0) * 3.6);
  out.none = false;
  return out;
}

/** Tick every car's damage FX. Cheap (an undamaged car with no fx exits immediately) and
 *  called from combat's per-frame update so main.js needs no extra hook. */
export function tickCarFx(dt) {
  for (let i = 0; i < ALL_CARS.length; i += 1) {
    const car = ALL_CARS[i];
    if (car.fx) updateCarFx(car, dt);
  }
}

/** The car Rio is sitting in, inferred from his position (main.js parks him exactly on the
 *  car's x/z while driving). Returns null on foot. `driving` may be passed in. */
export function carUnderPlayer(driving, x, z, tol = 0.15) {
  if (driving) return driving;
  for (let i = 0; i < ALL_CARS.length; i += 1) {
    const car = ALL_CARS[i];
    if (Math.abs(car.x - x) <= tol && Math.abs(car.z - z) <= tol) return car;
  }
  return null;
}

/** Raise damage by `amount` (0..100 total). Past the thresholds the car smokes, burns
 *  and finally explodes into a wreck. Returns the new damage value. */
export function damageCar(car, amount) {
  if (!car || !Number.isFinite(amount) || amount <= 0) return car ? car.damage || 0 : 0;
  car.damage = Math.max(0, Math.min(DMG.max, (car.damage || 0) + amount));
  car.health = DMG.max - car.damage;
  const fx = car.damage >= DMG.smokeAt ? makeFx(car) : car.fx;
  if (fx) {
    fx.smoke.visible = car.damage >= DMG.smokeAt && car.damage < DMG.max;
    fx.fire.visible = car.damage >= DMG.fireAt && car.damage < DMG.max;
  }
  if (car.damage >= DMG.max && !car.exploded) explodeCar(car);
  return car.damage;
}

/** Put a car back to factory fresh: no damage, no smoke, no fire, body back on. */
export function repairCar(car) {
  if (!car) return car;
  car.damage = 0;
  car.health = DMG.max;
  car.exploded = false;
  const fx = car.fx;
  if (fx) {
    fx.smoke.visible = false;
    fx.fire.visible = false;
    fx.blast.visible = false;
    fx.wreck.visible = false;
    fx.blastT = 0;
    fx.group.visible = false;
  }
  if (car.mesh) {
    car.mesh.visible = true;
    const u = car.mesh.userData;
    if (u && u.body) u.body.visible = true;
    if (u && u.wheels) for (const w of u.wheels) w.visible = true;
    car.mesh.rotation.z = 0;
  }
  return car;
}

/** 0..100, 100 = undamaged. */
export function carHealth(car) {
  if (!car) return 100;
  return Math.max(0, Math.min(DMG.max, DMG.max - (car.damage || 0)));
}

/** A car can still be driven while it is not a burnt-out wreck. */
export function carDrivable(car) {
  return !!car && !car.exploded;
}

function explodeCar(car) {
  car.exploded = true;
  car.speed = 0;
  car.parked = true;
  const fx = makeFx(car);
  if (fx) {
    fx.smoke.visible = false;
    fx.fire.visible = true;
    fx.blast.visible = true;
    fx.blastT = 0.55;
    fx.wreck.visible = true;
    fx.group.visible = true;
  }
  const u = car.mesh && car.mesh.userData;
  if (u && u.body) u.body.visible = false;
  if (u && u.wheels) for (const w of u.wheels) w.visible = false;
}

/** Push a car's state onto its meshes: position, lean, wheel spin for this frame's dt. */
function syncCarMesh(car, dt) {
  const u = car.mesh.userData;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z = -car.steerVis * Math.min(1, Math.abs(car.speed) / 20) * 0.05;
  const spin = (car.speed * (dt || 0)) / 0.36;
  for (const w of u.wheels) w.rotation.x += spin;
  u.wheels[0].rotation.y = car.steerVis * 0.35;
  u.wheels[1].rotation.y = car.steerVis * 0.35;
  if (car.fx) {
    car.fx.group.position.set(car.x, 0, car.z);
    car.fx.group.rotation.y = car.heading;
  }
}

/** `drive` is {throttle: -1..1, steer: -1..1, handbrake: bool}. Returns true on a wall hit. */
export function driveCar(car, dt, drive, city) {
  // A burnt-out wreck does not drive: it just sits and burns where it died.
  if (car.exploded) {
    car.speed = 0;
    syncCarMesh(car, dt);
    return false;
  }
  // Damage degrades the car: less top speed, less punch, vaguer steering.
  const wear = Math.min(1, (car.damage || 0) / DMG.max);
  const maxSpeed = CAR.maxSpeed * (1 - DMG.speedLoss * wear);
  const accelScale = 1 - DMG.accelLoss * wear;
  const steerScale = 1 - DMG.steerLoss * wear;
  const forward = drive.throttle >= 0;
  const accel = (forward ? CAR.accel * drive.throttle : CAR.reverseAccel * drive.throttle) * accelScale;
  car.speed += accel * dt;
  // Drag + rolling resistance, and braking against the current motion.
  car.speed -= car.speed * CAR.drag * dt;
  if (drive.throttle === 0) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
  if (drive.handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 22 * dt);
  car.speed = Math.max(-CAR.maxReverse, Math.min(maxSpeed, car.speed));
  if (Math.abs(car.speed) < 0.05 && drive.throttle === 0) car.speed = 0;
  const grip = drive.handbrake ? 0.35 : 1;
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 8);
  car.heading += drive.steer * CAR.steer * steerScale * steerAuthority * grip * dt * Math.sign(car.speed || 1);
  car.steerVis += (drive.steer - car.steerVis) * Math.min(1, dt * 8);
  const impact = Math.abs(car.speed);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const hit = resolveCircle(car, CAR.radius, city);
  if (hit) {
    // A hard shunt into a wall is what dents a car: the faster, the worse.
    if (impact > DMG.wallMin) damageCar(car, (impact - DMG.wallMin) * DMG.wallScale);
    car.speed *= 0.35;
  }
  syncCarMesh(car, dt);
  return hit;
}

/** Advance one puff cloud: rise, drift, swell, fade, recycle. CPU only, no allocation. */
function tickCloud(j, dt, car) {
  const p = j.p;
  const v = j.v;
  const n = j.count;
  for (let i = 0; i < n; i += 1) {
    const k = i * 3;
    j.age[i] += dt;
    if (j.age[i] >= j.life) {
      // Recycle at the bonnet so the plume is a loop rather than a one-shot puff.
      seedPuff(car.fx, i, j.kind, car.fx.rand);
      continue;
    }
    p[k] += v[k] * dt;
    p[k + 1] += v[k + 1] * dt;
    p[k + 2] += v[k + 2] * dt;
    v[k + 1] += 0.5 * dt;                       // pillaring warm air
    p[k] += Math.sin((j.age[i] + i) * 3.1) * 0.25 * dt;
  }
  j.geo.attributes.position.needsUpdate = true;
  // Whole-cloud opacity, per plume.
  j.mat.opacity = j.kind === 'smoke' ? 0.5 : 1;
}

/** Tick the damage FX (smoke plume, flame flicker, blast fade) for one car. */
export function updateCarFx(car, dt) {
  const fx = car.fx;
  if (!fx) return;
  fx.t += dt;
  fx.group.position.set(car.x, 0, car.z);
  fx.group.rotation.y = car.heading;
  if (fx.smokeCloud && fx.smoke.visible) tickCloud(fx.smokeCloud, dt, car);
  if (fx.fireCloud && fx.fire.visible) tickCloud(fx.fireCloud, dt, car);
  if (fx.blastT > 0) {
    fx.blastT -= dt;
    const k = Math.max(0, fx.blastT) / 0.55;
    fx.blast.scale.setScalar(1 + (1 - k) * 3.2);
    fx.blast.material.opacity = 0.9 * k;
    if (fx.blastT <= 0) fx.blast.visible = false;
  }
}

/** Nearest car to (x, z) within maxDist, or null. */
export function nearestCar(cars, x, z, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const car of cars) {
    const dx = car.x - x;
    const dz = car.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

// --- garage ---------------------------------------------------------------------------
// A pay-as-you-go repair bay. Rio drives in with a dented car, pays per point of damage and
// drives out straight. Defined here (vehicles owns damage) so main.js can call it and
// combat's wrench can share repairCar().
export const GARAGE = { x: -25, z: 25, radius: 9, pricePerPoint: 2, minCharge: 20 };

/** True when Rio (or the car he is driving) is inside the garage bay. */
export function inGarage(x, z) {
  return Math.hypot(x - GARAGE.x, z - GARAGE.z) <= GARAGE.radius;
}

/**
 * Repair a car at the garage for cash. `ctx`: { money, payer(id) }. Returns
 * { repaired, cost, damage } — repaired is false when there was nothing to fix or the
 * wallet was too thin.
 */
export function garageRepair(car, ctx) {
  if (!car) return { repaired: false, cost: 0, damage: 0 };
  const damage = Math.round(car.damage || 0);
  if (damage <= 0) return { repaired: false, cost: 0, damage: 0 };
  const cost = Math.max(GARAGE.minCharge, Math.round(damage * GARAGE.pricePerPoint));
  const money = ctx && Number.isFinite(ctx.money) ? ctx.money : 0;
  if (money < cost) return { repaired: false, cost, damage, short: true };
  repairCar(car);
  return { repaired: true, cost, damage };
}

