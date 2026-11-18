// Drawing only, in three.js: the sun-soaked sky, the ground texture (asphalt, sidewalks,
// lane dashes drawn once on a canvas), the buildings with lit-window facades, lamps and
// palms, plus the little built-from-boxes people and cars. No rules live here.
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const GROUND_PX = 1024;
const WORLD = CITY.bound * 2 + 16; // ground plane spans a little past the city edge

function facadeTexture(colorHex, seed) {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, c.width, c.height);
  let state = (seed | 0) ^ 0x51a7;
  const rand = () => { state = (state * 1664525 + 1013904223) | 0; return (state >>> 0) / 4294967296; };
  const cols = 3 + Math.floor(rand() * 4);
  const rows = 7 + Math.floor(rand() * 6);
  const gapX = c.width / cols;
  const gapY = c.height / rows;
  const ww = gapX * (0.43 + rand() * 0.2);
  const wh = gapY * (0.45 + rand() * 0.2);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = gapX * col + (gapX - ww) / 2;
      const y = gapY * row + (gapY - wh) / 2;
      const roll = rand();
      const windowColor = roll < 0.18 ? '#ffd786'
        : roll < 0.30 ? '#ffad83'
          : roll < 0.39 ? '#b9e6d0'
            : roll < 0.56 ? '#526573' : '#394b58';
      g.fillStyle = windowColor;
      g.fillRect(x, y, ww, wh);
      if (roll < 0.39) {
        g.fillStyle = 'rgba(255,231,180,.28)';
        g.fillRect(x, y, ww, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = GROUND_PX;
  c.height = GROUND_PX;
  const g = c.getContext('2d');
  const s = GROUND_PX / WORLD; // px per metre
  const toPx = (v) => (v + WORLD / 2) * s;
  g.fillStyle = '#71675f';
  g.fillRect(0, 0, GROUND_PX, GROUND_PX);
  // Sidewalk slabs, one per block.
  g.fillStyle = '#b8a58e';
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      g.fillRect(toPx(bx - 18), toPx(bz - 18), 36 * s, 36 * s);
    }
  }
  // Pale kerb edge around each block.
  g.strokeStyle = '#d6c7b6';
  g.lineWidth = 2;
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      g.strokeRect(toPx(bx - 18), toPx(bz - 18), 36 * s, 36 * s);
    }
  }
  // Short amber-white lane dashes, with visible zebra bars at intersections.
  g.fillStyle = '#f1dfb4';
  for (const line of CITY.roadLines) {
    for (let d = -130; d < 130; d += 10) {
      g.fillRect(toPx(line) - 1, toPx(d), 2, 3.2 * s);
      g.fillRect(toPx(d), toPx(line) - 1, 3.2 * s, 2);
    }
  }
  g.fillStyle = '#f4e8cf';
  for (const ix of CITY.roadLines) {
    for (const iz of CITY.roadLines) {
      for (let k = -3; k <= 3; k += 1) {
        g.fillRect(toPx(ix + k * 1.35), toPx(iz - 5.1), 0.78 * s, 3.8 * s);
        g.fillRect(toPx(ix + k * 1.35), toPx(iz + 5.1), 0.78 * s, 3.8 * s);
        g.fillRect(toPx(ix - 5.1), toPx(iz + k * 1.35), 3.8 * s, 0.78 * s);
        g.fillRect(toPx(ix + 5.1), toPx(iz + k * 1.35), 3.8 * s, 0.78 * s);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makePersonMesh(color, style = 0) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });
  const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
  legGeo.translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.14, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.14, 0.8, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), mat);
  torso.position.y = 1.12;
  const armGeo = new THREE.BoxGeometry(0.16, 0.62, 0.16);
  armGeo.translate(0, -0.31, 0);
  const armL = new THREE.Mesh(armGeo, mat);
  armL.position.set(-0.37, 1.38, 0);
  const armR = new THREE.Mesh(armGeo, mat);
  armR.position.set(0.37, 1.38, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.y = 1.62;
  group.add(legL, legR, torso, armL, armR, head);
  if (style === 1) {
    group.scale.set(0.82, 1.14, 0.82);
    torso.scale.x = 1.25;
    head.geometry = new THREE.SphereGeometry(0.2, 8, 6);
  }
  group.userData = { legL, legR, armL, armR };
  return group;
}

function makeCarMesh(color, type = 'sedan') {
  const group = new THREE.Group();
  const profile = type === 'sports'
    ? { width: 2.02, bodyH: 0.43, length: 4.65, cabinW: 1.48, cabinH: 0.35, cabinL: 1.75, cabinY: 0.89, cabinZ: -0.35, roofW: 1.43, roofL: 1.58, roofY: 1.08, wheelX: 0.93, wheelZ: 1.5, wheelR: 0.31 }
    : type === 'van'
      ? { width: 2.08, bodyH: 0.68, length: 4.45, cabinW: 1.76, cabinH: 1.0, cabinL: 2.75, cabinY: 1.35, cabinZ: -0.18, roofW: 1.78, roofL: 2.55, roofY: 1.88, wheelX: 0.94, wheelZ: 1.4, wheelR: 0.37 }
      : type === 'pickup'
        ? { width: 2.02, bodyH: 0.6, length: 4.5, cabinW: 1.66, cabinH: 0.68, cabinL: 1.65, cabinY: 1.18, cabinZ: -0.72, roofW: 1.62, roofL: 1.5, roofY: 1.58, wheelX: 0.92, wheelZ: 1.42, wheelR: 0.37 }
        : { width: 1.9, bodyH: 0.55, length: 4.2, cabinW: 1.6, cabinH: 0.5, cabinL: 2.1, cabinY: 1.05, cabinZ: -0.25, roofW: 1.55, roofL: 1.9, roofY: 1.32, wheelX: 0.88, wheelZ: 1.35, wheelR: 0.36 };
  const paint = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.09 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x4a7f91, emissive: 0x153344, emissiveIntensity: 0.2 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x111318 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c1, metalness: 0.78, roughness: 0.24 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(profile.width, profile.bodyH, profile.length), paint);
  body.position.y = profile.bodyH;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(profile.cabinW, profile.cabinH, profile.cabinL), glass);
  cabin.position.set(0, profile.cabinY, profile.cabinZ);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(profile.roofW, 0.08, profile.roofL), paint);
  roof.position.set(0, profile.roofY, profile.cabinZ);
  group.add(body, cabin, roof);
  if (type === 'pickup') {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.18, 1.28), new THREE.MeshLambertMaterial({ color: 0x41454a }));
    bed.position.set(0, 0.83, 1.05);
    group.add(bed);
  }
  const wheelGeo = new THREE.CylinderGeometry(profile.wheelR, profile.wheelR, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-profile.wheelX, profile.wheelZ], [profile.wheelX, profile.wheelZ], [-profile.wheelX, -profile.wheelZ], [profile.wheelX, -profile.wheelZ]]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(wx, 0.36, wz);
    wheels.push(w);
    group.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx * 1.06, 0.36, wz);
    group.add(hub);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1bd, toneMapped: false });
  for (const lx of [-profile.width * 0.32, profile.width * 0.32]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), lampMat);
    lamp.position.set(lx, 0.62, profile.length / 2 + 0.01);
    group.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xc0392b });
  for (const lx of [-profile.width * 0.32, profile.width * 0.32]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat);
    tail.position.set(lx, 0.62, -profile.length / 2 - 0.01);
    group.add(tail);
  }
  group.userData = { wheels, body };
  return group;
}

function makePackageMesh() {
  const group = new THREE.Group();
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 1.0), new THREE.MeshLambertMaterial({ color: 0xc8844d, emissive: 0x3c1d0d }));
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 1.04), new THREE.MeshBasicMaterial({ color: 0xffd66b }));
  group.add(parcel, ribbon);
  group.userData.parcel = parcel;
  return group;
}

// The bar lights are separate meshes so police.js can flash them.
function makePoliceCarMesh() {
  const group = makeCarMesh(PALETTE.policeWhite);
  const black = new THREE.MeshLambertMaterial({ color: PALETTE.policeBlack });
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.1), black);
  hood.position.set(0, 0.86, 1.5);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.9), black);
  trunk.position.set(0, 0.86, -1.65);
  group.add(hood, trunk);
  const doorGeo = new THREE.BoxGeometry(0.06, 0.5, 2.0);
  for (const sx of [-1, 1]) {
    const door = new THREE.Mesh(doorGeo, black);
    door.position.set(sx * 0.97, 0.62, 0);
    group.add(door);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.34), black);
  bar.position.set(0, 1.42, -0.25);
  group.add(bar);
  const lightR = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.policeRed }),
  );
  lightR.position.set(-0.28, 1.54, -0.25);
  const lightB = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.policeBlue }),
  );
  lightB.position.set(0.28, 1.54, -0.25);
  group.add(lightR, lightB);
  group.userData.lightR = lightR;
  group.userData.lightB = lightB;
  return group;
}

// An ammo pickup: a small floating green crate, spun by combat.js.
function makePickupMesh() {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshLambertMaterial({ color: PALETTE.pickup, emissive: 0x1a5c34 }),
  );
  box.position.y = 0.9;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.74, 0.12, 0.74),
    new THREE.MeshBasicMaterial({ color: 0xd5f5e3 }),
  );
  lid.position.y = 1.28;
  group.add(box, lid);
  group.userData.box = box;
  return group;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 145, 400);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  // A large inverted sphere gives the horizon a warm coastal gradient without assets.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGradient = skyCtx.createLinearGradient(0, 256, 0, 0);
  skyGradient.addColorStop(0, '#f4ad92');
  skyGradient.addColorStop(0.34, '#f6c7a7');
  skyGradient.addColorStop(0.68, '#a9d5ef');
  skyGradient.addColorStop(1, '#5c9ed0');
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(11, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c2, toneMapped: false, fog: false }));
  sunDisc.position.set(-230, 180, -320);
  scene.add(sunDisc);
  const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(24, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffc77a, transparent: true, opacity: 0.2, depthWrite: false, fog: false }));
  sunGlow.position.copy(sunDisc.position);
  scene.add(sunGlow);

  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.95));
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 500;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A broad sea plane meets the west edge; the tan beach and small harbor sit by the docks.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(430, 420), new THREE.MeshStandardMaterial({ color: 0x238cb1, roughness: 0.34, metalness: 0.16, emissive: 0x0a3145, emissiveIntensity: 0.2 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(-350, -0.16, 0);
  scene.add(water);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(15, 280), new THREE.MeshLambertMaterial({ color: 0xd9b57b }));
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-138, -0.08, 0);
  scene.add(beach);
  const dock = new THREE.Mesh(new THREE.BoxGeometry(12, 0.7, 7), new THREE.MeshLambertMaterial({ color: 0x886b50 }));
  dock.position.set(-145, 0.25, 25);
  scene.add(dock);
  const pier = new THREE.Mesh(new THREE.BoxGeometry(4, 0.55, 23), new THREE.MeshLambertMaterial({ color: 0x9b7856 }));
  pier.position.set(-139, 0.18, 25);
  scene.add(pier);
  const buoyMat = new THREE.MeshBasicMaterial({ color: 0xffa84e });
  for (const z of [17, 33]) {
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), buoyMat);
    buoy.position.set(-147, 0.4, z);
    scene.add(buoy);
  }
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 19, 10), new THREE.MeshLambertMaterial({ color: 0xf0d7a3 }));
  tower.position.y = 9.5;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.2, 10), new THREE.MeshLambertMaterial({ color: 0x36515d }));
  lantern.position.y = 20;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.8, 10), new THREE.MeshLambertMaterial({ color: 0xc6543e }));
  cap.position.y = 22.4;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffefb2, toneMapped: false }));
  lamp.position.set(0, 20, 0);
  lighthouse.add(tower, lantern, cap, lamp);
  lighthouse.position.set(-151, 0, 52);
  scene.add(lighthouse);
  const downtownTower = new THREE.Group();
  const glassTower = new THREE.Mesh(new THREE.BoxGeometry(14, 50, 14), new THREE.MeshLambertMaterial({ color: 0x7196a6, emissive: 0x18394a, emissiveIntensity: 0.2, transparent: true, opacity: 0.82 }));
  glassTower.position.y = 25;
  const towerCrown = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 16), new THREE.MeshLambertMaterial({ color: 0xffc36d }));
  towerCrown.position.y = 50;
  downtownTower.add(glassTower, towerCrown);
  downtownTower.position.set(9, 0, 9);
  scene.add(downtownTower);

  // Building footprints remain the generated originals; ornament uses stable position-derived seeds.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const facadeCache = new Map();
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xe5c99b });
  const acMat = new THREE.MeshLambertMaterial({ color: 0x89939a });
  const tankMat = new THREE.MeshLambertMaterial({ color: 0xd1d0bd });
  const awningColors = [0xc6543e, 0x218c91, 0xd29a42, 0x496a94];
  const seedOf = (b) => (Math.round((b.x + 150) * 17 + (b.z + 150) * 83 + b.h * 9) | 0);
  for (const b of city.buildings) {
    const seed = seedOf(b);
    const facadeKey = `${b.color}:${seed}`;
    if (!facadeCache.has(facadeKey)) facadeCache.set(facadeKey, facadeTexture(b.color, seed));
    const tex = facadeCache.get(facadeKey).clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, Math.round(b.h / 14)));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const side = new THREE.MeshLambertMaterial({ map: tex });
    const roof = new THREE.MeshLambertMaterial({ color: b.color });
    const mesh = new THREE.Mesh(boxGeo, [side, side, roof, roof, side, side]);
    mesh.position.set(b.x, 0, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const parapet = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.45, 0.38, b.d + 0.45), trimMat);
    parapet.position.set(b.x, b.h + 0.08, b.z);
    scene.add(parapet);
    for (const [dx, dz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
      if (((seed + Math.round((dx + dz) * 10)) & 1) !== 0) continue;
      const unit = Math.max(1, Math.min(b.w, b.d));
      const ac = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.3, 0.8, unit * 0.27), acMat);
      ac.position.set(b.x + dx * unit, b.h + 0.56, b.z + dz * unit);
      scene.add(ac);
    }
    if (seed % 4 === 0 && b.h > 9) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 10), tankMat);
      tank.position.set(b.x, b.h + 1.55, b.z);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5), trimMat);
      legs.position.set(b.x, b.h + 0.65, b.z);
      scene.add(tank, legs);
    }
    if (Math.abs(b.x) < 60 && Math.abs(b.z) < 60) {
      const awningColor = awningColors[(seed >>> 2) % awningColors.length];
      const awning = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.82, 0.45, 2.0), new THREE.MeshLambertMaterial({ color: awningColor }));
      awning.position.set(b.x, 3.1, b.z + b.d / 2 + 0.15);
      scene.add(awning);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.7, 0.9, 0.22), new THREE.MeshLambertMaterial({ color: 0x183642, emissive: awningColor, emissiveIntensity: 0.23 }));
      sign.position.set(b.x, 4.15, b.z + b.d / 2 + 0.22);
      scene.add(sign);
      const letters = document.createElement('canvas');
      letters.width = 256; letters.height = 64;
      const pen = letters.getContext('2d');
      pen.fillStyle = '#fff0c8'; pen.font = 'bold 30px sans-serif'; pen.textAlign = 'center';
      pen.fillText(['MARINA', 'CAFE', 'PALMS', 'MOTEL'][(seed >>> 4) % 4], 128, 44);
      const signTexture = new THREE.CanvasTexture(letters);
      signTexture.colorSpace = THREE.SRGBColorSpace;
      sign.material = new THREE.MeshBasicMaterial({ map: signTexture });
    }
  }

  const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.lampPole });
  const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.lampGlow });
  for (const lamp of city.lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6), poleMat);
    pole.position.set(lamp.x, 2.6, lamp.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.09), poleMat);
    arm.position.set(lamp.x + 0.52, 5.05, lamp.z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), glowMat);
    head.position.set(lamp.x + 0.95, 4.95, lamp.z);
    scene.add(pole, arm, head);
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk });
  const leafMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf });
  for (const palm of city.palms) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.4, 6), trunkMat);
    trunk.position.set(palm.x, 2.2, palm.z);
    trunk.rotation.z = 0.08;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), leafMat);
    crown.position.set(palm.x + 0.35, 4.9, palm.z);
    crown.scale.y = 0.58;
    crown.castShadow = true;
    scene.add(trunk, crown);
    const frondGeo = new THREE.ConeGeometry(0.45, 4.0, 5);
    frondGeo.translate(0, -1.9, 0);
    for (let i = 0; i < 8; i += 1) {
      const frond = new THREE.Mesh(frondGeo, leafMat);
      frond.position.set(palm.x + 0.35, 5.45, palm.z);
      frond.rotation.y = i * Math.PI / 4;
      frond.rotation.x = 0.72;
      frond.castShadow = true;
      scene.add(frond);
    }
  }

  // A few clean coastal wayfinding boards add scale beside the roads.
  const signPost = new THREE.MeshLambertMaterial({ color: 0x59666b });
  for (const [x, z, label] of [[-108, 14, 'DOCKS'], [-64, 68, 'BEACH'], [61, -64, 'MARINA']]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6), signPost);
    post.position.set(x, 1.6, z);
    const face = document.createElement('canvas'); face.width = 256; face.height = 96;
    const ctx = face.getContext('2d');
    ctx.fillStyle = '#16645f'; ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = '#f1d69e'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 248, 88);
    ctx.fillStyle = '#fff2ce'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 128, 50);
    const board = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.8, 0.18), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(face) }));
    board.position.set(x, 3.25, z);
    scene.add(post, board);
  }

  // Mission marker: a tall amber beacon so the objective reads at a glance.
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  beam.position.y = 30;
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 2.6, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc93c }),
  );
  pin.position.y = 4;
  pin.rotation.x = Math.PI;
  beacon.add(beam, pin);
  scene.add(beacon);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    scene,
    camera,
    makePerson: makePersonMesh,
    makeCar: makeCarMesh,
    makePackage: makePackageMesh,
    makePoliceCar: makePoliceCarMesh,
    makePickup: makePickupMesh,
    setBeacon(x, z, visible) {
      beacon.position.set(x, 0, z);
      beacon.visible = visible;
    },
    placeCamera(target, yaw, pitch, dist, lift = 0) {
      const cp = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cp * dist,
        target.y + Math.sin(pitch) * dist + lift,
        target.z + Math.cos(yaw) * cp * dist,
      );
      camera.lookAt(target.x, target.y + 1.5, target.z);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
