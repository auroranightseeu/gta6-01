// Rio Vega on foot: third-person walk/run, camera-relative steering, building collision,
// a simple leg-and-arm swing so the figure reads as walking. The mesh faces +z at heading 0.
import { PLAYER } from './config.js';
import { resolveCircle } from './world.js';

export function createPlayer(renderer, x, z) {
  const mesh = renderer.makePerson(0x2e86c1);
  renderer.scene.add(mesh);
  return {
    x, z, heading: Math.PI, vx: 0, vz: 0, moving: false, phase: 0,
    mesh, invulnerable: 0,
  };
}

/**
 * `wish` is the wanted move in camera space: {f: -1..1 forward, s: -1..1 strafe right}.
 * `camYaw` is the camera orbit yaw (see render.placeCamera).
 */
export function updatePlayer(p, dt, wish, run, camYaw, city) {
  const speed = run ? PLAYER.run : PLAYER.walk;
  // Camera forward on the ground is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw)... 
  // forward = -offset direction, offset = (sin yaw, cos yaw).
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  let wx = fx * wish.f + rx * wish.s;
  let wz = fz * wish.f + rz * wish.s;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  p.vx += (wx * speed - p.vx) * Math.min(1, dt * 10);
  p.vz += (wz * speed - p.vz) * Math.min(1, dt * 10);
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (resolveCircle(p, PLAYER.radius, city)) {
    // A wall stop: kill the velocity component that pushed into it.
    p.vx *= 0.4;
    p.vz *= 0.4;
  }
  p.moving = Math.hypot(p.vx, p.vz) > 0.4;
  if (p.moving) {
    const target = Math.atan2(p.vx, p.vz);
    let d = target - p.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    p.heading += d * Math.min(1, dt * 12);
    p.phase += dt * Math.hypot(p.vx, p.vz) * 1.6;
  }
  if (p.invulnerable > 0) p.invulnerable -= dt;
  const swing = p.moving ? Math.sin(p.phase) * 0.55 : 0;
  const u = p.mesh.userData;
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing * 0.8;
  u.armR.rotation.x = swing * 0.8;
  p.mesh.position.set(p.x, 0, p.z);
  p.mesh.rotation.y = p.heading;
}
