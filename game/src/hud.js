// The DOM HUD over the 3D view: money, health, wanted stars, ammo, weapon slots, taxi
// fare line, air-unit warning, speed, the objective line, the controls hint, a banner, a
// damage vignette and a 2D top-down minimap (roads, blocks, player arrow, cars, police in
// red, ammo crates in green, parcels, the mission marker). Screens are plain overlays
// shown and hidden by id; the pause screen also hosts the settings form and the stats
// block. Every v5 field on the state object is optional: an absent one means the old HUD.
import { CITY, FONT } from './config.js';

const MAP_SIZE = 180;
const MAP_SCALE = MAP_SIZE / (CITY.bound * 2 + 16);
// Parcel total when the state says nothing: v4 had eight.
const DEFAULT_PARCELS = 8;

function toMap(v) {
  return (v + CITY.bound + 8) * MAP_SCALE;
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

// --- v6 panels ----------------------------------------------------------------------
// Mission, police, vehicle, district/street and the dialogue box. They are ADDED around
// the existing HUD nodes rather than replacing them, so every v5 element (banner,
// minimap, health, ammo, speed, weapons, objective, hint) keeps its node, its position
// and its update path. Layout: the right column already holds the minimap, so the place
// line sits under it and the three stat panels stack beneath the weapon chips.
const PANEL_CSS = [
  /* One stack down the right edge: the minimap (12..196), the weapon chips at their own
     index.html position (210..302, untouched), then the place line and the three panels.
     The chips cannot move, so the place line starts under them rather than under the map. */
  '#hud-place,#hud-mission,#hud-police,#hud-vehicle{position:absolute;right:12px;width:198px;box-sizing:border-box;',
  'padding:7px 10px;border-radius:8px;background:rgba(10,16,24,.55);font-size:13px;line-height:1.35;}',
  '#hud-place{top:306px;text-align:right;line-height:1.3;}',
  /* Gaps of 10 px: a panel that grows by a wrapped line never touches the next one. */
  '#hud-mission{top:366px}#hud-police{top:470px}#hud-vehicle{top:526px}',
  '.hp-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:10px;',
  'letter-spacing:.14em;color:#8fa0b3;text-transform:uppercase;font-weight:700;}',
  '.hp-title{margin-top:2px;font-size:15px;font-weight:700;color:#f2f5f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.hp-next{display:flex;gap:6px;margin-top:2px;color:#c3cedb;font-size:12px;line-height:1.35;}',
  '.hp-next b{color:#ffc93c;text-transform:uppercase;letter-spacing:.06em;flex:0 0 auto;font-size:11px;padding-top:1px;}',
  '.hp-row{display:flex;justify-content:space-between;gap:8px;color:#c3cedb;font-variant-numeric:tabular-nums;}',
  '.hp-row b{color:#ffc93c;font-weight:700;}',
  '.hp-bar{height:5px;margin-top:5px;border-radius:3px;background:rgba(0,0,0,.45);',
  'box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);overflow:hidden;}',
  '.hp-bar i{display:block;height:100%;width:0;border-radius:3px;background:#4fc3f7;transition:width .2s linear;}',
  '#hud-vehicle .hp-bar i{background:#4cd07d;}#hud-vehicle .hp-bar i.low{background:#f0b429;}',
  '#hud-vehicle .hp-bar i.critical{background:#ff5544;}',
  '#hud-place b{display:block;font-size:14px;letter-spacing:.04em;color:#ffd166;}',
  '#hud-place span{color:#c3cedb;}',
  '#hud-dialog{position:absolute;left:50%;bottom:100px;transform:translateX(-50%);display:flex;gap:10px;',
  'align-items:flex-start;width:392px;padding:8px 12px;border-radius:10px;',
  'background:rgba(10,16,24,.68);border:1px solid rgba(255,255,255,.14);}',
  '#hud-portrait{width:56px;height:56px;border-radius:8px;background:#182130;',
  'box-shadow:0 0 0 1px rgba(255,255,255,.18);flex:0 0 auto;}',
  '.hd-body{min-width:0;}',
  '.hd-name{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#ffc93c;font-weight:700;}',
  '.hd-line{margin:3px 0 0;font-size:13px;line-height:1.4;color:#e7edf3;}',
].join('');

function panelStyle() {
  if (document.getElementById('hud-panel-style')) return;
  const style = document.createElement('style');
  style.id = 'hud-panel-style';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

function mk(tag, cls, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}

function buildPanels(root) {
  panelStyle();
  const mission = mk('div', 'hpanel', root);
  mission.id = 'hud-mission';
  const missionHead = mk('div', 'hp-head', mission);
  mk('span', '', missionHead).textContent = 'Mission';
  const missionCount = mk('span', '', missionHead);
  const missionTitle = mk('div', 'hp-title', mission);
  const missionNextRow = mk('div', 'hp-next', mission);
  const missionStage = mk('b', '', missionNextRow);
  const missionNext = mk('span', '', missionNextRow);
  const missionBarFill = mk('i', '', mk('div', 'hp-bar', mission));

  const police = mk('div', 'hpanel', root);
  police.id = 'hud-police';
  const policeHead = mk('div', 'hp-head', police);
  mk('span', '', policeHead).textContent = 'Police';
  const policeStatus = mk('span', '', policeHead);
  const policeRow = mk('div', 'hp-row', police);
  const policeUnit = mk('b', '', policeRow);
  const policeRange = mk('span', '', policeRow);

  const vehicle = mk('div', 'hpanel', root);
  vehicle.id = 'hud-vehicle';
  const vehicleHead = mk('div', 'hp-head', vehicle);
  mk('span', '', vehicleHead).textContent = 'Vehicle';
  const vehicleSpeed = mk('span', '', vehicleHead);
  const vehicleName = mk('div', 'hp-title', vehicle);
  const vehicleBar = mk('div', 'hp-bar', vehicle);
  const vehicleFill = mk('i', '', vehicleBar);

  const place = mk('div', '', root);
  place.id = 'hud-place';
  const placeDistrict = mk('b', '', place);
  const placeStreet = mk('span', '', place);

  const dialog = mk('div', '', root);
  dialog.id = 'hud-dialog';
  const portrait = mk('canvas', '', dialog);
  portrait.id = 'hud-portrait';
  portrait.width = 112;
  portrait.height = 112;
  const body = mk('div', 'hd-body', dialog);
  const speaker = mk('span', 'hd-name', body);
  const line = mk('p', 'hd-line', body);

  return {
    dialog,
    missionCount, missionTitle, missionStage, missionNext, missionBar: missionBarFill,
    policeStatus, policeUnit, policeRange,
    vehicleSpeed, vehicleName, vehicleFill,
    placeDistrict, placeStreet,
    portrait, speaker, line,
  };
}

/** FNV-1a: a stable small hash so a name always draws the same face. */
function hashName(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SKIN = ['#e8b48c', '#c98f68', '#8d5a3c', '#f0c8a6', '#b87c55'];
const HAIR = ['#2b2118', '#5a3a22', '#141419', '#8a4b2a', '#6d6a63'];
const SHIRT = ['#2f4858', '#7a2f3c', '#315c46', '#4a3a63', '#8a6a2f'];

/**
 * Draw a procedural portrait: canvas only, no image file, no URL, no font. The face is a
 * handful of ellipses coloured from the name's hash, so Ana Deluca always looks the same
 * and a second speaker would look different. 56 CSS px at 2x backing store.
 */
function drawPortrait(canvas, name) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const n = hashName(name || 'fixer');
  const skin = SKIN[n % SKIN.length];
  const hair = HAIR[(n >> 4) % HAIR.length];
  const shirt = SHIRT[(n >> 9) % SHIRT.length];
  const wide = ((n >> 13) % 3) - 1;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#25344a');
  bg.addColorStop(1, '#111823');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = shirt;
  g.beginPath();
  g.moveTo(w * 0.06, h);
  g.quadraticCurveTo(w * 0.5, h * 0.60, w * 0.94, h);
  g.closePath();
  g.fill();
  g.fillStyle = skin;
  g.fillRect(w * 0.42, h * 0.54, w * 0.16, h * 0.14);
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.45, w * 0.27, h * 0.30, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.30, w * 0.29, h * 0.22, 0, Math.PI, 0, false);
  g.fill();
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.40, w * 0.29, h * 0.14, 0, Math.PI * 1.06, Math.PI * 1.94, false);
  g.fill();
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(w * 0.21, h * 0.47, w * 0.05, h * 0.06, 0, 0, Math.PI * 2);
  g.ellipse(w * 0.79, h * 0.47, w * 0.05, h * 0.06, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1b1f26';
  g.beginPath();
  g.ellipse(w * (0.41 + wide * 0.01), h * 0.44, w * 0.035, h * 0.03, 0, 0, Math.PI * 2);
  g.ellipse(w * (0.59 + wide * 0.01), h * 0.44, w * 0.035, h * 0.03, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(30,24,20,.55)';
  g.lineWidth = w * 0.012;
  g.beginPath();
  g.moveTo(w * (0.36 + wide * 0.01), h * 0.375);
  g.lineTo(w * (0.46 + wide * 0.01), h * 0.365);
  g.moveTo(w * (0.54 + wide * 0.01), h * 0.365);
  g.lineTo(w * (0.64 + wide * 0.01), h * 0.375);
  g.stroke();
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.47);
  g.lineTo(w * 0.485, h * 0.545);
  g.lineTo(w * 0.52, h * 0.55);
  g.stroke();
  g.strokeStyle = '#8a3f3a';
  g.lineWidth = w * 0.016;
  g.beginPath();
  g.moveTo(w * 0.44, h * 0.615);
  g.quadraticCurveTo(w * 0.5, h * 0.645, w * 0.56, h * 0.615);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.05)';
  g.fillRect(0, 0, w, h * 0.12);
}

/** Pooled panel cache: written into each frame, compared before touching the DOM. */
function panelCache() {
  return {
    count: '', title: '', stage: '', next: '', bar: -1,
    status: '', unit: '', range: '',
    vehSpeed: '', vehName: '', vehFill: -1, vehClass: '',
    district: '', street: '', speaker: '', line: '', drawnFor: '',
  };
}

/** Write `text` into `node` only when the cached value changed. */
function put(cache, key, node, text) {
  const value = text == null ? '' : String(text);
  if (cache[key] === value) return false;
  cache[key] = value;
  if (node) node.textContent = value;
  return true;
}

function renderMaps(nodes, cache, state) {
  // The place line reads state.place: main.js computes it from world.js, which keeps this
  // file a pure renderer and keeps the dossier's import walk unchanged.
  const place = state.place || null;
  if (place) {
    put(cache, 'district', nodes.placeDistrict, place.district || '');
    put(cache, 'street', nodes.placeStreet, place.street || '');
  }
  const mission = state.mission || null;
  if (mission) {
    put(cache, 'count', nodes.missionCount, `${mission.index}/${mission.total}`);
    put(cache, 'title', nodes.missionTitle, mission.title);
    put(cache, 'stage', nodes.missionStage, mission.stage);
    put(cache, 'next', nodes.missionNext, mission.next);
    const pct = Math.round(Math.max(0, Math.min(1, mission.progress || 0)) * 100);
    if (pct !== cache.bar) {
      cache.bar = pct;
      nodes.missionBar.style.width = `${pct}%`;
    }
    if (put(cache, 'speaker', nodes.speaker, mission.speaker || '')) {
      drawPortrait(nodes.portrait, mission.speaker || '');
    }
    put(cache, 'line', nodes.line, mission.line || '');
  }
  const police = state.policeInfo || null;
  if (police) {
    const label = police.status === 'pursuing' ? 'PURSUING'
      : police.status === 'searching' ? 'SEARCHING' : 'CLEAR';
    put(cache, 'status', nodes.policeStatus, label);
    if (cache.status !== label) {
      nodes.policeStatus.style.color = police.status === 'pursuing' ? '#ff8a8a'
        : police.status === 'searching' ? '#ffd166' : '#7d8590';
    }
    put(cache, 'unit', nodes.policeUnit, police.callsign || (police.units ? `${police.units} units` : '—'));
    const range = police.units
      ? `${police.distance} m${police.heli ? ' · air' : ''}`
      : (police.heli ? 'air only' : 'no units');
    put(cache, 'range', nodes.policeRange, range);
  }
  const v = state.vehicle || null;
  if (v) {
    put(cache, 'vehName', nodes.vehicleName, v.none ? 'On foot' : v.name);
    put(cache, 'vehSpeed', nodes.vehicleSpeed, v.none ? '' : `${v.speed} km/h`);
    const cond = Math.max(0, Math.min(100, v.none ? 100 : v.condition));
    if (cond !== cache.vehFill) {
      cache.vehFill = cond;
      nodes.vehicleFill.style.width = `${cond}%`;
    }
    const cls = cond < 25 ? 'critical' : cond < 50 ? 'low' : '';
    if (cls !== cache.vehClass) {
      cache.vehClass = cls;
      nodes.vehicleFill.className = cls;
    }
  }
}


export function createHud() {
  const el = (id) => document.getElementById(id);
  const money = el('money');
  const health = el('health');
  const wanted = el('wanted');
  const ammo = el('ammo');
  const parcels = el('parcels');
  const speed = el('speed');
  const objective = el('objective');
  const hint = el('hint');
  const banner = el('banner');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');
  const weapons = el('weapons');
  const taxi = el('taxi');
  const heli = el('heli');
  const topleft = el('topleft');
  const vignette = el('vignette');
  const reticle = el('reticle');
  const healthBar = el('healthfill');
  const screens = {
    title: el('screen-title'),
    paused: el('screen-paused'),
    over: el('screen-over'),
  };
  const hud = el('hud');
  // Settings widgets (pause screen). All optional: if index.html lacks one, the HUD
  // still runs and simply never wires it.
  const settingNodes = {
    volume: el('set-volume'),
    volumeVal: el('set-volume-val'),
    shadows: el('set-shadows'),
    sens: el('set-sens'),
    sensVal: el('set-sens-val'),
    quality: el('set-quality'),
  };
  const pauseStats = el('pause-stats');
  const overStats = el('over-stats');
  // The v6 panels are built once and appended to the HUD root, so no index.html edit is
  // needed and every v5 node above is left exactly where it was.
  const panels = hud ? buildPanels(hud) : null;
  const panelState = panelCache();
  let lastPackageCount = -1;
  let lastPackageTotal = -1;
  let lastWeapons = '';
  let lastTaxi = '';
  let lastReticle = null;
  let lastDamage = -1;
  let lastHeli = null;
  let lastStats = '';
  let last = {
    money: -1, health: -1, wanted: -1, ammo: '', speed: -1, driving: false,
    objective: '', hint: '', banner: '',
  };

  if (weapons) weapons.hidden = true;
  if (taxi) taxi.hidden = true;
  if (heli) heli.hidden = true;

  function showScreen(name) {
    for (const [key, node] of Object.entries(screens)) {
      if (node) node.hidden = key !== name;
    }
    if (hud) hud.hidden = name === 'title';
    // The new panels live inside #hud, so the title screen hides them with it; the
    // dialogue box is the one piece that would otherwise sit over a paused card.
    if (panels) panels.dialog.hidden = name !== null;
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
    g.fillStyle = '#ffbd63';
    for (const item of state.packages || []) {
      if (item.active) {
        g.fillRect(toMap(item.x) - 2, toMap(item.z) - 2, 4, 4);
      }
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

  function renderWeapons(list) {
    const sig = list.map((w) => `${w.id}:${w.mag}:${w.reserve}:${w.active ? 1 : 0}`).join('|');
    if (sig === lastWeapons) return;
    lastWeapons = sig;
    if (!weapons) return;
    weapons.hidden = list.length === 0;
    if (!list.length) return;
    weapons.textContent = '';
    for (const w of list) {
      const slot = document.createElement('div');
      slot.className = `wslot${w.active ? ' active' : ''}${w.mag <= 0 && w.reserve <= 0 ? ' dry' : ''}`;
      const name = document.createElement('span');
      name.className = 'wname';
      name.textContent = w.name || w.id || '?';
      const rounds = document.createElement('span');
      rounds.className = 'wrounds';
      rounds.textContent = `${w.mag ?? 0}/${w.reserve ?? 0}`;
      slot.appendChild(name);
      slot.appendChild(rounds);
      weapons.appendChild(slot);
    }
  }

  function renderTaxi(info) {
    if (!taxi) return;
    const label = info && info.active ? (info.label || '') : '';
    if (label === lastTaxi) return;
    lastTaxi = label;
    taxi.hidden = !label;
    if (label) taxi.textContent = `TAXI · ${label}`;
  }

  function renderDamage(dmg) {
    if (!vignette) return;
    const v = Math.max(0, Math.min(100, Number(dmg) || 0));
    if (Math.abs(v - lastDamage) < 0.5) return;
    lastDamage = v;
    // 0 = clean screen, 100 = nearly blacked out at the edges. A slow pulse so a
    // badly hurt Rio reads as hurt even when the number is static.
    vignette.style.opacity = v <= 2 ? '0' : String(Math.min(0.92, (v / 100) * 0.92 + 0.06));
    vignette.classList.toggle('critical', v > 65);
  }

  function renderHeli(on, active) {
    if (!heli) return;
    if (on === lastHeli) return;
    lastHeli = on;
    heli.hidden = !on;
    if (on) {
      heli.classList.toggle('lit', !!active);
      // index.html pins #heli at top:192px, which is inside the top-left panel
      // (money/health/wanted/ammo/parcels ends at ~211px at 20px type): the red
      // badge was drawn straight over the "Parcels n/16" line. The left stack's
      // height depends on font metrics and the parcel count, so measure the panel
      // and park the badge just below it instead of trusting that constant.
      if (topleft) {
        const bottom = topleft.getBoundingClientRect().bottom;
        heli.style.top = `${Math.round(bottom + 6)}px`;
      }
    }
  }

  function renderStats(stats) {
    if (!stats) return;
    const acc = stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0;
    const mins = Math.floor(stats.played / 60);
    const secs = Math.floor(stats.played % 60);
    const text = [
      `Time played ${mins}:${String(secs).padStart(2, '0')}`,
      `Crimes ${stats.crimes || 0}`,
      `Fares ${stats.fares || 0}`,
      `Parcels ${stats.parcels || 0}`,
      `Accuracy ${acc}% (${stats.hits || 0}/${stats.shots || 0})`,
    ].join(' · ');
    if (text === lastStats) return;
    lastStats = text;
    if (pauseStats) pauseStats.textContent = text;
    if (overStats) overStats.textContent = text;
  }

  function update(state, city) {
    if (state.money !== last.money) {
      money.textContent = `$${state.money}`;
      last.money = state.money;
    }
    if (state.health !== last.health) {
      health.textContent = `Health ${Math.max(0, Math.round(state.health))}`;
      health.style.color = state.health < 35 ? '#ff7b6b' : '';
      // The bar duplicates the number on purpose: at contact-sheet size the number is
      // unreadable and the bar still is.
      if (healthBar) {
        const pct = Math.max(0, Math.min(100, state.health));
        healthBar.style.width = `${pct}%`;
        healthBar.className = pct < 25 ? 'critical' : pct < 50 ? 'low' : '';
      }
      last.health = state.health;
    }
    // Reticle: only while actually able to shoot — on foot, not in a menu, not driving
    // (the drive-by aims at the nearest target, not at screen centre). `state.armed` is
    // optional, so an older caller that does not pass it simply never shows the reticle.
    if (reticle) {
      const show = !!state.armed && !state.driving;
      if (show !== lastReticle) {
        reticle.hidden = !show;
        lastReticle = show;
      }
    }
    if (state.wanted !== last.wanted) {
      wanted.textContent = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
      wanted.style.color = state.wanted > 0 ? '#ffd94d' : '#7d8590';
      last.wanted = state.wanted;
    }
    // Ammo: the current weapon's name and magazine when the state carries the v5
    // weapon list, otherwise the v4 pistol line.
    const activeWeapon = Array.isArray(state.weapons)
      ? state.weapons.find((w) => w && w.active) || state.weapons[0]
      : null;
    const ammoText = activeWeapon
      ? `${activeWeapon.name || activeWeapon.id} ${activeWeapon.mag ?? 0} / ${activeWeapon.reserve ?? 0}${state.reloading ? ' · reloading…' : ''}`
      : `Pistol ${state.ammoMag} / ${state.ammoReserve}${state.reloading ? ' · reloading…' : ''}`;
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
    // Parcels are ambient collectibles, not the mission: their count lives in
    // the top-left panel (with the banner on pickup), never appended to the
    // objective line — a long objective must never collide with the hint.
    // The TOTAL comes from the state (16 in v5), never a hard-coded 8.
    const total = Number.isFinite(state.packageTotal) && state.packageTotal > 0
      ? state.packageTotal
      : (Array.isArray(state.packages) && state.packages.length) || DEFAULT_PARCELS;
    if (state.packageCount !== lastPackageCount || total !== lastPackageTotal) {
      parcels.textContent = `Parcels ${state.packageCount || 0}/${total}`;
      lastPackageCount = state.packageCount;
      lastPackageTotal = total;
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
    // --- v5 optional fields: absent means nothing changes. ---
    if (Array.isArray(state.weapons)) renderWeapons(state.weapons);
    renderTaxi(state.taxi);
    renderDamage(state.damage);
    renderHeli(!!state.heli, state.heliOn);
    renderStats(state.stats);
    drawMinimap(state, city);
    if (panels) renderMaps(panels, panelState, state);
  }

  /** Push the current settings into the pause-screen widgets (never fires a change). */
  function showSettings(cfg) {
    const c = cfg || {};
    if (settingNodes.volume) settingNodes.volume.value = String(Math.round((c.volume ?? 0.6) * 100));
    setText(settingNodes.volumeVal, `${Math.round((c.volume ?? 0.6) * 100)}%`);
    if (settingNodes.shadows) settingNodes.shadows.checked = c.shadows !== false;
    if (settingNodes.sens) settingNodes.sens.value = String(Math.round((c.mouseSensitivity ?? 1) * 100));
    setText(settingNodes.sensVal, `${(c.mouseSensitivity ?? 1).toFixed(2)}×`);
    setText(settingNodes.quality, c.qualityLabel || '');
  }

  /** Wire the settings widgets once. `handlers` = { onChange(patch), onQualityTest? }. */
  function bindSettings(handlers) {
    const h = handlers || {};
    const fire = (patch) => {
      if (typeof h.onChange === 'function') h.onChange(patch);
    };
    if (settingNodes.volume) {
      settingNodes.volume.addEventListener('input', () => {
        const v = Number(settingNodes.volume.value) / 100;
        setText(settingNodes.volumeVal, `${Math.round(v * 100)}%`);
        fire({ volume: v });
      });
    }
    if (settingNodes.shadows) {
      settingNodes.shadows.addEventListener('change', () => fire({ shadows: !!settingNodes.shadows.checked }));
    }
    if (settingNodes.sens) {
      settingNodes.sens.addEventListener('input', () => {
        const v = Number(settingNodes.sens.value) / 100;
        setText(settingNodes.sensVal, `${v.toFixed(2)}×`);
        fire({ mouseSensitivity: v });
      });
    }
    for (const node of Object.values(settingNodes)) {
      if (!node) continue;
      // Keep keyboard focus in the overlay instead of the game loop.
      node.addEventListener('keydown', (event) => event.stopPropagation());
    }
  }

  return { update, showScreen, showSettings, bindSettings };
}

export { FONT };
