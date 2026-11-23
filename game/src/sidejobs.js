// Side jobs: taxi fares and the parcel route. Self-contained — its own state, its own
// handful of meshes, its own money handling through the ctx hooks main.js passes in.
// Never imports main.js; main.js loads this module with a guarded dynamic import, so
// every export here has to survive being called with a partially built state.
import * as THREE from 'three';
import { CITY } from './config.js';

// Sixteen parcel spots, one on the KERB CORNER of each of sixteen intersections
// (7 m diagonally in from the crossing, toward the city centre), so a player on
// foot can always reach them — and so a parcel never sits on a driving lane.
// The old list put every spot dead on the intersection centreline: the chase
// route up the -125 road ran straight over (-125,-25), and the 1 m parcel ended
// up 3.3 m behind the player car, filling the chase camera as a huge cardboard
// box "on" the car. A kerb corner is clear of every lane and of every building
// (lots reach at most 8 m from a road centreline; the parcel's swept corner
// reaches 7.7 m), and the pickup is still a short walk from the road.
export const PARCEL_SPOTS = [
  { x: -118, z: 68 }, { x: -68, z: 118 }, { x: 18, z: 118 }, { x: 118, z: 68 },
  { x: 118, z: -68 }, { x: 68, z: -118 }, { x: -18, z: -118 }, { x: -118, z: -68 },
  { x: -68, z: 68 }, { x: 68, z: 68 }, { x: 68, z: -18 }, { x: -18, z: 68 },
  { x: 18, z: 18 }, { x: -18, z: -18 }, { x: 118, z: 18 }, { x: -118, z: -18 },
];

// Fares: base cash plus distance, and a clock that is generous but real.
const FARE_BASE = 25;
const FARE_PER_M = 0.55;
const FARE_MIN_DIST = 55;   // a fare that pays must be worth driving
const PICKUP_MIN = 26;      // the waiter is never on top of the player
const PICKUP_MAX = 78;
const BOARD_DIST = 7;       // a car must actually stop at the kerb
const DROP_DIST = 8;
const CLOCK_PER_M = 1 / 6.5;
const CLOCK_SLACK = 24;

function span(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Every kerb point on the grid, 6.6 m off a road centreline (clear of the lanes). */
function kerbSpots() {
  const out = [];
  for (const line of CITY.roadLines) {
    for (const along of CITY.roadLines) {
      out.push({ x: line + 6.6, z: along });
      out.push({ x: line - 6.6, z: along });
    }
  }
  return out;
}

const KERBS = kerbSpots();

function pickKerb(x, z, lo, hi, salt) {
  // Nearest kerb inside the [lo, hi] band from (x, z). `salt` rotates the search so
  // repeated fares do not all land on the same corner.
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < KERBS.length; i += 1) {
    const k = KERBS[(i + salt) % KERBS.length];
    const d = span(x, z, k.x, k.z);
    if (d < lo || d > hi) continue;
    if (d < bestScore) { bestScore = d; best = k; }
  }
  if (!best) {
    // Fall back to the closest kerb at any distance: a fare is always offerable.
    for (const k of KERBS) {
      const d = span(x, z, k.x, k.z);
      if (d < bestScore) { bestScore = d; best = k; }
    }
  }
  return best ? { x: best.x, z: best.z } : { x: x + 30, z };
}

function fareFor(a, b) {
  return Math.round(FARE_BASE + span(a.x, a.z, b.x, b.z) * FARE_PER_M);
}

function clockFor(a, b) {
  return span(a.x, a.z, b.x, b.z) * CLOCK_PER_M + CLOCK_SLACK;
}

/** A slim amber post with a pin: visible from across a block, two draws. */
function makeMarker() {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.9, 26, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  beam.position.y = 13;
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd94d }),
  );
  pin.position.y = 2.6;
  pin.rotation.x = Math.PI;
  group.add(beam, pin);
  group.visible = false;
  group.frustumCulled = false;
  group.userData.pin = pin;
  group.userData.beam = beam;
  return group;
}

/** The waiting passenger: the renderer's own person mesh when it has one. */
function makePassenger(renderer) {
  const mesh = renderer && typeof renderer.makePerson === 'function'
    ? renderer.makePerson(0xf39c12, 1)
    : new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.5, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf39c12 }),
    );
  mesh.visible = false;
  return mesh;
}

function ensureMeshes(s) {
  if (s.built) return;
  const renderer = s.renderer;
  if (!renderer || !renderer.scene) return;
  s.pickupMarker = makeMarker();
  s.dropMarker = makeMarker();
  s.passenger = makePassenger(renderer);
  renderer.scene.add(s.pickupMarker, s.dropMarker, s.passenger);
  s.built = true;
}

export function createSidejobs(renderer) {
  return {
    renderer,
    built: false,
    pickupMarker: null,
    dropMarker: null,
    passenger: null,
    taxi: null,
    // Running totals: never cleared by resetSidejobs.
    fares: 0,
    failed: 0,
    earned: 0,
    offered: 0,
    message: '',
  };
}

function clearFare(s) {
  s.taxi = null;
  if (s.pickupMarker) s.pickupMarker.visible = false;
  if (s.dropMarker) s.dropMarker.visible = false;
  if (s.passenger) s.passenger.visible = false;
}

export function resetSidejobs(s) {
  if (!s) return;
  clearFare(s);
  s.message = '';
}

/**
 * Begin a fare near (x, z). No-op (returns false) when one is already running, so
 * main.js can call it from a key press without checking first.
 */
export function startTaxi(s, x, z) {
  if (!s) return false;
  if (s.taxi) return false;
  ensureMeshes(s);
  if (!s.built) return false;
  const salt = (s.offered * 7) % KERBS.length;
  const pickup = pickKerb(x, z, PICKUP_MIN, PICKUP_MAX, salt);
  const drop = pickKerb(pickup.x, pickup.z, FARE_MIN_DIST, CITY.bound * 1.6, salt + 11);
  s.offered += 1;
  s.taxi = {
    phase: 'wait',
    pickup,
    drop,
    fare: fareFor(pickup, drop),
    timeLeft: clockFor(pickup, drop),
    clock: clockFor(pickup, drop),
    boarded: false,
    t: 0,
  };
  s.passenger.position.set(pickup.x, 0, pickup.z);
  s.passenger.visible = true;
  s.pickupMarker.position.set(pickup.x, 0, pickup.z);
  s.pickupMarker.visible = true;
  s.dropMarker.visible = false;
  s.message = `Fare waiting at the kerb — $${s.taxi.fare} to the drop-off.`;
  return true;
}

function arrive(s, ctx) {
  const fare = s.taxi.fare;
  s.fares += 1;
  s.earned += fare;
  if (typeof ctx.addMoney === 'function') ctx.addMoney(fare);
  if (typeof ctx.onMsg === 'function') ctx.onMsg(`Fare paid: $${fare}. ${s.fares} run${s.fares === 1 ? '' : 's'} tonight.`);
  s.message = `Fare paid: $${fare}.`;
  clearFare(s);
}

function failFare(s, ctx, why) {
  s.failed += 1;
  if (typeof ctx.onMsg === 'function') ctx.onMsg(why);
  s.message = why;
  clearFare(s);
}

/**
 * One step of the side jobs. `ctx`: { x, z, driving, money, addMoney(n), random,
 * city, onMsg(text) }. Everything is optional; a call with an empty ctx is harmless.
 */
export function updateSidejobs(s, ctx, dt) {
  if (!s) return;
  const c = ctx || {};
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
  if (!s.taxi) return;
  const t = s.taxi;
  t.t += step;

  if (s.passenger && s.passenger.visible) {
    s.passenger.rotation.y += step * 0.6;
  }
  if (s.pickupMarker && s.pickupMarker.visible) {
    s.pickupMarker.userData.pin.position.y = 2.6 + Math.sin(t.t * 2.2) * 0.28;
  }
  if (s.dropMarker && s.dropMarker.visible) {
    s.dropMarker.userData.pin.position.y = 2.6 + Math.sin(t.t * 2.2) * 0.28;
  }

  if (t.phase === 'wait') {
    // The passenger only boards a car: driving up on foot does nothing.
    if (c.driving && span(c.x, c.z, t.pickup.x, t.pickup.z) < BOARD_DIST) {
      t.phase = 'drop';
      t.boarded = true;
      t.t = 0;
      t.timeLeft = t.clock;
      if (s.passenger) s.passenger.visible = false;
      if (s.pickupMarker) s.pickupMarker.visible = false;
      if (s.dropMarker) {
        s.dropMarker.position.set(t.drop.x, 0, t.drop.z);
        s.dropMarker.visible = true;
      }
      if (typeof c.onMsg === 'function') c.onMsg(`Passenger aboard. Drop-off ${Math.round(span(t.drop.x, t.drop.z, c.x, c.z))} m away — $${t.fare}.`);
    }
    return;
  }

  if (t.phase === 'drop') {
    t.timeLeft -= step;
    if (span(c.x, c.z, t.drop.x, t.drop.z) < DROP_DIST) {
      arrive(s, c);
      return;
    }
    if (t.timeLeft <= 0) {
      failFare(s, c, `Fare lost — the clock ran out. No pay, no tip.`);
    }
  }
}

/** Plain data for the HUD (no meshes, no functions). */
export function sidejobsHud(s) {
  if (!s || !s.taxi) {
    return { taxiActive: false, taxiFare: 0, taxiLabel: '' };
  }
  const t = s.taxi;
  if (t.phase === 'drop') {
    const secs = Math.max(0, Math.ceil(t.timeLeft));
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    return {
      taxiActive: true,
      taxiFare: t.fare,
      taxiLabel: `Fare $${t.fare} · ${clock}`,
    };
  }
  return {
    taxiActive: true,
    taxiFare: t.fare,
    taxiLabel: `Passenger waiting · $${t.fare}`,
  };
}
