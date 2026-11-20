// Boot and the one loop: Solmar, Rio Vega, Ana Deluca's job chain, wanted stars and
// police (with the air unit), pistol/SMG/shotgun combat, side jobs, saves and settings.
// The world advances in fixed 1/60 s steps; the renderer paints what is there.
// Screens: title, play, paused (with settings + stats), game over.
// ?seed=N fixes the city; ?shot=start|drive|foot|chase|shoot (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady.
// ?perf=adaptive (default) | off (never touch quality) | 0|1|2 (pin a quality level).
//
// PARALLEL SAFETY: this file is the integration point and every v5 module is being
// written at the same time, so nothing here statically imports a symbol that did not
// exist at v4. combat/vehicles/audio are namespace imports called defensively, and the
// brand-new ./sidejobs.js is a guarded dynamic import with a null fallback.
import { CRIME, CRIME_COOLDOWN, MISSION_MARKER, RESPAWN_PENALTY, SAFEHOUSE, SAVE_KEY, START_MONEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity, dist2 } from './world.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import {
  ACTION_CONFIRM, ACTION_ENTER, ACTION_FIRE, ACTION_MUTE, ACTION_PAUSE,
  ACTION_PUNCH, ACTION_RELOAD, ACTION_SWITCH, ACTION_TAXI, createInput,
} from './input.js';
import { createPlayer, playerRecoil, setPlayerWeapon, updatePlayer } from './player.js';
import * as vehicles from './vehicles.js';
import { createTraffic, resetTraffic, updateTraffic } from './traffic.js';
import { createPolice, clearPolice, updatePolice } from './police.js';
import {
  MISSIONS, allMissionsDone, beginMission, createMissions, currentMission,
  missionTarget, missionText,
} from './missions.js';
import * as combat from './combat.js';
import { readSave, writeSave } from './save.js';
import { createHud } from './hud.js';
import * as audio from './audio.js';
import { stageShot } from './shots.js';

// v4 names, aliased once so the call sites below stay plain functions.
const {
  createCar, driveCar, nearestCar,
} = vehicles;
const {
  createCombat, clearHostiles, firePistol, punch, resetCombat, spawnHostiles, startReload, updateCombat,
} = combat;
const {
  ensureAudio, setEngine, setSiren, sfx, toggleMute,
} = audio;

const MAX_FRAME = 0.25;
const SPAWN = { x: -25, z: -18 };
// Parcels when sidejobs.js did not load: v4's eight corners, on the kerb corner of
// each intersection like PARCEL_SPOTS (never the centreline — a centreline parcel
// reads as a box on the car behind it) and as {x, z} objects, which is what
// ensurePackages reads. The old array form gave spot.x === undefined.
const FALLBACK_PARCELS = [
  { x: -118, z: 68 }, { x: -68, z: 118 }, { x: 18, z: 118 }, { x: 118, z: 68 },
  { x: 118, z: -68 }, { x: 68, z: -118 }, { x: -18, z: -118 }, { x: -118, z: -68 },
];
const WEAPON_IDS = ['pistol', 'smg', 'shotgun'];
const SETTINGS_KEY = 'solmar.settings.v1';
const DEFAULT_SETTINGS = { volume: 0.6, shadows: true, mouseSensitivity: 1 };
// Frame-rate safeguard: below LOW_FPS the quality ladder steps down; the levels are
// high (sun shadow map) -> medium (shadows off) -> low (shadows off, short draw distance).
const LOW_FPS = 30;
const CRITICAL_FPS = 14;
const HIGH_FPS = 56;
// W-I: the in-game controls hint dismisses itself this many game-seconds after it
// appears (start, or entering/exiting a car), so the first-30-seconds guidance never
// becomes permanent clutter. Game time, not wall clock: it survives slow frames.
const HINT_SECONDS = 8;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
// ?perf=adaptive (default) | off (never touch quality) | 0|1|2 (pin a quality level)
const perfParam = params.get('perf');
const perfMode = perfParam === 'off' || perfParam === 'adaptive' || perfParam === null
  ? (perfParam || 'adaptive')
  : 'pinned';
const perfLevel = Number.parseInt(perfParam ?? '', 10);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

// The one brand-new module: dynamic, guarded, and null if it is mid-write or absent.
let side = null;
try {
  side = await import('./sidejobs.js');
} catch {
  side = null;
}

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = buildGame();

function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        if (Number.isFinite(saved.volume)) out.volume = Math.max(0, Math.min(1, saved.volume));
        if (typeof saved.shadows === 'boolean') out.shadows = saved.shadows;
        if (Number.isFinite(saved.mouseSensitivity)) {
          out.mouseSensitivity = Math.max(0.2, Math.min(3, saved.mouseSensitivity));
        }
      }
    }
  } catch {
    // Storage off or a broken blob: the defaults are the v4 feel.
  }
  return out;
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      volume: settings.volume,
      shadows: settings.shadows,
      mouseSensitivity: settings.mouseSensitivity,
    }));
  } catch {
    // Private window: the settings last this visit only.
  }
}

function buildGame() {
  const random = createRandom(seed);
  const city = createCity(random);
  const renderer = createRenderer(canvas, city);
  const input = createInput(canvas);
  const hud = createHud();
  const player = createPlayer(renderer, SPAWN.x, SPAWN.z);
  const cars = city.parkedSpots.map((s, i) => {
    const type = i % 3 === 0 ? 'sports' : i % 3 === 1 ? 'van' : 'pickup';
    const colors = [0xff5a36, 0x218c91, 0xe0b146, 0x405f93];
    return createCar(renderer, s.x, s.z, s.heading, i === 0 ? 0xff5a36 : (colors[i % colors.length] || s.color), type);
  });
  const traffic = createTraffic(city, random, renderer);
  const police = createPolice(renderer);
  const fight = createCombat(renderer);
  const missions = createMissions();
  const settings = loadSettings();
  const g = {
    city, renderer, input, hud, player, cars, traffic, police, combat: fight, missions,
    screen: SCREEN_TITLE, driving: null, money: START_MONEY, health: 100,
    wanted: 0, camYaw: 0, camPitch: 0.35,
    objective: '', hint: '', time: 0, saveTimer: 0, speed: 0,
    crimeAt: {}, banner: '', bannerUntil: 0, busted: false, stolen: [],
    // v5 hit feedback: a short damped camera shake and the flash timer the HUD's
    // #vignette element plays. Both are presentation only — no gameplay state.
    shake: 0, shakeAmp: 0,
    // W-I: game-time deadline for the controls hint (0 = no hint showing that can
    // expire), and the game-time clock the current mission started on, so the
    // mission summary can report its elapsed time.
    hintUntil: 0, missionStartedAt: 0,
    packages: [], packagePool: [], packageCount: 0, packageFound: new Set(), packageMessage: '',
    settings, quality: 2, qualityLabel: 'high',
    stats: { played: 0, crimes: 0, shots: 0, hits: 0 },
    sidejobs: null,
    // Reused HUD buffers: hudState() runs every frame and must not allocate.
    hudCars: [], hudPolice: [], hudPickups: [], hudWeapons: [], hudWeaponPool: [],
    hudStats: { played: 0, crimes: 0, fares: 0, parcels: 0, shots: 0, hits: 0 },
    hudTaxi: { active: false, label: '' },
  };
  // Side jobs: optional module, optional state. Null means the game simply has none.
  g.sidejobs = side && typeof side.createSidejobs === 'function' ? side.createSidejobs(renderer) : null;
  g.input.setSensitivity(settings.mouseSensitivity);
  resetGame(g, false);
  applySettings(g, settings, true);
  return g;
}

/** Shrink (or restore) the sun shadow map without disabling shadows. This was the
 *  measured alternative to the ladder below: it keeps the look but reallocates the
 *  depth target, which costs draws, tris and fill all at once. Only reachable through
 *  `?perf=sm` so the experiment stays reproducible. */
function setShadowMapSize(g, size) {
  const sun = g.renderer.sun;
  if (!sun || !sun.shadow) return;
  const n = Math.max(256, Math.min(2048, size | 0));
  if (sun.shadow.mapSize.x === n) return;
  sun.shadow.mapSize.set(n, n);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}

/** 0 = low, 1 = medium, 2 = high. Never touches gameplay state, only presentation.
 *  MEASURED (see report): the shadow map is ~72% of the draw calls and ~53% of the
 *  triangles, so it is the only lever that pays. Level 0 additionally pulls the fog
 *  and camera far plane in as a last resort; that step measured no gain over level 1
 *  (same draws, same tris), so it is only reached when the frame rate is desperate. */
function setQuality(g, level) {
  const lv = Math.max(0, Math.min(2, level | 0));
  g.quality = lv;
  const shadows = lv >= 2 && g.settings.shadows !== false;
  const sun = g.renderer.sun;
  if (sun) {
    sun.castShadow = shadows;
    if (!shadows && sun.shadow && sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  // The WebGLRenderer lives inside render.js; if a future renderer exposes a
  // resolution knob use it, otherwise the shadows/fog ladder is the whole story.
  if (typeof g.renderer.setQuality === 'function') g.renderer.setQuality(lv);
  const camera = g.renderer.camera;
  if (camera) {
    const far = lv === 0 ? 900 : 1200;
    if (camera.far !== far) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }
  const fog = g.renderer.scene.fog;
  if (fog) fog.far = lv === 0 ? 420 : 460;
  g.qualityLabel = lv >= 2 ? 'high' : lv === 1 ? 'medium' : 'low';
  if (g.hud.showSettings) g.hud.showSettings({ ...g.settings, qualityLabel: g.qualityLabel });
}

/** Apply a settings object live: audio, mouse, and the quality ladder. */
function applySettings(g, settings, initial) {
  g.settings = settings;
  g.input.setSensitivity(settings.mouseSensitivity);
  if (audio.audioSettings) audio.audioSettings({ volume: settings.volume, music: true });
  if (!initial) {
    // A user who turns shadows off keeps them off: the watchdog may step further
    // down but never back up past the user's ceiling.
    if (!settings.shadows) setQuality(g, Math.min(g.quality, 1));
    else setQuality(g, 2);
  }
  if (g.hud.showSettings) g.hud.showSettings({ ...settings, qualityLabel: g.qualityLabel });
}

function ensurePackages(g) {
  // Pool the parcel meshes: a reset reuses them instead of building 16 new groups
  // (16 geometries and materials per reset in v4). `renderer.makePackage` is the
  // only allocation, and only the first time a spot appears.
  const spots = side && Array.isArray(side.PARCEL_SPOTS) && side.PARCEL_SPOTS.length
    ? side.PARCEL_SPOTS
    : FALLBACK_PARCELS;
  if (g.packages.length) {
    for (const item of g.packages) {
      if (item.mesh && item.mesh.parent) item.mesh.parent.remove(item.mesh);
    }
  }
  g.packages = spots.map((spot, i) => {
    let mesh = g.packagePool[i];
    if (!mesh) {
      mesh = g.renderer.makePackage();
      g.packagePool[i] = mesh;
    }
    mesh.position.set(spot.x, 0.55, spot.z);
    mesh.rotation.y = 0;
    mesh.visible = true;
    g.renderer.scene.add(mesh);
    return { x: spot.x, z: spot.z, mesh, active: true, index: i };
  });
}

function resetGame(g, fresh) {
  const random = createRandom(seed);
  g.random = random;
  g.player.x = SPAWN.x;
  g.player.z = SPAWN.z;
  g.player.heading = Math.PI;
  g.player.vx = 0;
  g.player.vz = 0;
  g.player.invulnerable = 0;
  g.player.mesh.visible = true;
  g.player.mesh.position.set(SPAWN.x, 0, SPAWN.z);
  g.player.mesh.rotation.y = Math.PI;
  // Stolen traffic cars go back to traffic before the parked cars are reset.
  for (const car of g.stolen) {
    const i = g.cars.indexOf(car);
    if (i >= 0) g.cars.splice(i, 1);
    g.traffic.cars.push(car);
  }
  g.stolen.length = 0;
  g.cars.forEach((car, i) => {
    const s = g.city.parkedSpots[i];
    car.x = s.x;
    car.z = s.z;
    car.heading = s.heading;
    car.speed = 0;
    car.parked = true;
    car.mesh.position.set(s.x, 0, s.z);
    car.mesh.rotation.y = s.heading;
  });
  // W-I: one car always waits near the spawn. The seeded parked spots land 25–92
  // units from (-25,-18) on every seed 1–12 (median ~50: a 6 s run before Rio can
  // drive at all), so the first 30 seconds were on foot by luck of the seed.
  // cars[0] is re-parked on the east kerb of the -25 road, 21 units south of
  // spawn — a 2–3 s run — clear of the -25 junction (its footprint ends 6 units
  // south of the junction mouth). Deterministic: same car, same spot, every
  // reset. Staged drive/chase shots reposition cars[0] themselves, so this never
  // moves their hero car.
  const nearCar = g.cars[0];
  if (nearCar) {
    nearCar.x = -19.6;
    nearCar.z = -38;
    nearCar.heading = Math.PI;
    nearCar.speed = 0;
    nearCar.parked = true;
    nearCar.mesh.position.set(-19.6, 0, -38);
    nearCar.mesh.rotation.y = Math.PI;
  }
  resetTraffic(g.traffic, random);
  clearPolice(g.police);
  resetCombat(g.combat);
  if (fresh) Object.assign(g.missions, createMissions());
  g.driving = null;
  g.money = START_MONEY;
  g.health = 100;
  g.wanted = 0;
  g.crimeAt = {};
  g.banner = '';
  g.bannerUntil = 0;
  g.busted = false;
  g.camYaw = 0;
  g.camPitch = 0.35;
  g.shake = 0;
  g.shakeAmp = 0;
  g.time = 0;
  g.missionStartedAt = 0;
  g.saveTimer = 0;
  g.speed = 0;
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  ensurePackages(g);
  g.packageCount = 0;
  g.packageFound = new Set();
  if (g.sidejobs && side && side.resetSidejobs) side.resetSidejobs(g.sidejobs);
  g.objective = missionText(g.missions);
  g.hint = 'WASD move · Shift run · E enter car · P pause';
}

function saveState(g) {
  const state = {
    money: g.money, health: g.health, x: g.player.x, z: g.player.z,
    missionIndex: g.missions.index, missionsDone: [...g.missions.done],
    missionStage: g.missions.stage, ammoMag: g.combat.mag, ammoReserve: g.combat.reserve,
    packageCount: g.packageCount,
    packageFound: [...g.packageFound],
    // v5 extras. save.js (W-D) persists any key it is given; an older save.js
    // simply ignores them and the game is exactly v4.
    parcelsFound: [...g.packageFound],
    stats: { played: g.stats.played, crimes: g.stats.crimes, shots: g.stats.shots, hits: g.stats.hits },
    fares: g.sidejobs ? g.sidejobs.fares : 0,
    sideJobs: g.sidejobs ? {
      fares: g.sidejobs.fares, failed: g.sidejobs.failed,
      earned: g.sidejobs.earned, offered: g.sidejobs.offered,
    } : null,
    weapons: weaponSlots(g).map((w) => ({ id: w.id, mag: w.mag, reserve: w.reserve })),
    weaponId: (combat.weaponInfo && combat.weaponInfo(g.combat) || {}).id || g.combat.weapon || 'pistol',
  };
  return state;
}

function applySave(g, save) {
  if (!save) return;
  g.money = Number.isFinite(save.money) ? save.money : g.money;
  g.health = Number.isFinite(save.health) ? save.health : g.health;
  if (Number.isFinite(save.x) && Number.isFinite(save.z)) {
    g.player.x = save.x;
    g.player.z = save.z;
    g.player.mesh.position.set(save.x, 0, save.z);
  }
  g.missions.index = Math.min(save.missionIndex || 0, MISSIONS.length);
  g.missions.done = (save.missionsDone || Array(MISSIONS.length).fill(false)).slice(0, MISSIONS.length);
  while (g.missions.done.length < MISSIONS.length) g.missions.done.push(false);
  g.missions.stage = save.missionStage || 'go';
  g.missions.hostilesDown = 0;
  const def = currentMission(g.missions);
  g.missions.timer = def && def.timed ? def.timed : 0;
  g.combat.mag = save.ammoMag ?? 12;
  g.combat.reserve = save.ammoReserve ?? 24;
  // v5 weapon state, only when combat.js actually keeps per-weapon magazines.
  if (Array.isArray(save.weapons) && g.combat.weapons) {
    for (const w of save.weapons) {
      if (!w || !w.id) continue;
      const slot = g.combat.weapons[w.id];
      if (slot) {
        if (Number.isFinite(w.mag)) slot.mag = w.mag;
        if (Number.isFinite(w.reserve)) slot.reserve = w.reserve;
      }
    }
    if (combat.switchWeapon) combat.switchWeapon(g.combat, save.weaponId || 'pistol');
  }
  const found = Array.isArray(save.packageFound) ? save.packageFound
    : Array.isArray(save.parcelsFound) ? save.parcelsFound : [];
  g.packageFound = new Set(found.filter((i) => Number.isInteger(i) && i >= 0 && i < g.packages.length));
  g.packageCount = g.packageFound.size;
  g.packages.forEach((item) => {
    item.active = !g.packageFound.has(item.index);
    item.mesh.visible = item.active;
  });
  if (save.stats && typeof save.stats === 'object') {
    if (Number.isFinite(save.stats.played)) g.stats.played = save.stats.played;
    if (Number.isFinite(save.stats.crimes)) g.stats.crimes = save.stats.crimes;
    if (Number.isFinite(save.stats.shots)) g.stats.shots = save.stats.shots;
    if (Number.isFinite(save.stats.hits)) g.stats.hits = save.stats.hits;
  }
  if (g.sidejobs) {
    const sj = save.sideJobs && typeof save.sideJobs === 'object' ? save.sideJobs : null;
    const fares = sj && Number.isFinite(sj.fares) ? sj.fares : Number.isFinite(save.fares) ? save.fares : 0;
    g.sidejobs.fares = fares;
    if (sj) {
      if (Number.isFinite(sj.failed)) g.sidejobs.failed = sj.failed;
      if (Number.isFinite(sj.earned)) g.sidejobs.earned = sj.earned;
      if (Number.isFinite(sj.offered)) g.sidejobs.offered = sj.offered;
    }
  }
  // Chase missions resume hot; a saved defend stage resumes with fresh rivals.
  if (g.missions.index === 2 || g.missions.index === 3) g.wanted = 2;
  if (g.missions.index === 4 && g.missions.stage === 'defend') {
    spawnHostiles(g.combat, -125, 25, 3);
  }
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  g.objective = missionText(g.missions);
  // A loaded mission has no recorded start: its summary time counts from the load.
  g.missionStartedAt = g.time;
}

// SAVE_KEY is read-only here: the v5 extras (stats, fares, sidejob totals, weapon
// magazines) are merged into the same record after writeSave(), because save.js
// (W-D) still writes only the v4 key set. Merging, not rewriting, means the moment
// W-D lands the v5 save these writes become no-ops on identical values. readSave()
// already returns the whole parsed record, so loading needs no sidecar at all.
const SAVE_EXTRA_KEYS = ['parcelsFound', 'stats', 'fares', 'sideJobs', 'weapons', 'weaponId'];

function persist(g) {
  const state = saveState(g);
  writeSave(state);
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const record = JSON.parse(raw);
    let changed = false;
    for (const key of SAVE_EXTRA_KEYS) {
      if (state[key] === undefined || state[key] === null) continue;
      if (JSON.stringify(record[key]) === JSON.stringify(state[key])) continue;
      record[key] = state[key];
      changed = true;
    }
    if (changed) window.localStorage.setItem(SAVE_KEY, JSON.stringify(record));
  } catch {
    // Storage off (private window): the save lasts this visit, as before.
  }
}

function announce(message) {
  status.textContent = message;
}

function showBanner(g, text) {
  g.banner = text;
  g.bannerUntil = g.time + 3.5;
}

// --- v5 hit feedback ---------------------------------------------------------------
// On any damage, a short damped camera shake plus a red edge flash. The HUD already
// owns a damage vignette (hud.js, driven by state.damage), but that wash fades with
// health, so it is invisible at full health — exactly when the first shot lands. The
// flash is therefore a transient layer that is only alive for ~0.3 s and never reads
// health; it adds no second damage number and nothing gameplay-facing.
const SHAKE_TIME = 0.26;
const SHAKE_AMP = 0.5;
let flashEl = null;
let flashStyle = false;

function ensureHitFlash() {
  if (flashEl) return flashEl;
  try {
    if (!flashStyle) {
      flashStyle = true;
      const style = document.createElement('style');
      style.textContent = [
        '#hitflash{position:fixed;inset:0;pointer-events:none;opacity:0;',
        'background:radial-gradient(ellipse at center,rgba(255,60,40,0) 38%,',
        'rgba(214,24,18,.34) 74%,rgba(150,0,0,.78) 100%);}',
        '#hitflash.on{animation:hitflash .3s ease-out 1;}',
        '@keyframes hitflash{0%{opacity:1}45%{opacity:.62}100%{opacity:0}}',
      ].join('');
      document.head.appendChild(style);
    }
    flashEl = document.createElement('div');
    flashEl.id = 'hitflash';
    // Inserted BELOW the HUD in paint order so the flash washes the world, never the
    // money/health panels — the same layering the HUD's own vignette uses.
    const hud = document.getElementById('hud');
    if (hud && hud.parentNode === document.body) document.body.insertBefore(flashEl, hud);
    else document.body.appendChild(flashEl);
  } catch {
    flashEl = null; // no DOM: the shake still plays, the flash just never shows
  }
  return flashEl;
}

/** Brief shake + red flash. `scale` 0..1 keeps a light scrape lighter than a hit. */
function hitFeedback(g, scale = 1) {
  const s = Math.max(0.15, Math.min(1, scale));
  g.shake = SHAKE_TIME * (0.6 + s * 0.4);
  g.shakeAmp = SHAKE_AMP * s;
  const el = ensureHitFlash();
  if (el) {
    // Restart the CSS animation: the class has to come off for one frame.
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(Math.round(18 * s)); } catch { /* not available */ }
  }
}

// --- mission summary ---------------------------------------------------------------
// A small, non-blocking panel after each completed job: what was just done, what it
// paid, and what comes next. Auto-dismisses, and any key or click dismisses it early.
// It is pointer-events:none, so it can never eat input or block play.
let summaryEl = null;
let summaryHideAt = 0;
let summaryStyle = false;
const SUMMARY_MS = 5000;

function ensureSummaryPanel() {
  if (summaryEl) return summaryEl;
  try {
    if (!summaryStyle) {
      summaryStyle = true;
      const style = document.createElement('style');
      style.textContent = [
        '#m-summary{position:fixed;top:112px;left:50%;transform:translate(-50%,-8px);',
        'min-width:280px;max-width:80vw;padding:14px 22px;border-radius:10px;',
        'background:rgba(8,14,22,.82);border:1px solid rgba(255,201,60,.45);',
        'border-left:4px solid #ffc93c;color:#eef1f5;text-align:left;',
        'font:600 14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;',
        'text-shadow:0 1px 3px rgba(0,0,0,.75);pointer-events:none;z-index:4;',
        'opacity:0;transition:opacity .18s ease,transform .18s ease;}',
        '#m-summary.on{opacity:1;transform:translate(-50%,0);}',
        '#m-summary .m-kicker{font-size:11px;letter-spacing:.18em;color:#ffc93c;}',
        '#m-summary .m-name{font-size:19px;font-weight:700;margin:1px 0 6px;}',
        '#m-summary .m-row{font-size:13px;color:#b8c4d0;}',
        '#m-summary .m-row b{color:#7ce8a4;font-variant-numeric:tabular-nums;}',
        '#m-summary .m-next{margin-top:6px;font-size:13px;color:#ffd98a;}',
        '#m-summary .m-hint{margin-top:7px;font-size:10.5px;letter-spacing:.08em;color:#7d8a99;}',
        // W-I: the panel itself is pointer-events:none so it can never eat input
        // or block play — but the CONTINUE button re-enables hit-testing for
        // itself, so it is a real, clickable dismissal (in addition to any key,
        // any click anywhere, and the auto-dismiss). It only ever receives a
        // click when the pointer is not locked to the canvas.
        '#m-summary .m-continue{pointer-events:auto;display:block;margin:11px auto 0;',
        'padding:8px 24px;border:0;border-radius:7px;background:#ffc93c;color:#14181f;',
        'font:700 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.08em;',
        'text-shadow:none;cursor:pointer;}',
        '#m-summary .m-continue:hover{background:#ffd76a;}',
        '#m-summary .m-continue:focus-visible{outline:2px solid #fff;outline-offset:2px;}',
      ].join('');
      document.head.appendChild(style);
    }
    const box = document.createElement('div');
    box.id = 'm-summary';
    box.innerHTML = [
      '<div class="m-kicker">MISSION COMPLETE</div>',
      '<div class="m-name"></div>',
      '<div class="m-row">Reward <b class="m-reward"></b></div>',
      '<div class="m-row">Time <b class="m-time"></b></div>',
      '<div class="m-next"></div>',
      '<button type="button" class="m-continue">CONTINUE ▸</button>',
      '<div class="m-hint">ANY KEY / CLICK TO DISMISS</div>',
    ].join('');
    box.querySelector('.m-continue').addEventListener('click', () => dismissMissionSummary());
    document.body.appendChild(box);
    summaryEl = box;
  } catch {
    summaryEl = null;
  }
  return summaryEl;
}

/** Mission elapsed time as m:ss (0:07, 1:23). */
function fmtElapsed(sec) {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function showMissionSummary(g, name, reward, nextName, allDone, elapsedSec) {
  const el = ensureSummaryPanel();
  if (!el) return;
  el.querySelector('.m-name').textContent = name;
  el.querySelector('.m-reward').textContent = `+$${reward}`;
  el.querySelector('.m-time').textContent = fmtElapsed(elapsedSec);
  el.querySelector('.m-next').textContent = allDone
    ? 'All jobs done — Solmar is yours.'
    : `Next up: ${nextName}`;
  el.classList.add('on');
  // Wall-clock deadline so it dismisses on its own even while paused.
  summaryHideAt = performance.now() + SUMMARY_MS;
}

function dismissMissionSummary() {
  summaryHideAt = 0;
  if (!summaryEl) return;
  summaryEl.classList.remove('on');
}

/** Auto-dismiss tick: called once per frame, cheap when nothing is showing. */
function summaryTick() {
  if (!summaryHideAt) return;
  if (performance.now() >= summaryHideAt) dismissMissionSummary();
}

/** Weapon chips for the HUD: per-weapon magazines when combat.js has them, else the
 *  single v4 pistol line. Both the array AND the slot objects are pooled on `g` so the
 *  per-frame HUD build allocates nothing. */
function weaponSlots(g) {
  const c = g.combat;
  const info = combat.weaponInfo ? combat.weaponInfo(c) : null;
  const current = (info && info.id) || c.weapon || 'pistol';
  const out = g.hudWeapons;
  const pool = g.hudWeaponPool;
  out.length = 0;
  if (c.weapons && typeof c.weapons === 'object') {
    for (const id of WEAPON_IDS) {
      const w = c.weapons[id];
      if (!w) continue;
      let slot = pool[out.length];
      if (!slot) {
        slot = { id, name: '', mag: 0, reserve: 0, active: false };
        pool[out.length] = slot;
      }
      slot.id = id;
      slot.name = w.name || (info && info.id === id ? info.name : id);
      slot.mag = w.mag ?? 0;
      slot.reserve = w.reserve ?? 0;
      slot.active = id === current;
      out.push(slot);
    }
  }
  if (!out.length) {
    let slot = pool[0];
    if (!slot) {
      slot = { id: '', name: '', mag: 0, reserve: 0, active: true };
      pool[0] = slot;
    }
    slot.id = current;
    slot.name = (info && info.name) || 'Pistol';
    slot.mag = info ? info.mag : c.mag ?? 0;
    slot.reserve = info ? info.reserve : c.reserve ?? 0;
    slot.active = true;
    out.push(slot);
  }
  return out;
}

function hudState(g) {
  const cars = g.hudCars;
  cars.length = 0;
  for (const car of g.cars) cars.push(car);
  for (const car of g.traffic.cars) cars.push(car);
  const cops = g.hudPolice;
  cops.length = 0;
  for (const car of g.police.cars) cops.push(car);
  const pickups = g.hudPickups;
  pickups.length = 0;
  for (const p of g.combat.pickups) pickups.push(p);
  const heli = g.police.heli;
  const heliOn = !!(heli && heli.active);
  // Damage on the vignette: the car Rio is in, or Rio himself, whichever is worse.
  let damage = 100 - g.health;
  if (g.driving) {
    const health = vehicles.carHealth ? vehicles.carHealth(g.driving) : 100;
    damage = Math.max(damage, 100 - (Number.isFinite(health) ? health : 100));
  }
  const taxiInfo = g.sidejobs && side && side.sidejobsHud ? side.sidejobsHud(g.sidejobs) : null;
  // The stats and taxi sub-objects are pooled too: hudState() runs every frame, so a
  // fresh literal here would be two allocations per frame, forever.
  const stats = g.hudStats;
  stats.played = g.stats.played;
  stats.crimes = g.stats.crimes;
  stats.fares = g.sidejobs ? g.sidejobs.fares : 0;
  stats.parcels = g.packageCount;
  stats.shots = g.stats.shots;
  stats.hits = g.stats.hits;
  const taxi = g.hudTaxi;
  taxi.active = taxiInfo ? !!taxiInfo.taxiActive : false;
  taxi.label = (taxiInfo && taxiInfo.taxiLabel) || '';
  return {
    money: g.money, health: g.health, wanted: g.wanted,
    speed: g.speed, driving: g.driving !== null,
    objective: g.objective, hint: g.hint,
    banner: g.time < g.bannerUntil ? g.banner : '',
    ammoMag: g.combat.mag, ammoReserve: g.combat.reserve,
    reloading: g.combat.reloading > 0,
    player: g.player, cars, police: cops, pickups,
    missionTarget: missionTarget(g.missions),
    packages: g.packages,
    packageCount: g.packageCount,
    packageTotal: g.packages.length,
    weapons: weaponSlots(g),
    // The reticle only makes sense when a shot would actually go down the screen centre,
    // which is exactly the on-foot case: the reticle hides in a car (drive-by aims at the
    // nearest target, not at centre) and on the title/busted screens.
    armed: !g.driving && g.screen === SCREEN_PLAY,
    taxi,
    damage: Math.max(0, Math.min(100, damage)),
    heli: heliOn,
    heliOn,
    stats,
  };
}

/** Raise wanted, at most once per crime kind every few seconds so one wild minute
 *  does not jump straight to five stars. */
function addCrime(g, n, key, msg) {
  if (g.time - (g.crimeAt[key] || -99) < CRIME_COOLDOWN) return;
  g.crimeAt[key] = g.time;
  g.wanted = Math.min(5, g.wanted + n);
  g.police.hiddenTimer = 0;
  g.stats.crimes += 1;
  if (msg) announce(msg);
}

function completeMission(g, i) {
  const def = MISSIONS[i];
  const nextDef = MISSIONS[i + 1] || null;
  // W-I: elapsed time on this mission, from when it began (or from the load, for
  // a continued save) — the summary reports it, and the next mission's clock
  // starts now.
  const elapsed = Math.max(0, g.time - (g.missionStartedAt || 0));
  g.missions.done[i] = true;
  g.money += def.reward;
  showBanner(g, `MISSION COMPLETE — ${def.name} +$${def.reward}`);
  showMissionSummary(g, def.name, def.reward, nextDef ? nextDef.name : '', !nextDef, elapsed);
  sfx('jingle');
  persist(g);
  const next = i + 1;
  if (next >= MISSIONS.length) {
    g.missions.index = next;
    g.missions.stage = 'go';
    g.objective = missionText(g.missions);
    g.renderer.setBeacon(MISSION_MARKER.x, MISSION_MARKER.z, false);
    announce(def.doneLine);
    return;
  }
  const intro = beginMission(g.missions, next);
  g.missionStartedAt = g.time;
  if (next === 2 || next === 3) g.wanted = Math.max(g.wanted, 2);
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  g.objective = missionText(g.missions);
  announce(intro);
}

function enterExitCar(g) {
  if (g.driving) {
    const car = g.driving;
    g.driving = null;
    g.player.mesh.visible = true;
    g.player.x = car.x - Math.sin(car.heading) * 2.5;
    g.player.z = car.z - Math.cos(car.heading) * 2.5;
    g.player.vx = 0;
    g.player.vz = 0;
    g.player.heading = car.heading;
    g.hint = 'WASD move · Shift run · E enter car · P pause';
    g.hintUntil = g.time + HINT_SECONDS;
    announce('On foot.');
    return;
  }
  const parked = nearestCar(g.cars, g.player.x, g.player.z, 4.5);
  const moving = nearestCar(g.traffic.cars, g.player.x, g.player.z, 4.5);
  let car = null;
  let stolen = false;
  if (parked && moving) {
    const dp = dist2(g.player.x, g.player.z, parked.x, parked.z);
    const dm = dist2(g.player.x, g.player.z, moving.x, moving.z);
    car = dp <= dm ? parked : moving;
    stolen = car === moving;
  } else {
    car = parked || moving;
    stolen = car === moving;
  }
  if (!car) return;
  if (stolen) {
    // Taking an occupied car is a crime: the driver is out, the car is Rio's.
    const ti = g.traffic.cars.indexOf(car);
    if (ti >= 0) g.traffic.cars.splice(ti, 1);
    g.cars.push(car);
    g.stolen.push(car);
    car.parked = false;
    addCrime(g, CRIME.steal, 'steal', 'You stole a car! The cops are coming.');
  }
  g.driving = car;
  car.parked = false;
  g.player.mesh.visible = false;
  g.hint = 'WASD drive · Space handbrake · E exit car · P pause';
  g.hintUntil = g.time + HINT_SECONDS;
  announce(stolen ? 'Driving — stolen.' : 'Driving.');
}

/** Weapon switching: Digit1..3 pick a slot, Q cycles. Both guarded because combat.js
 *  may not have the v5 API yet. */
function switchWeaponSlot(g, which) {
  if (!combat.switchWeapon && !combat.cycleWeapon) return;
  if (which === 'cycle') {
    if (!combat.cycleWeapon) return;
    combat.cycleWeapon(g.combat);
  } else if (combat.switchWeapon) {
    combat.switchWeapon(g.combat, which);
  }
  const info = combat.weaponInfo ? combat.weaponInfo(g.combat) : null;
  if (info) {
    sfx('click');
    announce(`${info.name || info.id} — ${info.mag}/${info.reserve}`);
  }
}

function doFire(g) {
  if (g.screen !== SCREEN_PLAY) return;
  const sanctioned = g.missions.index === 4 && g.missions.stage === 'defend';
  // Accuracy is measured from observable state: rival hit points before and after,
  // and whether any bystander started fleeing (that is what a ped hit does).
  let rivalHp = 0;
  for (const h of g.combat.hostiles) if (!h.down) rivalHp += h.hp;
  let fleeing = 0;
  for (const p of g.traffic.peds) if (p.flee > 0) fleeing += 1;
  const result = firePistol(g.combat, {
    x: g.player.x, z: g.player.z, heading: g.player.heading,
    peds: g.traffic.peds, trafficCars: g.traffic.cars, sanctioned,
    // Drive-by is detected from the car itself, not from position coincidence:
    // pass the car Rio is sitting in so the muzzle is the driver's window.
    driving: g.driving, car: g.driving,
    time: g.time,
    onCrime: (n, key, msg) => addCrime(g, n, key, msg),
    onHostileDown: () => {
      g.missions.hostilesDown += 1;
      announce(`Rival down (${g.missions.hostilesDown}/3).`);
    },
  });
  const weaponId = combat.weaponInfo ? (combat.weaponInfo(g.combat) || {}).id : null;
  if (result === 'fired') {
    g.stats.shots += 1;
    // The shooting arm kicks on every shot; without this the pose never changes.
    playerRecoil(g.player);
    let rivalHpAfter = 0;
    for (const h of g.combat.hostiles) if (!h.down) rivalHpAfter += h.hp;
    let fleeingAfter = 0;
    for (const p of g.traffic.peds) if (p.flee > 0) fleeingAfter += 1;
    if (rivalHpAfter < rivalHp || fleeingAfter > fleeing) g.stats.hits += 1;
    sfx(weaponId && weaponId !== 'pistol' ? weaponId : 'gunshot');
  } else if (result === 'empty') announce('Out of ammo — find a green crate or press R.');
  else if (result === 'reloading') sfx('reload');
}

function doPunch(g) {
  if (g.screen !== SCREEN_PLAY || g.driving) return;
  const result = punch(g.combat, {
    x: g.player.x, z: g.player.z, heading: g.player.heading,
    peds: g.traffic.peds,
    onHostileDown: () => {
      g.missions.hostilesDown += 1;
      announce(`Rival down (${g.missions.hostilesDown}/3).`);
    },
  });
  if (result === 'hit') sfx('punch');
}

/** The taxi key: no-op (with the module's own message) if a fare is already running. */
function callTaxi(g) {
  if (!g.sidejobs || !side || !side.startTaxi) return;
  const started = side.startTaxi(g.sidejobs, g.player.x, g.player.z);
  if (started) {
    sfx('taxi');
    announce('Fare posted — the passenger is waiting at the amber kerb marker.');
  } else if (g.sidejobs.taxi) {
    announce(g.sidejobs.message || 'A fare is already running.');
  }
}

/** Busted or wasted: respawn at the safehouse, a small cash penalty, wanted cleared,
 *  missions and ammo kept. */
function respawnPlayer(g, reason) {
  const penalty = Math.min(g.money, RESPAWN_PENALTY);
  g.money -= penalty;
  g.health = 100;
  g.wanted = 0;
  clearPolice(g.police);
  clearHostiles(g.combat);
  // M4 "The Docks": dying mid-defend must not strand the mission. clearHostiles
  // just emptied the rivals while the stage stays 'defend' and hostilesDown stays
  // below 3, and nothing in play re-spawns them. The save-load path (applySave)
  // re-spawns 3 fresh rivals for a saved defend stage, so respawn does the same:
  // fresh rivals, count reset, mission completable again.
  if (g.missions.index === 4 && g.missions.stage === 'defend') {
    g.missions.hostilesDown = 0;
    spawnHostiles(g.combat, -125, 25, 3);
  }
  // M2 "Cool Off": the mission completes when wanted hits 0, and this respawn
  // just cleared wanted — getting caught would auto-complete the job. A respawn
  // mid-M2 restarts the job instead, with the same heat it starts with
  // (completeMission sets wanted 2 when M2 begins), so it must be lost again.
  if (g.missions.index === 2) {
    beginMission(g.missions, 2);
    g.wanted = 2;
    g.missionStartedAt = g.time;
  }
  g.driving = null;
  g.player.mesh.visible = true;
  g.player.x = SAFEHOUSE.x;
  g.player.z = SAFEHOUSE.z;
  g.player.vx = 0;
  g.player.vz = 0;
  g.player.invulnerable = 2;
  g.player.mesh.position.set(SAFEHOUSE.x, 0, SAFEHOUSE.z);
  g.banner = '';
  g.bannerUntil = 0;
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  g.objective = missionText(g.missions);
  persist(g);
  announce(reason === 'busted'
    ? `Busted. The cops walked you to the safehouse, -$${penalty}.`
    : `Wasted. Rio woke up at the safehouse, -$${penalty}.`);
}

function stepWorld(g, dt) {
  g.time += dt;
  const mouse = g.input.takeMouse();
  if (g.screen === SCREEN_TITLE) {
    updateTraffic(g.traffic, dt, g.player);
    return;
  }
  // W-I: the controls hint dismisses itself a few seconds into play. It is only
  // ever armed by startGame / enterExitCar, and time is frozen while paused, so
  // it can never vanish before the player has seen it.
  if (g.hint && g.hintUntil && g.time > g.hintUntil) g.hint = '';
  g.stats.played += dt;
  g.camYaw -= mouse.dx * 0.0032;
  g.camPitch = Math.max(0.08, Math.min(1.2, g.camPitch - mouse.dy * 0.0025));
  if (g.driving) {
    const car = g.driving;
    const drive = g.input.drive();
    const hitWall = driveCar(car, dt, drive, g.city);
    // Vehicle damage (v5): walls and traffic both cost the car, and the HUD reads
    // it back through carHealth(). Guarded — v4 vehicles.js has neither.
    if (hitWall && Math.abs(car.speed) > 10) vehicles.damageCar?.(car, 6);
    // Soft collision with traffic: shove the car out and kill speed, never pass through.
    for (const other of g.traffic.cars) {
      const dx = car.x - other.x;
      const dz = car.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d < 4 && d > 0.01) {
        car.x = other.x + (dx / d) * 4;
        car.z = other.z + (dz / d) * 4;
        if (Math.abs(car.speed) > 6) {
          addCrime(g, CRIME.hitCar, 'hitCar', 'You clipped a car!');
          vehicles.damageCar?.(car, Math.min(20, Math.abs(car.speed) * 0.6));
        }
        car.speed *= 0.5;
      }
    }
    // Running a pedestrian over is a crime: they flee, the cops hear about it.
    for (const p of g.traffic.peds) {
      if (dist2(car.x, car.z, p.x, p.z) < 6.8) {
        p.flee = 6;
        p.fleeX = p.x - car.x;
        p.fleeZ = p.z - car.z;
        addCrime(g, CRIME.hitPed, 'hitPed', 'You hit a pedestrian!');
        break;
      }
    }
    g.player.x = car.x;
    g.player.z = car.z;
    g.player.heading = car.heading;
    g.speed = car.speed;
    // Chase camera: swing behind the car.
    const want = car.heading + Math.PI;
    let d = want - g.camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.camYaw += d * Math.min(1, dt * 2.5);
    g.camPitch += (0.32 - g.camPitch) * Math.min(1, dt * 3);
  } else {
    const move = g.input.move();
    updatePlayer(g.player, dt, move, g.input.run(), g.camYaw, g.city);
    g.speed = Math.hypot(g.player.vx, g.player.vz);
    // A traffic car that clips Rio hurts him.
    if (g.player.invulnerable <= 0) {
      for (const car of g.traffic.cars) {
        if (dist2(g.player.x, g.player.z, car.x, car.z) < 4.8) {
          g.health -= 12;
          g.player.invulnerable = 1;
          hitFeedback(g, 0.8);
          const dx = g.player.x - car.x;
          const dz = g.player.z - car.z;
          const d = Math.hypot(dx, dz) || 1;
          g.player.x += (dx / d) * 2;
          g.player.z += (dz / d) * 2;
          announce(`Hit by a car. Health ${Math.max(0, Math.round(g.health))}.`);
          break;
        }
      }
    }
  }
  // Rio's visible weapon always matches the weapon combat is firing: the pose and
  // the instanced gun are driven by player.armed, and nothing ever set it — so the
  // gun on screen was always the pistol whatever the HUD said. Synced every frame
  // so crate auto-switches and save loads are covered too. Empty while driving:
  // the mesh is hidden in the cabin and the drive-by gun is combat's job.
  setPlayerWeapon(g.player, g.driving ? '' : g.combat.weapon);
  // Traffic first (it also drives the signals), then the side jobs that read the
  // player's position — the order the contract fixes.
  updateTraffic(g.traffic, dt, g.player);
  if (g.sidejobs && side && side.updateSidejobs) {
    side.updateSidejobs(g.sidejobs, {
      x: g.player.x, z: g.player.z, driving: g.driving !== null,
      money: g.money,
      addMoney: (n) => { g.money += n; },
      random: g.random, city: g.city,
      onMsg: (text) => { if (text) { announce(text); showBanner(g, text); } },
    }, dt);
  }
  updatePolice(g.police, {
    x: g.player.x, z: g.player.z, driving: g.driving !== null, speed: g.speed,
    wanted: g.wanted, city: g.city, random: g.random,
    setWanted: (n) => { g.wanted = Math.max(0, Math.min(5, n)); },
    onBusted: () => { g.busted = true; },
  }, dt);
  updateCombat(g.combat, {
    x: g.player.x, z: g.player.z, time: g.time,
    onPlayerHit: (dmg) => {
      if (g.player.invulnerable <= 0) {
        g.health -= dmg;
        g.player.invulnerable = 0.8;
        hitFeedback(g, 1);
        announce(`A rival landed a hit. Health ${Math.max(0, Math.round(g.health))}.`);
      }
    },
    onPickup: () => {
      sfx('pickup');
      announce('Ammo crate: +12 rounds.');
    },
  }, dt);
  // Missions.
  const m = g.missions;
  const def = currentMission(m);
  if (def) {
    if (def.target2 && m.timer > 0) m.timer -= dt;
    const target = missionTarget(m);
    const arrived = target && dist2(g.player.x, g.player.z, target.x, target.z) < 49;
    if (m.index === 0 && arrived) {
      completeMission(g, 0);
    } else if (m.index === 1 && m.stage === 'go' && arrived) {
      m.stage = 'deliver';
      sfx('pickup');
      const drop = missionTarget(m);
      g.renderer.setBeacon(drop.x, drop.z, true);
      g.objective = missionText(m);
      announce(def.pickupLine);
    } else if (m.index === 1 && m.stage === 'deliver' && arrived) {
      completeMission(g, 1);
    } else if (m.index === 2 && g.wanted === 0) {
      completeMission(g, 2);
    } else if (m.index === 3 && arrived) {
      completeMission(g, 3);
    } else if (m.index === 4 && m.stage === 'go' && arrived) {
      m.stage = 'defend';
      spawnHostiles(g.combat, -125, 25, 3);
      g.renderer.setBeacon(-125, 25, false);
      g.objective = missionText(m);
      announce(def.defendLine);
    } else if (m.index === 4 && m.stage === 'defend' && m.hostilesDown >= 3) {
      completeMission(g, 4);
    } else if (def.target2 && m.stage === 'go' && arrived) {
      m.stage = 'deliver';
      sfx('pickup');
      const drop = missionTarget(m);
      g.renderer.setBeacon(drop.x, drop.z, true);
      g.objective = missionText(m);
      announce(def.pickupLine);
    } else if (def.target2 && m.stage === 'deliver' && arrived) {
      completeMission(g, m.index);
    } else if (m.index !== 2 && m.index !== 4 && arrived) {
      completeMission(g, m.index);
    }
  }
  // Repeatable parcel pickups: the total is whatever PARCEL_SPOTS gave us (16 in v5),
  // never a hard-coded number.
  for (const item of g.packages) {
    if (!item.active) continue;
    item.mesh.rotation.y += dt * 0.9;
    if (dist2(g.player.x, g.player.z, item.x, item.z) < 2.4) {
      item.active = false;
      item.mesh.visible = false;
      g.packageFound.add(item.index);
      g.packageCount = g.packageFound.size;
      g.money += 25;
      showBanner(g, `HARBOR PARCEL ${g.packageCount}/${g.packages.length}  +$25`);
      sfx('pickup');
      persist(g);
    }
  }
  g.saveTimer += dt;
  if (g.saveTimer > 10) {
    g.saveTimer = 0;
    persist(g);
  }
}

function placeCamera(g) {
  if (g.screen === SCREEN_TITLE) {
    g.renderer.placeCamera({ x: 0, y: 0, z: 0 }, g.camYaw, 0.55, 150, 30);
    applyShake(g);
    return;
  }
  const target = g.driving
    ? { x: g.driving.x, y: 0, z: g.driving.z }
    : { x: g.player.x, y: 0, z: g.player.z };
  g.renderer.placeCamera(target, g.camYaw, g.camPitch, g.driving ? 8.4 : 7, g.driving ? 0.45 : 0);
  applyShake(g);
}

// Camera shake: a decaying offset in the camera's own ground plane, never enough to
// lose the frame (max ~0.5 world units for a quarter of a second). It runs off wall
// clock, not game time, so it can never freeze mid-shake while paused.
let shakeClock = 0;
function applyShake(g) {
  const now = performance.now();
  const dt = shakeClock ? Math.min(0.1, (now - shakeClock) / 1000) : 0;
  shakeClock = now;
  if (!(g.shake > 0)) {
    g.shake = 0;
    return;
  }
  g.shake = Math.max(0, g.shake - dt);
  const camera = g.renderer.camera;
  if (!camera) return;
  const k = g.shake / SHAKE_TIME;
  const amp = g.shakeAmp * k * k;
  if (amp < 0.002) return;
  const t = now * 0.001;
  // Two out-of-phase sines so the move reads as a jolt, not a drift.
  const side = Math.sin(t * 62) * amp;
  const up = Math.sin(t * 47 + 1.7) * amp * 0.55;
  const rx = Math.cos(g.camYaw);
  const rz = -Math.sin(g.camYaw);
  camera.position.x += rx * side;
  camera.position.z += rz * side;
  camera.position.y += up;
}

function runShot(name) {
  const scene = stageShot(game, name, resetGame);
  game.screen = scene.screen;
  game.hud.showScreen(scene.screen === SCREEN_TITLE ? 'title' : null);
  // Staged on-foot frames never run the play loop, so updatePlayer never ran and
  // Rio stood with his arms down and no gun — even in the shoot frame, where the
  // flash and tracer were already live. Step the pose to convergence (aim lerps
  // at dt*9, so ~40 steps) and bake one recoil kick in, so the frame shows the
  // raised two-handed grip and the weapon for the staged weapon. Driving frames
  // skip this: the player mesh is hidden in the cabin there.
  if (!game.driving) {
    // The staged weapon (SMG in the shoot frame) is the one to draw, not the
    // player's default pistol.
    setPlayerWeapon(game.player, game.combat.weapon);
    for (let i = 0; i < 40; i += 1) {
      updatePlayer(game.player, STEP, { f: 0, s: 0 }, false, game.camYaw, game.city);
    }
    // No recoil kick baked in for the shoot frame (WJ item 3): the kick pitches
    // the muzzle up ~24 deg, so the gun read as firing at the sky with the weapon
    // small near the head. The level aim already shows the raised two-handed grip
    // and the weapon; the live flash (0.18 s) and tracer prove the shot.
  }
  // The chase shot is already a real four-star pursuit with the air unit stepped onto
  // station by shots.js itself, so nothing further is staged here: stepping the police
  // again would only drift the interceptors off the frame the shot was built around.
  let painted = 0;
  function paint() {
    placeCamera(game);
    game.renderer.render();
    game.hud.update(hudState(game), game.city);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const save = readSave();
  const btnNew = document.getElementById('btn-new');
  const btnContinue = document.getElementById('btn-continue');
  const btnResume = document.getElementById('btn-resume');
  const btnRespawn = document.getElementById('btn-respawn');
  const overScreen = document.getElementById('screen-over');
  const overTitle = document.getElementById('over-title');
  const overText = document.getElementById('over-text');
  btnContinue.disabled = !save;
  game.hud.showScreen('title');
  if (game.hud.showSettings) game.hud.showSettings({ ...game.settings, qualityLabel: game.qualityLabel });
  if (game.hud.bindSettings) {
    game.hud.bindSettings({
      onChange: (patch) => {
        Object.assign(game.settings, patch);
        saveSettings(game.settings);
        applySettings(game, game.settings, false);
      },
    });
  }
  announce('Solmar. Rio Vega. Press Enter or click New Game to start.');

  function startGame(useSave) {
    ensureAudio();
    sfx('click');
    resetGame(game, true);
    if (useSave && save) applySave(game, save);
    // W-I: the controls hint is armed here, not in resetGame — the title screen
    // idles on the same clock, and arming at reset would let it expire before
    // play even starts.
    game.hintUntil = game.time + HINT_SECONDS;
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce(useSave && save ? 'Playing. Welcome back to Solmar.' : 'Playing. Meet Ana Deluca — follow the amber marker.');
  }
  function pauseGame() {
    if (game.screen !== SCREEN_PLAY) return;
    game.screen = SCREEN_PAUSED;
    game.hud.showScreen('paused');
    if (game.hud.showSettings) game.hud.showSettings({ ...game.settings, qualityLabel: game.qualityLabel });
    game.input.unlock();
    persist(game);
    announce('Paused.');
  }
  function resumeGame() {
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce('Playing.');
  }
  function endGame(reason) {
    game.screen = SCREEN_OVER;
    game.endReason = reason;
    game.hud.showScreen('over');
    game.input.unlock();
    // Busted reads cold blue, wasted reads hot red: the card itself carries the state.
    if (overScreen) {
      overScreen.classList.toggle('busted', reason === 'busted');
      overScreen.classList.toggle('wasted', reason !== 'busted');
    }
    if (reason === 'busted') {
      overTitle.textContent = 'BUSTED';
      overText.textContent = 'The cops ran Rio down. He pays the fine at the safehouse and walks out clean — $50 lighter, stars gone.';
      sfx('busted');
    } else {
      overTitle.textContent = 'WASTED';
      overText.textContent = 'Rio got clipped and woke up at the safehouse. The city is still his — he just has to take it again.';
      sfx('wasted');
    }
    announce(reason === 'busted' ? 'Busted.' : 'Wasted.');
  }
  function respawn(reason) {
    respawnPlayer(game, reason);
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
  }

  btnNew.addEventListener('click', () => startGame(false));
  btnContinue.addEventListener('click', () => startGame(true));
  btnResume.addEventListener('click', resumeGame);
  btnRespawn.addEventListener('click', () => respawn(game.endReason || 'wasted'));
  canvas.addEventListener('pointerdown', () => {
    if (game.screen === SCREEN_PLAY) game.input.lock();
  });
  // The mission summary dismisses on any key or click. Added in the capture phase so a
  // click that also grabs pointer lock dismisses too; repeats are ignored so a held key
  // cannot cause a storm.
  window.addEventListener('keydown', (ev) => {
    if (!ev.repeat) dismissMissionSummary();
  }, true);
  window.addEventListener('pointerdown', () => dismissMissionSummary(), true);
  document.addEventListener('pointerlockchange', () => {
    if (!game.input.locked && game.screen === SCREEN_PLAY) pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === SCREEN_PLAY) pauseGame();
  });

  // Frame-rate safeguard. Two strategies were built and measured (numbers in the
  // report): the ladder below (disable the sun shadow pass, then pull the far plane in)
  // and a shadow-map shrink. `?perf=off|0|1|2|sm` exist so all of them stay reproducible.
  const watchdog = {
    frames: 0,
    start: performance.now(),
    warmup: 500,
    settleAt: 0,
    windows: 0,
  };
  if (perfMode === 'pinned' && Number.isFinite(perfLevel)) setQuality(game, perfLevel);
  if (perfMode === 'sm') setShadowMapSize(game, 1024);
  function qualityTick() {
    if (perfMode !== 'adaptive') return;
    const now = performance.now();
    watchdog.frames += 1;
    const elapsed = now - watchdog.start;
    const window = watchdog.settleAt === 0 && elapsed < watchdog.warmup ? watchdog.warmup : 1500;
    if (elapsed < window) return;
    const fps = (watchdog.frames * 1000) / elapsed;
    watchdog.frames = 0;
    watchdog.start = now;
    watchdog.windows += 1;
    // The user's shadow preference is a ceiling: the watchdog never re-enables a
    // shadow the player turned off.
    const ceiling = game.settings.shadows === false ? 1 : 2;
    // The ladder floors at 1, and never steps to 0 on its own. Measured twice
    // (A/B, same seed/scene): level 0 and level 1 issue the same pass — 44 draws /
    // 27.3k tris — and their FPS differ only by noise (2.36 vs 2.10, 2.43 vs 2.54),
    // so level 0 spends draw distance for zero frame time. ?perf=0 still pins it for
    // A/B runs; the automatic safeguard just refuses to pay for nothing.
    if (fps < LOW_FPS) {
      setQuality(game, Math.max(1, Math.min(ceiling, game.quality - 1)));
    } else if (fps > HIGH_FPS && game.quality < ceiling && watchdog.windows > 2) {
      setQuality(game, game.quality + 1);
    }
    watchdog.settleAt = now;
  }

  let accumulator = 0;
  let last = performance.now();
  let ambient = '';
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = game.input.takeActions();
    const playing = game.screen === SCREEN_PLAY;
    if (actions & ACTION_CONFIRM && game.screen === SCREEN_TITLE) startGame(false);
    else if (actions & ACTION_PAUSE && playing) pauseGame();
    else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && game.screen === SCREEN_PAUSED) resumeGame();
    else if (actions & ACTION_CONFIRM && game.screen === SCREEN_OVER) respawn(game.endReason || 'wasted');
    if (actions & ACTION_ENTER && playing) enterExitCar(game);
    if (actions & ACTION_PUNCH && playing) doPunch(game);
    if (actions & ACTION_RELOAD && playing) {
      if (startReload(game.combat)) sfx('reload');
    }
    if (actions & ACTION_SWITCH && playing) {
      const which = game.input.takeSwitch();
      if (which) switchWeaponSlot(game, which);
      else switchWeaponSlot(game, 'cycle');
    }
    if (actions & ACTION_TAXI && playing) callTaxi(game);
    if (actions & ACTION_MUTE) {
      const off = toggleMute();
      announce(off ? 'Sound off.' : 'Sound on.');
    }
    if ((actions & ACTION_FIRE || game.input.takeFire()) && playing) doFire(game);
    if (game.screen === SCREEN_TITLE) {
      game.camYaw += STEP * 0.03;
      while (accumulator >= STEP) {
        stepWorld(game, STEP);
        accumulator -= STEP;
      }
    } else if (playing) {
      while (accumulator >= STEP) {
        stepWorld(game, STEP);
        accumulator -= STEP;
        if (game.busted) {
          game.busted = false;
          endGame('busted');
          break;
        }
        if (game.health <= 0) {
          endGame('wasted');
          break;
        }
      }
    } else {
      accumulator = 0;
    }
    // Audio: every one of these is a guarded optional v5 call.
    const driving = game.driving !== null;
    setEngine(game.speed, driving, playing);
    setSiren(game.wanted > 0 && playing);
    if (audio.setHeli) audio.setHeli(!!(game.police.heli && game.police.heli.active) && playing);
    if (audio.setMusic) audio.setMusic(driving && playing);
    const wantAmbient = playing ? 'city' : 'off';
    if (wantAmbient !== ambient && audio.setAmbient) {
      ambient = wantAmbient;
      audio.setAmbient(wantAmbient);
    }
    placeCamera(game);
    game.renderer.render();
    game.hud.update(hudState(game), game.city);
    summaryTick();
    qualityTick();
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
