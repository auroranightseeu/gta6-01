import * as THREE from 'three';

// Lit windows for golden hour: warm emissive quads on the facades, procedural, no image.
// One building or the whole city array: an array returns ONE merged mesh, so every lit
// window is one draw (a mesh per building would cost 73).
const LIT = [0xffd08a, 0xffc06a, 0xffa95c, 0xfff0c0];
const DARK = 0.55;        // share of windows left unlit; a fully lit block reads as an office
const PER_BLD = 26;       // sampled, not exhaustive: tiny buffer, same look

const seeded = (n) => {
  let s = (n | 0) || 0x2545f491;
  return () => ((s = (s * 1664525 + 1013904223) | 0) >>> 0) / 4294967296;
};

export function goldenHourWindows(building) {
  const list = Array.isArray(building) ? building : [building];
  const pos = [];
  const col = [];
  const idx = [];
  let v = 0;
  const push = (p, hex) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    for (const q of p) {
      pos.push(q[0], q[1], q[2]);
      col.push(r, g, b);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };

  for (const b of list) {
    if (!b || !(b.w > 0) || !(b.h > 4)) continue;
    const rand = seeded(Math.round((b.x + 150) * 17 + (b.z + 150) * 83 + b.h * 9));
    const floors = Math.max(2, Math.min(26, Math.round(b.h / 3.4)));
    const cols = 3 + Math.floor(rand() * 4);
    // Four walls as (base point, tangent, length); windows sit above the shopfront band.
    const y0 = Math.max(4.2, b.h * 0.16);
    const walls = [
      [[b.x + b.w / 2 + 0.06, 0, b.z - b.d / 2], [0, 0, 1], b.d],
      [[b.x - b.w / 2 - 0.06, 0, b.z + b.d / 2], [0, 0, -1], b.d],
      [[b.x + b.w / 2, 0, b.z + b.d / 2 + 0.06], [-1, 0, 0], b.w],
      [[b.x - b.w / 2, 0, b.z - b.d / 2 - 0.06], [1, 0, 0], b.w],
    ];
    const perWall = Math.ceil(PER_BLD / 4);
    for (const [base, t, len] of walls) {
      const gap = len / cols;
      const ww = gap * 0.46;
      const fh = (b.h - y0) / floors;
      const wh = fh * 0.5;
      for (let n = 0; n < perWall; n += 1) {
        if (rand() < DARK) continue;
        const colI = Math.floor(rand() * cols);
        const rowI = Math.floor(rand() * floors);
        const u = colI * gap + (gap - ww) / 2;
        const y = y0 + rowI * fh + (fh - wh) / 2;
        const hex = LIT[Math.floor(rand() * LIT.length)];
        const c = (a, d) => [base[0] + t[0] * a, d, base[2] + t[2] * a];
        push([c(u, y), c(u + ww, y), c(u + ww, y + wh), c(u, y + wh)], hex);
      }
    }
  }
  if (!v) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;}
