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
