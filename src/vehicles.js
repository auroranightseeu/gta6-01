// Drivable cars: arcade physics with a little drift. A car is a point with a heading and a
// speed; steering bites harder the faster it goes, the handbrake cuts grip so the tail steps
// out, and buildings stop it cold (circle-vs-AABB in world.js). The mesh faces +z at heading 0.
import { CAR } from './config.js';
import { resolveCircle } from './world.js';

export function createCar(renderer, x, z, heading, color) {
  const mesh = renderer.makeCar(color);
  renderer.scene.add(mesh);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return { x, z, heading, speed: 0, steerVis: 0, mesh, parked: true };
}

/** `drive` is {throttle: -1..1, steer: -1..1, handbrake: bool}. Returns true on a wall hit. */
export function driveCar(car, dt, drive, city) {
  const forward = drive.throttle >= 0;
  const accel = forward ? CAR.accel * drive.throttle : CAR.reverseAccel * drive.throttle;
  car.speed += accel * dt;
  // Drag + rolling resistance, and braking against the current motion.
  car.speed -= car.speed * CAR.drag * dt;
  if (drive.throttle === 0) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
  if (drive.handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 22 * dt);
  car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));
  if (Math.abs(car.speed) < 0.05 && drive.throttle === 0) car.speed = 0;
  const grip = drive.handbrake ? 0.35 : 1;
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 8);
  car.heading += drive.steer * CAR.steer * steerAuthority * grip * dt * Math.sign(car.speed || 1);
  car.steerVis += (drive.steer - car.steerVis) * Math.min(1, dt * 8);
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  car.x = nx;
  car.z = nz;
  const hit = resolveCircle(car, CAR.radius, city);
  if (hit) car.speed *= 0.35;
  const u = car.mesh.userData;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z = -car.steerVis * Math.min(1, Math.abs(car.speed) / 20) * 0.05;
  const spin = (car.speed * dt) / 0.36;
  for (const w of u.wheels) w.rotation.x += spin;
  u.wheels[0].rotation.y = car.steerVis * 0.35;
  u.wheels[1].rotation.y = car.steerVis * 0.35;
  return hit;
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
