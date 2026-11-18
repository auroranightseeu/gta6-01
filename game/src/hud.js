// The DOM HUD over the 3D view: money, health, wanted stars, ammo, speed, the
// objective line, the controls hint, a mission-complete banner, and a 2D top-down
// minimap (roads, blocks, player arrow, cars, police in red, ammo crates in green,
// the mission marker). Screens are plain overlays shown and hidden by id.
import { CITY, FONT } from './config.js';

const MAP_SIZE = 180;
const MAP_SCALE = MAP_SIZE / (CITY.bound * 2 + 16);

function toMap(v) {
  return (v + CITY.bound + 8) * MAP_SCALE;
}

export function createHud() {
  const el = (id) => document.getElementById(id);
  const money = el('money');
  const health = el('health');
  const wanted = el('wanted');
  const ammo = el('ammo');
  const speed = el('speed');
  const objective = el('objective');
  const hint = el('hint');
  const banner = el('banner');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');
  const screens = {
    title: el('screen-title'),
    paused: el('screen-paused'),
    over: el('screen-over'),
  };
  const hud = el('hud');
  let last = {
    money: -1, health: -1, wanted: -1, ammo: '', speed: -1, driving: false,
    objective: '', hint: '', banner: '',
  };

  function showScreen(name) {
    for (const [key, node] of Object.entries(screens)) {
      node.hidden = key !== name;
    }
    hud.hidden = name === 'title';
    // A screen change can flip the driving flag while the speed number stays
    // put (exiting a stopped car, respawning on foot): force the next update
    // to rewrite the speed panel instead of trusting the number cache, so it
    // can never go stale across title / play / paused / over / respawn.
    last.speed = -1;
  }

  function drawMinimap(state, city) {
    const g = mapCtx;
    g.fillStyle = '#10151c';
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    g.fillStyle = '#3c4148';
    for (const line of CITY.roadLines) {
      g.fillRect(0, toMap(line) - 3.5 * MAP_SCALE, MAP_SIZE, 7 * MAP_SCALE);
      g.fillRect(toMap(line) - 3.5 * MAP_SCALE, 0, 7 * MAP_SCALE, MAP_SIZE);
    }
    g.fillStyle = '#5d564c';
    for (const bx of CITY.blockCenters) {
      for (const bz of CITY.blockCenters) {
        g.fillRect(toMap(bx - 18), toMap(bz - 18), 36 * MAP_SCALE, 36 * MAP_SCALE);
      }
    }
    // Buildings, faint, so the map reads as a city and not a grid.
    g.fillStyle = '#8a7a5f';
    for (const b of city.buildings) {
      g.fillRect(toMap(b.x - b.w / 2), toMap(b.z - b.d / 2), b.w * MAP_SCALE, b.d * MAP_SCALE);
    }
    if (state.missionTarget) {
      g.fillStyle = '#ffc93c';
      g.beginPath();
      g.arc(toMap(state.missionTarget.x), toMap(state.missionTarget.z), 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e8e4d8';
    for (const car of state.cars) {
      g.fillRect(toMap(car.x) - 2, toMap(car.z) - 2, 4, 4);
    }
    g.fillStyle = '#2ecc71';
    for (const p of state.pickups || []) {
      if (p.active) g.fillRect(toMap(p.x) - 2, toMap(p.z) - 2, 4, 4);
    }
    g.fillStyle = '#ff4444';
    for (const car of state.police || []) {
      g.beginPath();
      g.arc(toMap(car.x), toMap(car.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // Player arrow, pointing along the heading.
    const px = toMap(state.player.x);
    const pz = toMap(state.player.z);
    const h = state.player.heading;
    g.fillStyle = '#4fc3f7';
    g.beginPath();
    g.moveTo(px + Math.sin(h) * 7, pz + Math.cos(h) * 7);
    g.lineTo(px + Math.sin(h + 2.5) * 5, pz + Math.cos(h + 2.5) * 5);
    g.lineTo(px + Math.sin(h - 2.5) * 5, pz + Math.cos(h - 2.5) * 5);
    g.closePath();
    g.fill();
  }

  function update(state, city) {
    if (state.money !== last.money) {
      money.textContent = `$${state.money}`;
      last.money = state.money;
    }
    if (state.health !== last.health) {
      health.textContent = `Health ${Math.max(0, Math.round(state.health))}`;
      last.health = state.health;
    }
    if (state.wanted !== last.wanted) {
      wanted.textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
      wanted.style.color = state.wanted > 0 ? '#ffd94d' : '#7d8590';
      last.wanted = state.wanted;
    }
    const ammoText = `Pistol ${state.ammoMag} / ${state.ammoReserve}${state.reloading ? ' · reloading…' : ''}`;
    if (ammoText !== last.ammo) {
      ammo.textContent = ammoText;
      last.ammo = ammoText;
    }
    const kmh = Math.round(Math.abs(state.speed || 0) * 3.6);
    // The speed panel must refresh when the driving flag flips, not only when
    // the number changes: exiting a stopped car leaves kmh at 0, so a
    // speed-only cache would keep showing "0 km/h" as if still driving.
    if (kmh !== last.speed || state.driving !== last.driving) {
      speed.textContent = state.driving ? `${kmh} km/h` : '';
      speed.style.display = state.driving ? '' : 'none';
      last.speed = kmh;
      last.driving = state.driving;
    }
    if (state.objective !== last.objective) {
      objective.textContent = state.objective;
      last.objective = state.objective;
    }
    if (state.hint !== last.hint) {
      hint.textContent = state.hint;
      last.hint = state.hint;
    }
    if ((state.banner || '') !== last.banner) {
      banner.textContent = state.banner || '';
      banner.style.display = state.banner ? '' : 'none';
      last.banner = state.banner || '';
    }
    drawMinimap(state, city);
  }

  return { update, showScreen };
}

export { FONT };
