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
export const TRAFFIC_CARS = 8;
export const PEDESTRIANS = 14;
export const PARKED_CARS = 10;
export const START_MONEY = 250;
// Ana Deluca's office corner (mission marker for v1).
export const MISSION_MARKER = { x: 112, z: 112, label: "Ana's office" };
export const PALETTE = {
  sky: 0x8ec8ee, fog: 0xc3d9ec, sun: 0xfff2d8, hemiSky: 0xbfd9ff, hemiGround: 0x8a7f70,
  asphalt: 0x3c4148, sidewalk: 0x9a938a, curb: 0x7d766d,
  facades: [0xd9a066, 0xc98d7a, 0xe0c090, 0xa8b8c4, 0xcf9a8a, 0xb5c4a8, 0xd8b878, 0x9fb4c8],
  windowDark: '#2c3542', windowLit: '#ffd98a',
  palmTrunk: 0x7a5c3e, palmLeaf: 0x3f8f4f, lampPole: 0x2f3338, lampGlow: 0xffe9a8,
  carColors: [0xc0392b, 0x2e86c1, 0xf1c40f, 0x1abc9c, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x2c3e50],
  pedColors: [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xd35400],
};
export const SAVE_KEY = 'solmar.save.v1';
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
