// Save: one localStorage key, namespaced for Solmar v2 — money, health, position,
// missions, ammo. A v1 save (money/health/position/missionDone) still loads, with
// its single mission mapped onto the first mission of the chain.
import { SAVE_KEY, SAVE_KEY_V1 } from './config.js';

export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
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
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money, health: state.health, x: state.x, z: state.z,
      missionIndex: state.missionIndex, missionsDone: state.missionsDone,
      missionStage: state.missionStage, ammoMag: state.ammoMag, ammoReserve: state.ammoReserve,
      packageCount: state.packageCount || 0, packageFound: state.packageFound || [],
    }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}
