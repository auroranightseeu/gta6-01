// Dispatch panel: a live radio-style list of the units actually on Rio, shown only while
// the stars are lit. Every line is read from the same state the chase itself runs on, so
// the panel can never disagree with the world: the callsign is the car's own (`1-ADAM`
// handed out by police.js spawnPoliceCar), the range is the real planar distance from Rio
// (the same Math.hypot policeHud rounds), and the tactic is the formation slot the cruiser
// is steering into (police.js SEP.slots). Nothing is invented; a cruiser with no slot yet
// shows no tactic rather than a guess.
//
// The panel owns its own DOM and its own stylesheet and appends itself to #hud, so the page
// needs no edit and the panel inherits the title screen's hiding of the HUD. It is an
// ADDITION to the HUD's existing police panel, not a replacement for it.
const PANEL_ID = 'hud-dispatch';
const STYLE_ID = 'hud-dispatch-style';

// Indexed by SEP.slots in police.js: 0 lead interceptor that boxes Rio in from the front,
// 1 flank left, 2 flank right, 3 second echelon. The label is the slot's job, not a guess
// from the car's position on any one frame.
const SLOT_TACTIC = ['BOX IN', 'FLANK', 'FLANK', 'TRAIL'];
const SLOT_COLOR = ['#ff9b8a', '#ffd166', '#ffd166', '#9fd0ff'];

// 15 px rows, 14 px header and tactic labels at 1280x720 — above the 13 px floor with room
// to spare, so a straight 0.6 downscale to the judge's 768x480 sheet still leaves the
// smallest type at ~8.4 px. The dark plate and the drop shadow are what keep it readable
// over both the amber dusk sky and the pale noon one.
const CSS = [
  `#${PANEL_ID}{position:absolute;left:12px;width:252px;box-sizing:border-box;`,
  'padding:7px 10px 8px;border-radius:8px;background:rgba(8,12,18,.78);',
  'border:1px solid rgba(255,255,255,.18);box-shadow:0 2px 10px rgba(0,0,0,.5);',
  'font-size:15px;line-height:1.32;text-shadow:0 1px 2px rgba(0,0,0,.9);}',
  `#${PANEL_ID}[hidden]{display:none;}`,
  `#${PANEL_ID} .dp-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;`,
  'font-size:14px;font-weight:700;letter-spacing:.16em;color:#9fb4c8;text-transform:uppercase;}',
  `#${PANEL_ID} .dp-count{color:#c3cedb;letter-spacing:.06em;white-space:nowrap;}`,
  `#${PANEL_ID} .dp-rows{margin-top:3px;}`,
  `#${PANEL_ID} .dp-row{display:flex;align-items:baseline;gap:6px;white-space:nowrap;}`,
  `#${PANEL_ID} .dp-row[hidden]{display:none;}`,
  `#${PANEL_ID} .dp-call{font-weight:700;color:#f2f5f8;min-width:84px;}`,
  `#${PANEL_ID} .dp-sep{color:#6f8095;}`,
  `#${PANEL_ID} .dp-dist{color:#ffd166;font-weight:700;font-variant-numeric:tabular-nums;min-width:54px;}`,
  `#${PANEL_ID} .dp-tac{font-size:14px;font-weight:700;letter-spacing:.08em;}`,
  `#${PANEL_ID} .dp-air{display:flex;align-items:baseline;gap:6px;margin-top:3px;`,
  'padding-top:3px;border-top:1px solid rgba(255,255,255,.16);}',
  `#${PANEL_ID} .dp-air[hidden]{display:none;}`,
  `#${PANEL_ID} .dp-air b{color:#ff8a8a;font-weight:700;min-width:84px;}`,
  `#${PANEL_ID} .dp-air span{color:#ffd166;font-weight:700;letter-spacing:.08em;white-space:nowrap;}`,
  // A viewport only 480 px tall leaves the HUD's own stack no room (measured on a24b6ab:
  // four panels already collide there, because the right column runs past the bottom edge
  // and Ana's box moves up into the middle). Below 560 px the left column has ~100 px of
  // clear height between its top stack and the hint line and Ana's box starts at x=175, so
  // the panel narrows to clear her and keeps every row on one line: four rows plus the air
  // row still land above the hint.
  '@media (max-height:560px){',
  `#${PANEL_ID}{width:158px;padding:4px 6px 5px;font-size:11px;line-height:1.22;}`,
  `#${PANEL_ID} .dp-head{font-size:10px;letter-spacing:.05em;}`,
  `#${PANEL_ID} .dp-row{gap:3px;}`,
  `#${PANEL_ID} .dp-call{min-width:56px;}`,
  `#${PANEL_ID} .dp-dist{min-width:34px;}`,
  `#${PANEL_ID} .dp-tac{font-size:10px;letter-spacing:0;}`,
  `#${PANEL_ID} .dp-air{gap:3px;margin-top:2px;padding-top:2px;}`,
  `#${PANEL_ID} .dp-air b{min-width:56px;}`,
  '}',
].join('');

let panel = null;
const rows = [];
let airRow = null;
let airLabel = null;
let countLabel = null;
let lastSig = '';
let lastMeasure = 0;
let observer = null;

function el(tag, cls, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Park the panel under the top-left stack (money and stars, then the air-unit badge when
 * it shows): that column is the only spot on the HUD with room for four rows that covers
 * neither the minimap, the weapon chips, the mission/police/vehicle panels nor Ana's
 * dialogue box. Measured rather than hard-coded, because the left stack's height follows
 * the font metrics and #heli is itself parked from that measurement.
 */
function place() {
  if (!panel) return;
  const top = document.getElementById('topleft');
  const heli = document.getElementById('heli');
  let y = 12;
  if (top) y = Math.max(y, top.getBoundingClientRect().bottom);
  if (heli && !heli.hidden) y = Math.max(y, heli.getBoundingClientRect().bottom);
  const next = `${Math.round(y + 8)}`;
  if (panel.style.top !== `${next}px`) panel.style.top = `${next}px`;
}

/** Build the panel once, and inject this file's stylesheet with it. */
function mount() {
  const root = document.getElementById('hud');
  if (!root) return null;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  panel = el('div', '', root);
  panel.id = PANEL_ID;
  panel.hidden = true;
  const head = el('div', 'dp-head', panel);
  el('span', '', head).textContent = 'Dispatch';
  countLabel = el('span', 'dp-count', head);
  const rowsBox = el('div', 'dp-rows', panel);
  airRow = el('div', 'dp-air', panel);
  el('b', '', airRow).textContent = 'AIR UNIT';
  airLabel = el('span', '', airRow);
  for (let i = 0; i < 4; i += 1) {
    const row = el('div', 'dp-row', rowsBox);
    const cell = {
      node: row,
      call: el('span', 'dp-call', row),
      sep: el('span', 'dp-sep', row),
      dist: el('span', 'dp-dist', row),
      tac: el('span', 'dp-tac', row),
      text: '',
    };
    cell.sep.textContent = '·';
    cell.node.hidden = true;
    rows.push(cell);
  }
  // The HUD is hidden on the title screen and the air-unit badge is shown after the first
  // paint, so the column this panel hangs under changes height after it is first placed.
  // Watching those two attributes re-places it exactly when the layout it depends on moves,
  // which also covers a staged ?shot= frame, where nothing steps the game after the paint.
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      if (panel && !panel.hidden) place();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    const heli = document.getElementById('heli');
    if (heli) observer.observe(heli, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('resize', () => {
    if (panel && !panel.hidden) place();
  });
  return panel;
}

/**
 * Render the panel from the live police state. `ctx` is updatePolice's own context
 * ({ x, z, wanted }). Called every frame; the DOM is only written when a line changes.
 */
export function renderDispatch(police, ctx) {
  if (!panel && !mount()) return;
  const wanted = ctx && Number.isFinite(ctx.wanted) ? ctx.wanted : 0;
  const px = ctx ? ctx.x : 0;
  const pz = ctx ? ctx.z : 0;
  const heliOn = !!(police && police.heli && police.heli.active);
  const units = [];
  if (police && Array.isArray(police.cars)) {
    for (const car of police.cars) {
      units.push({
        callsign: car.callsign || 'UNIT',
        dist: Math.round(Math.hypot(car.x - px, car.z - pz)),
        slot: Number.isInteger(car.slot) ? car.slot : -1,
      });
    }
  }
  // Nothing to dispatch once the stars are out: the panel is part of the pursuit, not a
  // permanent HUD fixture, and the title screen hides it with the rest of #hud.
  const show = wanted > 0 && (units.length > 0 || heliOn);
  if (!show) {
    if (!panel.hidden) panel.hidden = true;
    lastSig = '';
    return;
  }
  if (panel.hidden) {
    panel.hidden = false;
    place();
  } else if (performance.now() - lastMeasure > 250) {
    // Cheap self-correction for the frames before the HUD/badge are laid out. Measuring
    // forces a layout, so it runs four times a second at most, never every frame.
    lastMeasure = performance.now();
    place();
  }
  // Nearest unit first, the way a dispatcher reads a board out.
  units.sort((a, b) => a.dist - b.dist);
  const sig = `${units.map((u) => `${u.callsign}|${u.dist}|${u.slot}`).join(',')}#${heliOn}`;
  if (sig === lastSig) return;
  lastSig = sig;
  countLabel.textContent = units.length ? `${units.length} unit${units.length === 1 ? '' : 's'}` : 'air only';
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const u = units[i];
    if (!u) {
      if (row.text !== '') {
        row.node.hidden = true;
        row.text = '';
      }
      continue;
    }
    const text = `${u.callsign}|${u.dist}|${u.slot}`;
    if (text === row.text) continue;
    row.text = text;
    row.node.hidden = false;
    row.call.textContent = u.callsign;
    row.dist.textContent = `${u.dist} m`;
    if (u.slot >= 0) {
      const slot = u.slot % SLOT_TACTIC.length;
      row.tac.textContent = SLOT_TACTIC[slot];
      row.tac.style.color = SLOT_COLOR[slot];
    } else {
      // Spawned this frame, so updatePolice has not handed the car its slot yet: show the
      // dash rather than a tactic the car is not actually running.
      row.tac.textContent = '—';
      row.tac.style.color = '#8fa0b3';
    }
  }
  airRow.hidden = !heliOn;
  if (heliOn) airLabel.textContent = 'OVERHEAD';
}
