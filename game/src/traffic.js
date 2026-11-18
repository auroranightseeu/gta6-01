// The city alive: NPC cars driving the road network and pedestrians on the sidewalks.
// Traffic cars run one road line each, in a lane, and wrap around the city edge — and
// queue behind the car ahead on a shared lane, so they never overlap at intersections.
// Pedestrians walk a sidewalk line, turn around at the edge, step aside when Rio gets
// close, and flee when shot at or clipped. A traffic car that hits Rio hurts him
// (handled by main.js).
import { CITY, PALETTE, PEDESTRIANS, TRAFFIC_CARS } from './config.js';
import { createCar } from './vehicles.js';

function pickLane(random) {
  const line = CITY.roadLines[Math.floor(random() * CITY.roadLines.length)];
  return { line, vertical: random() < 0.5, dir: random() < 0.5 ? -1 : 1, lane: random() < 0.5 ? -3.4 : 3.4 };
}

export function createTraffic(city, random, renderer) {
  const cars = [];
  for (let i = 0; i < TRAFFIC_CARS; i += 1) {
    const lane = pickLane(random);
    const along = (random() * 2 - 1) * 120;
    const car = createCar(
      renderer,
      lane.vertical ? lane.line + lane.lane : along,
      lane.vertical ? along : lane.line + lane.lane,
      lane.vertical ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      PALETTE.carColors[Math.floor(random() * PALETTE.carColors.length)],
    );
    car.parked = false;
    car.lane = lane;
    car.cruise = 8 + random() * 6;
    car.pause = 0; // a shot car sits still for a few seconds
    cars.push(car);
  }
  const peds = [];
  for (let i = 0; i < PEDESTRIANS; i += 1) {
    const line = CITY.roadLines[Math.floor(random() * CITY.roadLines.length)];
    const vertical = random() < 0.5;
    const side = random() < 0.5 ? -9.5 : 9.5;
    const along = (random() * 2 - 1) * 120;
    const mesh = renderer.makePerson(PALETTE.pedColors[Math.floor(random() * PALETTE.pedColors.length)]);
    renderer.scene.add(mesh);
    peds.push({
      x: vertical ? line + side : along, z: vertical ? along : line + side,
      vertical, dir: random() < 0.5 ? -1 : 1, speed: 1 + random() * 0.8,
      heading: 0, phase: random() * 6, mesh,
      flee: 0, fleeX: 0, fleeZ: 0, dodge: 0,
    });
  }
  return { cars, peds };
}

export function resetTraffic(traffic, random) {
  for (const car of traffic.cars) {
    const lane = pickLane(random);
    const along = (random() * 2 - 1) * 120;
    car.lane = lane;
    car.cruise = 8 + random() * 6;
    car.x = lane.vertical ? lane.line + lane.lane : along;
    car.z = lane.vertical ? along : lane.line + lane.lane;
    car.heading = lane.vertical ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.pause = 0;
  }
  for (const p of traffic.peds) {
    const line = CITY.roadLines[Math.floor(random() * CITY.roadLines.length)];
    const vertical = random() < 0.5;
    const side = random() < 0.5 ? -9.5 : 9.5;
    const along = (random() * 2 - 1) * 120;
    p.vertical = vertical;
    p.dir = random() < 0.5 ? -1 : 1;
    p.x = vertical ? line + side : along;
    p.z = vertical ? along : line + side;
    p.mesh.position.set(p.x, 0, p.z);
    p.flee = 0;
    p.dodge = 0;
  }
}

/**
 * `playerPos` ({x, z} or null) lets pedestrians step aside from Rio. Traffic cars
 * queue: on a shared lane, a car never closes within 5 m of the car ahead — it
 * slows to the leader's pace, so cars stop overlapping at intersections.
 */
export function updateTraffic(traffic, dt, playerPos = null) {
  // Desired speeds first, front car to back car per lane, so a follower sees the
  // leader's settled speed instead of everyone piling into the same gap.
  const groups = new Map();
  for (const car of traffic.cars) {
    const { line, vertical, dir, lane } = car.lane;
    const key = `${vertical ? 'v' : 'h'}|${line}|${dir}|${lane}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(car);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aa = a.lane.vertical ? a.z : a.x;
      const bb = b.lane.vertical ? b.z : b.x;
      return (bb - aa) * a.lane.dir; // front of the queue first
    });
    let leader = null;
    for (const car of group) {
      let want = car.pause > 0 ? 0 : car.cruise;
      if (leader) {
        const along = car.lane.vertical ? car.z : car.x;
        const leadAlong = leader.lane.vertical ? leader.z : leader.x;
        const gap = (leadAlong - along) * car.lane.dir - 4.2; // bumper to bumper
        if (gap < 1) want = 0;
        else if (gap < 8) want = Math.min(want, leader.speed * (gap / 8));
      }
      car.speed = want;
      leader = car;
    }
  }
  for (const car of traffic.cars) {
    if (car.pause > 0) car.pause -= dt;
    const { line, vertical, dir, lane } = car.lane;
    if (vertical) {
      car.z += dir * car.speed * dt;
      if (car.z > 132) car.z = -132;
      if (car.z < -132) car.z = 132;
      car.x = line + lane;
      car.heading = dir > 0 ? 0 : Math.PI;
    } else {
      car.x += dir * car.speed * dt;
      if (car.x > 132) car.x = -132;
      if (car.x < -132) car.x = 132;
      car.z = line + lane;
      car.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const u = car.mesh.userData;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    const spin = (car.speed * dt) / 0.36;
    for (const w of u.wheels) w.rotation.x += spin;
  }
  for (const p of traffic.peds) {
    // Fleeing (shot at, shoved, clipped by a car): run straight away, fast.
    if (p.flee > 0) {
      p.flee -= dt;
      const d = Math.hypot(p.fleeX, p.fleeZ) || 1;
      p.x += (p.fleeX / d) * 6 * dt;
      p.z += (p.fleeZ / d) * 6 * dt;
      p.x = Math.max(-128, Math.min(128, p.x));
      p.z = Math.max(-128, Math.min(128, p.z));
      p.heading = Math.atan2(p.fleeX, p.fleeZ);
      p.phase += dt * 12;
    } else {
      if (p.vertical) {
        p.z += p.dir * p.speed * dt;
        if (p.z > 128 || p.z < -128) p.dir *= -1;
        p.heading = p.dir > 0 ? 0 : Math.PI;
      } else {
        p.x += p.dir * p.speed * dt;
        if (p.x > 128 || p.x < -128) p.dir *= -1;
        p.heading = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      p.phase += dt * p.speed * 2.2;
      // Step aside: when Rio is close, sidestep up to 2.2 m away from him,
      // perpendicular to the walking direction, then drift back.
      if (playerPos) {
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const d = Math.hypot(dx, dz);
        if (d < 4) {
          // Side away from Rio: sign of the cross product with the walk direction.
          const wx = p.vertical ? 0 : p.dir;
          const wz = p.vertical ? p.dir : 0;
          const side = (wx * dz - wz * dx) >= 0 ? 1 : -1;
          p.dodge += (side * 2.2 - p.dodge) * Math.min(1, dt * 4);
        } else {
          p.dodge += (0 - p.dodge) * Math.min(1, dt * 1.5);
        }
      }
    }
    const swing = Math.sin(p.phase) * 0.5;
    const u = p.mesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
    // Dodge offset is perpendicular to the walk direction.
    const ox = p.vertical ? p.dodge : 0;
    const oz = p.vertical ? 0 : p.dodge;
    p.mesh.position.set(p.x + ox, 0, p.z + oz);
    p.mesh.rotation.y = p.heading;
  }
}
