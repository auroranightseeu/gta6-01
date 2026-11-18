// Missions + story: a five-job chain from fixer Ana Deluca. Each mission has an
// objective, a map marker, short dialogue and a cash reward. State is plain data so
// save.js can persist it and main.js can drive the transitions.
import {
  DOCKS, GETAWAY_MARKER, MISSION2_TIME, MISSION_MARKER, MISSION_REWARDS,
  PACKAGE_DROPOFF, PACKAGE_PICKUP,
} from './config.js';

export const MISSIONS = [
  {
    name: 'Meet Ana',
    reward: MISSION_REWARDS[0],
    target: MISSION_MARKER,
    intro: "Ana: Rio. My office, north-east corner. Don't keep me waiting.",
    objective: `Meet Ana Deluca — follow the amber marker ($${MISSION_REWARDS[0]})`,
    doneLine: 'Ana: good. $100. Solmar is yours, Rio.',
  },
  {
    name: 'The Package',
    reward: MISSION_REWARDS[1],
    target: PACKAGE_PICKUP,
    target2: PACKAGE_DROPOFF,
    timed: MISSION2_TIME,
    intro: 'Ana: a package waits north-west. Bring it south-east, quick but smooth.',
    objective: `Pick up Ana's package north-west ($${MISSION_REWARDS[1]})`,
    pickupLine: 'Package in hand. South-east corner, Rio — and keep it clean.',
    doneLine: 'Ana: package delivered. $150, as promised.',
  },
  {
    name: 'Cool Off',
    reward: MISSION_REWARDS[2],
    intro: 'Ana: the pickup was hot — the cops are on you. Lose them. All of them.',
    objective: `Lose the cops — get your wanted level to zero ($${MISSION_REWARDS[2]})`,
    doneLine: 'Ana: clean again. $200. You drive like a ghost, Rio.',
  },
  {
    name: 'Getaway',
    reward: MISSION_REWARDS[3],
    target: GETAWAY_MARKER,
    intro: 'Ana: one more run, south-west corner — and this time they will chase.',
    objective: `Getaway drive — reach the south-west marker ($${MISSION_REWARDS[3]})`,
    doneLine: 'Ana: beautiful driving. $250. One last job and we are done.',
  },
  {
    name: 'The Docks',
    reward: MISSION_REWARDS[4],
    target: DOCKS,
    intro: "Ana: drive my client to the docks, west edge. Rivals will be waiting. End it.",
    objective: `Drive Ana's client to the docks ($${MISSION_REWARDS[4]})`,
    defendLine: 'Rivals at the docks! Take them down — Ana’s crew has your back.',
    doneLine: 'Ana: the docks are ours. $500. Solmar is yours, Rio — all of it.',
  },
];

export function createMissions() {
  return { index: 0, done: [false, false, false, false, false], stage: 'go', timer: 0, hostilesDown: 0 };
}

export function currentMission(m) {
  return m.index < MISSIONS.length ? MISSIONS[m.index] : null;
}

export function allMissionsDone(m) {
  return m.index >= MISSIONS.length;
}

/** Where the amber marker should point right now, or null (evade / defend stages). */
export function missionTarget(m) {
  const def = currentMission(m);
  if (!def) return null;
  if (m.index === 1 && m.stage === 'deliver') return def.target2;
  if (m.index === 2) return null; // evade: no marker, just lose the cops
  if (m.index === 4 && m.stage === 'defend') return null; // defend: stay at the docks
  return def.target || null;
}

export function missionText(m) {
  const def = currentMission(m);
  if (!def) return 'All jobs done — Solmar is yours.';
  if (m.index === 1 && m.stage === 'deliver') {
    const t = Math.max(0, Math.ceil(m.timer));
    const clock = m.timer > 0 ? ` · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} left` : '';
    return `Deliver the package south-east ($${def.reward}${clock})`;
  }
  if (m.index === 2) return def.objective;
  if (m.index === 4 && m.stage === 'defend') {
    return `Defend the docks — take down the rivals (${m.hostilesDown}/3) ($${def.reward})`;
  }
  return def.objective;
}

/** (Re)start the mission at index `i`: reset its stage and timer. Returns its intro line. */
export function beginMission(m, i) {
  const def = MISSIONS[i];
  m.index = i;
  m.stage = 'go';
  m.timer = def.timed || 0;
  m.hostilesDown = 0;
  return def.intro;
}
