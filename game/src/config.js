// Every tuning number and colour in one place. Solmar is a 5x5-block grid city:
// road centrelines every 50 m, 14 m wide roads, 36 m blocks, city edge at +/-132 m.
export const STEP = 1 / 60;
export const CITY = {
  pitch: 50, roadWidth: 14, blockSize: 36, bound: 132,
  roadLines: [-125, -75, -25, 25, 75, 125],
  blockCenters: [-100, -50, 0, 50, 100],
};
export const PLAYER = { walk: 4.2, run: 8.5, radius: 0.5, accel: 40 };
export const CAR = {
  accel: 16, brake: 32, reverseAccel: 10, maxSpeed: 30, maxReverse: 9,
  steer: 1.9, grip: 6, radius: 1.7, drag: 0.35,
};
// Street population. These were 8 cars / 22 people, which read as an evacuated city in a
// 1280x720 frame — the weakest realism axis once lighting was fixed (a busy street is the
// single strongest "this place is alive" cue). Measured cost of the raise: see the bench
// numbers in the report; the scene sits far below the draw budget, so the gain in life is
// nearly free. Spawns come from the seeded RNG, so the layout stays reproducible.
export const TRAFFIC_CARS = 35;
export const PEDESTRIANS = 90;
export const PARKED_CARS = 10;
export const START_MONEY = 250;
// Ana Deluca's office corner (mission 1 marker).
export const MISSION_MARKER = { x: 112, z: 112, label: "Ana's office" };
// Mission 2: pick the package up north-west, deliver it south-east. Mission 4: the
// south-west corner. Mission 5: the docks, west edge on the 25 road.
export const PACKAGE_PICKUP = { x: -112, z: 112 };
export const PACKAGE_DROPOFF = { x: 112, z: -112 };
export const GETAWAY_MARKER = { x: -112, z: -112 };
export const DOCKS = { x: -125, z: 25 };
export const MISSION2_TIME = 120; // seconds to make the delivery; gentle, no fail
export const MISSION_REWARDS = [100, 150, 200, 250, 500, 300, 600];
// The safehouse Rio wakes up at after being busted or wasted; the respawn penalty.
export const SAFEHOUSE = { x: -25, z: -18 };
export const RESPAWN_PENALTY = 50;
// Police: how many cars chase per wanted level, how fast, how close they spawn,
// how far Rio must stay from every police car to cool a star off.
export const POLICE = {
  maxActive: 4, cruise: 20, perStar: 2, maxSpeed: 30, turn: 2.4,
  spawnDist: 52, tooFar: 82, sightDist: 45, bustDist: 3.4, bustSpeed: 3,
  decayBase: 4, decayPerStar: 2,
};
// Pistol: a 12-round magazine, reserve ammo, pickups around town.
export const AMMO = {
  magSize: 12, startMag: 12, startReserve: 24, pickupAmount: 12,
  pickupRespawn: 45, reloadTime: 0.9, fireCooldown: 0.25,
};
export const PICKUP_SPOTS = [
  { x: -16, z: 16 }, { x: 66, z: -16 }, { x: -66, z: 66 },
];
// Crimes and their wanted cost: steal a car, hit a pedestrian with a car,
// hit a traffic car while driving, fire the pistol in public.
export const CRIME = { steal: 1, hitPed: 2, hitCar: 1, shoot: 1 };
export const CRIME_COOLDOWN = 3; // seconds before the same crime can raise wanted again
export const PALETTE = {
  sky: 0x8ec8ee, fog: 0xf0b9a3, sun: 0xffe5bd, hemiSky: 0xa8c4e0, hemiGround: 0x6a5a4a,
  asphalt: 0x625b56, sidewalk: 0xb8a58e, curb: 0xd6c7b6,
  facades: [0xd9a066, 0xc98d7a, 0xe0c090, 0xa8b8c4, 0xcf9a8a, 0xb5c4a8, 0xd8b878, 0x9fb4c8],
  districtFacades: {
    harbor: [0xc9825c, 0xd49a6b, 0xb98567, 0xe0b779],
    downtown: [0x829eae, 0x8faab6, 0x6f8798, 0xb1c2c8],
    residential: [0xd9a066, 0xc98d7a, 0xe0c090, 0xcf9a8a, 0xd8b878],
  },
  windowDark: '#2c3542', windowLit: '#ffd98a',
  palmTrunk: 0x7a5c3e, palmLeaf: 0x3f8f4f, lampPole: 0x2f3338, lampGlow: 0xffe9a8,
  carColors: [0xc0392b, 0x2e86c1, 0xf1c40f, 0x1abc9c, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x2c3e50],
  pedColors: [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xd35400],
  policeWhite: 0xe8e8e8, policeBlack: 0x1c1f24, policeRed: 0xff2a2a, policeBlue: 0x2a6bff,
  hostile: 0x8e2f2f, pickup: 0x2ecc71,
};
// --- v5 lighting / atmosphere (owner W-A) -----------------------------------------
// SHADOW.mode picks the technique: 'map' = one real shadow-mapped sun, 'blob' = cheap
// instanced ellipse decals under cars and people. Measured, not guessed.
export const SHADOW = {
  mode: 'map',
  mapSize: 2048,
  extent: 80,       // half-size of the ortho frustum; TRACKS the player (see render.js),
                    // so 80 m at 2048 is 7.8 cm/texel instead of 168 m at 2048 = 16.4
  near: 1,
  far: 900,
  bias: -0.0004,
  normalBias: 0.08,
  intensity: 3.30,   // directional sun: raised with the sharper map so shadows read as shade
  hemi: 2.55,        // sky/ground fill: measured — below ~2.4 the shaded canyons (the
                     // 'shoot' frame sits in one) crush past 20% of the frame near black
  ambient: 0.54,     // flat lift so unlit faces never go black
};

// Late-afternoon sun at ~62° elevation: high enough that direct light still reaches down the
// street canyons (the el 48-51° sweeps crushed the shoot frame's road to 92% near-black), low
// enough that a 20 m block throws a ~11 m shadow which crosses most of a 14 m street. The
// readability of that shadow comes from the key:fill ratio and the sharp tracking shadow map,
// not from dropping the sun further. Direction is TOWARD the sun.
export const SUN_DIR = { x: -0.50, y: 0.88, z: -0.38 };
// Sky ramp, ground-up. The old ramp put a salmon haze (#fbd0aa) and a mid tone of #9fcae4
// over most of the upper frame, which read as white paper: measured on the staged chase
// frame, the sky band averaged 157/255 and dominated that frame's mean (149-154 against a
// 95-135 target). A clear noon sky is blue overhead and only warms near the horizon, so the
// mid/high tones are now proper sky blue and the warmth is confined to the last few degrees
// above the sea. The horizon keeps its warm haze — that is what sells the coast.
// Tighter haze than the flat 96/460 pair: a shorter near/far gives the canyons depth
// separation instead of one tonally uniform plane, and stops the skyline reading as a
// cut-out against a flat sky. Measured on the staged chase frame, which was the frame
// sitting furthest outside a realistic exposure band (mean luma 152.6, sky 210).
export const SKY = {
  fogColor: 0xe6c6a8,
  fogNear: 62,
  fogFar: 320,
  zenith: '#1f5f9e',
  high: '#3d84c0',
  mid: '#79b2d8',
  haze: '#dcc2a6',
  horizon: '#efd2b4',
  sunDisc: 0xfff4cf,
  sunGlow: 0xffb768,
};
export const CLOUDS = {
  height: 150,      // band centre above ground
  radius: 420,
  drift: 0.0022,    // texture offset per second
  opacity: 0.85,
};
export const WATER = {
  level: 0.06,
  edge: -137,       // city-side edge of the sea plane
  far: 780,         // how far out the plane runs
  span: 900,        // depth along z
  segX: 46,
  segZ: 30,
  waveAmp: 0.34,
  speed: 1.0,
};
// Street furniture counts, all merged into one buffer geometry (+ one instanced blob mesh).
export const PROPS = {
  bench: true, signal: true, planter: true, hydrant: true, bin: true,
  umbrella: true, railing: true, promenade: true,
};
export const SAVE_KEY = 'solmar.save.v2';
export const SAVE_KEY_V1 = 'solmar.save.v1';
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
