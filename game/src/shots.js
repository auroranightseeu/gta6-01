// The screenshot scenes behind ?shot=start|drive|foot|chase|shoot. Each one stages the
// real game from a fresh reset and plays it forward with a simple autopilot, so the frame
// is what a short game really looks like and the same seed always gives the same frame.
//
// Realism is the point of these frames (the owner's 19 Nov order): the cover is staged as
// a real four-star pursuit with the air unit actually overhead and in frame, not a busy
// collage. Every scene runs the game's own systems rather than posing meshes.
import { GETAWAY_MARKER, STEP } from './config.js';
import { SCREEN_PLAY } from './render.js';
import { updatePlayer } from './player.js';
import { driveCar, syncMotor } from './vehicles.js';
import { updateTraffic } from './traffic.js';
import { spawnPoliceCar, updatePolice } from './police.js';
import { beginMission, missionText } from './missions.js';
import { firePistol, refillAmmo, spawnHostiles, switchWeapon } from './combat.js';

const DRIVE_SECONDS = 5.5;
const FOOT_SECONDS = 6;
const CHASE_SECONDS = 4.2; // let the interceptors close into the camera frame
// The air unit lifts at 46 m and descends at 16 m/s to its 10 m station, so it needs
// ~240 fixed steps to reach the hover the cover depends on. main.js steps the police
// 150 more times after staging, which is not enough on its own: stepping it here puts
// the aircraft at 10 m and inside the top of the frame instead of clipped off it.
const HELI_SETTLE_STEPS = 300;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Stage `game` to the named scene and return the screen to draw over it. `resetGame` is
 * main.js's own reset, passed in so this file never duplicates it.
 */
export function stageShot(game, name, resetGame) {
  resetGame(game, true);
  if (name === 'drive') return stageDrive(game);
  if (name === 'foot') return stageFoot(game);
  if (name === 'shoot') return stageShoot(game);
  if (name === 'dusk') return stageDusk(game);
  if (name === 'chase') return stageChase(game);
  // Start = the cover (W-H winner, 19 Nov): the police-chase frame, not the
  // title screen. The title aerial (yaw 2.6 tried) stays dim behind its panel
  // and reads as a wash at contact-sheet size; the chase shows the heli, the
  // stars, the minimap and the objective all at once. The live title screen
  // is untouched — this only stages the ?shot=start cover.
  return stageChase(game);
}

/** Shared: put every traffic car on a cross street so none crosses the shot's lane. */
function clearShotLane(game) {
  for (const t of game.traffic.cars) {
    const lines = [-125, -75, 25, 75, 125];
    const line = lines[Math.floor(game.random() * lines.length)];
    t.lane = { line, vertical: true, dir: t.lane.dir, lane: t.lane.lane };
    t.x = line + t.lane.lane;
    t.mesh.position.set(t.x, 0, t.z);
  }
}

/** Shared: Rio takes the first parked car at (-125,-110) facing up the -25 road. */
function takeCar(game) {
  clearShotLane(game);
  const car = game.cars[0];
  car.x = -125;
  car.z = -110;
  car.heading = 0;
  car.speed = 0;
  car.mesh.position.set(-125, 0, -110);
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
  return car;
}

/** Shared: drive the shot car up its road, lane-keeping, for `seconds`. */
function driveForward(game, car, seconds) {
  for (let i = 0; i < seconds / STEP; i += 1) {
    const steer = clamp(-car.heading * 2 - (car.x + 125) * 0.06, -1, 1);
    driveCar(car, STEP, { throttle: 1, steer, handbrake: false }, game.city);
    game.player.x = car.x;
    game.player.z = car.z;
    game.speed = car.speed;
    updateTraffic(game.traffic, STEP);
  }
}

/**
 * Shared: put the three traffic bikes on the kerb lane of the -125 avenue, ahead of the
 * shot car and heading the same way, so they are the first thing the drive and chase
 * frames show after Rio's own car. They keep their real lanes and their own signals; only
 * their along-lane position is staged, which is what shots.js does for cars already.
 * z is measured from the shot car's own position at the end of the staging run, so the
 * gap is fixed no matter how far the car got.
 */
function stageBikes(game, car, offsets, dir = 1) {
  const bikes = game.traffic.bikes;
  const lane = dir > 0 ? 3.4 : -3.4;
  for (let i = 0; i < offsets.length && i < bikes.length; i += 1) {
    const m = bikes[i];
    m.lane = { line: -125, vertical: true, dir, lane };
    m.x = -125 + lane;
    m.z = car.z + offsets[i];
    m.heading = dir > 0 ? 0 : Math.PI;
    m.speed = m.cruise || 12;
    m.lean = 0;
    syncMotor(m, 0);
  }
}

/** Driving through the city: Rio's car on the -25 road, traffic on the cross streets. */
function stageDrive(game) {
  const car = takeCar(game);
  driveForward(game, car, DRIVE_SECONDS);
  // Bikes ahead in the kerb lane: 5.5, 10 and 16 m up the road, in a tight line like the
  // reference's bike row — close enough to read as bikes with their riders, clear of the
  // car's nose (which ends 2.1 m ahead of its centre) and of each other.
  stageBikes(game, car, [5.5, 10, 16]);
  return { screen: SCREEN_PLAY };
}

/**
 * On foot: Rio walks up the middle of the -25 road, camera behind him. Traffic lanes sit
 * 3.4 m either side of the centreline, so cars pass without clipping him; one traffic car
 * overtakes in the west lane, and several walkers are seeded along the blocks ahead so the
 * street reads as inhabited rather than empty.
 */
function stageFoot(game) {
  const pass = game.traffic.cars[0];
  pass.lane = { line: -25, vertical: true, dir: -1, lane: -3.4 };
  pass.x = -28.4;
  pass.z = -40;
  pass.mesh.position.set(-28.4, 0, -40);
  const walkers = [[0, -35, -22], [1, -15, -8], [2, -35, 8], [3, -15, 24], [4, -35, 40], [5, -15, 56]];
  for (const [i, x, z] of walkers) {
    const p = game.traffic.peds[i];
    p.x = x;
    p.z = z;
    p.vertical = false;
    p.dir = i % 2 ? 1 : -1;
    p.mesh.position.set(x, 0, z);
  }
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

/**
 * Golden hour: Rio stands at the (25,75) crossing looking north-west across the bay at the
 * Downtown landmark tower, with the low sun behind the skyline. The frame is the one the
 * lighting pass is judged on, so it carries every HUD element at once — a live mission
 * (objective line, wanted stars row, minimap blip and the gold beacon beam at the getaway
 * marker), the district/street line and the controls hint. The camera sits behind Rio with
 * a nearly level pitch: the tower is 46 m tall and ~93 m away, so a pitched-down camera
 * would crop it and the dusk sky above it.
 */
const DUSK = { x: 25, z: 75, yaw: Math.PI / 4, pitch: 0.07 };
function stageDusk(game) {
  beginMission(game.missions, 3);
  game.objective = missionText(game.missions);
  game.renderer.setBeacon(GETAWAY_MARKER.x, GETAWAY_MARKER.z, true);
  game.money = 1250;
  game.player.x = DUSK.x;
  game.player.z = DUSK.z;
  // Facing is +z rotated by heading, so heading = PI + PI/4 looks north-west, the way the
  // camera is pointed; a mismatch would turn Rio's back to the skyline.
  game.player.heading = Math.PI + Math.PI / 4;
  game.player.mesh.position.set(DUSK.x, 0, DUSK.z);
  game.player.mesh.rotation.y = game.player.heading;
  game.camYaw = DUSK.yaw;
  game.camPitch = DUSK.pitch;
  game.hint = 'WASD move · Shift run · E enter car · P pause';
  // A couple of steps of traffic so the road is not frozen mid-lane, camera car-free.
  for (let i = 0; i < 12; i += 1) updateTraffic(game.traffic, STEP);
  game.speed = 0;
  return { screen: SCREEN_PLAY };
}

/**
 * The cover: a real four-star pursuit. Rio flees up the -25 road while two interceptors
 * bear down head-on and the air unit is genuinely overhead with its searchlight on him.
 * The police are stepped until the aircraft has settled onto its 10 m station, so the
 * helicopter is inside the frame (at spawn height 46 m it projects far above the top
 * edge and the cover had no aircraft in it at all).
 */
function stageChase(game) {
  beginMission(game.missions, 3);
  game.wanted = 4;
  game.objective = missionText(game.missions);
  game.renderer.setBeacon(GETAWAY_MARKER.x, GETAWAY_MARKER.z, true);
  const car = takeCar(game);
  // W-H B-variant: level the chase camera (pitch 0.32 -> 0.24) so the air unit
  // at its 10 m station sits in the upper third of the frame instead of
  // grazing the top edge behind the rooftops. 0.15 put the heli dead-centre
  // but the searchlight cone filled the sky and the near interceptor hid
  // Rio's car; 0.24 keeps the heli big while the car stays readable.
  // Drive staging keeps 0.32.
  game.camPitch = 0.24;
  const cop1 = spawnPoliceCar(game.police, -128.4, -58, game.city);
  cop1.heading = Math.PI;
  cop1.mesh.rotation.y = Math.PI;
  const cop2 = spawnPoliceCar(game.police, -121.6, -30, game.city);
  cop2.heading = Math.PI;
  cop2.mesh.rotation.y = Math.PI;
  const policeCtx = {
    x: game.player.x, z: game.player.z, driving: true, speed: game.speed,
    wanted: game.wanted, city: game.city, random: game.random,
    setWanted: (n) => { game.wanted = n; },
    onBusted: () => {},
  };
  for (let i = 0; i < CHASE_SECONDS / STEP; i += 1) {
    const steer = clamp(-car.heading * 2 - (car.x + 125) * 0.06, -1, 1);
    driveCar(car, STEP, { throttle: 1, steer, handbrake: false }, game.city);
    game.player.x = car.x;
    game.player.z = car.z;
    game.speed = car.speed;
    policeCtx.x = car.x;
    policeCtx.z = car.z;
    policeCtx.speed = car.speed;
    policeCtx.wanted = game.wanted;
    updateTraffic(game.traffic, STEP, game.player);
    updatePolice(game.police, policeCtx, STEP);
  }
  // Let the aircraft finish its descent onto station with Rio holding still, so the
  // frame shows it hovering overhead rather than mid-approach high and out of shot.
  for (let i = 0; i < HELI_SETTLE_STEPS; i += 1) {
    policeCtx.x = car.x;
    policeCtx.z = car.z;
    policeCtx.speed = 0;
    policeCtx.wanted = game.wanted;
    updatePolice(game.police, policeCtx, STEP);
  }
  // Two bikes coming the other way, in the far lane 12 and 26 m ahead: the cover's chase
  // already has police traffic, so the bikes stay out of the pursuit's way and read as
  // street life beside it.
  stageBikes(game, car, [5.5, 10, 16], -1);
  return { screen: SCREEN_PLAY };
}

/**
 * A firefight: Rio on foot with the SMG, two rivals closing, a tracer still lit and the
 * muzzle flash up. The shot fires the real weapon through the real combat module so the
 * tracer, the flash, the ammo count and the wanted level are all the game's own state.
 */
function stageShoot(game) {
  // Rio stands at (-25,-52) facing -z (heading PI), so the rivals are placed ahead of him
  // at -66 and the camera sits behind and above, looking down the street.
  game.player.x = -25;
  game.player.z = -52;
  game.player.heading = Math.PI;
  game.player.mesh.position.set(-25, 0, -52);
  game.player.mesh.rotation.y = Math.PI;
  // Aim down the street: the shot follows the camera's sight line now, so the camera has
  // to look at the rivals (camYaw 0 = down -z, the way Rio faces) or the tracer leaves
  // the barrel the wrong way. placeCamera puts the rig at target + (sin yaw, cos yaw) * d,
  // so yaw 0 is behind Rio at +z looking -z; PI put the camera in FRONT of him looking
  // back up the street, and the shot flew off over his shoulder while both rivals sat
  // behind the lens. The over-the-shoulder camera keeps his head clear of the reticle
  // and the muzzle flash reads at the barrel tip, so the gun is still visible.
  game.camYaw = 0;
  // A steeper pitch than the old 0.22. The tracer runs level down the street, so a level
  // camera puts it within a few pixels of screen centre and perspective squashes a 26 m
  // streak into a 40 px stub; looking down more lifts the muzzle up the frame and the same
  // streak projects ~88 px, and the fallen rival reads from above instead of edge-on.
  game.camPitch = 0.34;
  game.wanted = 2;
  game.hint = 'Mouse aim · LMB fire · R reload · 1/2/3 weapon · P pause';
  // The SMG is unlocked but resets with an empty magazine (startMag 0), and a weapon with
  // no rounds only starts a reload, so the shot showed a man standing still. Load it.
  switchWeapon(game.combat, 'smg');
  const smg = game.combat.weapons.smg;
  smg.mag = 24;
  refillAmmo(game.combat, 'smg', 60);
  spawnHostiles(game.combat, -25, -66, 3);
  // The hit cone is measured from the camera's centre line, which rides 0.55 m to Rio's
  // right (main.js placeCamera, combat.aimFromCamera). The rival at spawn angle 0 lands on
  // Rio's own x, so he sits 0.55 m off that line — 7.8 deg at 4 m, wider than the SMG's
  // 7 deg cone — and both staged rounds missed him. Put him on the sight line instead of
  // moving the spawn ring.
  const sightX = game.player.x + Math.cos(game.camYaw) * 0.55;
  for (const h of game.combat.hostiles) {
    if (h.x === -25 && h.z === -56) {
      h.x = sightX;
      h.mesh.position.x = sightX;
      break;
    }
  }
  const ctx = {
    x: game.player.x, z: game.player.z, heading: game.player.heading,
    // On foot the shot follows the camera's sight line, so the staged frame must aim the
    // camera at the rivals or the tracer would leave down the body's heading instead.
    camYaw: game.camYaw,
    peds: game.traffic.peds, trafficCars: game.traffic.cars,
    sanctioned: true, driving: false, time: 0,
  };
  // Three rounds. The first two land on the near rival (1 hp each, so he drops), and
  // because the pool only keeps the LAST shot's tracer, the third is the one the frame
  // shows. It is fired down the empty street — no walker or car in the cone — so it runs
  // the SMG's full 26 m and stays a long streak instead of a stub that dies 4 m out.
  game.combat.cooldown = 0;
  firePistol(game.combat, ctx);
  game.combat.cooldown = 0;
  firePistol(game.combat, ctx);
  game.combat.cooldown = 0;
  firePistol(game.combat, { ...ctx, peds: [], trafficCars: [] });
  // The street reacts: two walkers on the kerbs break into a run away from the gunfire.
  // Staged on known spots like stageFoot's walkers so they read at sheet size instead of
  // being whichever far-off ped happened to be in frame. The -25 road is 14 m wide, so the
  // kerbs sit at x = -32 and -18.
  const runners = [[0, -18.6, -57], [1, -31.4, -55]];
  for (const [i, x, z] of runners) {
    const p = game.traffic.peds[i];
    p.x = x;
    p.z = z;
    p.vertical = false;
    p.mesh.position.set(x, 0, z);
    p.flee = 6;
    p.fleeX = x - game.player.x;
    p.fleeZ = z - game.player.z;
  }
  for (let i = 0; i < 4; i += 1) updateTraffic(game.traffic, STEP);
  return { screen: SCREEN_PLAY };
}
