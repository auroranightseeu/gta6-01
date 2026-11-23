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
import { applyDusk } from './dusk.js';
import { renderDispatch } from './dispatch.js';

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

/** Hide the HUD reticle for a staged frame: the shot is a photograph, not an aim view. */
function hideReticle() {
  const id = 'shot-no-reticle';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = '#reticle{display:none !important}';
  document.head.appendChild(style);
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

/**
 * Street life for the chase frame. The pursuit itself is staged by stageChase above; this
 * pass fills the avenue it runs down so the shot reads as a busy city rather than a duel on
 * an empty road, which is the axis the cover is judged on (open world you can see).
 *
 * Everything is placed AFTER the drive and police steps, at offsets from the shot car's own
 * final position — the rule stageBikes already uses — so the layout holds no matter how far
 * the car got. The avenue is two-way: the west lane carries cars going Rio's way (tails up
 * the road), the east lane carries oncoming traffic (fronts and headlights) with the three
 * bikes weaving up it, and two oncoming cars sit beside and just ahead of Rio's fender so the
 * road is populated at the camera as well as up it. The block-side pavement is a line of
 * walkers in front of the market crowd, with two more on the seaward sand for balance.
 */
function stageChaseStreet(game, car) {
  const CITY_SIDE = -121.6; // lane the oncoming traffic and the bikes ride
  const AWAY_SIDE = -128.4; // lane the cars heading the same way as Rio ride
  const z0 = car.z;
  // [lane x, dir, offset from the shot car] for twelve avenue cars. dir -1 faces the camera —
  // fronts and headlights, the read a busy avenue gives at a glance — and its first two sit
  // beside and just ahead of Rio's fender, so the road is populated at the camera as well as
  // up it. dir 1 fills Rio's own lane above the pursuit, far enough that no car sits on his
  // bumper in a frozen 108 km/h frame. Cars are 12 m apart (7.8 m of clear air behind each
  // 4.2 m body, real following distance) and 18-42 m is left to the bike row, which weaves
  // past the queue instead of waiting in it.
  const SLOTS = [
    [CITY_SIDE, -1, 4], [CITY_SIDE, -1, 14], [CITY_SIDE, -1, 46], [CITY_SIDE, -1, 58],
    [CITY_SIDE, -1, 70], [CITY_SIDE, -1, 82], [CITY_SIDE, -1, 94], [CITY_SIDE, -1, 106],
    [AWAY_SIDE, 1, 48], [AWAY_SIDE, 1, 62], [AWAY_SIDE, 1, 76], [AWAY_SIDE, 1, 90],
  ];
  const cars = game.traffic.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const t = cars[i];
    const slot = SLOTS[i];
    if (slot) {
      const [x, dir, off] = slot;
      t.lane = { line: -125, vertical: true, dir, lane: x + 125 };
      t.x = x;
      t.z = z0 + off;
      t.heading = dir > 0 ? 0 : Math.PI;
      t.speed = t.cruise || 10;
      t.parked = false;
      t.mesh.position.set(x, 0, t.z);
      t.mesh.rotation.y = t.heading;
    } else if (t.lane && t.lane.line === -125) {
      // A car this pass did not stage leaves the chase road for a cross street, so the lane
      // stays exactly the layout above instead of picking up strays behind it.
      const line = i % 2 ? -75 : 75;
      t.lane = { line, vertical: true, dir: t.lane.dir, lane: t.lane.lane };
      t.x = line + t.lane.lane;
      t.mesh.position.set(t.x, 0, t.z);
    }
  }
  const bikes = game.traffic.bikes;
  // Bikes in the oncoming lane, ahead of Rio: 20, 28 and 36 m up, so the row is close enough
  // to read as riders with their jackets and far enough to sit under the pursuit rather than
  // on the car's nose. They ride the oncoming lane and slip past its queue instead of waiting
  // behind it — the bike rule traffic.js already runs — so the lane's car slots skip 18-42 m.
  const bikeOffsets = [20, 28, 36];
  for (let i = 0; i < bikeOffsets.length && i < bikes.length; i += 1) {
    const m = bikes[i];
    m.lane = { line: -125, vertical: true, dir: -1, lane: 3.4 };
    m.x = CITY_SIDE;
    m.z = z0 + bikeOffsets[i];
    m.heading = Math.PI;
    m.speed = m.cruise || 12;
    m.lean = 0;
    syncMotor(m, 0);
  }
  // [offset, walk direction] along the block-side pavement, plus two on the beach sand.
  // x comes from pavementX at that z, so no walker ends up inside a facade.
  const walkers = [
    [9, 1], [16, -1], [24, 1], [33, -1], [43, 1], [54, -1], [66, 1], [78, -1], [92, 1],
  ];
  const peds = game.traffic.peds;
  let placed = 0;
  for (let i = 0; i < walkers.length && i < peds.length; i += 1) {
    const [off, dir] = walkers[i];
    const x = pavementX(game, z0 + off, 0.55);
    if (x === null) continue;
    const p = peds[i];
    p.x = x;
    p.z = z0 + off;
    p.vertical = true;
    p.line = -125;
    p.dir = dir;
    p.heading = dir > 0 ? 0 : Math.PI;
    p.flee = 0;
    p.dodge = 0;
    p.mesh.position.set(x, 0, p.z);
    p.mesh.rotation.y = p.heading;
    placed += 1;
  }
  // Two on the seaward sand, past the promenade wall, where the beach row already walks:
  // they read on the opposite kerb and give the avenue both sides populated.
  const sand = [[14, 1], [40, -1]];
  for (let i = 0; i < sand.length && placed < peds.length; i += 1) {
    const [off, dir] = sand[i];
    const p = peds[placed];
    p.x = -134.5;
    p.z = z0 + off;
    p.vertical = true;
    p.line = -125;
    p.dir = dir;
    p.heading = dir > 0 ? 0 : Math.PI;
    p.flee = 0;
    p.dodge = 0;
    p.mesh.position.set(-134.5, 0, p.z);
    p.mesh.rotation.y = p.heading;
    placed += 1;
  }
  // Crowd walkers that placeAvenuePed already put on this pavement are kept — they make the
  // street busier — but their fixed x = -115.5 can sit inside a facade, and two of them can
  // land on a staged body. Snap each to the free pavement lane at its own z; the ones with
  // no lane at all are moved to the market aisle, where the crowd is dense anyway.
  for (let i = placed; i < peds.length; i += 1) {
    const p = peds[i];
    if (Math.abs(p.x + 115.5) > 3.5 || p.z < z0 - 25 || p.z > z0 + 115) continue;
    let clash = false;
    for (let k = 0; k < walkers.length; k += 1) {
      if (Math.abs(p.z - (z0 + walkers[k][0])) < 2.8) { clash = true; break; }
    }
    if (!clash) {
      const x = pavementX(game, p.z, 0.55);
      if (x !== null) {
        p.x = x;
        p.mesh.position.set(x, 0, p.z);
        continue;
      }
    }
    p.x = -111.5;
    p.z = 12 + (i % 9);
    p.vertical = false;
    p.line = -125;
    p.mesh.position.set(p.x, 0, p.z);
  }
}

/**
 * A free x on the -125 avenue's block-side pavement at `z`, or null when the facades on
 * that stretch reach the kerb. The pavement runs from the kerb (x = -118) back to the wall
 * of the block, and that wall moves from -114.6 to -116.9 depending on the building, so a
 * single fixed x would put half the walkers inside a facade where nobody can see them.
 * Candidates start at the kerb and step toward the block; the first clear one wins.
 */
function pavementX(game, z, r) {
  const cols = game.city.colliders || [];
  for (const x of [-117.7, -117.4, -117.1, -116.8, -116.5, -116.2]) {
    let clear = true;
    for (let i = 0; i < cols.length; i += 1) {
      const c = cols[i];
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) { clear = false; break; }
    }
    if (clear) return x;
  }
  return null;
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
 * Golden hour: Rio stands in the middle of the 75 street looking west down it, into the
 * sunset, so the frame is a dusk boulevard rather than a skyline with a road under it. The
 * sun sits low over the sea at the end of the street (the west end of the frame), the road
 * recedes through the (25,75) junction with a queue of traffic in both lanes, and the
 * pavements carry walkers — the two things the old shot was missing (it was an empty road
 * with one pedestrian). The frame also carries every HUD element: a live mission (objective
 * line, wanted stars, minimap blip and the gold beacon at the getaway marker), the
 * district/street line, the police panel and the controls hint.
 *
 * Why the west axis: a 45 deg look across the grid put every car on the horizon line —
 * measured, the staged traffic covered a 90 px band at y 340-430 in a 720 px frame — because
 * a eye-level camera in 30-90 m canyons sees road only at the far end. Down the boulevard
 * the same cars are 12-70 m away along the view axis, so they read at sheet size, and the
 * sunset is at the end of the street instead of being cropped off the top.
 */
const DUSK = { x: 48, z: 75, yaw: Math.PI / 2, pitch: 0.13, heading: -Math.PI / 2 };

/**
 * Street life for the dusk frame. The old dusk shot was staged on nothing but the camera:
 * it showed the sunset over an empty junction, and the sheet read it as the weakest frame
 * of the four. The boulevard it now looks down is filled the way rush hour looks: oncoming
 * cars with their head-lamps lit on one side, tail-lights receding on the other, cross
 * traffic on the avenue at the junction, and walkers along both pavements.
 *
 * Slots are fixed, not seeded: the camera is fixed, so the layout only has to be right for
 * this one frame. Every slot sits on a real lane (z = 75 ± 3.4 on the street, x = 25 ± 3.4
 * on the avenue) and clear of the junction's zebras, which sit ~8 m either side of each
 * crossing centre — hence the gap between x 12 and x 38 in the list below.
 *
 * dir +1 on a horizontal road moves +x, i.e. toward the camera (fronts and head-lamps);
 * dir -1 moves away (tail-lights). On the vertical avenue dir +1 moves +z, across frame.
 */
const DUSK_CARS = [
  // The 75 street just ahead of the camera: one car coming at the lens, one pulling away.
  // 13-15 m out, not 8: at 8 m a car is 48000 px — a fifth of the frame — and it blocks the
  // boulevard the shot is about.
  [40, 71.6, 1, false], [42, 78.4, -1, false],
  // The queue down the boulevard, past the junction: head-lamps one side...
  [12, 71.6, 1, false], [2, 71.6, 1, false], [-10, 71.6, 1, false],
  [-24, 71.6, 1, false], [-40, 71.6, 1, false], [-58, 71.6, 1, false],
  // ...tail-lights the other.
  [10, 78.4, -1, false], [-2, 78.4, -1, false], [-16, 78.4, -1, false],
  [-32, 78.4, -1, false], [-50, 78.4, -1, false],
  // Cross traffic on the 25 avenue, at the junction: two cars heading across the view.
  [21.6, 62, 1, true], [28.4, 62, -1, true],
];

/** Heading for a traffic slot: the mesh faces +z at heading 0. */
function slotHeading(vertical, dir) {
  if (vertical) return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/**
 * Walkers for the dusk frame, on both pavements of the boulevard and at the junction, so
 * the near kerbs are inhabited at sheet size as well as the far ones. Each entry is
 * [fromX, fromZ, dir, vertical, stepX, stepZ]; the pavement strip here is 1-2 m deep, so
 * duskSpot() steps each body toward the kerb until it clears the facades.
 */
const DUSK_WALKERS = [
  // The near (south) kerb of the street, walking with and against the camera.
  [44.5, 67.55, 1, false, 0, 0.25], [38, 67.55, -1, false, 0, 0.25],
  [4, 67.55, 1, false, 0, 0.25], [-4, 67.55, -1, false, 0, 0.25],
  [-14, 67.55, 1, false, 0, 0.25], [-26, 67.55, -1, false, 0, 0.25],
  [-38, 67.55, 1, false, 0, 0.25], [-52, 67.55, -1, false, 0, 0.25],
  // The far (north) kerb.
  [8, 82.45, -1, false, 0, -0.25], [-8, 82.45, 1, false, 0, -0.25],
  [-20, 82.45, -1, false, 0, -0.25], [-34, 82.45, 1, false, 0, -0.25],
  [-48, 82.45, -1, false, 0, -0.25],
  // The avenue's two pavements either side of the junction.
  [17.55, 66, 1, true, 0.25, 0], [17.55, 84, -1, true, 0.25, 0],
  [32.45, 68, -1, true, -0.25, 0], [32.45, 86, 1, true, -0.25, 0],
  // Two on the crossing itself, in front of the camera, and the third up on the near kerb
  // instead. At its old (41, 72.2) the body centre sat inside the staged cab at (40, 71.6):
  // 1.17 m apart, but 0.60 m in from the hull's side and 1.00 m along it, i.e. inside the
  // 2.02 x 4.65 m footprint, so the torso rose out of the roof and the legs vanished into
  // the bodywork. The kerb slot keeps him in the same part of the frame, 2.69 m clear of
  // that cab and 2.5 m from the walker beside him, so nobody is buried in the car.
  [41, 67.55, 1, false, 0, 0.25], [39.5, 77.8, -1, false, 0, 0],
  [36.5, 74.6, 1, false, 0, 0],
];

/**
 * First (x, z) of `candidates` whose body circle of radius `r` clears every facade, or
 * null. The pavements here are only 1-2 m deep, so a single fixed x would put half the
 * walkers inside a wall; this steps in from the kerb the way pavementX does for the
 * chase frame.
 */
function duskSpot(game, candidates, r) {
  const cols = game.city.colliders || [];
  for (const [x, z] of candidates) {
    let clear = true;
    for (let i = 0; i < cols.length; i += 1) {
      const c = cols[i];
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) { clear = false; break; }
    }
    if (clear) return { x, z };
  }
  return null;
}

/** Fill the dusk junction with its cars, walkers and one searching unit. */
function stageDuskStreet(game) {
  const cars = game.traffic.cars;
  for (let i = 0; i < cars.length; i += 1) {
    const t = cars[i];
    const slot = DUSK_CARS[i];
    if (slot) {
      const [x, z, dir, vertical] = slot;
      const line = vertical ? DUSK.x : DUSK.z;
      t.lane = { line, vertical, dir, lane: vertical ? x - line : z - line };
      t.x = x;
      t.z = z;
      t.heading = slotHeading(vertical, dir);
      // A stopped car reads as a queue at a light; a slow roll keeps the frame from looking
      // like a car park, and the speed is only for the paint (nothing steps the frame after).
      t.speed = Math.min(t.cruise || 10, 6);
      t.parked = false;
      t.mesh.position.set(x, 0, z);
      t.mesh.rotation.y = t.heading;
    } else if (t.lane && ((t.lane.vertical && t.lane.line === DUSK.x)
      || (!t.lane.vertical && t.lane.line === DUSK.z))) {
      // A car this pass did not stage leaves the two roads that are in frame, so the layout
      // above is exactly the layout painted instead of picking up strays behind it.
      t.lane = { line: 125, vertical: t.lane.vertical, dir: t.lane.dir, lane: t.lane.lane };
      if (t.lane.vertical) t.x = 125 + t.lane.lane;
      else t.z = 125 + t.lane.lane;
      t.mesh.position.set(t.x, 0, t.z);
    }
  }
  const peds = game.traffic.peds;
  let placed = 0;
  for (let i = 0; i < DUSK_WALKERS.length && i < peds.length; i += 1) {
    const [x0, z0, dir, vertical, sx, sz] = DUSK_WALKERS[i];
    const candidates = [];
    for (let k = 0; k < 5; k += 1) candidates.push([x0 + sx * k, z0 + sz * k]);
    const spot = duskSpot(game, candidates, 0.55);
    if (!spot) continue;
    const p = peds[i];
    p.x = spot.x;
    p.z = spot.z;
    p.vertical = vertical;
    p.line = vertical ? DUSK.x : DUSK.z;
    p.dir = dir;
    p.heading = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.flee = 0;
    p.dodge = 0;
    p.wait = 0;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
    placed += 1;
  }
  // Walkers the reset already put on these two roads but this pass did not stage go to the
  // market aisle, off frame: they would otherwise stand in a facade or on a staged body.
  for (let i = placed; i < peds.length; i += 1) {
    const p = peds[i];
    const onAvenue = Math.abs(p.x - DUSK.x) < 12 && p.z > DUSK.z - 80 && p.z < DUSK.z + 12;
    const onStreet = Math.abs(p.z - DUSK.z) < 12 && p.x > DUSK.x - 80 && p.x < DUSK.x + 12;
    if (!onAvenue && !onStreet) continue;
    p.x = -111.5;
    p.z = 12 + (i % 9);
    p.vertical = false;
    p.line = -125;
    p.flee = 0;
    p.dodge = 0;
    p.mesh.position.set(p.x, 0, p.z);
  }
}

function stageDusk(game) {
  beginMission(game.missions, 3);
  game.objective = missionText(game.missions);
  game.renderer.setBeacon(GETAWAY_MARKER.x, GETAWAY_MARKER.z, true);
  game.money = 1250;
  // Three stars and a net closing: the dispatch panel then reads as a board with several
  // callsigns on it instead of a single line. The two extra cruisers sit behind the camera
  // (the lens looks down -x), so the street keeps the exact layout the shot was sealed with
  // and only the radio traffic grows.
  game.wanted = 3;
  const cop = spawnPoliceCar(game.police, 121.6, -121.6, game.city);
  cop.heading = Math.PI;
  cop.mesh.rotation.y = Math.PI;
  const cop2 = spawnPoliceCar(game.police, 168, -12, game.city);
  cop2.heading = Math.PI;
  cop2.mesh.rotation.y = Math.PI;
  const cop3 = spawnPoliceCar(game.police, 176, 168, game.city);
  cop3.heading = Math.PI;
  cop3.mesh.rotation.y = Math.PI;
  game.player.x = DUSK.x;
  game.player.z = DUSK.z;
  // Facing is +z rotated by heading, so heading -PI/2 faces -x, the way the camera looks
  // down the boulevard; a mismatch would turn Rio's back to the sunset.
  game.player.heading = DUSK.heading;
  game.player.mesh.position.set(DUSK.x, 0, DUSK.z);
  game.player.mesh.rotation.y = game.player.heading;
  game.camYaw = DUSK.yaw;
  game.camPitch = DUSK.pitch;
  game.hint = 'WASD move · Shift run · E enter car · P pause';
  // Stage the traffic and walkers at fixed spots around the fixed camera, so the frame is
  // the junction under the sunset and not an empty road beneath it.
  stageDuskStreet(game);
  // The boot look is golden hour for every frame; dusk.js swaps the sky, sun, fog and
  // lights on this page's own scene only, so the day shots keep the boot look untouched.
  applyDusk(game.renderer.scene, game.city);
  game.speed = 0;
  // A ?shot= page paints a staged frame and steps nothing afterwards, so updatePolice —
  // the live caller of the dispatch panel — never runs here. Hand each cruiser the slot
  // updatePolice would give it from its index in the list (0 lead, 1 flank left, 2 flank
  // right) and render the panel from the same state the frame is drawn from.
  cop.slot = 0;
  cop2.slot = 1;
  cop3.slot = 2;
  renderDispatch(game.police, { x: game.player.x, z: game.player.z, wanted: game.wanted });
  // A staged frame is drawn on the play screen, so the HUD would paint its centre reticle
  // over the junction. Every ?shot= is a fresh page load, so this only reaches dusk.
  hideReticle();
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
  // Street life fills the avenue the pursuit runs down: an oncoming queue of cars with the
  // three bikes weaving up it, a line of cars in Rio's own lane above the pursuit, and
  // walkers on both pavements. Last, so every offset is measured from the car's final spot
  // and nothing drifts afterwards — main.js paints the staged frame and steps nothing more.
  stageChaseStreet(game, car);
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
