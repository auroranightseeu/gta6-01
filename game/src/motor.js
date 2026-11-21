// Motorbikes: Rio's ride and the bikes in traffic. Same arcade model as a car — a point
// with a heading and a speed — but lighter and quicker, and it leans into a corner instead
// of rolling. The mesh faces +z at heading 0, like every car, so the chase camera and the
// drive-by code work unchanged.
//
// The bike is one merged body mesh (frame, tank, seat, fork, bars, lamps and a seated
// rider) plus two spinning wheels: 3 draws per bike, and the lamp glow is baked into the
// body's vertex colours rather than lit, so a bike costs no extra light.
import * as THREE from 'three';
import { resolveCircle } from './world.js';

// Local tuning: config.js belongs to W-A, so the bike's numbers live here.
const MOTO = {
  accel: 26,        // m/s^2: nearly twice a sedan, so a bike pulls away from traffic
  maxSpeed: 36,     // m/s (~130 km/h): the fastest thing Rio can drive
  reverse: 8,
  maxReverse: 6,
  steer: 2.5,       // rad/s at full lock: tighter than CAR.steer (1.9)
  drag: 0.30,
  radius: 0.95,     // circle radius for the wall test (a car is 1.7)
  lean: 0.55,       // max roll, ~31 deg: reads as a lean, never as a fall
  wheelR: 0.33,
};

const BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const DARK = 0x1b1d22;
const CHROME = 0xb9bcc4;

/** Translation + rotation matrix for one merged part. */
function at(x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  return m;
}

/** Concatenate geometries into one, baking a flat colour per part into vertex colours. */
function merge(parts) {
  const prepared = [];
  let total = 0;
  for (const part of parts) {
    const src = part.geo;
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (part.m) g.applyMatrix4(part.m);
    const n = g.attributes.position.count;
    total += n;
    prepared.push({ g, n, color: part.color === undefined ? 0xffffff : part.color });
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const { g, n, color } of prepared) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    const r = ((color >> 16) & 255) / 255;
    const gg = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let i = 0; i < n; i += 1) {
      col[(o + i) * 3] = r;
      col[(o + i) * 3 + 1] = gg;
      col[(o + i) * 3 + 2] = b;
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// One wheel geometry for every bike: tyre, a rim ring and four spokes, all baked in.
let WHEEL = null;
function wheelGeometry() {
  if (WHEEL) return WHEEL;
  const r = MOTO.wheelR;
  const tyre = new THREE.CylinderGeometry(r, r, 0.15, 14);
  tyre.rotateZ(Math.PI / 2);
  const rim = new THREE.TorusGeometry(r * 0.72, 0.028, 5, 14);
  rim.rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.17, 10);
  hub.rotateZ(Math.PI / 2);
  const parts = [{ geo: tyre, color: 0x14161a }, { geo: rim, color: CHROME }, { geo: hub, color: 0xd8d2c4 }];
  for (let i = 0; i < 4; i += 1) {
    const spoke = new THREE.BoxGeometry(0.055, r * 1.34, 0.045);
    spoke.rotateX((i * Math.PI) / 4);
    parts.push({ geo: spoke, color: 0x8d939c });
  }
  WHEEL = merge(parts);
  return WHEEL;
}

/** The bike itself: frame, tank, seat, fork, bars, mudguards, pipe and lamps, in `paint`. */
function bikeBody(paint) {
  const parts = [
    // Chassis: a spine, the engine block, the tank, the seat and the tail cowl.
    { geo: new THREE.BoxGeometry(0.16, 0.32, 1.24), m: at(0, 0.62, -0.02), color: paint },
    { geo: new THREE.BoxGeometry(0.30, 0.34, 0.44), m: at(0, 0.50, 0.02), color: DARK },
    { geo: new THREE.BoxGeometry(0.34, 0.30, 0.56), m: at(0, 0.90, 0.22), color: paint },
    { geo: new THREE.BoxGeometry(0.36, 0.13, 0.60), m: at(0, 0.84, -0.40), color: DARK },
    { geo: new THREE.BoxGeometry(0.30, 0.20, 0.34), m: at(0, 0.94, -0.72), color: paint },
    // Fork legs, bars, mudguards and the pipe: the bits that make the front read as a bike.
    { geo: new THREE.BoxGeometry(0.07, 0.64, 0.07), m: at(-0.10, 0.62, 0.60, -0.22), color: CHROME },
    { geo: new THREE.BoxGeometry(0.07, 0.64, 0.07), m: at(0.10, 0.62, 0.60, -0.22), color: CHROME },
    { geo: new THREE.BoxGeometry(0.66, 0.06, 0.06), m: at(0, 1.02, 0.50), color: DARK },
    { geo: new THREE.BoxGeometry(0.16, 0.05, 0.42), m: at(0, 0.74, 0.72), color: paint },
    { geo: new THREE.BoxGeometry(0.18, 0.05, 0.36), m: at(0, 0.66, -0.80), color: paint },
    { geo: new THREE.CylinderGeometry(0.055, 0.055, 0.70, 8), m: at(0.17, 0.42, -0.36, Math.PI / 2), color: CHROME },
    // Lamps: a bright block at the front and a red one at the tail, baked in like a car's.
    { geo: new THREE.BoxGeometry(0.20, 0.17, 0.12), m: at(0, 0.96, 0.66), color: 0xfff0c8 },
    { geo: new THREE.BoxGeometry(0.16, 0.08, 0.05), m: at(0, 0.86, -0.90), color: 0xe8483a },
  ];
  return merge(parts);
}

/**
 * The rider, as its own mesh so it can sit on the bike while Rio rides and step off with
 * him: hips, thighs, shins, a forward-leaning torso, arms to the bars, helmet and visor.
 */
function riderBody(jacket, helmet) {
  const parts = [
    { geo: new THREE.BoxGeometry(0.40, 0.20, 0.34), m: at(0, 0.94, -0.40), color: DARK },
    { geo: new THREE.BoxGeometry(0.15, 0.16, 0.44), m: at(-0.20, 0.86, 0.02), color: DARK },
    { geo: new THREE.BoxGeometry(0.15, 0.16, 0.44), m: at(0.20, 0.86, 0.02), color: DARK },
    { geo: new THREE.BoxGeometry(0.13, 0.40, 0.14), m: at(-0.22, 0.56, 0.16, 0.25), color: DARK },
    { geo: new THREE.BoxGeometry(0.13, 0.40, 0.14), m: at(0.22, 0.56, 0.16, 0.25), color: DARK },
    { geo: new THREE.BoxGeometry(0.42, 0.50, 0.26), m: at(0, 1.26, -0.26, 0.30), color: jacket },
    { geo: new THREE.BoxGeometry(0.46, 0.12, 0.24), m: at(0, 1.48, -0.16, 0.30), color: jacket },
    { geo: new THREE.BoxGeometry(0.12, 0.48, 0.12), m: at(-0.24, 1.32, 0.10, 1.0), color: jacket },
    { geo: new THREE.BoxGeometry(0.12, 0.48, 0.12), m: at(0.24, 1.32, 0.10, 1.0), color: jacket },
    { geo: new THREE.IcosahedronGeometry(0.19, 1), m: at(0, 1.64, -0.06), color: helmet },
    { geo: new THREE.BoxGeometry(0.26, 0.10, 0.07), m: at(0, 1.62, 0.12), color: DARK },
  ];
  return merge(parts);
}

/**
 * Build a bike at (x, z) facing `heading`. `paint` is the body colour, `opts.jacket` the
 * rider's jacket and `opts.helmet` the helmet. The rider is a separate mesh, shown only
 * while the bike is ridden (`parked` false), so a bike Rio stepped off is an empty bike
 * rather than a statue sitting on it.
 */
export function createMotor(renderer, x, z, heading, paint = 0xc0392b, opts = {}) {
  const jacket = opts.jacket === undefined ? 0x2c3e50 : opts.jacket;
  const helmet = opts.helmet === undefined ? 0x1c1f24 : opts.helmet;
  const group = new THREE.Group();
  const body = new THREE.Mesh(bikeBody(paint), BODY_MAT);
  body.castShadow = true;
  const rider = new THREE.Mesh(riderBody(jacket, helmet), BODY_MAT);
  rider.castShadow = true;
  const wheels = [];
  const geo = wheelGeometry();
  for (const wz of [0.68, -0.68]) {
    const w = new THREE.Mesh(geo, BODY_MAT);
    w.position.set(0, MOTO.wheelR, wz);
    w.castShadow = true;
    wheels.push(w);
    group.add(w);
  }
  group.add(body, rider);
  group.userData = { body, rider, wheels };
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  renderer.scene.add(group);
  return {
    x, z, heading, speed: 0, steerVis: 0, lean: 0, mesh: group, renderer,
    // Home spot: resetGame puts every bike back here, so a new game and the staged
    // screenshots always start from the same place.
    homeX: x, homeZ: z, homeHeading: heading,
    // Same field names a car carries, so the HUD panel, the damage vignette and the
    // drive-by code read a bike without a single special case.
    type: 'motor', motor: true, parked: true, damage: 0, health: 100,
  };
}

/** Push a bike's state onto its mesh: position, heading, lean, rider and wheel spin. */
export function syncMotor(m, dt) {
  m.mesh.position.set(m.x, 0, m.z);
  // Euler order XYZ applies z first, i.e. the roll is taken about the bike's own forward
  // axis, then the heading — which is exactly a lean into the corner.
  m.mesh.rotation.set(0, m.heading, m.lean);
  const u = m.mesh.userData;
  u.rider.visible = !m.parked;
  const spin = (m.speed * (dt || 0)) / MOTO.wheelR;
  for (const w of u.wheels) w.rotation.x += spin;
}

/**
 * `drive` is {throttle: -1..1, steer: -1..1, handbrake: bool}, the same object a car takes.
 * Steering bites almost immediately (a bike turns at walking pace), and the roll is capped
 * at MOTO.lean, so a normal corner leans the bike and never puts it on the tarmac.
 * Returns true on a wall hit.
 */
export function driveMotor(m, dt, drive, city) {
  const forward = drive.throttle >= 0;
  m.speed += (forward ? MOTO.accel * drive.throttle : MOTO.reverse * drive.throttle) * dt;
  m.speed -= m.speed * MOTO.drag * dt;
  if (drive.throttle === 0) m.speed -= Math.sign(m.speed) * Math.min(Math.abs(m.speed), 7 * dt);
  if (drive.handbrake) m.speed -= Math.sign(m.speed) * Math.min(Math.abs(m.speed), 20 * dt);
  m.speed = Math.max(-MOTO.maxReverse, Math.min(MOTO.maxSpeed, m.speed));
  if (Math.abs(m.speed) < 0.05 && drive.throttle === 0) m.speed = 0;
  const grip = drive.handbrake ? 0.55 : 1;
  const authority = Math.min(1, Math.abs(m.speed) / 5);
  m.heading += drive.steer * MOTO.steer * authority * grip * dt * Math.sign(m.speed || 1);
  m.steerVis += (drive.steer - m.steerVis) * Math.min(1, dt * 9);
  const target = -m.steerVis * Math.min(1, Math.abs(m.speed) / 12) * MOTO.lean;
  m.lean += (target - m.lean) * Math.min(1, dt * 7);
  m.x += Math.sin(m.heading) * m.speed * dt;
  m.z += Math.cos(m.heading) * m.speed * dt;
  const hit = resolveCircle(m, MOTO.radius, city);
  if (hit) m.speed *= 0.25;
  syncMotor(m, dt);
  return hit;
}

/** Nearest bike to (x, z) within maxDist, or null. */
export function nearestMotor(bikes, x, z, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const m of bikes) {
    const dx = m.x - x;
    const dz = m.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}
