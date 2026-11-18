// The screenshot scenes behind ?shot=start|drive|foot|chase. Each one stages the real
// game from a fresh reset and plays it forward with a simple autopilot, so the frame is
// what a short game really looks like and the same seed always gives the same frame.
import { GETAWAY_MARKER, STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { updatePlayer } from './player.js';
import { driveCar } from './vehicles.js';
import { updateTraffic } from './traffic.js';
import { spawnPoliceCar, updatePolice } from './police.js';
import { beginMission, missionText } from './missions.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 5.5;
const FOOT_SECONDS = 6;
const CHASE_SECONDS = 2.2; // short: the interceptors close fast head-on

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Stage `game` to the named scene (start, drive, foot or chase; any other name is
 * start) and return the screen to draw over it. `resetGame` is main.js's own reset,
 * passed in so this file never duplicates it.
 */
export function stageShot(game, name, resetGame) {
  resetGame(game, true);
  if (name === 'drive') {
    // Rio takes the first parked car and drives it up the -25 road, lane-keeping.
    // Traffic is kept to the other vertical roads so no car crosses this shot's lane.
    for (const t of game.traffic.cars) {
      const lines = [-125, -75, 25, 75, 125];
      const line = lines[Math.floor(game.random() * lines.length)];
      t.lane = { line, vertical: true, dir: t.lane.dir, lane: t.lane.lane };
      t.x = line + t.lane.lane;
      t.mesh.position.set(t.x, 0, t.z);
    }
    const car = game.cars[0];
    car.x = -25;
    car.z = -110;
    car.heading = 0;
    car.speed = 0;
    car.mesh.position.set(-25, 0, -110);
    car.mesh.rotation.y = 0;
    game.driving = car;
    car.parked = false;
    game.player.mesh.visible = false;
    game.player.x = car.x;
    game.player.z = car.z;
    game.player.heading = 0;
    game.camYaw = Math.PI;
    game.camPitch = 0.32;
    game.hint = 'WASD drive · Space handbrake · E exit car · P pause';
    for (let i = 0; i < DRIVE_SECONDS / STEP; i += 1) {
      const steer = clamp(-car.heading * 2 - (car.x + 25) * 0.06, -1, 1);
      driveCar(car, STEP, { throttle: 1, steer, handbrake: false }, game.city);
      game.player.x = car.x;
      game.player.z = car.z;
      game.speed = car.speed;
      updateTraffic(game.traffic, STEP);
    }
    return { screen: SCREEN_PLAY };
  }
  if (name === 'foot') {
    // Rio walks up the middle of the -25 road, camera behind him: the street
    // recedes ahead with traffic and pedestrians at the edges and the city
    // behind, instead of the east sidewalk, where the tall block at (-9, -91)
    // fills the right half of the frame. Traffic lanes sit 3.4 m either side
    // of the centreline, so cars pass Rio without clipping him. One traffic
    // car is put on his road, northbound in the west lane behind him, so it
    // overtakes him during the walk and is visible ahead of him in the frame.
    const pass = game.traffic.cars[0];
    pass.lane = { line: -25, vertical: true, dir: -1, lane: -3.4 };
    pass.x = -28.4;
    pass.z = -40;
    pass.mesh.position.set(-28.4, 0, -40);
    game.player.x = -25;
    game.player.z = -60;
    game.player.heading = Math.PI;
    game.player.mesh.position.set(-16, 0, -60);
    game.player.mesh.rotation.y = Math.PI;
    game.camYaw = 0;
    game.camPitch = 0.35;
    game.hint = 'WASD move · Shift run · E enter car · P pause';
    for (let i = 0; i < FOOT_SECONDS / STEP; i += 1) {
      updatePlayer(game.player, STEP, { f: 1, s: 0 }, false, game.camYaw, game.city);
      updateTraffic(game.traffic, STEP);
    }
    game.speed = 0;
    return { screen: SCREEN_PLAY };
  }
  if (name === 'chase') {
    // Rio fleeing up the -25 road, two wanted stars, two police cars bearing down
    // head-on to intercept — the getaway mission, marker on the minimap. The cars
    // spawn ahead on the same road, already facing Rio, and really chase him: the
    // autopilot drives Rio north while updatePolice steers them onto him.
    beginMission(game.missions, 3);
    game.wanted = 2;
    game.objective = missionText(game.missions);
    game.renderer.setBeacon(GETAWAY_MARKER.x, GETAWAY_MARKER.z, true);
    for (const t of game.traffic.cars) {
      const lines = [-125, -75, 25, 75, 125];
      const line = lines[Math.floor(game.random() * lines.length)];
      t.lane = { line, vertical: true, dir: t.lane.dir, lane: t.lane.lane };
      t.x = line + t.lane.lane;
      t.mesh.position.set(t.x, 0, t.z);
    }
    const car = game.cars[0];
    car.x = -25;
    car.z = -110;
    car.heading = 0;
    car.speed = 0;
    car.mesh.position.set(-25, 0, -110);
    car.mesh.rotation.y = 0;
    game.driving = car;
    car.parked = false;
    game.player.mesh.visible = false;
    game.player.x = car.x;
    game.player.z = car.z;
    game.player.heading = 0;
    game.camYaw = Math.PI;
    game.camPitch = 0.32;
    game.hint = 'WASD drive · Space handbrake · E exit car · P pause';
    const cop1 = spawnPoliceCar(game.police, -31, -20, game.city);
    cop1.heading = Math.PI;
    cop1.mesh.rotation.y = Math.PI;
    const cop2 = spawnPoliceCar(game.police, -19, -24, game.city);
    cop2.heading = Math.PI;
    cop2.mesh.rotation.y = Math.PI;
    for (let i = 0; i < CHASE_SECONDS / STEP; i += 1) {
      const steer = clamp(-car.heading * 2 - (car.x + 25) * 0.06, -1, 1);
      driveCar(car, STEP, { throttle: 1, steer, handbrake: false }, game.city);
      game.player.x = car.x;
      game.player.z = car.z;
      game.speed = car.speed;
      updateTraffic(game.traffic, STEP, game.player);
      updatePolice(game.police, {
        x: game.player.x, z: game.player.z, driving: true, speed: game.speed,
        wanted: game.wanted, city: game.city, random: game.random,
        setWanted: (n) => { game.wanted = n; },
        onBusted: () => {},
      }, STEP);
    }
    return { screen: SCREEN_PLAY };
  }
  // Start: the title screen over a living city, camera high over the centre.
  game.camYaw = 0.7;
  game.camPitch = 0.55;
  for (let i = 0; i < START_SECONDS / STEP; i += 1) updateTraffic(game.traffic, STEP);
  return { screen: SCREEN_TITLE };
}
