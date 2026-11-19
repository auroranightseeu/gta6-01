// Missions + story: a ten-job chain from fixer Ana Deluca — Meet Ana, The Package,
// Cool Off, Getaway, The Docks, The Night Ferry, The Last Light, The Night Shift,
// Cash and Carry, The Long Way Home. Each mission has an objective, a map marker,
// short dialogue and a cash reward. State is plain data so save.js can persist it
// and main.js can drive the transitions.
import {
  DOCKS, GETAWAY_MARKER, MISSION2_TIME, MISSION_MARKER, MISSION_REWARDS,
  PACKAGE_DROPOFF, PACKAGE_PICKUP,
} from './config.js';

// Rewards for the v5 missions live here, not in config.js (another worker owns that
// file and MISSION_REWARDS stops at seven entries).
const REWARD_TOWER = 350;
const REWARD_CASH = 400;
const REWARD_FINALE = 750;
const CASH_TIME = 150; // seconds to make the cash run; generous, same as mission 2

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
    doneLine: 'Ana: the docks are ours. $500. One last pair of jobs, Rio.',
  },
  {
    name: 'The Night Ferry',
    reward: MISSION_REWARDS[5],
    target: { x: -112, z: -12, label: 'ferry office' },
    target2: { x: 112, z: 12, label: 'east garage' },
    intro: 'Ana: pick up the ferry manifest on the west side. Bring it to the east garage.',
    objective: `Collect Ana's ferry manifest ($${MISSION_REWARDS[5]})`,
    pickupLine: 'Manifest secured. East garage, and keep the route quiet.',
    doneLine: 'Ana: the ferry is clear. $300, Rio.',
  },
  {
    name: 'The Last Light',
    reward: MISSION_REWARDS[6],
    target: { x: 0, z: 112, label: 'hilltop lookout' },
    intro: 'Ana: the handoff is at the hilltop lookout. Take the city in on your way up.',
    objective: `Make the handoff at the hilltop ($${MISSION_REWARDS[6]})`,
    doneLine: 'Ana: that is seven. $600, Rio. But the tower is still talking — one more visit.',
  },
  // --- v5 additions: three more jobs, so the chain runs ten deep ----------------
  {
    name: 'The Night Shift',
    reward: REWARD_TOWER,
    target: { x: 100, z: 75, label: 'the radio tower' },
    intro: "Ana: someone is running our traffic off a transmitter on the north road. Go dark on them.",
    objective: `Kill the rival transmitter at the radio tower ($${REWARD_TOWER})`,
    doneLine: `Ana: dead air. Beautiful. $${REWARD_TOWER} for that — now move the cash.`,
  },
  {
    name: 'Cash and Carry',
    reward: REWARD_CASH,
    target: { x: 25, z: 125, label: 'the coach station' },
    target2: { x: -112, z: -50, label: 'the boatyard' },
    timed: CASH_TIME,
    intro: 'Ana: there is a locker at the coach station with more money in it than sense. Bring it west.',
    objective: `Collect the cash from the coach station ($${REWARD_CASH})`,
    pickupLine: 'Bag is in the boot. Boatyard on the west edge — do not stop for anyone.',
    doneLine: `Ana: clean money, clean hands. $${REWARD_CASH}, Rio.`,
  },
  {
    name: 'The Long Way Home',
    reward: REWARD_FINALE,
    target: { x: 125, z: -25, label: 'the coast road' },
    intro: 'Ana: last one. The coast road, south-east. Come alone and come fast — I will explain when you get here.',
    objective: `Meet Ana on the coast road one last time ($${REWARD_FINALE})`,
    doneLine: `Ana: ten jobs, no mistakes. $${REWARD_FINALE}. Solmar is yours, Rio — go enjoy it.`,
  },
];

export function missionCount() {
  return MISSIONS.length;
}

export function createMissions() {
  return { index: 0, done: Array(MISSIONS.length).fill(false), stage: 'go', timer: 0, hostilesDown: 0 };
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
  if (def.target2 && m.stage === 'deliver') return def.target2;
  if (m.index === 2) return null; // evade: no marker, just lose the cops
  if (m.index === 4 && m.stage === 'defend') return null; // defend: stay at the docks
  return def.target || null;
}

/** What Rio is carrying on a two-leg job, per mission (the schema has no such key). */
const CARRY = { 1: 'package', 5: 'manifest', 8: 'cash' };

export function missionText(m) {
  const def = currentMission(m);
  if (!def) return 'All jobs done — Solmar is yours.';
  if (def.target2 && m.stage === 'deliver') {
    const t = Math.max(0, Math.ceil(m.timer));
    const clock = m.timer > 0 ? ` · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} left` : '';
    const what = CARRY[m.index] || 'package';
    return `Deliver the ${what} to ${def.target2.label || 'the drop-off'} ($${def.reward}${clock})`;
  }
  if (m.index === 2) return def.objective;
  if (m.index === 4 && m.stage === 'defend') {
    return `Defend the docks — take down the rivals (${m.hostilesDown}/3) ($${def.reward})`;
  }
  if (def.pickupLine && m.stage === 'go' && def.target) {
    return def.objective;
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
