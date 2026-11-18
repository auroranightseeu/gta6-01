// Boot and the one loop: Solmar, Rio Vega, Ana Deluca's five-job chain, wanted stars
// and police, pistol combat, saves. The world advances in fixed 1/60 s steps; the
// renderer paints what is there. Screens: title, play, paused, game over.
// ?seed=N fixes the city; ?shot=start|drive|foot|chase (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { CRIME, CRIME_COOLDOWN, MISSION_MARKER, RESPAWN_PENALTY, SAFEHOUSE, START_MONEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity, dist2 } from './world.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import {
  ACTION_CONFIRM, ACTION_ENTER, ACTION_FIRE, ACTION_MUTE, ACTION_PAUSE,
  ACTION_PUNCH, ACTION_RELOAD, createInput,
} from './input.js';
import { createPlayer, updatePlayer } from './player.js';
import { createCar, driveCar, nearestCar } from './vehicles.js';
import { createTraffic, resetTraffic, updateTraffic } from './traffic.js';
import { createPolice, clearPolice, updatePolice } from './police.js';
import {
  MISSIONS, allMissionsDone, beginMission, createMissions, currentMission,
  missionTarget, missionText,
} from './missions.js';
import { createCombat, clearHostiles, firePistol, punch, resetCombat, spawnHostiles, startReload, updateCombat } from './combat.js';
import { readSave, writeSave } from './save.js';
import { createHud } from './hud.js';
import { ensureAudio, setEngine, setSiren, sfx, toggleMute } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const SPAWN = { x: -25, z: -18 };

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const game = buildGame();

function buildGame() {
  const random = createRandom(seed);
  const city = createCity(random);
  const renderer = createRenderer(canvas, city);
  const input = createInput(canvas);
  const hud = createHud();
  const player = createPlayer(renderer, SPAWN.x, SPAWN.z);
  const cars = city.parkedSpots.map((s) => createCar(renderer, s.x, s.z, s.heading, s.color));
  const traffic = createTraffic(city, random, renderer);
  const police = createPolice(renderer);
  const combat = createCombat(renderer);
  const missions = createMissions();
  const g = {
    city, renderer, input, hud, player, cars, traffic, police, combat, missions,
    screen: SCREEN_TITLE, driving: null, money: START_MONEY, health: 100,
    wanted: 0, camYaw: 0, camPitch: 0.35,
    objective: '', hint: '', time: 0, saveTimer: 0, speed: 0,
    crimeAt: {}, banner: '', bannerUntil: 0, busted: false, stolen: [],
  };
  resetGame(g, false);
  return g;
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
  g.time = 0;
  g.saveTimer = 0;
  g.speed = 0;
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  g.objective = missionText(g.missions);
  g.hint = 'WASD move · Shift run · E enter car · P pause';
}

function saveState(g) {
  return {
    money: g.money, health: g.health, x: g.player.x, z: g.player.z,
    missionIndex: g.missions.index, missionsDone: [...g.missions.done],
    missionStage: g.missions.stage, ammoMag: g.combat.mag, ammoReserve: g.combat.reserve,
  };
}

function applySave(g, save) {
  g.money = save.money;
  g.health = save.health;
  g.player.x = save.x;
  g.player.z = save.z;
  g.player.mesh.position.set(save.x, 0, save.z);
  g.missions.index = Math.min(save.missionIndex || 0, MISSIONS.length);
  g.missions.done = (save.missionsDone || [false, false, false, false, false]).slice(0, 5);
  while (g.missions.done.length < 5) g.missions.done.push(false);
  g.missions.stage = save.missionStage || 'go';
  g.missions.hostilesDown = 0;
  const def = currentMission(g.missions);
  g.missions.timer = def && def.timed ? def.timed : 0;
  g.combat.mag = save.ammoMag ?? 12;
  g.combat.reserve = save.ammoReserve ?? 24;
  // Chase missions resume hot; a saved defend stage resumes with fresh rivals.
  if (g.missions.index === 2 || g.missions.index === 3) g.wanted = 2;
  if (g.missions.index === 4 && g.missions.stage === 'defend') {
    spawnHostiles(g.combat, -125, 25, 3);
  }
  const target = missionTarget(g.missions);
  g.renderer.setBeacon(target ? target.x : MISSION_MARKER.x, target ? target.z : MISSION_MARKER.z, !!target);
  g.objective = missionText(g.missions);
}

function announce(message) {
  status.textContent = message;
}

function showBanner(g, text) {
  g.banner = text;
  g.bannerUntil = g.time + 3.5;
}

function hudState(g) {
  return {
    money: g.money, health: g.health, wanted: g.wanted,
    speed: g.speed, driving: g.driving !== null,
    objective: g.objective, hint: g.hint,
    banner: g.time < g.bannerUntil ? g.banner : '',
    ammoMag: g.combat.mag, ammoReserve: g.combat.reserve,
    reloading: g.combat.reloading > 0,
    player: g.player, cars: [...g.cars, ...g.traffic.cars],
    police: g.police.cars, pickups: g.combat.pickups,
    missionTarget: missionTarget(g.missions),
  };
}

/** Raise wanted, at most once per crime kind every few seconds so one wild minute
 *  does not jump straight to five stars. */
function addCrime(g, n, key, msg) {
  if (g.time - (g.crimeAt[key] || -99) < CRIME_COOLDOWN) return;
  g.crimeAt[key] = g.time;
  g.wanted = Math.min(5, g.wanted + n);
  g.police.hiddenTimer = 0;
  if (msg) announce(msg);
}

function completeMission(g, i) {
  const def = MISSIONS[i];
  g.missions.done[i] = true;
  g.money += def.reward;
  showBanner(g, `MISSION COMPLETE — ${def.name} +$${def.reward}`);
  sfx('jingle');
  writeSave(saveState(g));
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
  announce(stolen ? 'Driving — stolen.' : 'Driving.');
}

function doFire(g) {
  if (g.screen !== SCREEN_PLAY) return;
  const sanctioned = g.missions.index === 4 && g.missions.stage === 'defend';
  const result = firePistol(g.combat, {
    x: g.player.x, z: g.player.z, heading: g.player.heading,
    peds: g.traffic.peds, trafficCars: g.traffic.cars, sanctioned,
    onCrime: (n, key, msg) => addCrime(g, n, key, msg),
    onHostileDown: () => {
      g.missions.hostilesDown += 1;
      announce(`Rival down (${g.missions.hostilesDown}/3).`);
    },
  });
  if (result === 'fired') sfx('gunshot');
  else if (result === 'empty') announce('Out of ammo — find a green crate or press R.');
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

/** Busted or wasted: respawn at the safehouse, a small cash penalty, wanted cleared,
 *  missions and ammo kept. */
function respawnPlayer(g, reason) {
  const penalty = Math.min(g.money, RESPAWN_PENALTY);
  g.money -= penalty;
  g.health = 100;
  g.wanted = 0;
  clearPolice(g.police);
  clearHostiles(g.combat);
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
  writeSave(saveState(g));
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
  g.camYaw -= mouse.dx * 0.0032;
  g.camPitch = Math.max(0.08, Math.min(1.2, g.camPitch - mouse.dy * 0.0025));
  if (g.driving) {
    const car = g.driving;
    const drive = g.input.drive();
    driveCar(car, dt, drive, g.city);
    // Soft collision with traffic: shove the car out and kill speed, never pass through.
    for (const other of g.traffic.cars) {
      const dx = car.x - other.x;
      const dz = car.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d < 4 && d > 0.01) {
        car.x = other.x + (dx / d) * 4;
        car.z = other.z + (dz / d) * 4;
        if (Math.abs(car.speed) > 6) addCrime(g, CRIME.hitCar, 'hitCar', 'You clipped a car!');
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
    let want = car.heading + Math.PI;
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
  updateTraffic(g.traffic, dt, g.player);
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
    if (m.index === 1 && m.timer > 0) m.timer -= dt;
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
    }
    if (m.index === 1 && m.stage === 'deliver') g.objective = missionText(m);
  }
  g.saveTimer += dt;
  if (g.saveTimer > 10) {
    g.saveTimer = 0;
    writeSave(saveState(g));
  }
}

function placeCamera(g) {
  if (g.screen === SCREEN_TITLE) {
    g.renderer.placeCamera({ x: 0, y: 0, z: 0 }, g.camYaw, 0.55, 150, 30);
    return;
  }
  const target = g.driving
    ? { x: g.driving.x, y: 0, z: g.driving.z }
    : { x: g.player.x, y: 0, z: g.player.z };
  g.renderer.placeCamera(target, g.camYaw, g.camPitch, g.driving ? 11 : 7, g.driving ? 1 : 0);
}

function runShot(name) {
  const scene = stageShot(game, name, resetGame);
  game.screen = scene.screen;
  game.hud.showScreen(scene.screen === SCREEN_TITLE ? 'title' : null);
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
  const overTitle = document.getElementById('over-title');
  const overText = document.getElementById('over-text');
  btnContinue.disabled = !save;
  game.hud.showScreen('title');
  announce('Solmar. Rio Vega. Press Enter or click New Game to start.');

  function startGame(useSave) {
    ensureAudio();
    sfx('click');
    resetGame(game, true);
    if (useSave && save) applySave(game, save);
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce(useSave && save ? 'Playing. Welcome back to Solmar.' : 'Playing. Meet Ana Deluca — follow the amber marker.');
  }
  function pauseGame() {
    if (game.screen !== SCREEN_PLAY) return;
    game.screen = SCREEN_PAUSED;
    game.hud.showScreen('paused');
    game.input.unlock();
    writeSave(saveState(game));
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
    game.hud.showScreen('over');
    game.input.unlock();
    if (reason === 'busted') {
      overTitle.textContent = 'BUSTED';
      overText.textContent = 'The cops caught Rio on foot. He pays the fine at the safehouse and walks out clean — $50 lighter.';
      sfx('busted');
    } else {
      overTitle.textContent = 'WASTED';
      overText.textContent = 'Rio got clipped and woke up at the safehouse. The city is still his — he just has to take it again.';
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
  document.addEventListener('pointerlockchange', () => {
    if (!game.input.locked && game.screen === SCREEN_PLAY) pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === SCREEN_PLAY) pauseGame();
  });

  let accumulator = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = game.input.takeActions();
    if (actions & ACTION_CONFIRM && game.screen === SCREEN_TITLE) startGame(false);
    else if (actions & ACTION_PAUSE && game.screen === SCREEN_PLAY) pauseGame();
    else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && game.screen === SCREEN_PAUSED) resumeGame();
    else if (actions & ACTION_CONFIRM && game.screen === SCREEN_OVER) respawn(game.endReason || 'wasted');
    if (actions & ACTION_ENTER && game.screen === SCREEN_PLAY) enterExitCar(game);
    if (actions & ACTION_PUNCH && game.screen === SCREEN_PLAY) doPunch(game);
    if (actions & ACTION_RELOAD && game.screen === SCREEN_PLAY) {
      if (startReload(game.combat)) sfx('reload');
    }
    if (actions & ACTION_MUTE) {
      const off = toggleMute();
      announce(off ? 'Sound off.' : 'Sound on.');
    }
    if ((actions & ACTION_FIRE || game.input.takeFire()) && game.screen === SCREEN_PLAY) doFire(game);
    if (game.screen === SCREEN_TITLE) {
      game.camYaw += STEP * 0.03;
      while (accumulator >= STEP) {
        stepWorld(game, STEP);
        accumulator -= STEP;
      }
    } else if (game.screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        stepWorld(game, STEP);
        accumulator -= STEP;
        if (game.busted) {
          game.busted = false;
          game.endReason = 'busted';
          endGame('busted');
          break;
        }
        if (game.health <= 0) {
          game.endReason = 'wasted';
          endGame('wasted');
          break;
        }
      }
    } else {
      accumulator = 0;
    }
    setEngine(game.speed, game.driving !== null, game.screen === SCREEN_PLAY);
    setSiren(game.wanted > 0 && game.screen === SCREEN_PLAY);
    placeCamera(game);
    game.renderer.render();
    game.hud.update(hudState(game), game.city);
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
