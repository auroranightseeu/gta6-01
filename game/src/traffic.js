// The city alive: NPC cars driving the road network and pedestrians on the sidewalks.
// Traffic cars run one road line each, in a lane, and wrap around the city edge; pedestrians
// walk a sidewalk line and turn around at the edge. Both dodge nothing — the roads keep them
// out of the buildings — but a traffic car that hits Rio hurts him (handled by main.js).
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
  }
}

export function updateTraffic(traffic, dt) {
  for (const car of traffic.cars) {
    const { line, vertical, dir, lane } = car.lane;
    car.speed = car.cruise;
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
    const swing = Math.sin(p.phase) * 0.5;
    const u = p.mesh.userData;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8;
    u.armR.rotation.x = swing * 0.8;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
  }
}
