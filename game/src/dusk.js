import * as THREE from 'three';

// Dusk, staged only by ?shot=dusk. The game boots with one global golden-hour look
// (main.js applies it once, for every frame), so the dusk shot was the day look from a
// different camera — measured pixel diff 0.41 against the day frames. This module walks
// the live scene and swaps the sky ramp, sun, clouds, fog and light levels in place.
// Every ?shot= is its own page load, so nothing here can reach the day frames.
//
// The dome is a full sphere and the camera sits at its centre, so the geometric horizon
// is v=0.5, not v=0: the visible sky is roughly v 0.50..0.67 with the shot's 62 deg fov.
// The ramp stops are placed there, or the whole sunset would sit below the sea.
const RAMP = [
  [0, '#ff8a35'], [0.5, '#ff8a35'], [0.55, '#f2703a'],
  [0.6, '#b8515c'], [0.66, '#6b3a6e'], [0.76, '#3a3a70'], [1, '#1a2a55'],
];

const FOG = 0x6b4460;

/** Same 8x256 vertical ramp + dither as sky.js, with the dusk palette. */
function duskRamp() {
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

/** Soft warm radial, drawn once for the whole street-lamp glow mesh. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,226,168,1)');
  grad.addColorStop(0.4, 'rgba(255,196,120,.55)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * One merged additive mesh with a soft glow at every lamp head, so the street lamps read
 * as switched on once the sky is dark. Two crossed quads per lamp: a fixed quad would
 * vanish edge-on from half the street angles. One draw for the whole city.
 */
function lampGlow(city) {
  const lamps = (city && city.lamps) || [];
  if (!lamps.length) return null;
  const pos = [];
  const uv = [];
  const CORNER = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const W = 2.4;
  const H = 1.7;
  const quad = (cx, cy, cz, ax, az) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(cx + CORNER[i][0] * W * ax, cy + CORNER[i][1] * H, cz + CORNER[i][0] * W * az);
      uv.push(UVC[i][0], UVC[i][1]);
    }
  };
  for (const lamp of lamps) {
    // Same arm parity render.js uses to place the head, or the glow would miss the lamp.
    const rot = ((Math.round(lamp.x) + Math.round(lamp.z)) / 25) % 2 === 0 ? 0 : Math.PI;
    const dx = rot === 0 ? 1 : -1;
    const hx = lamp.x + dx * 0.95;
    quad(hx, 4.95, lamp.z, 1, 0);
    quad(hx, 4.95, lamp.z, 0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, opacity: 0.75, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  }));
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * Turn the booted golden-hour scene into dusk. `city` supplies the lamp heads; `scene` is
 * game.renderer.scene. Returns the numbers the probe checks, so the look is verified by
 * measurement rather than by eye.
 */
export function applyDusk(scene, city) {
  const found = { dome: false, disc: false, halo: false, clouds: 0, lamps: 0 };
  if (!scene) return found;

  let dome = null;
  let disc = null;
  let halo = null;
  let sun = null;
  let hemi = null;
  let amb = null;
  const clouds = [];
  scene.traverse((o) => {
    if (o.isDirectionalLight) { sun = o; return; }
    if (o.isHemisphereLight) { hemi = o; return; }
    if (o.isAmbientLight) { amb = o; return; }
    if (!o.isMesh) return;
    const p = (o.geometry && o.geometry.parameters) || {};
    // The noon dome shares the 520 radius but sky.js already hid it; only the visible one
    // is the golden-hour dome this shot paints over.
    if (p.radius === 520 && o.visible && o.material && o.material.map) dome = o;
    else if (p.radius === 22 && o.visible) disc = o;
    else if (p.width === 560 && p.height === 560 && o.visible) halo = o;
    else if (p.radiusTop >= 300 && p.height >= 50 && o.material && o.material.transparent) clouds.push(o);
  });

  if (dome) {
    dome.material.map = duskRamp();
    dome.material.needsUpdate = true;
    found.dome = true;
  }
  if (disc) {
    disc.material.color.setHex(0xff9a3c);
    found.disc = true;
  }
  if (halo) {
    halo.material.opacity = 0.45;
    found.halo = true;
  }
  // Clouds are untonemapped white: left alone they would hang over a night sky like paper.
  for (const c of clouds) {
    c.material.color.setHex(0x6b4a72);
    c.material.opacity *= 0.6;
    found.clouds += 1;
  }

  if (scene.fog && scene.fog.color) {
    scene.fog.color.setHex(FOG);
    if ('near' in scene.fog) scene.fog.near = 30;
    if ('far' in scene.fog) scene.fog.far = 220;
  }
  if (scene.background && scene.background.setHex) scene.background.setHex(FOG);

  // Light levels only. The sun's position is owned by render.js's shadow tracker and the
  // wrapper golden-hour.js puts on position.set(), so moving it here would fight both.
  if (sun) {
    sun.color.setHex(0xff8a3a);
    sun.intensity = 4;
  }
  if (hemi) {
    hemi.color.setHex(0x8a7ab0);
    hemi.groundColor.setHex(0x2e2230);
    hemi.intensity = 4;
  }
  if (amb) {
    amb.color.setHex(0x6a7ab0);
    amb.intensity = 1.1;
  }

  const glow = lampGlow(city);
  if (glow) {
    scene.add(glow);
    found.lamps = (city.lamps || []).length;
  }

  // The 2D grade is a plain DOM div that already exists (main.js applies it at boot), so
  // repainting its background costs nothing per frame: cool blue above, warm horizon below.
  if (typeof document !== 'undefined') {
    const el = document.getElementById('solmar-grade');
    if (el) {
      el.style.background = 'radial-gradient(115% 95% at 50% 44%,'
        + ' rgba(30,14,44,.18) 0%, rgba(26,10,40,.32) 58%, rgba(10,4,20,.58) 100%),'
        + ' linear-gradient(180deg, rgba(24,12,44,.34) 0%, rgba(40,16,42,.10) 46%,'
        + ' rgba(96,36,12,.18) 100%)';
      found.grade = true;
    }
  }

  return found;
}
