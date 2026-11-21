// The city alive: NPC cars driving the road network and pedestrians on the sidewalks.
// Traffic cars run one road line each, in a lane, and wrap around the city edge — and
// queue behind the car ahead on a shared lane, so they never overlap at intersections.
// Pedestrians walk a sidewalk line, turn around at the edge, step aside when Rio gets
// close, and flee when shot at or clipped. A traffic car that hits Rio hurts him
// (handled by main.js).
//
// v5 (W-D): the road grid is actually signalised. Every one of the 36 crossings gets a
// phase offset drawn from the passed-in seeded `random`, so neighbouring intersections do
// not blink in unison and a given seed always paints the same frame. A car looks ahead to
// the next crossing on its own lane, and if the signal for its axis is red (or amber and it
// can still stop) it brakes on the v = sqrt(2·b·d) profile until it halts with its nose on
// the stop line. Accel/brake are rate-limited so starts and stops read as driving, not as
// speed snapping between 0 and cruise. The queue-behind-leader rule still runs first, so a
// car stopped at a red IS the leader the car behind it settles behind — one mechanism, no
// separate jam. Pedestrians likewise wait at a kerb while the road they are about to cross
// has a green, and panic spreads: a ped that starts fleeing screams and nearby walkers join.
//
// Signal heads come from renderer.makeTrafficLight (owner W-A) and are called defensively:
// with the factory absent the whole signal LOGIC still runs, only the lamps are missing.
import * as THREE from 'three';
import { CITY, PALETTE, PEDESTRIANS, TRAFFIC_CARS } from './config.js';
import { createCar } from './vehicles.js';
import { sfx } from './audio.js';

// --- local tuning (config.js belongs to W-A, so these live here) ---------------------
const LINES = CITY.roadLines;
const N = LINES.length;                 // 6 road lines per axis
const NL = N * N;                       // 36 crossings
const ROAD_HALF = CITY.roadWidth / 2;   // 7 m: the kerb, and where the stop line sits
const CAR_HALF = 2.2;                   // half a car: the nose, not the origin, meets the line
const STOP_BACK = ROAD_HALF + CAR_HALF + 0.2; // 9.4 m from the crossing centre

// One phase cycle per intersection. Vertical green, vertical amber, all-red, then the same
// for horizontal. 20 s total; the longest single red a car can meet is 11 s.
const GREEN = 7;
const AMBER = 2;
const ALL_RED = 1;
const HALF_CYCLE = GREEN + AMBER + ALL_RED;   // 10
const CYCLE = HALF_CYCLE * 2;                 // 20

const ACCEL = 4.5;   // m/s^2, how fast a stopped car picks up speed again
const BRAKE = 7;     // m/s^2, used for the stop-line profile
const JAM_GUARD = 14; // s stationary at a light before the logic gives up and lets it go

// Which crossings actually get a visible head. Draw calls are the bottleneck in this
// build, so 36 x 2 heads (144 draws) is out of the question: these are the four centre
// crossings plus the two the drive/chase shots look at down the west road.
const HEAD_SPOTS = [
  [-25, -25], [25, -25], [-25, 25], [25, 25],
  [-125, -75], [-125, -25],
];

// 'per'    = the shipped scheme: per-intersection offset, stop-line lookahead, rate limits.
// 'global' = the measured alternative: one global phase, hard stop inside 6 m. Kept only
//            for the A/B numbers in the report; 'per' is what ships (see report).
const SIG_MODE = 'per';

// --- small helpers -------------------------------------------------------------------
const RI = Object.create(null);
for (let i = 0; i < N; i += 1) RI[LINES[i]] = i;

/** Index of the next road line strictly ahead of `along` when travelling `dir`; -1 at the edge. */
function nextLineIndex(along, dir) {
  if (dir > 0) {
    for (let i = 0; i < N; i += 1) if (LINES[i] > along) return i;
    return -1;
  }
  for (let i = N - 1; i >= 0; i -= 1) if (LINES[i] < along) return i;
  return -1;
}

/** 0 green, 1 amber, 2 red for an axis whose green window starts at `start`. */
function phaseState(phase, start) {
  let p = phase - start;
  if (p < 0) p += CYCLE;
  if (p < GREEN) return 0;
  if (p < GREEN + AMBER) return 1;
  return 2;
}

const STATE_NAME = ['green', 'amber', 'red'];

function pickLane(random) {
  const li = Math.floor(random() * N);
  const line = LINES[li];
  return {
    line, vertical: random() < 0.5, dir: random() < 0.5 ? -1 : 1,
    lane: random() < 0.5 ? -3.4 : 3.4,
  };
}

/** Minimum centre-to-centre spacing when parking a fresh car on a lane. A car is 4.2 m
 *  long, so anything under that overlaps it into the one ahead. 22 cars over the same
 *  spawn window put two of them 3.6 m apart in one lane: the queue rule then holds both
 *  of them still (it only ever slows a car, never reverses one), so they sat interpenetrated
 *  until the light changed. Rejection sampling here fixes the cause instead of the symptom.
 *  It consumes the same seeded stream, so a given seed still builds the same city. */
const SPAWN_GAP = 9;

/** True when (x, z) would sit on top of a car already placed in the SAME lane. Cars in
 *  different lanes are 6.8 m apart and can never touch, so only lane-mates matter. */
function tooCloseToLaneMate(cars, lane, x, z) {
  for (let i = 0; i < cars.length; i += 1) {
    const c = cars[i];
    if (!c.lane) continue;
    if (c.lane.line !== lane.line) continue;
    if (c.lane.vertical !== lane.vertical) continue;
    if (c.lane.dir !== lane.dir) continue;
    if (c.lane.lane !== lane.lane) continue;
    const along = lane.vertical ? z : x;
    const other = lane.vertical ? c.z : c.x;
    if (Math.abs(other - along) < SPAWN_GAP) return true;
  }
  return false;
}

// --- signal heads (visual only) ------------------------------------------------------
/** Corner check: is (x, z) clear of every building footprint? Called once at boot. */
function clearOfBuildings(city, x, z, margin) {
  const cols = city && city.colliders;
  if (!cols) return true;
  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i];
    if (x > c.minX - margin && x < c.maxX + margin && z > c.minZ - margin && z < c.maxZ + margin) return false;
  }
  return true;
}

const POST_OFF = 8.8;   // pole distance from both centrelines: 1.8 m outside the kerb
const ARM_LEN = 1.0;    // short arm from the pole toward the crossing
const HEAD_UP = 4.78;   // centre of the lamp housing; its top clears the arm at 5.62

/**
 * Two heads per signalised crossing, each on a corner POLE with a short arm and the head
 * hanging 1 m in from the pole — so nothing floats: pole meets the pavement, arm meets the
 * head. Pole and arm are one instanced mesh each (2 draws for every post in the city); the
 * heads are the factory's 2 draws apiece and exist only at HEAD_SPOTS. Nothing here touches
 * the signal logic: remove the factory and the cars still stop.
 */
function buildSignalHeads(renderer, city, lights) {
  if (!renderer || !renderer.scene) return 0;
  const posts = [];
  const heads = [];
  for (const spot of HEAD_SPOTS) {
    const li = RI[spot[0]];
    const lj = RI[spot[1]];
    if (li === undefined || lj === undefined) continue;
    const rec = lights[li * N + lj];
    const ix = spot[0];
    const iz = spot[1];
    // A head serves ONE approach and sits on the FAR side of the box for it, so a car
    // stopped at the line has the lamp in front of it: v head east of the crossing with its
    // lens facing -z (seen by a car travelling +z), h head east/north with the lens facing -x.
    const wants = [
      { sx: 1, sz: 1, ax: 0, az: -1, yaw: Math.PI, slot: 'headV' },
      { sx: 1, sz: -1, ax: -1, az: 0, yaw: -Math.PI / 2, slot: 'headH' },
    ];
    for (const w of wants) {
      // Closer to the kerb is safer: buildings live deeper inside the block, so if the
      // 1.8 m setback is occupied we step toward the road, never into the facade.
      for (const off of [POST_OFF, POST_OFF - 0.6, POST_OFF - 1.1]) {
        const px = ix + w.sx * off;
        const pz = iz + w.sz * off;
        if (!clearOfBuildings(city, px, pz, 0.9)) continue;
        const hx = px + w.ax * ARM_LEN;
        const hz = pz + w.az * ARM_LEN;
        posts.push({ x: px, z: pz, ax: w.ax, az: w.az });
        heads.push({ rec, slot: w.slot, x: hx, z: hz, yaw: w.yaw });
        break;
      }
    }
  }
  if (!posts.length) return 0;

  const postMat = new THREE.MeshLambertMaterial({ color: 0x39424a });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.0, 6);
  const armGeo = new THREE.BoxGeometry(ARM_LEN + 0.2, 0.09, 0.09);
  const poles = new THREE.InstancedMesh(poleGeo, postMat, posts.length);
  const arms = new THREE.InstancedMesh(armGeo, postMat, posts.length);
  poles.castShadow = true;
  poles.frustumCulled = false;
  arms.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < posts.length; i += 1) {
    const p = posts[i];
    // Pole: centred at 3.0 so its base sits at y = 0, its top at 6.0.
    q.identity();
    pos.set(p.x, 3.0, p.z);
    m.compose(pos, q, one);
    poles.setMatrixAt(i, m);
    // Arm: from the pole top out to (and a little past) the head centre.
    q.setFromAxisAngle(Y, p.ax !== 0 ? Math.PI / 2 : 0);
    pos.set(p.x + (p.ax * ARM_LEN) / 2, 5.62, p.z + (p.az * ARM_LEN) / 2);
    m.compose(pos, q, one);
    arms.setMatrixAt(i, m);
  }
  poles.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  renderer.scene.add(poles, arms);

  let built = 0;
  const factory = renderer.makeTrafficLight ? renderer.makeTrafficLight.bind(renderer) : null;
  if (factory) {
    for (let i = 0; i < heads.length; i += 1) {
      const h = heads[i];
      let node = null;
      try {
        node = factory();
      } catch {
        node = null;
      }
      if (!node) break;
      node.position.set(h.x, HEAD_UP, h.z);
      node.rotation.y = h.yaw;
      // A head is small; keeping it out of the sun's shadow pass saves a draw per head for
      // a shadow nobody can read from the street.
      if (node.userData && node.userData.housing) node.userData.housing.castShadow = false;
      renderer.scene.add(node);
      h.rec[h.slot] = node;
      built += 1;
    }
  }
  return built;
}

/** Push a state (0..2) into a head, but only when it changed. Guarded for a missing factory. */
function setHead(node, state) {
  if (!node) return;
  const name = STATE_NAME[state];
  if (node.userData && node.userData.signal === name) return;
  if (node.setSignal) node.setSignal(name);
  else if (node.userData && node.userData.setSignal) node.userData.setSignal(name);
}

// --- creation ------------------------------------------------------------------------
export function createTraffic(city, random, renderer) {
  const lights = [];
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      lights.push({
        x: LINES[i], z: LINES[j],
        offset: random() * CYCLE,   // seeded: neighbouring crossings are out of step
        vState: 0, hState: 2,
        headV: null, headH: null,
      });
    }
  }
  const cars = [];
  for (let i = 0; i < TRAFFIC_CARS; i += 1) {
    let lane = pickLane(random);
    let along = (random() * 2 - 1) * 120;
    // Retry the placement (not the lane pick alone) so a fresh car never lands on top of
    // one already parked in the same lane. Bounded, so a pathological seed still terminates.
    for (let tries = 0; tries < 12; tries += 1) {
      const px = lane.vertical ? carX(lane) : along;
      const pz = lane.vertical ? along : carX(lane);
      if (!tooCloseToLaneMate(cars, lane, px, pz)) break;
      lane = pickLane(random);
      along = (random() * 2 - 1) * 120;
    }
    // Colour is still drawn for every car, including cabs: the cab paints itself yellow
    // in the mesh, so skipping the roll here would shift the seeded stream and move every
    // later car, ped and lamp in the city.
    const color = PALETTE.carColors[Math.floor(random() * PALETTE.carColors.length)];
    const typeRoll = random();
    const type = typeRoll < 0.13 ? 'sports' : typeRoll < 0.23 ? 'van' : typeRoll < 0.33 ? 'pickup'
      : typeRoll < 0.47 ? 'taxi' : 'sedan';
    const car = createCar(
      renderer,
      lane.vertical ? carX(lane) : along,
      lane.vertical ? along : carX(lane),
      lane.vertical ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      color,
      type,
    );
    car.parked = false;
    car.lane = lane;
    car.cruise = 8 + random() * 6;
    car.pause = 0;   // a shot car sits still for a few seconds
    car.want = 0;    // target speed for this frame
    car.still = 0;   // seconds spent stationary, for the jam guard and the diagnostics
    car.hold = false; // stopped by a red this frame
    cars.push(car);
  }
  const peds = [];
  for (let i = 0; i < PEDESTRIANS; i += 1) {
    const li = Math.floor(random() * N);
    const line = LINES[li];
    const vertical = random() < 0.5;
    const side = random() < 0.5 ? -9.5 : 9.5;
    const along = (random() * 2 - 1) * 120;
    const style = i % 3 === 0 ? 1 : 0;
    const mesh = renderer.makePerson(PALETTE.pedColors[Math.floor(random() * PALETTE.pedColors.length)], style);
    renderer.scene.add(mesh);
    peds.push({
      x: vertical ? line + side : along, z: vertical ? along : line + side,
      line, vertical, dir: random() < 0.5 ? -1 : 1, speed: 1 + random() * 0.8,
      heading: 0, phase: random() * 6, mesh,
      flee: 0, fleeX: 0, fleeZ: 0, dodge: 0,
      wasFleeing: false, // panic edge detector: the transition is what spreads it
      wait: 0,           // seconds held at a kerb
    });
  }
  const traffic = {
    cars, peds, lights, time: 0,
    // signalised: crossings with a working signal state machine (the logic, always on).
    // heads: visible lamp heads actually built (a subset, for draw-call budget).
    signalised: NL, heads: 0,
    screamAt: -99,
    diag: { moving: 0, stoppedRed: 0, stoppedQueue: 0, stoppedOther: 0, avgSpeed: 0, stuck: 0, maxStill: 0, panic: 0 },
  };
  traffic.heads = buildSignalHeads(renderer, city, lights);
  return traffic;
}

function carX(lane) { return lane.line + lane.lane; }

export function resetTraffic(traffic, random) {
  traffic.time = 0;
  for (const car of traffic.cars) {
    const lane = pickLane(random);
    const along = (random() * 2 - 1) * 120;
    car.lane = lane;
    car.cruise = 8 + random() * 6;
    car.x = lane.vertical ? carX(lane) : along;
    car.z = lane.vertical ? along : carX(lane);
    car.heading = lane.vertical ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.pause = 0;
    car.want = 0;
    car.speed = 0;
    car.still = 0;
    car.hold = false;
  }
  for (const p of traffic.peds) {
    const li = Math.floor(random() * N);
    const line = LINES[li];
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
    p.wasFleeing = false;
    p.wait = 0;
  }
}

// --- per-frame scratch (no allocation in the hot loop) -------------------------------
const GROUPS = [];
for (let i = 0; i < 48; i += 1) GROUPS.push([]);
const LOOSE = []; // cars whose lane does not map to a bucket: processed on their own
const _sig = { d: 0, state: 2 };
const _sortCmp = (a, b) => {
  const av = a.lane.vertical ? a.z : a.x;
  const bv = b.lane.vertical ? b.z : b.x;
  return (bv - av) * a.lane.dir;
};

function bucketOf(lane) {
  const li = RI[lane.line];
  if (li === undefined) return -1;
  return (lane.vertical ? N * 2 : 0) + li * 4 + (lane.dir > 0 ? 2 : 0) + (lane.lane > 0 ? 1 : 0);
}

/**
 * Distance from `car` to the stop line of the next crossing on its lane, and that crossing's
 * signal for the car's axis. Writes into the shared _sig object: { d, state }.
 * Returns false when there is no crossing ahead (city edge) or the car is already in it.
 */
function approachSignal(traffic, car) {
  const { line, vertical, dir } = car.lane;
  const own = RI[line];
  if (own === undefined) return false;
  const along = vertical ? car.z : car.x;
  const cross = nextLineIndex(along, dir);
  if (cross < 0) return false;
  const rec = traffic.lights[vertical ? own * N + cross : cross * N + own];
  const d = (LINES[cross] - dir * STOP_BACK - along) * dir;
  if (d < 0) return false;                 // committed: past the line, never stop in the box
  _sig.d = d;
  _sig.state = vertical ? rec.vState : rec.hState;
  return true;
}

/** Refresh every crossing's two axis states for this frame, then the lamps. */
function refreshSignals(traffic) {
  const t = traffic.time;
  for (let i = 0; i < NL; i += 1) {
    const rec = traffic.lights[i];
    const phase = SIG_MODE === 'global' ? t % CYCLE : (t + rec.offset) % CYCLE;
    const v = phaseState(phase, 0);
    const h = phaseState(phase, HALF_CYCLE);
    if (rec.vState !== v) {
      rec.vState = v;
      setHead(rec.headV, v);
    }
    if (rec.hState !== h) {
      rec.hState = h;
      setHead(rec.headH, h);
    }
  }
}

// Panic: one ped starting to flee makes the walkers around it run too.
const PANIC_RADIUS = 9;
const PANIC_RADIUS2 = PANIC_RADIUS * PANIC_RADIUS;

function spreadPanic(traffic, src) {
  // A single scream per wave: sfx() swallows unknown names, and W-F may add 'scream'.
  if (traffic.time - traffic.screamAt > 0.35) {
    traffic.screamAt = traffic.time;
    try {
      sfx('scream');
    } catch {
      // Audio is optional and must never break traffic.
    }
  }
  for (const q of traffic.peds) {
    if (q === src || q.flee > 0) continue;
    const dx = q.x - src.x;
    const dz = q.z - src.z;
    if (dx * dx + dz * dz > PANIC_RADIUS2) continue;
    q.flee = 4.5;
    q.fleeX = dx || (q.vertical ? 0 : q.dir);
    q.fleeZ = dz || (q.vertical ? q.dir : 0);
  }
}

/** Walk one lane's bucket, front car first, so a follower sees the leader's settled target. */
function planBucket(traffic, g) {
  if (!g.length) return;
  if (g.length > 1) g.sort(_sortCmp);
  let leader = null;
  for (let k = 0; k < g.length; k += 1) {
    const car = g[k];
    let want = car.pause > 0 ? 0 : car.cruise;
    let why = car.pause > 0 ? 'other' : 'move';
    if (leader) {
      const along = car.lane.vertical ? car.z : car.x;
      const leadAlong = leader.lane.vertical ? leader.z : leader.x;
      const gap = (leadAlong - along) * car.lane.dir - 4.2; // bumper to bumper
      if (gap < 1) { want = 0; why = 'queue'; }
      else if (gap < 8) {
        const pace = leader.want * (gap / 8);
        if (pace < want) { want = pace; why = 'queue'; }
      }
    }
    // The signal, decided on its own: it only ever slows a car, and the flag lets the
    // diagnostics tell "held by its own red" apart from "stuck behind someone else".
    let red = false;
    if (approachSignal(traffic, car)) {
      const d = _sig.d;
      const state = _sig.state;
      if (SIG_MODE === 'global') {
        // Approach B: binary hold inside 6 m of the line, no approach profile.
        if (state !== 0 && d < 6) { red = true; want = 0; }
      } else if (state === 1) {
        // Amber: stop if there is still room to pull up comfortably; if the car is already
        // too close, going through is the safer read (and it never halts inside the box).
        if (d + 0.6 >= (car.speed * car.speed) / (2 * BRAKE)) {
          red = true;
          const lim = stopLimit(d);
          if (lim < want) want = lim;
        }
      } else if (state === 2) {
        red = true;
        const lim = stopLimit(d);
        if (lim < want) want = lim;
      }
      // state 0 (green) is a plain go.
    }
    car.redHold = red;
    car.want = want;
    car.why = red ? (want < 0.05 ? 'red' : 'brake') : why;
    leader = car;
  }
}

/** Braking-curve speed cap for a red light `d` metres ahead; 0 once inside the cushion. */
function stopLimit(d) {
  const gap = d - 0.5;
  if (gap <= 0) return 0;
  const lim = Math.sqrt(2 * BRAKE * gap);
  return lim < 0.45 ? 0 : lim;
}

/**
 * `playerPos` ({x, z} or null) lets pedestrians step aside from Rio. Traffic cars
 * queue: on a shared lane, a car never closes within 5 m of the car ahead — it
 * slows to the leader's pace, so cars stop overlapping at intersections. On top of
 * that, a car that is approaching a red (or an amber it can still stop for) brakes
 * on the stop-line profile, and because it is processed front-first it becomes the
 * leader the queue behind it settles behind.
 */
export function updateTraffic(traffic, dt, playerPos = null) {
  traffic.time += dt;
  refreshSignals(traffic);

  const diag = traffic.diag;
  diag.moving = 0;
  diag.stoppedRed = 0;
  diag.stoppedQueue = 0;
  diag.stoppedOther = 0;
  diag.avgSpeed = 0;
  diag.stuck = 0;
  diag.maxStill = 0;
  diag.panic = 0;

  // Bucket the cars by lane (a fixed pool of arrays: no per-frame allocation), then walk
  // each bucket front to back so a follower sees the leader's settled target this frame.
  for (let b = 0; b < GROUPS.length; b += 1) {
    const g = GROUPS[b];
    if (g.length) g.length = 0;
  }
  LOOSE.length = 0;
  for (const car of traffic.cars) {
    const b = bucketOf(car.lane);
    if (b >= 0) GROUPS[b].push(car);
    else LOOSE.push(car);
  }
  for (let b = 0; b < GROUPS.length; b += 1) planBucket(traffic, GROUPS[b]);
  // A car whose lane is not on the grid (a shot restages one onto a made-up lane) still
  // gets its own light check, just with no queue behind it.
  for (let k = 0; k < LOOSE.length; k += 1) planBucket(traffic, LOOSE);

  for (const car of traffic.cars) {
    if (car.pause > 0) car.pause -= dt;
    // Jam guard, applied after the plan: nothing may stand at a light forever. A car that
    // has been stationary past the guard creeps through and clears the box for the others.
    if (car.still > JAM_GUARD && car.why !== 'queue') {
      car.want = car.cruise * 0.6;
      car.why = 'move';
    }
    // Rate-limit toward the target: smooth pull-away, smooth stop, never a speed snap.
    const dv = car.want - car.speed;
    const lim = (dv > 0 ? ACCEL : BRAKE) * dt;
    car.speed += Math.max(-lim, Math.min(lim, dv));
    if (car.speed < 0.06 && car.want < 0.06) car.speed = 0;
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
    // Diagnostics: what is this car doing, and for how long has it not moved?
    if (car.speed < 0.15) {
      car.still += dt;
      if (car.why === 'red' || car.why === 'brake') diag.stoppedRed += 1;
      else if (car.why === 'queue') diag.stoppedQueue += 1;
      else diag.stoppedOther += 1;
      if (car.still > diag.maxStill) diag.maxStill = car.still;
      if (car.still > 15) diag.stuck += 1;
    } else {
      car.still = 0;
      diag.moving += 1;
    }
    diag.avgSpeed += car.speed;
  }
  diag.avgSpeed = traffic.cars.length ? diag.avgSpeed / traffic.cars.length : 0;

  for (const p of traffic.peds) {
    // Fleeing (shot at, shoved, clipped by a car): run straight away, fast. The transition
    // into flight is the panic edge — it screams once and drags the neighbours along.
    if (p.flee > 0) {
      if (!p.wasFleeing) {
        p.wasFleeing = true;
        spreadPanic(traffic, p);
      }
      diag.panic += 1;
      p.flee -= dt;
      const d = Math.hypot(p.fleeX, p.fleeZ) || 1;
      p.x += (p.fleeX / d) * 6 * dt;
      p.z += (p.fleeZ / d) * 6 * dt;
      p.x = Math.max(-128, Math.min(128, p.x));
      p.z = Math.max(-128, Math.min(128, p.z));
      p.heading = Math.atan2(p.fleeX, p.fleeZ);
      p.phase += dt * 12;
    } else {
      p.wasFleeing = false;
      // A kerb is a kerb: wait while the road being crossed has a green.
      if (!pedWait(traffic, p, dt)) {
        p.wait = 0;
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
      }
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
    if (p.flee > 0) {
      // Arms up, elbows flapping: the silhouette of a scream rather than a stroll.
      u.legL.rotation.x = swing * 1.6;
      u.legR.rotation.x = -swing * 1.6;
      u.armL.rotation.x = -2.5 + swing * 0.35;
      u.armR.rotation.x = -2.5 - swing * 0.35;
    } else {
      const held = p.wait > 0;
      const sw = held ? 0 : swing;
      u.legL.rotation.x = sw;
      u.legR.rotation.x = -sw;
      u.armL.rotation.x = -sw * 0.8;
      u.armR.rotation.x = sw * 0.8;
    }
    // Dodge offset is perpendicular to the walk direction.
    const ox = p.vertical ? p.dodge : 0;
    const oz = p.vertical ? 0 : p.dodge;
    p.mesh.position.set(p.x + ox, 0, p.z + oz);
    p.mesh.rotation.y = p.heading;
  }
}

/**
 * Hold a ped at the kerb while the road it is about to walk over still has a green.
 * A ped on a vertical road's sidewalk crosses the horizontal roads, so it waits on that
 * crossing's horizontal phase. Cheap (one array read) and it gives up after 10 s.
 */
function pedWait(traffic, p, dt) {
  if (p.wait > 10) return false;
  const along = p.vertical ? p.z : p.x;
  const cross = nextLineIndex(along, p.dir);
  if (cross < 0) return false;
  const d = (LINES[cross] - p.dir * (ROAD_HALF + 0.9) - along) * p.dir;
  if (d < 0 || d > 3.2) return false;         // already crossing, or not there yet
  const li = RI[p.line];
  if (li === undefined) return false;
  const rec = traffic.lights[li * N + cross];
  const state = p.vertical ? rec.hState : rec.vState;
  if (state !== 0) return false;              // the road it crosses is already stopped
  p.wait += dt;
  return true;
}
