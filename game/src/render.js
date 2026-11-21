// Drawing only, in three.js: the sun-soaked sky with drifting clouds, the street-level
// ground texture, ONE merged mesh for every building (facades come from a single canvas
// atlas), ONE merged mesh for every piece of street furniture, instanced palms and people,
// the animated sea at the west edge, the sun with its shadow map, and the little
// built-from-boxes cars. No rules live here.
//
// v5 perf note: this build is draw-call bound, so nothing is a mesh per prop. Buildings are
// one draw, all street furniture (lamps, benches, planters, bins, hydrants, railings,
// signals, parasols) is one draw, palms are one instanced draw, every pedestrian and everyone
// Rio fights is four instanced draws in total, and each car is five. Shadows are one
// directional light with a 2048 map.
import * as THREE from 'three';
import { CITY, PALETTE, SHADOW, SUN_DIR, SKY, CLOUDS, WATER } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const GROUND_PX = 2048;
const WORLD = CITY.bound * 2 + 16; // ground plane spans a little past the city edge
const UP = new THREE.Vector3(0, 1, 0);

// --- facade atlas geometry --------------------------------------------------------
// One 2048 canvas holds 128 tiles of 128x256. Tile 0 is a plain roof surface; tiles 1..N
// are one building facade each, baked at that building's own floor count, so a facade is
// never tiled (no bleeding, no misaligned window rows).
const TILE_W = 128;
const TILE_H = 256;
const SHEET = 2048;
const SHEET_COLS = SHEET / TILE_W; // 16
const SHEET_ROWS = SHEET / TILE_H; // 8
const ROOF_TILE = 0;
const FACADE_TILE_0 = 1;

function srgb(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tintOf(hex, k) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** A tiny deterministic PRNG for canvas noise (never Math.random: captures must repeat). */
function seeded(seed) {
  let s = (seed | 0) || 0x2545f491;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function tileUV(index, inset = 1) {
  const cx = index % SHEET_COLS;
  const ry = Math.floor(index / SHEET_COLS);
  return {
    u0: (cx * TILE_W + inset) / SHEET,
    u1: ((cx + 1) * TILE_W - inset) / SHEET,
    v0: 1 - ((ry + 1) * TILE_H - inset) / SHEET,
    v1: 1 - (ry * TILE_H + inset) / SHEET,
  };
}

// --- merged geometry helpers -------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _euler = new THREE.Euler();

/** Translation (+ optional rotation) matrix for merging parts. */
function at(x, y, z, rotY = 0, rotX = 0, rotZ = 0) {
  const m = new THREE.Matrix4();
  _euler.set(rotX, rotY, rotZ);
  m.makeRotationFromEuler(_euler);
  m.setPosition(x, y, z);
  return m;
}

/**
 * Concatenate any number of transformed geometries into one, baking a flat colour per part
 * into vertex colours. One draw call, many parts. UVs are dropped: merged parts are
 * untextured by design (textured surfaces — buildings and signboards — build their own
 * buffers with explicit UVs).
 */
function mergeParts(parts) {
  const prepared = [];
  let total = 0;
  for (const part of parts) {
    const src = part.geo;
    let g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (part.matrix) g.applyMatrix4(part.matrix);
    const n = g.attributes.position.count;
    total += n;
    prepared.push({ g, n, color: part.color === undefined ? 0xffffff : part.color });
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const { g, n, color } of prepared) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    const r = ((color >> 16) & 255) / 255;
    const gg = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let i = 0; i < n; i += 1) {
      col[(o + i) * 3] = r;
      col[(o + i) * 3 + 1] = gg;
      col[(o + i) * 3 + 2] = b;
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A box geometry pre-translated so it sits between y0 and y1 with its centre at (x, z). */
function boxBetween(w, h, d, x, y, z, color, rotY = 0) {
  return { geo: new THREE.BoxGeometry(w, h, d), matrix: at(x, y, z, rotY), color };
}

// --- textures ----------------------------------------------------------------------
/**
 * The whole city's facades on one sheet. Each building gets a tile at its own floor count:
 * a darker shopfront band at street level, window rows up the face, a cornice at the top.
 * The base colour is near-white and the per-building colour is a vertex tint, so one sheet
 * serves every district palette.
 */
function facadeSheet(buildings) {
  const c = document.createElement('canvas');
  c.width = SHEET;
  c.height = SHEET;
  const g = c.getContext('2d');

  // Tile 0: plain roof surface (gravel with seams).
  const roof = tileOrigin(ROOF_TILE);
  g.fillStyle = '#b9b3a6';
  g.fillRect(roof.x, roof.y, TILE_W, TILE_H);
  g.strokeStyle = 'rgba(120,114,104,.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 8; i += 1) {
    g.beginPath();
    g.moveTo(roof.x, roof.y + i * (TILE_H / 8));
    g.lineTo(roof.x + TILE_W, roof.y + i * (TILE_H / 8));
    g.stroke();
  }

  buildings.forEach((b, i) => {
    const index = FACADE_TILE_0 + i;
    if (index >= SHEET_COLS * SHEET_ROWS) return;
    const { x, y } = tileOrigin(index);
    const rand = seeded(Math.round((b.x + 150) * 17 + (b.z + 150) * 83 + b.h * 9));
    const floors = Math.max(2, Math.min(26, Math.round(b.h / 3.4)));
    const cols = 3 + Math.floor(rand() * 4);
    const shopH = Math.round(TILE_H * 0.14);
    // Wall base: near-white so the vertex tint reads as the wall colour.
    g.fillStyle = '#f4eee6';
    g.fillRect(x, y, TILE_W, TILE_H);
    // Ground floor: a glazed shopfront in a pale stone frame, with lit signage.
    g.fillStyle = '#8b7f6f';
    g.fillRect(x, y + TILE_H - shopH, TILE_W, shopH);
    g.fillStyle = '#5d7b86';
    g.fillRect(x + 3, y + TILE_H - shopH + 7, TILE_W - 6, shopH - 12);
    g.fillStyle = 'rgba(255,255,255,.28)';
    for (let k = 0; k < 6; k += 1) g.fillRect(x + 7 + k * 20, y + TILE_H - shopH + 10, 8, shopH - 18);
    g.fillStyle = '#c98f45';
    g.fillRect(x + 3, y + TILE_H - shopH - 5, TILE_W - 6, 5);
    // Window rows up the face.
    const top = y + Math.round(TILE_H * 0.06);
    const usable = TILE_H - shopH - (TILE_H * 0.1);
    const rowH = usable / floors;
    const gapX = TILE_W / cols;
    const ww = gapX * (0.52 + rand() * 0.18);
    const wh = rowH * (0.52 + rand() * 0.16);
    for (let row = 0; row < floors; row += 1) {
      const wy = top + row * rowH + (rowH - wh) / 2;
      for (let col = 0; col < cols; col += 1) {
        const wx = x + gapX * col + (gapX - ww) / 2;
        const roll = rand();
        g.fillStyle = roll < 0.14 ? '#ffce7a'
          : roll < 0.24 ? '#ffab7d'
          : roll < 0.34 ? '#9fd8c4'
            : roll < 0.6 ? '#4a5f6d' : '#33454f';
        g.fillRect(wx, wy, ww, wh);
        if (roll < 0.34) {
          // A pale sill catches the sun on the lit windows.
          g.fillStyle = 'rgba(255,240,200,.45)';
          g.fillRect(wx, wy + wh - 1.5, ww, 1.5);
        }
      }
      // Floor slab line: reads as structure from a distance.
      g.fillStyle = 'rgba(255,255,255,.10)';
      g.fillRect(x, top + row * rowH, TILE_W, 1);
    }
    // Cornice.
    g.fillStyle = 'rgba(90,80,70,.35)';
    g.fillRect(x, y + Math.round(TILE_H * 0.05), TILE_W, 3);
  });

  const tex = srgb(new THREE.CanvasTexture(c));
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function tileOrigin(index) {
  const cx = index % SHEET_COLS;
  const ry = Math.floor(index / SHEET_COLS);
  return { x: cx * TILE_W, y: ry * TILE_H };
}

/** Host geometry + material for every quad in buildGroundQuads(): one draw call. */
function quadGeo(pos, col, idx, uv) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// --- real road paint, at real widths ------------------------------------------------
// The ground canvas covers 280 m in 2048 px (7.3 px/m), so anything narrower than about
// 0.14 m cannot be drawn there at all: a 0.12 m lane line is under one pixel and the
// mip/min filter turns it into a pale smear. That is exactly why the old crosswalks read
// as oversized bright white bars and there were no lane markings: both were baked into
// that canvas. Each marking is now a quad with its true metric size, all merged into a
// single buffer so the entire paint layer costs one draw call.
//
// Proportions follow real road practice rather than what "looks like a game" —
// except for one measured compromise (R1c): a true 0.12 m lane line is sub-pixel
// from the chase/foot camera at 1280x720, so the bench frames showed NO markings at
// all despite the paint mesh being there. 0.24 m is the narrowest width that survives
// the frame, and it is still a width real roads paint (wide edge lines run 0.20-0.25 m).
//   lane line   0.24 m wide, 3 m painted / 6 m gap (a 9 m cycle, i.e. Aus/UK practice)
//   edge line   0.24 m, solid, 0.25 m inside the kerb
//   crosswalk   0.45 m bar, 0.55 m gap, 3.0 m long — measured against a 3.4 m lane this
//               is what a zebra actually looks like: a set of stripes you could walk
//               between, not the single broad slab the old frames showed.
const PAINT = { y: 0.012 };
const LANE_W = 0.24;
const EDGE_W = 0.24;
const BAR_W = 0.45;
const BAR_GAP = 0.55;
const BAR_LEN = 3.0;

/**
 * Build the road paint as one merged, vertex-coloured mesh: centre dashes, edge lines,
 * crosswalk bars, stop lines. Every quad is laid flat at y = 0.012 so it sits on the
 * asphalt without z-fighting, and the whole layer is one draw.
 */
function buildRoadMarkings() {
  const pos = [];
  const col = [];
  const idx = [];
  let v = 0;
  // Worn off-white: brighter than the asphalt by a clear margin but never above the sky.
  // The old paint tone-mapped to (255,255,229) and was the brightest thing on screen;
  // this sits about 25% below that so it reads as paint, not as light. R1c: lifted from
  // 0xcfc9b8 — at 0.12 m the old tone was invisible next to the aggregate, and the wider
  // line still needs the extra step to read as paint at screenshot distance.
  const WHITE = 0xdcd7c6;
  const YELLOW = 0xc9a94e;
  const push = (x0, z0, x1, z1, hex) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    pos.push(x0, PAINT.y, z0, x1, PAINT.y, z0, x1, PAINT.y, z1, x0, PAINT.y, z1);
    for (let i = 0; i < 4; i += 1) col.push(r, g, b);
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    v += 4;
  };
  // Axis-aligned rect helper: centre (cx,cz), half extents along each axis.
  const rect = (cx, cz, hx, hz, hex) => push(cx - hx, cz - hz, cx + hx, cz + hz, hex);

  const B = CITY.bound;
  const KERB = CITY.roadWidth / 2; // 7: the kerb face
  const atJunction = (t) => {
    for (const l of CITY.roadLines) if (Math.abs(t - l) < KERB + 4.2) return true;
    return false;
  };

  for (const line of CITY.roadLines) {
    // --- centre dashes, one per 9 m cycle, skipping every junction ----------------
    for (let d = -B + 4; d < B - 4; d += 9) {
      // A dash that starts inside a junction box or a crossing approach is dropped: real
      // paint stops clean at the stop line, it never runs through the box.
      const mid = d + 1.5;
      if (atJunction(mid) || atJunction(d - 1) || atJunction(d + 4)) continue;
      rect(line, d + 1.5, LANE_W / 2, 1.5, WHITE);
      rect(d + 1.5, line, 1.5, LANE_W / 2, WHITE);
    }
    // --- solid edge lines, 0.25 m in from the kerb -------------------------------
    for (const side of [-1, 1]) {
      const off = side * (KERB - 0.25);
      // Break the edge line at every junction and crossing, like the real thing.
      let runStart = null;
      for (let d = -B + 2; d <= B - 2; d += 2) {
        const blocked = atJunction(d);
        if (!blocked && runStart === null) runStart = d;
        if (blocked && runStart !== null) {
          if (d - runStart > 3) {
            const cz = (runStart + d) / 2;
            rect(line - off, cz, EDGE_W / 2, (d - runStart) / 2, WHITE);
            rect(cz, line - off, (d - runStart) / 2, EDGE_W / 2, WHITE);
          }
          runStart = null;
        }
      }
      if (runStart !== null && B - 2 - runStart > 3) {
        const cz = (runStart + B - 2) / 2;
        rect(line - off, cz, EDGE_W / 2, (B - 2 - runStart) / 2, WHITE);
        rect(cz, line - off, (B - 2 - runStart) / 2, EDGE_W / 2, WHITE);
      }
    }
  }

  // --- junctions: crosswalks on all four approaches, plus stop lines ---------------
  for (const ix of CITY.roadLines) {
    for (const iz of CITY.roadLines) {
      // A crossing sits just outside the box on each arm. The box half-width is 7 m, so
      // the near edge of the zebra is at 7.6 m and it spans 3 m outward — that is what
      // puts it on the approach rather than inside the junction.
      const ZEBRA_IN = KERB + 0.6;
      const ZEBRA_OUT = ZEBRA_IN + BAR_LEN;
      const mid = (ZEBRA_IN + ZEBRA_OUT) / 2;
      // Bars run parallel to the road being crossed. Across the N-S street the bars are
      // short in x (0.45) and long in z (3.0), repeating across the 14 m width.
      for (const sz of [-1, 1]) {
        for (let t = -KERB + 0.5; t <= KERB - 0.5; t += BAR_W + BAR_GAP) {
          if (Math.abs(t) > KERB - 0.45) continue;
          rect(ix + t, iz + sz * mid, BAR_W / 2, BAR_LEN / 2, WHITE);
        }
        // Stop line: 0.4 m, the full approach width, 1 m beyond the crossing.
        rect(ix, iz + sz * (ZEBRA_OUT + 1.0), KERB - 0.35, 0.22, WHITE);
      }
      for (const sx of [-1, 1]) {
        for (let t = -KERB + 0.5; t <= KERB - 0.5; t += BAR_W + BAR_GAP) {
          if (Math.abs(t) > KERB - 0.45) continue;
          rect(ix + sx * mid, iz + t, BAR_LEN / 2, BAR_W / 2, WHITE);
        }
        rect(ix + sx * (ZEBRA_OUT + 1.0), iz, 0.22, KERB - 0.35, WHITE);
      }
      // A centre-line stub on each approach in the last few metres before the crossing,
      // which is what actually reads as "this road has lanes" on a junction shot.
      for (const sz of [-1, 1]) {
        rect(ix, iz + sz * (ZEBRA_OUT + 5.0), LANE_W / 2, 2.0, YELLOW);
      }
      for (const sx of [-1, 1]) {
        rect(ix + sx * (ZEBRA_OUT + 5.0), iz, 2.0, LANE_W / 2, YELLOW);
      }
    }
  }

  // NOTE (R1c): pass the index as a PLAIN array. three r170's setIndex() stores a
  // typed array raw (this.index = the Uint32Array, not a BufferAttribute) and the
  // renderer then dies reading index.array.byteLength on the first frame — this is
  // why the markings crashed the boot the first time they were wired in. A plain
  // array is wrapped into a proper (Uint16) BufferAttribute by setIndex.
  const geo = quadGeo(
    new Float32Array(pos), new Float32Array(col),
    idx, null,
  );
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = SHADOW.mode === 'map';
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Kerbs: a 0.14 m step around every block, as real geometry rather than a painted line,
 * so the pavement and the carriageway read as two levels and not one plane. Four boxes
 * per block, all merged into one buffer — one draw for the whole city.
 *
 * The pavement slab itself is a flat quad at +0.14 m covering the block interior, so the
 * kerb face has something to be a face of. Nothing walks on that height: player and car
 * collision is 2D (world.js), so this is purely visual, which is why 0.14 m (a realistic
 * kerb) is safe here where a taller one would make feet float.
 */
const KERB_H = 0.14;
const KERB_W = 0.30;
function buildKerbs() {
  const parts = [];
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      const half = 18;
      // Pavement slab: top face only, inset by the kerb width so the kerb face shows.
      parts.push({
        geo: new THREE.PlaneGeometry(half * 2 - KERB_W * 2, half * 2 - KERB_W * 2),
        matrix: at(bx, KERB_H, bz, 0, -Math.PI / 2),
        color: 0xbdb09a,
      });
      // Four kerb stones. Each is a low box whose outer face is the visible step.
      for (const [sx, sz, w, d] of [
        [0, -1, half * 2, KERB_W],
        [0, 1, half * 2, KERB_W],
        [-1, 0, KERB_W, half * 2 - KERB_W * 2],
        [1, 0, KERB_W, half * 2 - KERB_W * 2],
      ]) {
        parts.push({
          geo: new THREE.BoxGeometry(w, KERB_H, d),
          matrix: at(bx + sx * (half - KERB_W / 2), KERB_H / 2, bz + sz * (half - KERB_W / 2)),
          color: 0xd8ccb6,
        });
      }
    }
  }
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeParts(parts), bodyMatCache);
  mesh.receiveShadow = SHADOW.mode === 'map';
  return mesh;
}

/** The painted street surface: asphalt, pavements, kerbs. Markings are NOT here.
 *
 * This canvas covers the whole city (280 m) in 2048 px, i.e. 7.3 px per metre, so a
 * 0.12 m paint line is under one pixel and every marking baked in at this scale came out
 * either invisible or — after the min-filter averaged it with the asphalt — as the pale
 * mush the old crosswalks read as. Instead this texture carries only what survives at
 * this density (tone, aggregate, wear, patches, seams) and the paint lives in
 * buildRoadMarkings(), drawn as real quads at real widths.
 *
 * The old base was a single flat #6d635a brown, which is what made every gameplay frame
 * read as "vast flat brown plane": mean luma 89 with a standard deviation of 2.1 and a
 * horizontal gradient of 0.03 per pixel in the road band at the bottom of ?shot=drive —
 * literally a gradient-free fill. Real asphalt at street level varies by tens of levels
 * between aggregate, patch, tyre polish and repair seams, so this builds that structure
 * first and the flat colour never gets a chance to show.
 */
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = GROUND_PX;
  c.height = GROUND_PX;
  const g = c.getContext('2d');
  const s = GROUND_PX / WORLD; // px per metre
  const toPx = (v) => (v + WORLD / 2) * s;
  const rand = seeded(0x51a5f3);

  // --- 1. Asphalt base, road areas only -------------------------------------------
  // Neutral-warm grey, not brown: sunlit asphalt is desaturated, the warmth in a coastal
  // frame comes from the buildings and the sand.
  g.fillStyle = '#7d7b74';
  g.fillRect(0, 0, GROUND_PX, GROUND_PX);

  // Blocks are pavement, so paint them over the asphalt field first, then carve the
  // carriageway back out of the ring between them. Doing it this way means the kerb line
  // is exactly at +/-18 m (the block edge) and the 1.4 m gutter falls outside it.
  const HALF_ROAD = CITY.roadWidth / 2; // 7
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      const px = toPx(bx - 18);
      const pz = toPx(bz - 18);
      // Pavement: a warm, light concrete, deliberately several steps brighter than the
      // asphalt so the two surfaces read as different materials even before the kerb.
      g.fillStyle = '#b9ac95';
      g.fillRect(px, pz, 36 * s, 36 * s);
    }
  }

  // --- 2. Per-road asphalt tone, so no two streets are the same slab -----------------
  // Each centreline gets its own slight tint and its own wear pattern; a grid where every
  // road is one identical value is the other half of why the old ground read as flat.
  const ROAD_TONES = ['#6e6c66', '#767369', '#7a776e', '#6a6862', '#737168', '#78756b'];
  CITY.roadLines.forEach((line, i) => {
    const tone = ROAD_TONES[i % ROAD_TONES.length];
    g.fillStyle = tone;
    // Roads run the full city plus a little past the edge, so a car leaving the grid
    // still drives on asphalt rather than on a labelled void.
    const extent = CITY.bound + 8;
    g.fillRect(toPx(line - HALF_ROAD), toPx(-extent), CITY.roadWidth * s, extent * 2 * s);
    g.fillRect(toPx(-extent), toPx(line - HALF_ROAD), extent * 2 * s, CITY.roadWidth * s);
    // Intersection boxes are the overlap of both roads: repaint them with the darker of
    // the crossing tones so every junction reads as its own slab (real junctions are
    // patched separately from the approach and are visibly darker and more cracked).
    // R1c: kept to the darkest road tone instead of a step darker — the extra step read
    // as a big dark slab laid across the road in the drive/foot frames, not as a junction.
    g.fillStyle = '#6e6c66';
    for (const other of CITY.roadLines) {
      g.fillRect(toPx(other - HALF_ROAD), toPx(line - HALF_ROAD), CITY.roadWidth * s, CITY.roadWidth * s);
    }
  });

  // --- 3. Aggregate: mottled patches, not a uniform speckle -------------------------
  // Two scales. Big, very low-contrast blobs give the slab uneven weathering; fine grain
  // gives the tooth of the surface. Both are seeded, so a seed always paints the same city.
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * GROUND_PX;
    const y = rand() * GROUND_PX;
    const r = 6 + rand() * 46;
    const dark = rand() < 0.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = (0.05 + rand() * 0.09).toFixed(3);
    grad.addColorStop(0, dark ? `rgba(52,50,47,${a})` : `rgba(168,163,152,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Fine grain: 1-3 px specks at low alpha. Enough to break the fill without turning the
  // road into television static at 1280x720.
  for (let i = 0; i < 34000; i += 1) {
    const x = rand() * GROUND_PX;
    const y = rand() * GROUND_PX;
    const v = rand();
    g.fillStyle = v < 0.5 ? 'rgba(58,56,52,.22)' : 'rgba(172,167,156,.16)';
    g.fillRect(x, y, 1 + rand() * 2.2, 1 + rand() * 2.2);
  }

  // --- 4. Repair patches and seams along the carriageways ---------------------------
  // Straight-edged darker rectangles plus the tar seam around them: the single strongest
  // "this is a maintained road, not a plane" cue that survives at 7 px/m.
  const patchRand = seeded(0x2b7c11);
  for (const line of CITY.roadLines) {
    // Longitudinal seam: where the two paving passes met, a few cm of darker tar.
    g.strokeStyle = 'rgba(48,46,43,.30)';
    g.lineWidth = Math.max(1, 0.16 * s);
    g.beginPath();
    g.moveTo(toPx(line), toPx(-CITY.bound));
    g.lineTo(toPx(line), toPx(CITY.bound));
    g.moveTo(toPx(-CITY.bound), toPx(line));
    g.lineTo(toPx(CITY.bound), toPx(line));
    g.stroke();
    // Patches: a handful per street, aligned to the kerb like real utility trenches.
    for (let i = 0; i < 7; i += 1) {
      const along = -CITY.bound + patchRand() * CITY.bound * 2;
      const wM = 1.6 + patchRand() * 4.2;
      const lM = 2.2 + patchRand() * 7;
      const side = patchRand() < 0.5 ? -1 : 1;
      const off = side * (0.8 + patchRand() * (HALF_ROAD - 2.2 - wM / 2));
      const shade = 34 + Math.floor(patchRand() * 22);
      g.fillStyle = `rgba(${shade},${shade - 2},${shade - 5},.34)`;
      // Vertical street.
      g.fillRect(toPx(line + off), toPx(along), wM * s, lM * s);
      g.strokeStyle = 'rgba(40,38,36,.34)';
      g.lineWidth = 1;
      g.strokeRect(toPx(line + off), toPx(along), wM * s, lM * s);
      // Horizontal street, same treatment.
      g.fillStyle = `rgba(${shade},${shade - 2},${shade - 5},.30)`;
      g.fillRect(toPx(along), toPx(line + off), lM * s, wM * s);
      g.strokeStyle = 'rgba(40,38,36,.30)';
      g.strokeRect(toPx(along), toPx(line + off), lM * s, wM * s);
    }
  }

  // --- 5. Tyre polish: the two wheel tracks each lane develops ----------------------
  // Lanes sit +/-3.4 m from the centreline (traffic.js), so the tracks are faint pale
  // bands at about +/-2.6 m and +/-4.2 m. This is what makes a road read as driven-on
  // from the driver's seat, and it is the cheapest depth cue available here.
  for (const line of CITY.roadLines) {
    for (const track of [-4.2, -2.6, 2.6, 4.2]) {
      const grad = g.createLinearGradient(toPx(line + track - 0.5), 0, toPx(line + track + 0.5), 0);
      grad.addColorStop(0, 'rgba(150,146,136,0)');
      grad.addColorStop(0.5, 'rgba(150,146,136,.13)');
      grad.addColorStop(1, 'rgba(150,146,136,0)');
      g.fillStyle = grad;
      g.fillRect(toPx(line + track - 0.5), toPx(-CITY.bound), 1.0 * s, CITY.bound * 2 * s);
      g.fillRect(toPx(-CITY.bound), toPx(line + track - 0.5), CITY.bound * 2 * s, 1.0 * s);
    }
  }

  // --- 6. Kerb + gutter ------------------------------------------------------------
  // The pavement is drawn 0.14 m higher by buildKerbs(); here the kerb face needs to be
  // the brightest, cleanest stone on the street and the gutter beside it the dirtiest.
  for (const bx of CITY.blockCenters) {
    for (const bz of CITY.blockCenters) {
      const x0 = toPx(bx - 18);
      const z0 = toPx(bz - 18);
      const w = 36 * s;
      // Gutter: a dark, gritty strip just outside the kerb where grit collects.
      g.strokeStyle = 'rgba(52,49,45,.34)';
      g.lineWidth = Math.max(2, 0.7 * s);
      g.strokeRect(toPx(bx - 18 - 0.75), toPx(bz - 18 - 0.75), 36 * s + 1.5 * s, 36 * s + 1.5 * s);
      // Kerb edge line.
      g.strokeStyle = '#d8ccb6';
      g.lineWidth = Math.max(2, 0.3 * s);
      g.strokeRect(x0, z0, w, w);
      // Paving seams inside the block: slabs about 1.8 m, running both ways.
      g.strokeStyle = 'rgba(126,113,96,.26)';
      g.lineWidth = 1;
      const step = (1.8 / 36) * w;
      for (let x = x0 + step; x < x0 + w - 1; x += step) {
        g.beginPath();
        g.moveTo(x, z0);
        g.lineTo(x, z0 + w);
        g.stroke();
      }
      for (let z = z0 + step; z < z0 + w - 1; z += step) {
        g.beginPath();
        g.moveTo(x0, z);
        g.lineTo(x0 + w, z);
        g.stroke();
      }
      // A darker band one slab in from the kerb: the threshold strip that gets the most
      // foot traffic and the most grime.
      g.strokeStyle = 'rgba(120,108,92,.28)';
      g.lineWidth = Math.max(2, 0.55 * s);
      g.strokeRect(x0 + step * 1.1, z0 + step * 1.1, w - step * 2.2, w - step * 2.2);
    }
  }

  // --- 7. Manholes and drainage gullies --------------------------------------------
  // Small, hard-edged and high contrast: the scale reference that tells the eye how big
  // the carriageway is. Placed where they really go — near the gutter, not mid-lane.
  for (const line of CITY.roadLines) {
    for (let d = -CITY.bound + 6; d <= CITY.bound - 6; d += 19) {
      const side = ((d / 19) | 0) % 2 === 0 ? 1 : -1;
      const r = Math.max(2.2, 0.42 * s);
      // Cover: dark iron disc with a rim and a few concentric rings.
      g.fillStyle = 'rgba(34,32,30,.72)';
      g.beginPath();
      g.arc(toPx(line + side * 4.9), toPx(d), r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(96,92,86,.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(toPx(line + side * 4.9), toPx(d), r * 0.66, 0, Math.PI * 2);
      g.stroke();
      // Gutter gully on the opposite side, a slotted rectangle.
      g.fillStyle = 'rgba(44,42,39,.62)';
      g.fillRect(toPx(line - side * 6.3), toPx(d + 5), 0.55 * s, 1.3 * s);
      g.fillStyle = 'rgba(24,23,21,.7)';
      for (let k = 0; k < 4; k += 1) {
        g.fillRect(toPx(line - side * 6.3), toPx(d + 5.15 + k * 0.3), 0.55 * s, Math.max(1, 0.1 * s));
      }
    }
  }

  const tex = srgb(new THREE.CanvasTexture(c));
  tex.anisotropy = 8;
  return tex;
}

/** The sea: a deep teal base, horizontal wave bands, a pale crest and a warm sun path. */
function waterTexture() {
  const w = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = w;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, w);
  grad.addColorStop(0, '#1d6f92');
  grad.addColorStop(0.45, '#2187ab');
  grad.addColorStop(0.8, '#2fa2be');
  grad.addColorStop(1, '#5cc4cf');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
  const rand = seeded(0x9e3779b1);
  // Wave bands: long, slightly wavy pale strokes, denser towards the top of the tile.
  for (let i = 0; i < 220; i += 1) {
    const y = rand() * w;
    const x = rand() * w;
    const len = 14 + rand() * 90;
    const alpha = 0.05 + rand() * 0.3 * (1 - y / w * 0.6);
    g.strokeStyle = `rgba(214,246,255,${alpha.toFixed(3)})`;
    g.lineWidth = 0.7 + rand() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.35, y - 1.6, x + len * 0.7, y + 1.6, x + len, y);
    g.stroke();
  }
  // Darker troughs between crests so the surface has visible relief in a still frame.
  for (let i = 0; i < 90; i += 1) {
    const y = rand() * w;
    const x = rand() * w;
    const len = 20 + rand() * 110;
    g.strokeStyle = `rgba(10,52,74,${(0.08 + rand() * 0.22).toFixed(3)})`;
    g.lineWidth = 1 + rand() * 3.4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len * 0.5, y + 2.6, x + len, y);
    g.stroke();
  }
  // Foam sparkle.
  for (let i = 0; i < 260; i += 1) {
    g.fillStyle = `rgba(240,253,255,${(0.1 + rand() * 0.4).toFixed(2)})`;
    g.fillRect(rand() * w, rand() * w, 1 + rand() * 2, 1);
  }
  const tex = srgb(new THREE.CanvasTexture(c));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 8;
  return tex;
}

/** Soft round blob shadow, one texture shared by the whole instanced field. */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.82)');
  grad.addColorStop(0.45, 'rgba(0,0,0,.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A cloud band: a few soft lumpy clusters on transparent, tiling horizontally. */
function cloudTexture() {
  const w = 1024;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rand = seeded(0x7ce4a1);
  g.clearRect(0, 0, w, h);
  const puff = (cx, cy, rx, ry, a) => {
    const grd = g.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
    grd.addColorStop(0, `rgba(255,252,246,${a})`);
    grd.addColorStop(0.55, `rgba(255,248,240,${a * 0.7})`);
    grd.addColorStop(1, 'rgba(255,246,238,0)');
    g.save();
    g.translate(cx, cy);
    g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    g.translate(-cx, -cy);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  // Four clusters spread along the band, each made of overlapping puffs.
  for (let cluster = 0; cluster < 4; cluster += 1) {
    const bx = (cluster + 0.5) * (w / 4) + (rand() - 0.5) * 80;
    const by = h * (0.42 + rand() * 0.2);
    const lumps = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < lumps; i += 1) {
      const ox = (i - lumps / 2) * (26 + rand() * 26);
      const oy = (rand() - 0.5) * 22;
      const r = 34 + rand() * 44;
      puff(bx + ox, by + oy, r * 1.5, r * 0.72, 0.5 + rand() * 0.34);
    }
    // Flat, slightly shaded base so the cluster reads as a cloud and not a smear.
    puff(bx, by + 22, 150, 26, 0.35);
  }
  const tex = srgb(new THREE.CanvasTexture(c));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// --- people (instanced) ------------------------------------------------------------
// Every pedestrian, Rio and every rival is drawn as FOUR instanced meshes city-wide:
// legs, torso, arms, head. A person object is an empty Group (zero draws) with limb
// holders that the walking code rotates exactly as before; render() bakes those rotations
// into instance matrices each frame.
const PERSON_CAP = 72;
const PERSON_GEO = {
  leg: (() => { const g = new THREE.BoxGeometry(0.22, 0.8, 0.22); g.translate(0, -0.4, 0); return g; })(),
  torso: new THREE.BoxGeometry(0.56, 0.62, 0.3),
  arm: (() => { const g = new THREE.BoxGeometry(0.16, 0.62, 0.16); g.translate(0, -0.31, 0); return g; })(),
  head: new THREE.IcosahedronGeometry(0.185, 1),
};
const SKIN = 0xd9a066;
const DARK = 0x2c2c34;

function makePersonMesh(color, style = 0) {
  const group = new THREE.Group();
  // Limb holders: plain transforms, never added to the scene, only read by render().
  const legL = new THREE.Object3D();
  const legR = new THREE.Object3D();
  const armL = new THREE.Object3D();
  const armR = new THREE.Object3D();
  if (style === 1) group.scale.set(0.82, 1.14, 0.82);
  group.userData = { legL, legR, armL, armR, style, color, person: true };
  return group;
}

// --- cars (merged body, live wheels) ----------------------------------------------
/**
 * Body proportions per type. These are what make a car recognisable at sheet size, where
 * lamp detail is a few pixels: the coupe is low and long, the van is tall with a flat
 * roof, the pickup keeps its cabin forward of an open tray, and the cab is a sedan hull
 * with a roof sign on it.
 */
function carProfile(type) {
  return type === 'sports'
    ? { width: 2.02, bodyH: 0.43, length: 4.65, cabinW: 1.48, cabinH: 0.35, cabinL: 1.75, cabinY: 0.89, cabinZ: -0.35, roofW: 1.43, roofL: 1.58, roofY: 1.08, wheelX: 0.93, wheelZ: 1.5, wheelR: 0.31 }
    : type === 'van'
      ? { width: 2.08, bodyH: 0.68, length: 4.45, cabinW: 1.76, cabinH: 1.0, cabinL: 2.75, cabinY: 1.35, cabinZ: -0.18, roofW: 1.78, roofL: 2.55, roofY: 1.88, wheelX: 0.94, wheelZ: 1.4, wheelR: 0.37 }
      : type === 'pickup'
        ? { width: 2.02, bodyH: 0.6, length: 4.5, cabinW: 1.66, cabinH: 0.68, cabinL: 1.65, cabinY: 1.18, cabinZ: -0.72, roofW: 1.62, roofL: 1.5, roofY: 1.58, wheelX: 0.92, wheelZ: 1.42, wheelR: 0.37 }
        : { width: 1.9, bodyH: 0.55, length: 4.2, cabinW: 1.6, cabinH: 0.5, cabinL: 2.1, cabinY: 1.05, cabinZ: -0.25, roofW: 1.55, roofL: 1.9, roofY: 1.32, wheelX: 0.88, wheelZ: 1.35, wheelR: 0.36 };
}

const wheelGeoCache = new Map();
/**
 * One wheel: tyre, bright hub disc and five spokes in a single geometry, so a car is
 * body + lights + 4 wheels. The spokes are geometry, not draws — the whole city's wheels
 * still cost one draw each. They span the hub's full width so they show on both faces,
 * which is what keeps a wheel from reading as a plain black disc at shot distance.
 */
function wheelGeometry(r) {
  const key = r.toFixed(2);
  if (wheelGeoCache.has(key)) return wheelGeoCache.get(key);
  const tyre = new THREE.CylinderGeometry(r, r, 0.28, 12);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12);
  hub.rotateZ(Math.PI / 2);
  const parts = [
    { geo: tyre, color: 0x111318 },
    { geo: hub, color: 0xf0eadb },
  ];
  for (let i = 0; i < 5; i += 1) {
    const a = (i * Math.PI * 2) / 5;
    const spoke = new THREE.BoxGeometry(0.3, 0.045, 0.17);
    spoke.translate(0, 0, 0.085);
    // Rotate about x: the disc faces lie in the y/z plane after the tyre's own rotation.
    parts.push({ geo: spoke, matrix: at(0, 0, 0, 0, a), color: 0x9c9484 });
  }
  const geo = mergeParts(parts);
  wheelGeoCache.set(key, geo);
  return geo;
}

const bodyMatCache = new THREE.MeshLambertMaterial({ vertexColors: true });

// --- car lights ---------------------------------------------------------------------
let glowTexCache = null;
/** Soft white radial falloff, drawn once and shared by every car's lamp glow. */
function glowTexture() {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  glowTexCache = srgb(new THREE.CanvasTexture(c));
  return glowTexCache;
}

let glowMatCache = null;
/** Additive, untonemapped, vertex coloured: the lamps read as lit at dusk, not as paint. */
function glowMaterial() {
  if (glowMatCache) return glowMatCache;
  glowMatCache = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    toneMapped: false,
  });
  return glowMatCache;
}

/**
 * One merged textured quad mesh holding all four lamp glows of a car: the soft-sprite
 * look of a glow without four sprites, so a car costs one extra draw for its lights
 * instead of four. `back` flips the winding for the tail-lamps, which face -z.
 */
function carGlowMesh(quads) {
  const pos = [];
  const uv = [];
  const col = [];
  const CORNER = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const q of quads) {
    const r = ((q.color >> 16) & 255) / 255;
    const g = ((q.color >> 8) & 255) / 255;
    const b = (q.color & 255) / 255;
    const order = q.back ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      pos.push(q.x + CORNER[i][0] * q.w, q.y + CORNER[i][1] * q.h, q.z);
      uv.push(UVC[i][0], UVC[i][1]);
      col.push(r, g, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, glowMaterial());
}

let taxiSignTexCache = null;
/** The roof sign's face: a bright yellow plate with TAXI on it, drawn once. */
function taxiSignTexture() {
  if (taxiSignTexCache) return taxiSignTexCache;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f7cf1c';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 5;
  g.strokeRect(3, 3, 122, 58);
  g.fillStyle = '#20232a';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 64, 34);
  taxiSignTexCache = srgb(new THREE.CanvasTexture(c));
  return taxiSignTexCache;
}

/** A yellow cab: the sedan hull in cab paint, plus a lit roof sign on its own draw. */
const TAXI_PAINT = 0xf2c40c;
function makeTaxiSign(p) {
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.26, 0.12),
    new THREE.MeshBasicMaterial({ map: taxiSignTexture() }),
  );
  sign.position.set(0, p.roofY + 0.19, p.cabinZ + 0.12);
  return sign;
}

function makeCarMesh(color, type = 'sedan') {
  const group = new THREE.Group();
  const p = carProfile(type);
  // Dark cabin glass: the old 0x4a7f91 read as a pale blue block, brighter than the paint.
  const glass = 0x18222e;
  const paint = type === 'taxi' ? TAXI_PAINT : color;
  const parts = [
    { geo: new THREE.BoxGeometry(p.width, p.bodyH, p.length), matrix: at(0, p.bodyH, 0), color: paint },
    // Darker rocker under the sills: fake AO that grounds the body on its wheels, so the
    // paint is not one flat tone from sill to shoulder.
    { geo: new THREE.BoxGeometry(p.width * 0.97, 0.17, p.length * 0.94), matrix: at(0, p.bodyH * 0.42, 0), color: tintOf(paint, 0.55) },
    { geo: new THREE.BoxGeometry(p.cabinW, p.cabinH, p.cabinL), matrix: at(0, p.cabinY, p.cabinZ), color: glass },
    { geo: new THREE.BoxGeometry(p.roofW, 0.08, p.roofL), matrix: at(0, p.roofY, p.cabinZ), color: paint },
  ];
  if (type === 'pickup') {
    // Open bed: a dark floor, low side walls and a tailgate, so the rear reads as a tray
    // rather than as a second cabin.
    parts.push({ geo: new THREE.BoxGeometry(1.62, 0.16, 1.6), matrix: at(0, 0.8, 1.05), color: 0x41454a });
    for (const sx of [-0.78, 0.78]) {
      parts.push({ geo: new THREE.BoxGeometry(0.1, 0.34, 1.6), matrix: at(sx, 0.98, 1.05), color: paint });
    }
    parts.push({ geo: new THREE.BoxGeometry(1.62, 0.34, 0.1), matrix: at(0, 0.98, 1.85), color: paint });
  }
  // Head-lamps and tail-lamps are baked in as bright vertex colours, and their glow is
  // one extra merged mesh below: no point light per car, no sprite per lamp.
  const lampY = p.bodyH * 1.05;
  const glows = [];
  for (const lx of [-p.width * 0.32, p.width * 0.32]) {
    parts.push({ geo: new THREE.BoxGeometry(0.3, 0.14, 0.06), matrix: at(lx, lampY, p.length / 2 + 0.01), color: 0xfff6d8 });
    parts.push({ geo: new THREE.BoxGeometry(0.3, 0.14, 0.06), matrix: at(lx, lampY, -p.length / 2 - 0.01), color: 0xe8483a });
    glows.push({ x: lx, y: lampY, z: p.length / 2 + 0.07, w: 0.66, h: 0.5, color: 0xfff0c0 });
    glows.push({ x: lx, y: lampY, z: -p.length / 2 - 0.07, w: 0.52, h: 0.4, color: 0xff3b28, back: true });
  }
  const body = new THREE.Mesh(mergeParts(parts), bodyMatCache);
  body.castShadow = true;
  body.receiveShadow = false;
  group.add(body);
  group.add(carGlowMesh(glows));
  if (type === 'taxi') group.add(makeTaxiSign(p));
  const wGeo = wheelGeometry(p.wheelR);
  const wheels = [];
  for (const [wx, wz] of [[-p.wheelX, p.wheelZ], [p.wheelX, p.wheelZ], [-p.wheelX, -p.wheelZ], [p.wheelX, -p.wheelZ]]) {
    const w = new THREE.Mesh(wGeo, bodyMatCache);
    w.position.set(wx, 0.36, wz);
    w.castShadow = true;
    wheels.push(w);
    group.add(w);
  }
  group.userData = { wheels, body };
  return group;
}

/** The police cruiser: same body, plus one merged black-trim mesh and two live light bar lenses. */
function makePoliceCarMesh() {
  const group = makeCarMesh(PALETTE.policeWhite);
  const p = carProfile('sedan');
  const trim = new THREE.Mesh(mergeParts([
    { geo: new THREE.BoxGeometry(1.7, 0.1, 1.1), matrix: at(0, 0.86, 1.5), color: PALETTE.policeBlack },
    { geo: new THREE.BoxGeometry(1.7, 0.1, 0.9), matrix: at(0, 0.86, -1.65), color: PALETTE.policeBlack },
    { geo: new THREE.BoxGeometry(0.06, 0.5, 2.0), matrix: at(-0.97, 0.62, 0), color: PALETTE.policeBlack },
    { geo: new THREE.BoxGeometry(0.06, 0.5, 2.0), matrix: at(0.97, 0.62, 0), color: PALETTE.policeBlack },
    { geo: new THREE.BoxGeometry(1.1, 0.14, 0.34), matrix: at(0, 1.42, -0.25), color: PALETTE.policeBlack },
  ]), bodyMatCache);
  trim.castShadow = true;
  group.add(trim);
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

/** A parcel: crate + ribbon as one merged mesh. */
function makePackageMesh() {
  const group = new THREE.Group();
  const parcel = new THREE.Mesh(mergeParts([
    { geo: new THREE.BoxGeometry(1.0, 0.75, 1.0), matrix: at(0, 0.375, 0), color: 0xc8844d },
    { geo: new THREE.BoxGeometry(0.16, 0.82, 1.04), matrix: at(0, 0.41, 0), color: 0xffd66b },
  ]), bodyMatCache);
  group.add(parcel);
  group.userData.parcel = parcel;
  return group;
}

/** An ammo pickup: a small floating green crate, spun by combat.js. */
function makePickupMesh() {
  const group = new THREE.Group();
  const box = new THREE.Mesh(mergeParts([
    { geo: new THREE.BoxGeometry(0.7, 0.7, 0.7), matrix: at(0, 0.9, 0), color: PALETTE.pickup },
    { geo: new THREE.BoxGeometry(0.74, 0.12, 0.74), matrix: at(0, 1.28, 0), color: 0xd5f5e3 },
  ]), bodyMatCache);
  group.add(box);
  group.userData.box = box;
  return group;
}

// --- traffic light factory ---------------------------------------------------------
// 2 draws per head: one merged housing and one lens plane. The lens texture holds the three
// lenses with a lit and an unlit variant; setSignal() picks one by moving the texture
// offset, so a caller can change the colour without owning a mesh per lamp.
let lensBase = null;
function lensBaseTexture() {
  if (lensBase) return lensBase;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 384;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 384);
  // Rows top-to-bottom are red, amber, green; columns are unlit then lit.
  const lamps = [['#ff3b30', '#5c1410'], ['#ffb020', '#5a3c08'], ['#43d675', '#0f2e1c']];
  for (let i = 0; i < 3; i += 1) {
    const [lit, dark] = lamps[i];
    for (let col = 0; col < 2; col += 1) {
      const cx = 32 + col * 64;
      const cy = 64 + i * 128;
      g.beginPath();
      g.arc(cx, cy, 30, 0, Math.PI * 2);
      g.fillStyle = col === 0 ? dark : '#101315';
      g.fill();
      if (col === 1) {
        g.beginPath();
        g.arc(cx, cy, 24, 0, Math.PI * 2);
        g.fillStyle = lit;
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.beginPath();
        g.arc(cx - 7, cy - 8, 7, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  lensBase = srgb(new THREE.CanvasTexture(c));
  lensBase.wrapS = THREE.ClampToEdgeWrapping;
  lensBase.wrapT = THREE.ClampToEdgeWrapping;
  lensBase.repeat.set(0.5, 1 / 3);
  lensBase.offset.set(0.5, 0);
  lensBase.magFilter = THREE.LinearFilter;
  lensBase.minFilter = THREE.LinearFilter;
  lensBase.generateMipmaps = false;
  return lensBase;
}

let trafficLightGeo = null;
function trafficLightGeometries() {
  if (trafficLightGeo) return trafficLightGeo;
  const housing = mergeParts([
    // Backplate, body and three visors.
    { geo: new THREE.BoxGeometry(0.62, 1.5, 0.1), matrix: at(0, 0, -0.12), color: 0x1c2126 },
    { geo: new THREE.BoxGeometry(0.5, 1.34, 0.2), matrix: at(0, 0, -0.02), color: 0x272d33 },
    { geo: new THREE.BoxGeometry(0.56, 0.1, 0.26), matrix: at(0, 0.6, -0.08, 0, 0.5), color: 0x30363d },
    { geo: new THREE.BoxGeometry(0.56, 0.1, 0.26), matrix: at(0, 0, -0.08, 0, 0.5), color: 0x30363d },
    { geo: new THREE.BoxGeometry(0.56, 0.1, 0.26), matrix: at(0, -0.6, -0.08, 0, 0.5), color: 0x30363d },
  ]);
  // Top of the housing is at +0.75: geometry is authored around the head's centre.
  const lens = new THREE.PlaneGeometry(0.44, 1.28);
  trafficLightGeo = { housing, lens };
  return trafficLightGeo;
}

const LENS_STATE = { red: 0, amber: 1, green: 2, none: 2 };

/** Returns a Group: { userData: { setSignal(state), lens, housing, signal }, setSignal }.
 *  state is 0/'red', 1/'amber', 2/'green'. Callers may also pass 'none' to leave it dark. */
function makeTrafficLight() {
  const geo = trafficLightGeometries();
  const group = new THREE.Group();
  const housing = new THREE.Mesh(geo.housing, bodyMatCache);
  housing.castShadow = true;
  const map = lensBaseTexture().clone();
  map.needsUpdate = true;
  const lens = new THREE.Mesh(geo.lens, new THREE.MeshBasicMaterial({ map, toneMapped: false, fog: true }));
  lens.position.z = 0.11;
  group.add(housing, lens);
  const setSignal = (state) => {
    const key = typeof state === 'number' ? (['red', 'amber', 'green'][state] ?? 'green') : String(state);
    const row = LENS_STATE[key] ?? 2;
    // Row 0 (red) is drawn at the top of the canvas, which is v = 1.
    map.offset.y = 1 - (row + 1) / 3;
    group.userData.signal = key;
    return key;
  };
  group.userData = { housing, lens, signal: 'green', setSignal };
  group.setSignal = setSignal;
  setSignal('green');
  return group;
}

// --- harbour + beach ----------------------------------------------------------------
function buildHarbour() {
  const parts = [
    { geo: new THREE.BoxGeometry(12, 0.7, 7), matrix: at(-145, 0.25, 25), color: 0x886b50 },
    { geo: new THREE.BoxGeometry(4, 0.55, 23), matrix: at(-139, 0.18, 25), color: 0x9b7856 },
    { geo: new THREE.CylinderGeometry(1.8, 2.6, 19, 10), matrix: at(-151, 9.5, 52), color: 0xf0d7a3 },
    { geo: new THREE.CylinderGeometry(2.2, 2.2, 2.2, 10), matrix: at(-151, 20, 52), color: 0x36515d },
    { geo: new THREE.ConeGeometry(2.5, 2.8, 10), matrix: at(-151, 22.4, 52), color: 0xc6543e },
    { geo: new THREE.SphereGeometry(0.8, 8, 6), matrix: at(-151, 20, 52), color: 0xffefb2 },
  ];
  for (const z of [17, 33]) {
    parts.push({ geo: new THREE.SphereGeometry(0.55, 8, 6), matrix: at(-147, 0.4, z), color: 0xffa84e });
  }
  // A couple of moored hulls give the harbour a skyline of its own.
  for (const [x, z, h, c] of [[-158, 14, 0xe9e4d6], [-166, 40, 0xcf7a52]]) {
    parts.push({ geo: new THREE.BoxGeometry(7, 1.5, 2.6), matrix: at(x, 0.5, z), color: c });
    parts.push({ geo: new THREE.BoxGeometry(2.4, 2.2, 2.0), matrix: at(x - 1.2, 2.1, z), color: 0x2f4150 });
  }
  // Promenade wall between the sand and the city, broken at the docks.
  for (const z of [-70, 70, -20, 95]) {
    parts.push({ geo: new THREE.BoxGeometry(1.6, 1.1, 44), matrix: at(-133.2, 0.55, z), color: 0xcbb79a });
  }
  const mesh = new THREE.Mesh(mergeParts(parts), bodyMatCache);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function beachTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  // Dry sand under a high sun is genuinely the brightest thing in a beach frame, but at
  // #d8b47c it tone-mapped to (250,236,201) — 8.5% of the cover frame above luma 230 —
  // and dragged that frame's mean to 149 against the 95–135 target. Deeper base tone and
  // duller bright specks keep the sand warm and sunlit without clipping the highlights.
  g.fillStyle = '#c3a06e';
  g.fillRect(0, 0, 256, 256);
  const rand = seeded(0x1342ab);
  for (let i = 0; i < 5000; i += 1) {
    g.fillStyle = rand() < 0.5 ? 'rgba(162,132,90,.35)' : 'rgba(226,205,166,.45)';
    g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Wet-sand band along the waterline edge of the tile.
  const grad = g.createLinearGradient(0, 200, 0, 256);
  grad.addColorStop(0, 'rgba(150,120,84,0)');
  grad.addColorStop(1, 'rgba(140,112,78,.55)');
  g.fillStyle = grad;
  g.fillRect(0, 200, 256, 56);
  const tex = srgb(new THREE.CanvasTexture(c));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 18);
  return tex;
}

// --- street furniture (one merged mesh) -------------------------------------------
function buildStreetFurniture(city) {
  const parts = [];
  // Lamp posts: pole, arm and a glowing head, all merged.
  for (const lamp of city.lamps) {
    const rot = ((Math.round(lamp.x) + Math.round(lamp.z)) / 25) % 2 === 0 ? 0 : Math.PI;
    const dx = rot === 0 ? 1 : -1;
    parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6), matrix: at(lamp.x, 2.6, lamp.z), color: PALETTE.lampPole });
    parts.push({ geo: new THREE.BoxGeometry(1.15, 0.09, 0.09), matrix: at(lamp.x + dx * 0.52, 5.05, lamp.z), color: PALETTE.lampPole });
    parts.push({ geo: new THREE.BoxGeometry(0.55, 0.16, 0.34), matrix: at(lamp.x + dx * 0.95, 4.95, lamp.z), color: 0xfff0bf });
    parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.22, 0.12, 8), matrix: at(lamp.x, 0.06, lamp.z), color: 0x8f8778 });
  }
  const props = city.props || {};
  // Traffic signals: pole, arm over the road, head with three baked lenses.
  for (const sig of props.signals || []) {
    const armLen = 5.4;
    const ax = sig.axis === 'x' ? sig.dir * armLen : 0;
    const az = sig.axis === 'x' ? 0 : sig.dir * armLen;
    parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.11, 6.2, 6), matrix: at(sig.x, 3.1, sig.z), color: 0x39424a });
    parts.push({ geo: new THREE.BoxGeometry(sig.axis === 'x' ? armLen : 0.1, 0.1, sig.axis === 'x' ? 0.1 : armLen), matrix: at(sig.x + ax / 2, 6.1, sig.z + az / 2), color: 0x39424a });
    const hx = sig.x + ax;
    const hz = sig.z + az;
    parts.push({ geo: new THREE.BoxGeometry(0.42, 1.1, 0.34), matrix: at(hx, 5.55, hz), color: 0x22272c });
    const lensCol = [0xff3b30, 0xffb020, 0x43d675][sig.state] ?? 0x43d675;
    for (let i = 0; i < 3; i += 1) {
      const lit = i === sig.state;
      parts.push({
        geo: new THREE.BoxGeometry(0.26, 0.24, 0.06),
        matrix: at(hx, 5.88 - i * 0.32, hz + sig.face * 0.2),
        color: lit ? lensCol : tintOf(lensCol, 0.22),
      });
    }
  }
  // Benches.
  for (const b of props.benches || []) {
    parts.push({ geo: new THREE.BoxGeometry(1.9, 0.1, 0.55), matrix: at(b.x, 0.46, b.z, b.rot), color: 0x9a6b45 });
    parts.push({ geo: new THREE.BoxGeometry(1.9, 0.5, 0.09), matrix: at(b.x - Math.sin(b.rot) * 0.24, 0.72, b.z - Math.cos(b.rot) * 0.24, b.rot), color: 0x9a6b45 });
    for (const s of [-1, 1]) {
      parts.push({ geo: new THREE.BoxGeometry(0.1, 0.44, 0.46), matrix: at(b.x + Math.cos(b.rot) * s * 0.8, 0.22, b.z - Math.sin(b.rot) * s * 0.8), color: 0x3c4148 });
    }
  }
  // Planters with a dark shrub.
  for (const p of props.planters || []) {
    parts.push({ geo: new THREE.BoxGeometry(1.1, 0.6, 1.1), matrix: at(p.x, 0.3, p.z, p.rot), color: 0xc9bda8 });
    parts.push({ geo: new THREE.IcosahedronGeometry(0.52, 1), matrix: at(p.x, 0.78, p.z), color: 0x3f7a45 });
  }
  // Bins.
  for (const b of props.bins || []) {
    parts.push({ geo: new THREE.CylinderGeometry(0.28, 0.24, 0.8, 8), matrix: at(b.x, 0.4, b.z), color: 0x2f4a3c });
    parts.push({ geo: new THREE.CylinderGeometry(0.31, 0.31, 0.07, 8), matrix: at(b.x, 0.82, b.z), color: 0x21362b });
  }
  // Hydrants.
  for (const h of props.hydrants || []) {
    parts.push({ geo: new THREE.CylinderGeometry(0.13, 0.15, 0.62, 7), matrix: at(h.x, 0.31, h.z), color: 0xc0392b });
    parts.push({ geo: new THREE.SphereGeometry(0.15, 7, 5), matrix: at(h.x, 0.65, h.z), color: 0xd94a3c });
    parts.push({ geo: new THREE.BoxGeometry(0.5, 0.1, 0.1), matrix: at(h.x, 0.46, h.z), color: 0xa5301f });
  }
  // Promenade railing along the beach edge.
  const rails = props.rails || [];
  if (rails.length) {
    const zs = rails.map((r) => r.z);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    for (const r of rails) {
      parts.push({ geo: new THREE.BoxGeometry(0.08, 1.0, 0.08), matrix: at(r.x, 0.5, r.z), color: 0xd6cbb6 });
    }
    for (const y of [0.55, 0.95]) {
      parts.push({ geo: new THREE.BoxGeometry(0.06, 0.06, z1 - z0), matrix: at(rails[0].x, y, (z0 + z1) / 2), color: 0xe4dccb });
    }
  }
  // Beach parasols.
  for (const u of props.umbrellas || []) {
    parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), matrix: at(u.x, 1.2, u.z), color: 0x8b7b62 });
    parts.push({ geo: new THREE.ConeGeometry(1.35, 0.5, 10), matrix: at(u.x, 2.45, u.z, 0, u.tilt), color: u.color });
    parts.push({ geo: new THREE.BoxGeometry(0.5, 0.45, 1.7), matrix: at(u.x + 0.9, 0.24, u.z + 0.4), color: 0xe8e2d2 });
  }
  const mesh = new THREE.Mesh(mergeParts(parts), bodyMatCache);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Roof clutter and awnings for the blocks near the centre, all in one merged mesh. */
function buildBuildingTrim(city) {
  const parts = [];
  const awningColors = [0xc6543e, 0x218c91, 0xd29a42, 0x496a94];
  const seedOf = (b) => (Math.round((b.x + 150) * 17 + (b.z + 150) * 83 + b.h * 9) | 0);
  city.buildings.forEach((b) => {
    const seed = seedOf(b);
    // A solid parapet cap slightly proud of the roof: reads as a rim from the street.
    parts.push({ geo: new THREE.BoxGeometry(b.w + 0.45, 0.42, b.d + 0.45), matrix: at(b.x, b.h + 0.1, b.z), color: tintOf(b.color, 1.12) });
    // One AC unit on the roof for silhouette variety.
    if (seed % 3 === 0) {
      const u = Math.max(1, Math.min(b.w, b.d));
      parts.push({ geo: new THREE.BoxGeometry(u * 0.3, 0.8, u * 0.27), matrix: at(b.x, b.h + 0.8, b.z), color: 0x89939a });
    }
    if (seed % 4 === 0 && b.h > 9) {
      parts.push({ geo: new THREE.CylinderGeometry(1.1, 1.1, 2.6, 10), matrix: at(b.x + 1.4, b.h + 1.75, b.z), color: 0xd1d0bd });
      parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 1.5, 5), matrix: at(b.x + 1.4, b.h + 0.7, b.z), color: 0xb8b3a2 });
    }
    if (Math.abs(b.x) < 60 && Math.abs(b.z) < 60) {
      const c = awningColors[(seed >>> 2) % awningColors.length];
      parts.push({ geo: new THREE.BoxGeometry(b.w * 0.82, 0.42, 1.9), matrix: at(b.x, 3.1, b.z + b.d / 2 + 0.15), color: c });
      // Alternating stripe blocks on the awning face.
      for (let i = 0; i < 5; i += 1) {
        parts.push({
          geo: new THREE.BoxGeometry(b.w * 0.15, 0.4, 0.06),
          matrix: at(b.x - b.w * 0.33 + i * b.w * 0.165, 3.1, b.z + b.d / 2 + 1.12),
          color: 0xf4ecdd,
        });
      }
    }
  });
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeParts(parts), bodyMatCache);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Three coastal wayfinding boards on one shared 3-panel texture: one draw. */
function buildSigns() {
  const labels = ['DOCKS', 'BEACH', 'MARINA'];
  const spots = [[-108, 14], [-64, 68], [61, -64]];
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 128;
  const g = c.getContext('2d');
  labels.forEach((label, i) => {
    const x = i * 256;
    g.fillStyle = '#16645f';
    g.fillRect(x, 0, 256, 128);
    g.strokeStyle = '#f1d69e';
    g.lineWidth = 7;
    g.strokeRect(x + 6, 6, 244, 116);
    g.fillStyle = '#fff2ce';
    g.font = 'bold 46px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + 128, 66);
  });
  const tex = srgb(new THREE.CanvasTexture(c));
  const geos = [];
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const pushQuad = (a, b2, c2, d, n, uvs, colour) => {
    const verts = [a, b2, c2, a, c2, d];
    const uu = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    const r = ((colour >> 16) & 255) / 255;
    const gg = ((colour >> 8) & 255) / 255;
    const bb = (colour & 255) / 255;
    for (let i = 0; i < 6; i += 1) {
      pos.push(verts[i][0], verts[i][1], verts[i][2]);
      nor.push(n[0], n[1], n[2]);
      uv.push(uu[i][0], uu[i][1]);
      col.push(r, gg, bb);
    }
  };
  spots.forEach(([x, z], i) => {
    const hw = 2.6;
    const hh = 0.9;
    const y = 3.25;
    const u0 = i / 3;
    const u1 = (i + 1) / 3;
    pushQuad([x - hw, y - hh, z + 0.1], [x + hw, y - hh, z + 0.1], [x + hw, y + hh, z + 0.1], [x - hw, y + hh, z + 0.1], [0, 0, 1], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], 0xffffff);
    // Posts for the three boards (part of the same merged mesh below).
    pushQuad([x + hw, y - hh, z - 0.1], [x - hw, y - hh, z - 0.1], [x - hw, y + hh, z - 0.1], [x + hw, y + hh, z - 0.1], [0, 0, -1], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], 0xffffff);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }));
  // Posts are part of the furniture mesh; only the boards live here.
  return mesh;
}

// --- palms --------------------------------------------------------------------------
/**
 * How far every palm is pushed into the ground, in metres. The trunk is tilted rz = -0.08
 * inside `buildPalmGeo`, which lifts the base of the 4.4 m cylinder by ~0.7 cm, and a 22 cm
 * trunk with no contact shadow reads as floating on the pale pavement. Sinking it a fixed
 * 15 cm makes the trunk bite into the ground and keeps the buried amount identical at
 * every crown scale, so the offset lives on the instance, not in the baked geometry.
 */
const PALM_SINK = 0.15;
let palmGeoCache = null;
/** Top of the 4.4 m trunk after its rz = -0.08 lean: the single point every frond grows from. */
const PALM_CROWN_X = 0.35;
const PALM_CROWN_Y = 4.42;

let frondGeoCache = null;
/**
 * One palm frond, as a tapered blade that leaves the crown nearly level and droops at the
 * tip. It is built along +Z so the nine of them need only a yaw to radiate, and it is
 * squashed across its thickness (0.3x) so it reads as a leaf, not as the thick green
 * cylinder the old cone produced. Two open-ended 4-gon segments (16 triangles, no caps:
 * both ends are hidden, the base inside the crown and the tip 1 cm across) with the wide
 * end at the base and the narrow end at the tip — a cone the right way round.
 */
function frondGeometry() {
  if (frondGeoCache) return frondGeoCache;
  // Base: 1.15 m, rises ~22 deg as it leaves the trunk top. 0.12 m half-width keeps the
  // base narrower than the 0.28 m trunk top, so no frond is thicker than the stem.
  const lower = new THREE.CylinderGeometry(0.058, 0.12, 1.15, 4, 1, true);
  lower.translate(0, 0.575, 0);
  lower.scale(1.1, 1, 0.3);
  // Tip: 1.75 m from the base's end, bending ~35 deg below level.
  const upper = new THREE.CylinderGeometry(0.011, 0.058, 1.75, 4, 1, true);
  upper.translate(0, 0.875, 0);
  upper.scale(1.1, 1, 0.3);
  frondGeoCache = mergeParts([
    { geo: lower, matrix: at(0, 0, 0, 0, Math.PI / 2 - 0.38), color: 0xffffff },
    // Start of the bend: the base segment's own end point (1.15 m out, 0.43 m up).
    { geo: upper, matrix: at(0, 0.428, 1.069, 0, Math.PI / 2 + 0.62), color: 0xffffff },
  ]);
  return frondGeoCache;
}

/** Trunk + crown + fronds baked into one geometry, vertex coloured, for instancing. */
function buildPalmGeo() {
  if (palmGeoCache) return palmGeoCache;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.22, 4.4, 6);
  parts.push({ geo: trunk, matrix: at(0.18, 2.2, 0, 0, 0, -0.08), color: PALETTE.palmTrunk });
  const crown = new THREE.IcosahedronGeometry(1.25, 1);
  parts.push({ geo: crown, matrix: at(PALM_CROWN_X, 4.9, 0), color: tintOf(PALETTE.palmLeaf, 0.85) });
  // All nine fronds share one origin at the trunk top, so their thick bases sit inside the
  // crown with no gap; only the drooping outer half of each blade is seen.
  const frond = frondGeometry();
  for (let i = 0; i < 9; i += 1) {
    const a = (i * Math.PI * 2) / 9;
    parts.push({
      geo: frond,
      matrix: at(PALM_CROWN_X, PALM_CROWN_Y, 0, a),
      color: i % 2 ? PALETTE.palmLeaf : tintOf(PALETTE.palmLeaf, 1.18),
    });
  }
  palmGeoCache = mergeParts(parts);
  return palmGeoCache;
}

// --- broadleaf street trees ---------------------------------------------------------
let treeGeoCache = null;
/**
 * A plain street tree baked into one geometry: a short trunk plus three overlapping
 * icosahedron canopies (264 triangles with the trunk, against the palm's 212), vertex
 * coloured so a whole avenue varies without a second material. Instancing keeps it at one
 * draw call for the whole city.
 */
function buildTreeGeo() {
  if (treeGeoCache) return treeGeoCache;
  const parts = [];
  parts.push({ geo: new THREE.CylinderGeometry(0.17, 0.26, 2.6, 6), matrix: at(0, 1.3, 0), color: PALETTE.palmTrunk });
  const leaf = 0x4c8a3c;
  const blobs = [
    [0, 3.9, 0, 1.55, leaf],
    [0.85, 3.3, 0.3, 1.15, tintOf(leaf, 0.86)],
    [-0.8, 3.35, -0.35, 1.05, tintOf(leaf, 1.16)],
  ];
  for (const [x, y, z, r, color] of blobs) {
    parts.push({ geo: new THREE.IcosahedronGeometry(r, 1), matrix: at(x, y, z), color });
  }
  treeGeoCache = mergeParts(parts);
  return treeGeoCache;
}

/**
 * One instanced draw for a single-geometry field; `scaleOf`/`yawOf` default to seeded
 * variety. `liftOf` returns a world-space y offset for an instance and is applied after
 * scaling, so the same list can be sunk by a fixed amount regardless of its crown size.
 */
function scratchInstances(scene, geo, list, scaleOf, yawOf, liftOf) {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
  mesh.castShadow = SHADOW.mode === 'map';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  list.forEach((item, i) => {
    const h = scaleOf(item, i);
    s.set(h, h, h);
    q.setFromAxisAngle(UP, yawOf(item, i));
    p.set(item.x, liftOf ? liftOf(item, i) : 0, item.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

// --- palm contact shadows -----------------------------------------------------------
let contactTexCache = null;
/** Soft round contact shadow for a palm base, drawn once and shared by the whole row. */
function contactTexture() {
  if (contactTexCache) return contactTexCache;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  contactTexCache = srgb(new THREE.CanvasTexture(c));
  return contactTexCache;
}

/**
 * Dark discs under every palm, in one unlit instanced draw. The pavement is bright enough
 * that the trunks need a footprint to sit on; a 0.8 m radius disc is wide enough to read
 * at chase distance and narrow enough not to pool under the crown.
 */
function buildPalmShades(scene, palms) {
  if (!palms || !palms.length) return null;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: contactTexture(), transparent: true, depthWrite: false, opacity: 0.34, color: 0x1b2418,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, palms.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  palms.forEach((palm, i) => {
    const h = (palm.scale || 1) * 1.2;
    s.set(h, h, h);
    p.set(palm.x, 0.045, palm.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// --- the sea -------------------------------------------------------------------------
function buildOcean() {
  const width = WATER.far;
  const geo = new THREE.PlaneGeometry(width, WATER.span, WATER.segX, WATER.segZ);
  geo.rotateX(-Math.PI / 2);
  const tex = waterTexture();
  // The sea read as a flat white band across the whole horizon in the staged frames:
  // roughness 0.3 + metalness 0.22 turned the diffuse sky and the sun into a mirror at
  // grazing angles, and emissive 0.35 lifted the far water over 235 luma everywhere.
  // Measured on ?shot=chase, the mid band at y=180..230 was rgb(241,239,229) across
  // ~40% of the frame width. A rough, mostly-diffuse surface keeps the teal and lets the
  // sun path (baked into the texture) carry the highlight instead of the shader.
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xdfeef2,
    roughness: 0.62,
    metalness: 0.04,
    emissive: 0x0b3a52,
    emissiveIntensity: 0.06,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(WATER.edge - width / 2, WATER.level, 0);
  mesh.receiveShadow = false;
  const base = geo.attributes.position.array.slice();
  return {
    mesh,
    tex,
    /** Gentle swell: two crossed sine trains, deeper out to sea than at the shore. */
    update(t) {
      const pos = geo.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const x = base[i];
        const z = base[i + 2];
        const depth = Math.min(1, Math.max(0, (WATER.edge - (mesh.position.x + x)) / 110));
        pos[i + 1] = WATER.waveAmp * depth * (
          Math.sin(x * 0.055 + t * 1.5) * 0.7
          + Math.sin(z * 0.09 - t * 1.1 + x * 0.02) * 0.45
          + Math.sin((x + z) * 0.021 + t * 0.6) * 0.5
        );
      }
      geo.attributes.position.needsUpdate = true;
      tex.offset.y = (t * 0.012) % 1;
      tex.offset.x = (t * 0.004) % 1;
    },
  };
}

// --- sky ------------------------------------------------------------------------------
// The dome gradient is dithered, not a plain 4x512 canvas strip. Measured on the staged
// frames before this change: a vertical sky column held 76-83 consecutive identical rows
// out of 216 (rl0-foot at x=153, rl0-shoot at x=153) — textbook 8-bit banding, visible as
// stripes across the sky in every screenshot. Ordered (Bayer 8x8) dithering at +-1/255
// scatters each 8-bit step so the ramp reads smooth, and being an ordered matrix it stays
// perfectly deterministic: the same seed still paints the same frame.
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/** Clamp a dither-nudged channel back into a byte. Uint8ClampedArray would wrap-free it,
 *  but getImageData can hand back a plain array in some engines, so do it explicitly. */
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function buildSky(scene) {
  const SKY_W = 64;
  const SKY_H = 512;
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = SKY_W;
  skyCanvas.height = SKY_H;
  const ctx = skyCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, SKY_H, 0, 0);
  grad.addColorStop(0, SKY.horizon);
  grad.addColorStop(0.22, SKY.haze);
  grad.addColorStop(0.44, '#e7c8ab');
  grad.addColorStop(0.62, SKY.mid);
  grad.addColorStop(0.82, SKY.high);
  grad.addColorStop(1, SKY.zenith);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SKY_W, SKY_H);
  // Ordered dither: nudge each pixel by up to +-1 level, in a fixed 8x8 pattern.
  const img = ctx.getImageData(0, 0, SKY_W, SKY_H);
  const px = img.data;
  for (let y = 0; y < SKY_H; y += 1) {
    for (let x = 0; x < SKY_W; x += 1) {
      const i = (y * SKY_W + x) * 4;
      // (bayer + 0.5)/64 -> (0,1); shift by -0.5 so the ramp keeps its average brightness.
      const d = (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5;
      px[i] = clamp255(px[i] + d);
      px[i + 1] = clamp255(px[i + 1] + d);
      px[i + 2] = clamp255(px[i + 2] + d);
    }
  }
  ctx.putImageData(img, 0, 0);
  const skyTex = srgb(new THREE.CanvasTexture(skyCanvas));
  skyTex.minFilter = THREE.LinearFilter; // no mip chain: mips would average the dither away
  skyTex.generateMipmaps = false;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(520, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);

  // Sun disc + a wide warm halo, both pinned to the light direction.
  const sunPos = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize().multiplyScalar(430);
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(12, 20, 12),
    new THREE.MeshBasicMaterial({ color: SKY.sunDisc, toneMapped: false, fog: false }),
  );
  sunDisc.position.copy(sunPos);
  scene.add(sunDisc);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 360),
    new THREE.MeshBasicMaterial({
      map: haloTexture(), transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }),
  );
  halo.position.copy(sunPos);
  halo.lookAt(0, 0, 0);
  scene.add(halo);
  return { sky, sunDisc, halo };
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 2, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,244,214,.95)');
  grad.addColorStop(0.12, 'rgba(255,216,160,.55)');
  grad.addColorStop(0.4, 'rgba(255,190,130,.18)');
  grad.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return srgb(new THREE.CanvasTexture(c));
}

function buildClouds(scene) {
  const tex = cloudTexture();
  const bands = [];
  const layers = [
    { y: CLOUDS.height, radius: CLOUDS.radius, height: 78, repeat: 3, opacity: 0.9, speed: 1 },
    { y: CLOUDS.height * 0.72, radius: CLOUDS.radius * 0.82, height: 56, repeat: 4, opacity: 0.55, speed: 1.7 },
  ];
  for (const layer of layers) {
    const t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(layer.repeat, 1);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(layer.radius, layer.radius, layer.height, 40, 1, true),
      new THREE.MeshBasicMaterial({
        map: t, transparent: true, opacity: layer.opacity, depthWrite: false,
        side: THREE.BackSide, fog: false, toneMapped: false,
      }),
    );
    mesh.position.y = layer.y;
    scene.add(mesh);
    bands.push({ tex: t, speed: layer.speed });
  }
  return bands;
}

// --- buildings ------------------------------------------------------------------------
function buildBuildings(city, sheet) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const quads = [];
  const pushQuad = (a, b, c, d, n, uvs, colour) => {
    quads.push([a, b, c, d, n, uvs, colour]);
  };
  city.buildings.forEach((b, i) => {
    const tile = FACADE_TILE_0 + i;
    const t = tileUV(tile, 1.5);
    const roof = tileUV(ROOF_TILE, 12);
    const x0 = b.x - b.w / 2;
    const x1 = b.x + b.w / 2;
    const z0 = b.z - b.d / 2;
    const z1 = b.z + b.d / 2;
    const y0 = 0;
    const y1 = b.h;
    const side = b.color;
    // Four walls, wound so the normal points outward. The vertical UV span is the
    // building's OWN tile band (t.v0..t.v1), not 0..1: the atlas is 16x8 tiles and only
    // 73 of 128 are ever drawn, so a 0..1 wall sampled the blank lower rows, where the
    // texel is rgba(0,0,0,0) and the material is opaque — texture x vertex-colour x
    // light = 0 at every pixel, which is why 18.4% of the on-foot frame rendered pure
    // black no matter how much ambient or hemisphere light was added.
    const wallUV = [[t.u0, t.v0], [t.u1, t.v0], [t.u1, t.v1], [t.u0, t.v1]];
    pushQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], wallUV, side);
    pushQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], wallUV, side);
    pushQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wallUV, side);
    pushQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], wallUV, side);
    // Roof, tinted darker so it reads as a different surface from a high camera.
    pushQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[roof.u0, roof.v0], [roof.u1, roof.v0], [roof.u1, roof.v1], [roof.u0, roof.v1]], tintOf(b.color, 0.62));
  });
  for (const [a, b, c, d, n, uvs, colour] of quads) {
    const verts = [a, b, c, a, c, d];
    const uu = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    const r = ((colour >> 16) & 255) / 255;
    const g = ((colour >> 8) & 255) / 255;
    const bl = (colour & 255) / 255;
    for (let k = 0; k < 6; k += 1) {
      pos.push(verts[k][0], verts[k][1], verts[k][2]);
      nor.push(n[0], n[1], n[2]);
      uv.push(uu[k][0], uu[k][1]);
      col.push(r, g, bl);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: sheet, vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- renderer ---------------------------------------------------------------------------
export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = SHADOW.mode === 'map';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Measured on the staged chase frame: mean luma 156.8 with P95 at 253 (clipped) and a
  // sky band mean of 164 — the frame is over-exposed and the sky reads as white paper.
  // For a noon coastal scene the sky should sit well below the top of the range so the
  // facades, road and foliage still carry their mid-tones.
  renderer.toneMappingExposure = 0.66;
  // ?exposure=0.6 pins the exposure for A/B: shot mode paints a fixed two frames and then
  // stops, so a value set after __shotReady is never drawn — every post-hoc sweep came back
  // byte-identical and looked like a dead knob. Boot-time is the only point that measures.
  {
    const q = new URLSearchParams(window.location.search).get('exposure');
    if (q !== null && Number.isFinite(+q)) renderer.toneMappingExposure = Math.max(0.05, Math.min(4, +q));
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.fogColor);
  scene.fog = new THREE.Fog(SKY.fogColor, SKY.fogNear, SKY.fogFar);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);

  // Sky, sun, clouds.
  buildSky(scene);
  const cloudBands = buildClouds(scene);

  // Light: hemisphere fill + ambient lift + one shadow-mapped sun.
  // ?fill=<multiplier> scales the two fill lights only, for A/B ing how much of a shadowed
  // face survives. Boot-time only, same reason as ?exposure: shot mode paints twice.
  let fillMul = 1;
  {
    const q = new URLSearchParams(window.location.search).get('fill');
    if (q !== null && Number.isFinite(+q)) fillMul = Math.max(0.05, Math.min(4, +q));
  }
  scene.add(new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, SHADOW.hemi * fillMul));
  scene.add(new THREE.AmbientLight(0xffe9d2, SHADOW.ambient * fillMul));
  const sun = new THREE.DirectionalLight(PALETTE.sun, SHADOW.intensity);
  // ?sun=<elevation deg>&sunAz=<deg> overrides the sun for A/B. Shadows only read as
  // shadows when the light is low enough to throw them across the ground: at 75° a 10 m
  // building drops a 2.7 m stub, which is why every visual review of the shots said "no
  // sunlight, flat". Boot-time only, same reason as ?exposure (shot mode paints twice).
  let sunVec;
  {
    const q = new URLSearchParams(window.location.search);
    const elq = q.get('sun');
    const azq = q.get('sunAz');
    if (elq !== null && Number.isFinite(+elq)) {
      const el = Math.max(2, Math.min(88, +elq)) * Math.PI / 180;
      const az = (azq !== null && Number.isFinite(+azq) ? +azq : 225) * Math.PI / 180;
      sunVec = new THREE.Vector3(
        Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el),
      ).normalize();
    } else {
      sunVec = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();
    }
  }
  sun.position.copy(sunVec).multiplyScalar(220);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);
  sun.castShadow = SHADOW.mode === 'map';
  const _fwd = new THREE.Vector3(); // scratch for the shadow-frustum tracker in render()
  const sh = sun.shadow;
  sh.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  sh.camera.left = -SHADOW.extent;
  sh.camera.right = SHADOW.extent;
  sh.camera.top = SHADOW.extent;
  sh.camera.bottom = -SHADOW.extent;
  sh.camera.near = SHADOW.near;
  sh.camera.far = SHADOW.far;
  sh.bias = SHADOW.bias;
  sh.normalBias = SHADOW.normalBias;
  sh.camera.updateProjectionMatrix();
  scene.add(sun);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = SHADOW.mode === 'map';
  scene.add(ground);

  // Road paint + kerbs (R1c): buildRoadMarkings()/buildKerbs() were written in the
  // R1b pass but never added to the scene, so the bench frames showed no markings at
  // all — the "no lane markings" gap was dead code, not a width problem. Both are one
  // draw each: the paint layer and the whole city's kerbs.
  scene.add(buildRoadMarkings());
  const kerbs = buildKerbs();
  if (kerbs) scene.add(kerbs);

  // Sea, beach, foam line, harbour.
  const ocean = buildOcean();
  scene.add(ocean.mesh);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 292, 1, 1),
    new THREE.MeshLambertMaterial({ map: beachTexture() }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-137.5, 0.02, 0);
  beach.receiveShadow = SHADOW.mode === 'map';
  scene.add(beach);
  // Wet sand / foam: a soft, warm-white line that moves with the swell.
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 300),
    new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, opacity: 0.8, depthWrite: false }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(-144.6, WATER.level + 0.05, 0);
  scene.add(foam);
  scene.add(buildHarbour());

  // Buildings: one draw for the whole city.
  const sheet = facadeSheet(city.buildings);
  scene.add(buildBuildings(city, sheet));
  const trim = buildBuildingTrim(city);
  if (trim) scene.add(trim);
  const furniture = buildStreetFurniture(city);
  scene.add(furniture);
  scene.add(buildSigns());

  // Palms and street trees: one instanced draw each. Pixel scale/rotation per instance is
  // derived from the position, so the same city is drawn the same way on every capture.
  // `scale` comes from world.js for the planted rows (it varies row by row); the older
  // in-block palms carry no scale and keep the derived 0.90-1.17 range they always had.
  if (city.palms.length) {
    scratchInstances(
      scene, buildPalmGeo(), city.palms,
      (palm, i) => palm.scale || (0.9 + ((((Math.round(palm.x * 13 + palm.z * 7) % 7) + 7) % 7) * 0.045)),
      (palm) => (((Math.round(palm.x * 13 + palm.z * 7) % 11) + 11) % 11) * 0.57,
      () => -PALM_SINK,
    );
    buildPalmShades(scene, city.palms);
  }
  if (city.trees && city.trees.length) {
    scratchInstances(
      scene, buildTreeGeo(), city.trees,
      (tree) => tree.scale || 1,
      (tree, i) => tree.rot || 0,
    );
  }

  // Downtown landmark tower: glass shaft plus a warm crown.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(14, 50, 14),
    new THREE.MeshLambertMaterial({ color: 0x7196a6, emissive: 0x18394a, emissiveIntensity: 0.2, transparent: true, opacity: 0.82 }),
  );
  glass.position.set(9, 25, 9);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(16, 2, 16), new THREE.MeshLambertMaterial({ color: 0xffc36d }));
  crown.position.set(9, 50, 9);
  crown.castShadow = SHADOW.mode === 'map';
  scene.add(glass, crown);

  // Mission beacon.
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
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

  // Blob shadows: one instanced field for every car and every person.
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTexture(), transparent: true, depthWrite: false,
    opacity: SHADOW.mode === 'map' ? 0.10 : 0.6, color: 0x1a2230,
  });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, 96);
  blobs.frustumCulled = false;
  blobs.renderOrder = 1;
  blobs.count = 0;
  scene.add(blobs);

  // People: four instanced meshes for every person in the world.
  const personMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const legMesh = new THREE.InstancedMesh(PERSON_GEO.leg, new THREE.MeshLambertMaterial({ color: DARK }), PERSON_CAP * 2);
  const armMesh = new THREE.InstancedMesh(PERSON_GEO.arm, personMat.clone(), PERSON_CAP * 2);
  const torsoMesh = new THREE.InstancedMesh(PERSON_GEO.torso, personMat.clone(), PERSON_CAP);
  const headMesh = new THREE.InstancedMesh(PERSON_GEO.head, new THREE.MeshLambertMaterial({ color: SKIN }), PERSON_CAP);
  for (const m of [legMesh, armMesh, torsoMesh, headMesh]) {
    m.frustumCulled = false;
    m.castShadow = SHADOW.mode === 'map';
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    scene.add(m);
  }
  const _pm = new THREE.Matrix4();
  const _lm = new THREE.Matrix4();
  const _tmp = new THREE.Matrix4();
  const _out = new THREE.Matrix4();
  const _vec = new THREE.Vector3();
  const personColor = new THREE.Color();
  const people = [];
  const cars = [];

  /** Find every person and car mesh the rest of the game added to the scene. Cheap: the
   *  scene holds well under 200 children now that props are merged. */
  function discover() {
    people.length = 0;
    cars.length = 0;
    for (const child of scene.children) {
      const ud = child.userData;
      if (!ud) continue;
      if (ud.person) people.push(child);
      else if (ud.wheels) cars.push(child);
    }
  }

  /** Bake every tracked person's limb rotations into the instanced meshes. */
  function syncPeople() {
    let n = 0;
    for (let i = 0; i < people.length; i += 1) {
      const g = people[i];
      if (!g.visible || n >= PERSON_CAP) continue;
      g.updateWorldMatrix(true, false);
      _pm.copy(g.matrixWorld);
      const ud = g.userData;
      const wide = ud.style === 1 ? 1.25 : 1;
      const legL = ud.legL.rotation.x;
      const legR = ud.legR.rotation.x;
      const armL = ud.armL.rotation.x;
      const armR = ud.armR.rotation.x;
      // Legs.
      _lm.makeTranslation(-0.14, 0.8, 0).multiply(_tmp.makeRotationX(legL));
      legMesh.setMatrixAt(n * 2, _out.copy(_pm).multiply(_lm));
      _lm.makeTranslation(0.14, 0.8, 0).multiply(_tmp.makeRotationX(legR));
      legMesh.setMatrixAt(n * 2 + 1, _out.copy(_pm).multiply(_lm));
      // Torso (scaled sideways for the broad build).
      _lm.makeScale(wide, 1, 1).setPosition(0, 1.12, 0);
      torsoMesh.setMatrixAt(n, _out.copy(_pm).multiply(_lm));
      // Arms.
      _lm.makeTranslation(-0.37, 1.38, 0).multiply(_tmp.makeRotationX(armL));
      armMesh.setMatrixAt(n * 2, _out.copy(_pm).multiply(_lm));
      _lm.makeTranslation(0.37, 1.38, 0).multiply(_tmp.makeRotationX(armR));
      armMesh.setMatrixAt(n * 2 + 1, _out.copy(_pm).multiply(_lm));
      // Head, slightly taller on the broad build.
      _lm.makeTranslation(0, 1.62 + (ud.style === 1 ? 0.06 : 0), 0);
      headMesh.setMatrixAt(n, _out.copy(_pm).multiply(_lm));
      personColor.setHex(ud.color === undefined ? 0xcccccc : ud.color);
      armMesh.setColorAt(n * 2, personColor);
      armMesh.setColorAt(n * 2 + 1, personColor);
      torsoMesh.setColorAt(n, personColor);
      n += 1;
    }
    legMesh.count = n * 2;
    armMesh.count = n * 2;
    torsoMesh.count = n;
    headMesh.count = n;
    legMesh.instanceMatrix.needsUpdate = true;
    armMesh.instanceMatrix.needsUpdate = true;
    torsoMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    if (armMesh.instanceColor) armMesh.instanceColor.needsUpdate = true;
    if (torsoMesh.instanceColor) torsoMesh.instanceColor.needsUpdate = true;
  }

  // Weapon: one instanced pass for every armed person. People are instanced limbs (there is
  // no drawable body to parent a gun to), so the gun is placed from the same right-shoulder
  // transform the arm uses. Three proportions, picked by the carrier's weapon id, so a
  // pistol, SMG and shotgun read differently in silhouette. Two draws total (body + slide).
  const GUN_GEO = {
    pistol: new THREE.BoxGeometry(0.09, 0.13, 0.34),
    smg: new THREE.BoxGeometry(0.10, 0.15, 0.62),
    shotgun: new THREE.BoxGeometry(0.11, 0.16, 0.92),
  };
  // A magazine/grip block, sized with the gun, so each weapon has a distinct silhouette.
  const GRIP_GEO = {
    pistol: new THREE.BoxGeometry(0.07, 0.16, 0.09),
    smg: new THREE.BoxGeometry(0.08, 0.26, 0.11),
    shotgun: new THREE.BoxGeometry(0.09, 0.2, 0.34),
  };
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x23262c });
  const guns = {};
  for (const id of ['pistol', 'smg', 'shotgun']) {
    const m = new THREE.InstancedMesh(GUN_GEO[id], gunMat, PERSON_CAP);
    m.frustumCulled = false;
    m.castShadow = SHADOW.mode === 'map';
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    scene.add(m);
    guns[id] = { mesh: m, grip: new THREE.InstancedMesh(GRIP_GEO[id], gunMat, PERSON_CAP) };
    guns[id].grip.frustumCulled = false;
    guns[id].grip.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    guns[id].grip.count = 0;
    scene.add(guns[id].grip);
  }

  function syncGuns() {
    const used = { pistol: 0, smg: 0, shotgun: 0 };
    for (let i = 0; i < people.length; i += 1) {
      const g = people[i];
      if (!g.visible) continue;
      const ud = g.userData;
      const id = ud.armed;
      if (!id || !guns[id] || used[id] >= PERSON_CAP) continue;
      g.updateWorldMatrix(true, false);
      _pm.copy(g.matrixWorld);
      // Right shoulder, then the arm's own pitch/roll, then a point down the forearm: this
      // is the same chain the arm instance uses, so the gun sits in the hand.
      _lm.makeTranslation(0.37, 1.38, 0).multiply(_tmp.makeRotationX(ud.armRx || 0));
      if (ud.armRz) _lm.multiply(_tmp.makeRotationZ(ud.armRz));
      _lm.multiply(_tmp.makeTranslation(0, -0.62, 0.16));
      // The gun's long axis is its local +Z, but the arm chain pitches the forearm
      // forward (armRx ~ -1.45 when aiming), which maps +Z to straight UP: without a
      // compensating rotation every gun stood up like an antenna. Roll the gun +90°
      // about X so the barrel runs along the forearm, then slide it forward so the
      // breech sits at the hand and the muzzle is (len - 0.07) m ahead of it.
      const len = GUN_GEO[id].parameters.depth;
      _lm.multiply(_tmp.makeRotationX(Math.PI / 2));
      _lm.multiply(_tmp.makeTranslation(0, 0, len / 2 - 0.07));
      const k = used[id];
      guns[id].mesh.setMatrixAt(k, _out.copy(_pm).multiply(_lm));
      // The grip hangs below the barrel at the hand: back from the gun centre by the
      // same forward slide, 0.09 down in the gun's frame (which is world-down once the
      // barrel runs along the forearm).
      _lm.multiply(_tmp.makeTranslation(0, -0.09, 0.09 - len / 2));
      guns[id].grip.setMatrixAt(k, _out.copy(_pm).multiply(_lm));
      used[id] += 1;
    }
    for (const id of Object.keys(guns)) {
      guns[id].mesh.count = used[id];
      guns[id].grip.count = used[id];
      guns[id].mesh.instanceMatrix.needsUpdate = true;
      guns[id].grip.instanceMatrix.needsUpdate = true;
    }
  }

  /** One dark ellipse under every car and every person: 1 draw for all of them. */
  function syncBlobs() {
    let used = 0;
    const push = (x, z, rx, rz, ry) => {
      if (used >= 96) return;
      _lm.makeRotationY(ry || 0);
      _lm.scale(_vec.set(rx, 1, rz));
      _lm.setPosition(x, 0.04, z);
      blobs.setMatrixAt(used, _lm);
      used += 1;
    };
    for (const g of cars) {
      if (!g.visible) continue;
      push(g.position.x, g.position.z, 2.3, 4.6, g.rotation.y);
    }
    for (const g of people) {
      if (!g.visible) continue;
      push(g.position.x, g.position.z, 1.15, 1.15, g.rotation.y);
    }
    blobs.count = used;
    blobs.instanceMatrix.needsUpdate = true;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const start = performance.now();
  return {
    scene,
    camera,
    sun,
    // The THREE.WebGLRenderer itself. main.js's quality ladder and any exposure change
    // reach for this; without it `renderer.toneMappingExposure = x` silently wrote the
    // number onto this plain wrapper object and changed nothing on screen.
    gl: renderer,
    makePerson: makePersonMesh,
    makeCar: makeCarMesh,
    makePackage: makePackageMesh,
    makePoliceCar: makePoliceCarMesh,
    makePickup: makePickupMesh,
    makeTrafficLight,
    /** Force the instanced passes to re-scan the scene (called every frame anyway). */
    refresh() {
      discover();
    },
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
      const t = (performance.now() - start) / 1000;
      ocean.update(t * WATER.speed);
      for (const band of cloudBands) band.tex.offset.x = (t * CLOUDS.drift * band.speed) % 1;
      foam.position.y = WATER.level + 0.05 + Math.sin(t * 0.9) * 0.1;
      // The shadow box is only 2*SHADOW.extent wide, so it has to follow the action. Centre it
      // a little in front of the camera, along its view direction, so the ground being looked
      // at sits inside the sharp region rather than half behind the lens. Snapping the centre
      // to whole metres stops the texel grid crawling as the player walks, which otherwise
      // reads as shimmering shadow edges.
      if (sun.castShadow) {
        _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const tx = Math.round(camera.position.x + _fwd.x * SHADOW.extent * 0.5);
        const tz = Math.round(camera.position.z + _fwd.z * SHADOW.extent * 0.5);
        sun.target.position.set(tx, 0, tz);
        sun.position.set(tx + sunVec.x * 220, sunVec.y * 220, tz + sunVec.z * 220);
        sun.target.updateMatrixWorld();
      }
      discover();
      syncPeople();
      syncGuns();
      syncBlobs();
      renderer.render(scene, camera);
    },
  };
}

// --- extra canvas textures -----------------------------------------------------------
function foamTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.55)');
  grad.addColorStop(0.62, 'rgba(255,255,255,.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const rand = seeded(0x2fa1);
  for (let i = 0; i < 90; i += 1) {
    g.fillStyle = 'rgba(255,255,255,0)';
    g.fillRect(rand() * 128, rand() * 128, 2, 2);
  }
  const tex = srgb(new THREE.CanvasTexture(c));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 12);
  return tex;
}
