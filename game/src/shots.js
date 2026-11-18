// The screenshot scenes behind ?shot=start|drive|foot. Each one stages the real game from
// a fresh reset and plays it forward with a simple autopilot, so the frame is what a short
// game really looks like and the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { updatePlayer } from './player.js';
import { driveCar } from './vehicles.js';
import { updateTraffic } from './traffic.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 5.5;
const FOOT_SECONDS = 6;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Stage `game` to the named scene (start, drive or foot; any other name is start) and
 * return the screen to draw over it. `resetGame` is main.js's own reset, passed in so
 * this file never duplicates it.
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
    // Rio walks the sidewalk up the -25 road, traffic and pedestrians passing by.
    game.player.x = -16;
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
  // Start: the title screen over a living city, camera high over the centre.
  game.camYaw = 0.7;
  game.camPitch = 0.55;
  for (let i = 0; i < START_SECONDS / STEP; i += 1) updateTraffic(game.traffic, STEP);
  return { screen: SCREEN_TITLE };
}
