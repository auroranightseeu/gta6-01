import * as THREE from 'three';

// Golden-hour sky: orange horizon -> pink -> blue zenith, a big low sun disc and a wide
// amber glow. One dome, one disc, one halo — the same three cheap objects render.js draws
// at noon, so this swaps the look, not the cost.
const SUN_DIR = new THREE.Vector3(-0.90, 0.30, -0.32).normalize();
const RAMP = [
  [0, '#ffb072'], [0.3, '#f2a2a0'],
  [0.52, '#c39ac0'], [0.72, '#7f93c4'], [1, '#2a5390'],
];

/** Narrow ramp, dithered so 8-bit banding never shows on a 520 m dome. */
function rampTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  for (const [at, hex] of RAMP) grad.addColorStop(at, hex);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const img = g.getImageData(0, 0, 8, 256);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const d = (i >> 2) % 2 - 0.5;
    px[i] += d; px[i + 1] += d; px[i + 2] += d;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,226,170,.95)');
  grad.addColorStop(0.16, 'rgba(255,168,96,.55)');
  grad.addColorStop(0.5, 'rgba(255,130,80,.16)');
  grad.addColorStop(1, 'rgba(255,110,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function goldenHourSky(scene) {
  if (!scene || scene.userData.goldenHourSky) return scene;
  scene.userData.goldenHourSky = true;

  // The noon dome/disc/halo are pinned to the old ramp and sun height, and that dome
  // writes no depth, so leaving it visible would paint noon over this one.
  scene.traverse((o) => {
    const p = (o.geometry && o.geometry.parameters) || {};
    const old = p.radius === 520 || p.radius === 12 || (p.width === 360 && p.height === 360);
    if (o.isMesh && old) o.visible = false;
  });

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(520, 32, 20),
    new THREE.MeshBasicMaterial({ map: rampTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  const sunAt = SUN_DIR.clone().multiplyScalar(430);
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(22, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0c4, toneMapped: false, fog: false }),
  );
  disc.position.copy(sunAt);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }),
  );
  halo.position.copy(sunAt);
  halo.lookAt(0, 0, 0);
  scene.add(disc, halo);
  return scene;
}
