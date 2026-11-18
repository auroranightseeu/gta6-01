// Boot and the one loop: Solmar, Rio Vega, Ana Deluca's marker, cars, traffic, the HUD.
// The world advances in fixed 1/60 s steps; the renderer paints what is there. Screens:
// title, play, paused, game over. ?seed=N fixes the city; ?shot=start|drive|foot (with
// &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { MISSION_MARKER, SAVE_KEY, START_MONEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity, dist2 } from './world.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, createInput } from './input.js';
import { createPlayer, updatePlayer } from './player.js';
import { createCar, driveCar, nearestCar } from './vehicles.js';
import { createTraffic, resetTraffic, updateTraffic } from './traffic.js';
import { createHud } from './hud.js';
import { ensureAudio } from './audio.js';
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

// Debug hook for automated playtests: read state, teleport Rio. Harmless in normal play.
window.__dbg = () => ({
  screen: game.screen, x: +game.player.x.toFixed(1), z: +game.player.z.toFixed(1),
  driving: game.driving !== null, speed: +game.speed.toFixed(1),
  money: game.money, health: Math.round(game.health), missionDone: game.missionDone,
  cars: game.cars.map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1) })),
});
window.__dbgTeleport = (x, z) => {
  game.player.x = x;
  game.player.z = z;
  game.player.mesh.position.set(x, 0, z);
};

function buildGame() {
  const random = createRandom(seed);
  const city = createCity(random);
  const renderer = createRenderer(canvas, city);
  const input = createInput(canvas);
  const hud = createHud();
  const player = createPlayer(renderer, SPAWN.x, SPAWN.z);
  const cars = city.parkedSpots.map((s) => createCar(renderer, s.x, s.z, s.heading, s.color));
  const traffic = createTraffic(city, random, renderer);
  const g = {
    city, renderer, input, hud, player, cars, traffic,
    screen: SCREEN_TITLE, driving: null, money: START_MONEY, health: 100,
    wanted: 0, missionDone: false, camYaw: 0, camPitch: 0.35,
    objective: '', hint: '', time: 0, saveTimer: 0, speed: 0,
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
  g.driving = null;
  g.money = START_MONEY;
  g.health = 100;
  g.wanted = 0;
  g.missionDone = false;
  g.camYaw = 0;
  g.camPitch = 0.35;
  g.time = 0;
  g.saveTimer = 0;
  g.speed = 0;
  g.renderer.setBeacon(MISSION_MARKER.x, MISSION_MARKER.z, true);
  if (fresh) {
    g.objective = `Meet Ana Deluca — follow the amber marker ($100)`;
    g.hint = 'WASD move · Shift run · E enter car · P pause';
  }
}

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave(g) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: g.money, health: g.health, x: g.player.x, z: g.player.z, missionDone: g.missionDone,
    }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

function applySave(g, save) {
  g.money = save.money;
  g.health = save.health;
  g.player.x = save.x;
  g.player.z = save.z;
  g.missionDone = save.missionDone;
  g.player.mesh.position.set(save.x, 0, save.z);
  g.renderer.setBeacon(MISSION_MARKER.x, MISSION_MARKER.z, !save.missionDone);
  g.objective = save.missionDone
    ? 'Free roam — Solmar is yours.'
    : `Meet Ana Deluca — follow the amber marker ($100)`;
}

function announce(message) {
  status.textContent = message;
}

function hudState(g) {
  return {
    money: g.money, health: g.health, wanted: g.wanted,
    speed: g.speed, driving: g.driving !== null,
    objective: g.objective, hint: g.hint,
    player: g.player, cars: [...g.cars, ...g.traffic.cars],
    missionDone: g.missionDone,
  };
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
  const car = nearestCar(g.cars, g.player.x, g.player.z, 4.5);
  if (!car) return;
  g.driving = car;
  car.parked = false;
  g.player.mesh.visible = false;
  g.hint = 'WASD drive · Space handbrake · E exit car · P pause';
  announce('Driving.');
}

function stepWorld(g, dt) {
  g.time += dt;
  const mouse = g.input.takeMouse();
  if (g.screen === SCREEN_TITLE) {
    updateTraffic(g.traffic, dt);
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
        car.speed *= 0.5;
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
  updateTraffic(g.traffic, dt);
  if (!g.missionDone && dist2(g.player.x, g.player.z, MISSION_MARKER.x, MISSION_MARKER.z) < 49) {
    g.missionDone = true;
    g.money += 100;
    g.objective = 'Free roam — Solmar is yours.';
    g.renderer.setBeacon(MISSION_MARKER.x, MISSION_MARKER.z, false);
    announce('Ana Deluca: good. $100. Solmar is yours, Rio.');
  }
  g.saveTimer += dt;
  if (g.saveTimer > 10) {
    g.saveTimer = 0;
    writeSave(g);
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
  btnContinue.disabled = !save;
  game.hud.showScreen('title');
  announce('Solmar. Rio Vega. Press Enter or click New Game to start.');

  function startGame(useSave) {
    ensureAudio();
    resetGame(game, true);
    if (useSave && save) applySave(game, save);
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce('Playing. Meet Ana Deluca — follow the amber marker.');
  }
  function pauseGame() {
    if (game.screen !== SCREEN_PLAY) return;
    game.screen = SCREEN_PAUSED;
    game.hud.showScreen('paused');
    game.input.unlock();
    writeSave(game);
    announce('Paused.');
  }
  function resumeGame() {
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce('Playing.');
  }
  function endGame() {
    game.screen = SCREEN_OVER;
    game.hud.showScreen('over');
    game.input.unlock();
    announce('Wasted. Rio is back on his feet at the docks.');
  }

  btnNew.addEventListener('click', () => startGame(false));
  btnContinue.addEventListener('click', () => startGame(true));
  btnResume.addEventListener('click', resumeGame);
  btnRespawn.addEventListener('click', () => {
    resetGame(game, true);
    game.screen = SCREEN_PLAY;
    game.hud.showScreen(null);
    game.input.lock();
    announce('Playing.');
  });
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
    else if (actions & ACTION_CONFIRM && game.screen === SCREEN_OVER) {
      resetGame(game, true);
      game.screen = SCREEN_PLAY;
      game.hud.showScreen(null);
      game.input.lock();
    }
    if (actions & ACTION_ENTER && game.screen === SCREEN_PLAY) enterExitCar(game);
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
        if (game.health <= 0) {
          endGame();
          break;
        }
      }
    } else {
      accumulator = 0;
    }
    placeCamera(game);
    game.renderer.render();
    game.hud.update(hudState(game), game.city);
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
