// Save: three localStorage slots, namespaced for Solmar v2 — money, health, position,
// missions, ammo, plus every v5 extra the game puts on the state object (parcels,
// fares, side-job totals, weapon magazines, stats). Slot 1 IS the v2 key, so a save
// written before slots existed still loads as slot 1; slots 2 and 3 add `.slot2` and
// `.slot3`. A v1 save (money/health/position/missionDone) still loads, as slot 1, with
// its single mission mapped onto the first mission.
//
// main.js (an in-text file this round may not edit) reads the record once at boot and
// holds it in a closure, so readSave() hands back a LIVE view of the active slot: each
// property is read when Continue is honoured, after the player has picked a slot.
import { SAVE_KEY, SAVE_KEY_V1 } from './config.js';
import { installSlots } from './slots.js';

const SLOT_COUNT = 3;
const SLOT_STORE = 'solmar.slot.v1';

function storage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

// Held unpatched: the slot bookkeeping below must see the real keys, while the patch
// further down redirects the one key main.js names.
const proto = storage() ? window.Storage.prototype : null;
const nativeGet = proto ? proto.getItem : null;
const nativeSet = proto ? proto.setItem : null;

function slotKey(slot) {
  return slot === 1 ? SAVE_KEY : `${SAVE_KEY}.slot${slot}`;
}

function storedSlot() {
  try {
    const n = Number(nativeGet.call(window.localStorage, SLOT_STORE));
    return n === 2 || n === 3 ? n : 1;
  } catch {
    return 1;
  }
}

let activeSlot = storedSlot();

// main.js re-reads SAVE_KEY itself right after writeSave() to merge the v5 extras, and
// it names `solmar.save.v2` in its own code — a file this round may not edit. That one
// key therefore means "the active slot": a run in slot 2 autosaves to slot 2 and the
// extras merge there too, never over slot 1. Every other key (settings included) and
// this module's own bookkeeping go through the unpatched reads below.
if (proto) {
  proto.getItem = function getItem(key) {
    return nativeGet.call(this, key === SAVE_KEY ? slotKey(activeSlot) : key);
  };
  proto.setItem = function setItem(key, value) {
    return nativeSet.call(this, key === SAVE_KEY ? slotKey(activeSlot) : key, value);
  };
}

// Keys stored as null/undefined are dropped: a null side-job block must not overwrite
// a good one from an earlier save, and JSON cannot carry undefined anyway.
function keeper(state) {
  const out = {};
  for (const key of Object.keys(state)) {
    const value = state[key];
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

function parse(raw, slot) {
  if (raw !== null && raw !== undefined) {
    const v2 = JSON.parse(raw);
    return v2 && typeof v2 === 'object' ? v2 : null;
  }
  if (slot !== 1) return null;
  const old = nativeGet.call(window.localStorage, SAVE_KEY_V1);
  if (!old) return null;
  const v1 = JSON.parse(old);
  return {
    money: v1.money, health: v1.health, x: v1.x, z: v1.z,
    missionIndex: v1.missionDone ? 1 : 0,
    missionsDone: [!!v1.missionDone, false, false, false, false],
    missionStage: 'go', ammoMag: 12, ammoReserve: 24,
  };
}

function slotData(slot) {
  try {
    const raw = nativeGet.call(window.localStorage, slotKey(slot));
    return { raw, record: parse(raw, slot) };
  } catch {
    return { raw: null, record: null };
  }
}

// One parse per (slot, raw) pair: applySave touches ~15 properties in a row.
let cache = { slot: 0, raw: null, record: null };

function activeRecord() {
  const { raw, record } = slotData(activeSlot);
  if (cache.slot === activeSlot && cache.raw === raw) return cache.record;
  cache = { slot: activeSlot, raw, record };
  return record;
}

export function readSave() {
  if (!storage()) return null;
  return new Proxy({}, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      const record = activeRecord();
      return record ? record[prop] : undefined;
    },
  });
}

export function writeSave(state) {
  try {
    const next = keeper(state);
    // Merge over the stored record rather than replacing it, so a caller that omits a
    // key (an old call site, or a field the current run does not track) does not erase
    // it. writeSave is also called on every autosave, so this keeps v5 keys alive.
    const prev = slotData(activeSlot).record || {};
    nativeSet.call(window.localStorage, slotKey(activeSlot), JSON.stringify({ ...prev, ...next }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

export function getActiveSlot() {
  return activeSlot;
}

export function setActiveSlot(slot) {
  activeSlot = slot === 2 || slot === 3 ? slot : 1;
  try {
    nativeSet.call(window.localStorage, SLOT_STORE, String(activeSlot));
  } catch {
    // Private window: the choice lasts this visit only.
  }
}

// What one chip on the title screen reads. `saved` is the only field Continue needs;
// the numbers come from the record itself, never from a stored summary.
function slotInfo(slot) {
  const { record } = slotData(slot);
  if (!record) return { slot, saved: false };
  const done = Array.isArray(record.missionsDone) ? record.missionsDone : [];
  const index = Number.isFinite(record.missionIndex) ? record.missionIndex : 0;
  return {
    slot,
    saved: true,
    money: Number.isFinite(record.money) ? record.money : null,
    mission: done.length && done.every(Boolean) ? 'All missions' : `Mission ${index + 1}`,
  };
}

installSlots({
  count: SLOT_COUNT,
  getActive: () => activeSlot,
  setActive: setActiveSlot,
  info: slotInfo,
});
