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

function facadeTexture(colorHex, lit) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const x = 8 + col * 20;
      const y = 10 + row * 20;
      g.fillStyle = lit ? PALETTE.windowLit : PALETTE.windowDark;
      g.fillRect(x, y, 12, 14);
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
  g.fillStyle = '#3c4148';
  g.fillRect(0, 0, GROUND_PX, GROUND_PX);
  // Sidewalk slabs, one per block.
  g.fillStyle = '#9a938a';
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      g.fillRect(toPx(bx - 18), toPx(bz - 18), 36 * s, 36 * s);
    }
  }
  // Pale kerb edge around each block.
  g.strokeStyle = '#7d766d';
  g.lineWidth = 2;
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      g.strokeRect(toPx(bx - 18), toPx(bz - 18), 36 * s, 36 * s);
    }
  }
  // Dashed centre lines down every road.
  g.fillStyle = '#e8e4d8';
  for (const line of CITY.roadLines) {
    for (let d = -130; d < 130; d += 8) {
      g.fillRect(toPx(line) - 1, toPx(d), 2, 4 * s);
      g.fillRect(toPx(d), toPx(line) - 1, 4 * s, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makePersonMesh(color) {
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
  group.userData = { legL, legR, armL, armR };
  return group;
}

function makeCarMesh(color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1c2733 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x16181c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), paint);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.1), glass);
  cabin.position.set(0, 1.05, -0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 1.9), paint);
  roof.position.set(0, 1.32, -0.25);
  group.add(body, cabin, roof);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.88, 1.35], [0.88, 1.35], [-0.88, -1.35], [0.88, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(wx, 0.36, wz);
    wheels.push(w);
    group.add(w);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const lx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), lampMat);
    lamp.position.set(lx, 0.62, 2.11);
    group.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xc0392b });
  for (const lx of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tailMat);
    tail.position.set(lx, 0.62, -2.11);
    group.add(tail);
  }
  group.userData = { wheels, body };
  return group;
}

// A police car: white body, black doors and hood, red/blue light bar on the roof.
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
  scene.fog = new THREE.Fog(PALETTE.fog, 130, 430);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

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

  // Buildings: one shared box, one facade texture per colour, roof in plain colour.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const facadeCache = new Map();
  for (const b of city.buildings) {
    if (!facadeCache.has(b.color)) {
      facadeCache.set(b.color, facadeTexture(b.color, false));
    }
    const tex = facadeCache.get(b.color).clone();
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
  }

  const poleMat = new THREE.MeshLambertMaterial({ color: PALETTE.lampPole });
  const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.lampGlow });
  for (const lamp of city.lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6), poleMat);
    pole.position.set(lamp.x, 2.6, lamp.z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat);
    head.position.set(lamp.x, 5.3, lamp.z);
    scene.add(pole, head);
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk });
  const leafMat = new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf });
  for (const palm of city.palms) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.4, 6), trunkMat);
    trunk.position.set(palm.x, 2.2, palm.z);
    trunk.rotation.z = 0.08;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 0), leafMat);
    crown.position.set(palm.x + 0.35, 4.9, palm.z);
    crown.scale.y = 0.75;
    crown.castShadow = true;
    scene.add(trunk, crown);
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
