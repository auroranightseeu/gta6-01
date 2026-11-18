// Combat: a punch and a pistol. The pistol is hitscan with a tracer line and a
// muzzle flash; the nearest person or car in front of Rio takes the hit. Ammo is a
// magazine plus a reserve (R reloads), topped up by green crates around town.
// Shooting a bystander or a car is a crime; rivals at the docks are fair game.
import * as THREE from 'three';
import { AMMO, PALETTE, PICKUP_SPOTS } from './config.js';

const RANGE = 30;
const PUNCH_RANGE = 2.6;

function angleTo(fx, fz, dx, dz) {
  const d = Math.hypot(dx, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / d)));
}

export function createCombat(renderer) {
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const tracer = new THREE.Line(
    tracerGeo,
    new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }),
  );
  tracer.visible = false;
  tracer.frustumCulled = false;
  renderer.scene.add(tracer);
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 }),
  );
  flash.visible = false;
  renderer.scene.add(flash);
  const pickups = PICKUP_SPOTS.map((s) => {
    const mesh = renderer.makePickup();
    mesh.position.set(s.x, 0, s.z);
    renderer.scene.add(mesh);
    return { x: s.x, z: s.z, mesh, active: true, respawn: 0 };
  });
  return {
    renderer, mag: AMMO.startMag, reserve: AMMO.startReserve,
    reloading: 0, cooldown: 0, punchCooldown: 0,
    tracer, tracerT: 0, flash, flashT: 0, pickups, hostiles: [],
  };
}

export function resetCombat(c) {
  c.mag = AMMO.startMag;
  c.reserve = AMMO.startReserve;
  c.reloading = 0;
  c.cooldown = 0;
  c.punchCooldown = 0;
  c.tracer.visible = false;
  c.flash.visible = false;
  for (const p of c.pickups) {
    p.active = true;
    p.respawn = 0;
    p.mesh.visible = true;
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
  if (c.reloading > 0 || c.reserve <= 0 || c.mag >= AMMO.magSize) return false;
  c.reloading = AMMO.reloadTime;
  return true;
}

function showShot(c, from, to) {
  const pos = c.tracer.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  c.tracer.visible = true;
  c.tracerT = 0.08;
  c.flash.position.set(from.x, from.y, from.z);
  c.flash.visible = true;
  c.flashT = 0.06;
}

/**
 * Fire one round. `ctx`: { x, z, heading, peds, trafficCars, sanctioned, time,
 * onCrime(n, key, msg), announce(msg), onHostileDown() }. Returns 'fired',
 * 'empty', 'reloading' or 'busy'.
 */
export function firePistol(c, ctx) {
  if (c.cooldown > 0 || c.reloading > 0) return 'busy';
  if (c.mag <= 0) {
    if (startReload(c)) return 'reloading';
    return 'empty';
  }
  c.mag -= 1;
  c.cooldown = AMMO.fireCooldown;
  const fx = Math.sin(ctx.heading);
  const fz = Math.cos(ctx.heading);
  const from = { x: ctx.x + fx * 1.2, y: 1.3, z: ctx.z + fz * 1.2 };
  // Nearest target inside a forward cone: rivals first, then bystanders, then cars.
  let best = null;
  let bestD = Infinity;
  const consider = (obj, maxD, maxAngle, kind) => {
    const dx = obj.x - ctx.x;
    const dz = obj.z - ctx.z;
    const d = Math.hypot(dx, dz);
    if (d > maxD || d >= bestD) return;
    if (angleTo(fx, fz, dx, dz) > maxAngle) return;
    best = { obj, d, kind };
    bestD = d;
  };
  for (const h of c.hostiles) if (!h.down) consider(h, RANGE, 0.6, 'hostile');
  if (!best) {
    for (const p of ctx.peds) if (!p.down) consider(p, RANGE, 0.6, 'ped');
    for (const car of ctx.trafficCars) consider(car, 25, 0.5, 'car');
  }
  const to = best
    ? { x: best.obj.x, y: 1.2, z: best.obj.z }
    : { x: from.x + fx * RANGE, y: 1.3, z: from.z + fz * RANGE };
  showShot(c, from, to);
  if (!ctx.sanctioned) ctx.onCrime(1, 'shoot', 'Gunfire! The cops heard that.');
  if (!best) return 'fired';
  if (best.kind === 'hostile') {
    const h = best.obj;
    h.hp -= 1;
    h.x += (h.x - ctx.x) / (bestD || 1) * 1.2;
    h.z += (h.z - ctx.z) / (bestD || 1) * 1.2;
    if (h.hp <= 0) {
      h.down = true;
      h.mesh.rotation.z = 1.5;
      ctx.onHostileDown();
    }
  } else if (best.kind === 'ped') {
    const p = best.obj;
    p.flee = 6;
    p.fleeX = p.x - ctx.x;
    p.fleeZ = p.z - ctx.z;
    ctx.onCrime(2, 'hitPed', 'You shot a pedestrian! The cops are coming.');
  } else {
    const car = best.obj;
    car.pause = 3;
    ctx.onCrime(1, 'hitCar', 'You shot a car!');
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
  if (!best) for (const p of ctx.peds) consider(p, 'ped');
  if (!best) return 'miss';
  if (best.kind === 'hostile') {
    const h = best.obj;
    h.hp -= 1;
    h.x += (h.x - ctx.x) / (bestD || 1) * 1.5;
    h.z += (h.z - ctx.z) / (bestD || 1) * 1.5;
    if (h.hp <= 0) {
      h.down = true;
      h.mesh.rotation.z = 1.5;
      ctx.onHostileDown();
    }
  } else {
    const p = best.obj;
    p.flee = 5;
    p.fleeX = p.x - ctx.x;
    p.fleeZ = p.z - ctx.z;
  }
  return 'hit';
}

export function updateCombat(c, ctx, dt) {
  if (c.cooldown > 0) c.cooldown -= dt;
  if (c.punchCooldown > 0) c.punchCooldown -= dt;
  if (c.reloading > 0) {
    c.reloading -= dt;
    if (c.reloading <= 0) {
      const need = AMMO.magSize - c.mag;
      const take = Math.min(need, c.reserve);
      c.mag += take;
      c.reserve -= take;
    }
  }
  if (c.tracerT > 0) {
    c.tracerT -= dt;
    if (c.tracerT <= 0) c.tracer.visible = false;
  }
  if (c.flashT > 0) {
    c.flashT -= dt;
    if (c.flashT <= 0) c.flash.visible = false;
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
      c.reserve += AMMO.pickupAmount;
      ctx.onPickup();
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
      ctx.onPlayerHit(10);
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
