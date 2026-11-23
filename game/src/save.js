// Save: one localStorage key, namespaced for Solmar v2 — money, health, position,
// missions, ammo, plus every v5 extra the game puts on the state object (parcels,
// fares, side-job totals, weapon magazines, stats). A v1 save (money/health/position/
// missionDone) still loads, with its single mission mapped onto the first mission.
//
// v5 (owner W-D): writeSave() copies ALL of `state` instead of a fixed key list, so a
// new field needs no change here. readSave() hands the record back untouched, and a
// field that is missing simply reads as undefined — an old save still loads.
import { SAVE_KEY, SAVE_KEY_V1 } from './config.js';

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

export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      const v2 = JSON.parse(raw);
      return v2 && typeof v2 === 'object' ? v2 : null;
    }
    const old = window.localStorage.getItem(SAVE_KEY_V1);
    if (!old) return null;
    const v1 = JSON.parse(old);
    return {
      money: v1.money, health: v1.health, x: v1.x, z: v1.z,
      missionIndex: v1.missionDone ? 1 : 0,
      missionsDone: [!!v1.missionDone, false, false, false, false],
      missionStage: 'go', ammoMag: 12, ammoReserve: 24,
    };
  } catch {
    return null;
  }
}

export function writeSave(state) {
  try {
    const next = keeper(state);
    // Merge over the stored record rather than replacing it, so a caller that omits a
    // key (an old call site, or a field the current run does not track) does not erase
    // it. writeSave is also called on every autosave, so this keeps v5 keys alive.
    let prev = {};
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') prev = parsed;
      }
    } catch {
      prev = {};
    }
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ ...prev, ...next }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}
