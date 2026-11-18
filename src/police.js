// Wanted + police: stars 1-5, police cars that spawn at the city edge and chase Rio
// on foot and in a car, and the cool-off that drops a star when every police car is
// far away for a while. Busted is a police car catching Rio on foot at close range.
import { CITY, POLICE } from './config.js';
import { resolveCircle } from './world.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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

export function createPolice(renderer) {
  return { cars: [], renderer, hiddenTimer: 0 };
}

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

export function clearPolice(police) {
  for (const car of police.cars) police.renderer.scene.remove(car.mesh);
  police.cars.length = 0;
  police.hiddenTimer = 0;
}

function removePoliceCar(police, car) {
  police.renderer.scene.remove(car.mesh);
  const i = police.cars.indexOf(car);
  if (i >= 0) police.cars.splice(i, 1);
}

/**
 * Chase + cool-off. `ctx` is { x, z, driving, speed, wanted, time, city, random,
 * onBusted }. Returns nothing; mutates ctx.wanted via ctx.setWanted(n).
 * One police car per wanted star, up to maxActive; cars too far away respawn nearer.
 */
export function updatePolice(police, ctx, dt) {
  const wanted = ctx.wanted;
  const want = Math.min(wanted, POLICE.maxActive);
  while (police.cars.length < want) {
    const p = spawnPoint(ctx.x, ctx.z, ctx.random);
    spawnPoliceCar(police, p.x, p.z, ctx.city);
  }
  while (police.cars.length > want) {
    removePoliceCar(police, police.cars[police.cars.length - 1]);
  }
  let nearest = Infinity;
  for (const car of police.cars) {
    const d = Math.hypot(car.x - ctx.x, car.z - ctx.z);
    if (d < nearest) nearest = d;
    // A car that lost Rio completely reappears nearer the action.
    if (d > POLICE.tooFar) {
      const p = spawnPoint(ctx.x, ctx.z, ctx.random);
      car.x = p.x;
      car.z = p.z;
      car.speed = 0;
      resolveCircle(car, 1.7, ctx.city);
    }
    const targetHeading = (() => {
      // Stuck? A police car steering straight at Rio grinds against a building
      // face forever: the wall push cancels its forward motion. If the distance
      // to Rio has not shrunk for 2 s, detour for 3 s toward a point 30 m to
      // one side of Rio, which carries the car around the end of the obstacle.
      let tx = ctx.x;
      let tz = ctx.z;
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
  // Cool-off: no police car in sight for a while drops one star, then the timer
  // restarts for the next star. Being seen resets the timer.
  if (wanted > 0) {
    if (nearest > POLICE.sightDist) {
      police.hiddenTimer += dt;
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
