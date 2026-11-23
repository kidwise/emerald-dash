import * as THREE from 'three';
import { FacadeGeo, STYLE, createFacadeMaterial } from './facade.js';
import { cityBlocks, Z_SOUTH, X_WEST, X_EAST } from '../config.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAMES = [[0.035, 0.036, 0.04], [0.10, 0.10, 0.105], [0.05, 0.042, 0.035], [0.20, 0.21, 0.22], [0.022, 0.03, 0.04]];
const ACCENTS = [[0.85, 0.30, 0.04], [0.04, 0.42, 0.62], [0.62, 0.08, 0.10], [0.10, 0.50, 0.26], [0.80, 0.58, 0.06], [0.36, 0.14, 0.52]];
const BRICKS = [[0.30, 0.10, 0.065], [0.24, 0.085, 0.06], [0.34, 0.20, 0.12], [0.16, 0.13, 0.115], [0.36, 0.30, 0.22]];
const PANELS = [[0.30, 0.31, 0.32], [0.16, 0.17, 0.18], [0.34, 0.30, 0.25], [0.09, 0.10, 0.11]];
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

const SIDEWALK = 4.6;

// Each builder adds geometry for one building on lot {x0,x1,z0,z1}.
const BUILDERS = {
  office(g, r, L, o) {
    const frame = o.frame ?? pick(r, FRAMES), accent = o.accent ?? pick(r, ACCENTS);
    const floors = o.floors ?? 8;
    const gh = 5.6, fh = 4.1;
    const H = gh + floors * fh;
    const base = { style: STYLE.CURTAIN, seed: r() * 50, floorH: fh, bayW: 1.5, groundH: gh, lit: o.lit ?? 0.5, a: r() < 0.65 ? 1 : 0, b: r(), tint: frame, tint2: accent };
    const w = L.x1 - L.x0, d = L.z1 - L.z0;
    const variant = o.variant ?? Math.floor(r() * 3);
    if (variant === 0 || Math.min(w, d) < 26) {
      g.box(L.x0, L.x1, L.z0, L.z1, 0, H, base);
      penthouse(g, r, L, H);
    } else if (variant === 1) {
      // two interlocking volumes of different height
      const alongX = w > d;
      const k = 0.42 + r() * 0.2;
      const H2 = gh + Math.max(3, Math.round(floors * (0.5 + r() * 0.25))) * fh;
      const A = alongX ? { ...L, x1: L.x0 + w * k } : { ...L, z1: L.z0 + d * k };
      const B = alongX ? { ...L, x0: L.x0 + w * k } : { ...L, z0: L.z0 + d * k };
      const tallFirst = r() < 0.5;
      g.box(A.x0, A.x1, A.z0, A.z1, 0, tallFirst ? H : H2, base);
      g.box(B.x0, B.x1, B.z0, B.z1, 0, tallFirst ? H2 : H, { ...base, seed: base.seed + 9, a: 1 - base.a });
      penthouse(g, r, tallFirst ? A : B, H);
    } else {
      // podium with a set-back upper mass and a floating accent box
      const pf = Math.min(3, Math.max(1, Math.floor(floors / 3)));
      const pH = gh + pf * fh;
      g.box(L.x0, L.x1, L.z0, L.z1, 0, pH, base);
      const s = 3.5;
      const U = { x0: L.x0 + s, x1: L.x1 - s, z0: L.z0 + s, z1: L.z1 - s };
      g.box(U.x0, U.x1, U.z0, U.z1, pH, H, { ...base, groundH: 0, seed: base.seed + 4 });
      penthouse(g, r, U, H);
    }
    return H;
  },

  brick(g, r, L, o) {
    const floors = o.floors ?? 3;
    const gh = 5.2, fh = 3.9;
    const H = gh + floors * fh + 0.6;
    const tint = o.tint ?? pick(r, BRICKS);
    g.box(L.x0, L.x1, L.z0, L.z1, 0, H, { style: STYLE.BRICK, seed: r() * 50, floorH: fh, bayW: 3.3, groundH: gh, lit: o.lit ?? 0.45, a: r() < 0.6 ? 1 : 0, tint });
    // roof clutter: a stair bulkhead and a water tank
    const cx = L.x0 + (L.x1 - L.x0) * (0.3 + r() * 0.4), cz = L.z0 + (L.z1 - L.z0) * (0.3 + r() * 0.4);
    g.box(cx - 2.5, cx + 2.5, cz - 2, cz + 2, H, H + 3, { style: STYLE.SOLID, seed: r(), floorH: 3, bayW: 5, tint: [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8] });
    return H;
  },

  lab(g, r, L, o) {
    const floors = o.floors ?? 8;
    const gh = 5.8, fh = 4.6;
    const H = gh + floors * fh;
    const tint = o.tint ?? pick(r, PANELS);
    const base = { style: STYLE.RIBBON, seed: r() * 50, floorH: fh, bayW: 1.6, groundH: gh, lit: o.lit ?? 0.62, a: r() < 0.6 ? 1 : 0, b: r() < 0.5 ? 1 : 0, tint, tint2: pick(r, ACCENTS) };
    g.box(L.x0, L.x1, L.z0, L.z1, 0, H, base);
    // big mechanical floor with louvres and exhaust stacks
    const s = 4;
    const M = { x0: L.x0 + s, x1: L.x1 - s, z0: L.z0 + s, z1: L.z1 - s };
    g.box(M.x0, M.x1, M.z0, M.z1, H, H + 6.5, { style: STYLE.SOLID, seed: r(), floorH: 6.5, bayW: 3, a: 0.8, b: 1, tint: [0.14, 0.145, 0.15] });
    const stacks = [];
    for (let i = 0; i < 4; i++) stacks.push([M.x0 + 4 + r() * (M.x1 - M.x0 - 8), H + 6.5, M.z0 + 4 + r() * (M.z1 - M.z0 - 8)]);
    o.out.stacks.push(...stacks);
    return H + 6.5;
  },

  resi(g, r, L, o) {
    const floors = o.floors ?? 30;
    const pf = 2, gh = 5.6, pfh = 4.0, fh = 3.05;
    const pH = gh + pf * pfh;
    const frame = pick(r, FRAMES);
    const podStyle = r() < 0.5 ? STYLE.BRICK : STYLE.CURTAIN;
    g.box(L.x0, L.x1, L.z0, L.z1, 0, pH, {
      style: podStyle, seed: r() * 50, floorH: pfh, bayW: podStyle === STYLE.BRICK ? 3.3 : 1.5, groundH: gh, lit: 0.5,
      tint: podStyle === STYLE.BRICK ? pick(r, BRICKS) : frame, tint2: pick(r, ACCENTS), a: 1,
    });
    const tw = Math.min(L.x1 - L.x0 - 6, o.tw ?? 30), td = Math.min(L.z1 - L.z0 - 6, o.td ?? 28);
    const cx = (L.x0 + L.x1) / 2 + (o.ox ?? 0), cz = (L.z0 + L.z1) / 2 + (o.oz ?? 0);
    const H = pH + floors * fh;
    const slab = o.slab ?? (r() < 0.5 ? [0.42, 0.42, 0.41] : [0.16, 0.165, 0.17]);
    const tower = { style: STYLE.RESI, seed: r() * 50, floorH: fh, bayW: 3.4, groundH: 0, lit: o.lit ?? 0.34, tint: slab, tint2: frame };
    g.box(cx - tw / 2, cx + tw / 2, cz - td / 2, cz + td / 2, pH, H, tower);
    // illuminated crown
    const crownC = o.crown ?? pick(r, [[0.5, 0.8, 1.0], [1.0, 0.75, 0.45], [1.0, 0.35, 0.5], [0.4, 1.0, 0.8]]);
    const s = 2.5;
    g.box(cx - tw / 2 + s, cx + tw / 2 - s, cz - td / 2 + s, cz + td / 2 - s, H, H + 5, { style: STYLE.SOLID, seed: r(), floorH: 5, bayW: 2.5, a: 0.7, b: 1, tint: [0.1, 0.1, 0.11] });
    g.box(cx - tw / 2 + s - 0.15, cx + tw / 2 - s + 0.15, cz - td / 2 + s - 0.15, cz + td / 2 - s + 0.15, H + 4.4, H + 5.1, { style: STYLE.EMISSIVE, lit: 3.5, tint: crownC }, false);
    o.out.beacons.push([cx, H + 9, cz]);
    return H + 5;
  },

  grocery(g, r, L, o) {
    // tall glazed market hall under a residential tower
    const gh = 8.5;
    g.box(L.x0, L.x1, L.z0, L.z1, 0, gh + 4.2, { style: STYLE.CURTAIN, seed: 7.3, floorH: 4.2, bayW: 1.5, groundH: gh, lit: 0.9, a: 1, b: 0.2, tint: [0.05, 0.06, 0.05], tint2: [0.08, 0.42, 0.16] });
    const cx = (L.x0 + L.x1) / 2 - 8, cz = (L.z0 + L.z1) / 2 + 6;
    const H = gh + 4.2 + 26 * 3.05;
    g.box(cx - 15, cx + 15, cz - 14, cz + 14, gh + 4.2, H, { style: STYLE.RESI, seed: 21.5, floorH: 3.05, bayW: 3.4, groundH: 0, lit: 0.36, tint: [0.40, 0.40, 0.39], tint2: [0.05, 0.05, 0.055] });
    g.box(cx - 12.5, cx + 12.5, cz - 11.5, cz + 11.5, H + 4.4, H + 5.1, { style: STYLE.EMISSIVE, lit: 3.2, tint: [0.4, 1.0, 0.55] }, false);
    g.box(cx - 12.4, cx + 12.4, cz - 11.4, cz + 11.4, H, H + 5, { style: STYLE.SOLID, seed: 1, floorH: 5, bayW: 2.5, a: 0.7, b: 1, tint: [0.1, 0.1, 0.11] });
    o.out.beacons.push([cx, H + 9, cz]);
    return H;
  },
};

function penthouse(g, r, L, H) {
  const w = L.x1 - L.x0, d = L.z1 - L.z0;
  if (w < 18 || d < 18) return;
  const s = 5 + r() * 2;
  g.box(L.x0 + s, L.x1 - s, L.z0 + s, L.z1 - s, H, H + 4.2, { style: STYLE.SOLID, seed: r(), floorH: 4.2, bayW: 3, a: 0.8, b: 1, tint: [0.12, 0.125, 0.13] });
}

// Hand-authored lots for the twelve drivable blocks. [u0,u1,v0,v1] are fractions of the block
// (u: west->east, v: north->south); g = gap left for a mid-block alley / plaza.
const INNER = {
  '0,0': [[0, 0.46, 0, 1, 'brick', { floors: 4 }, 'Denny Row Lofts'], [0.54, 1, 0, 1, 'resi', { floors: 33, tw: 28, td: 30 }, 'Cirrus Tower']],
  '1,0': [[0, 1, 0, 1, 'office', { floors: 21, variant: 2, lit: 0.6 }, 'Day One North']],
  '0,1': [[0, 0.52, 0, 1, 'office', { floors: 10 }, 'Arbor Blocks West'], [0.6, 1, 0, 0.48, 'brick', { floors: 2 }, 'Westlake Tavern'], [0.6, 1, 0.54, 1, 'brick', { floors: 3 }, 'The Print Works']],
  '1,1': [[0, 1, 0, 0.47, 'office', { floors: 12, variant: 1 }, 'Houdini Building'], [0, 1, 0.55, 1, 'office', { floors: 7, variant: 0 }, 'Nessie Building']],
  '0,2': [[0, 0.5, 0, 1, 'lab', { floors: 8 }, 'Cascade Bioscience'], [0.58, 1, 0, 1, 'office', { floors: 6, variant: 0 }, 'Rufus Building']],
  '1,2': [[0, 1, 0, 0.42, 'brick', { floors: 4 }, 'Terry Avenue Building'], [0, 1, 0.5, 1, 'office', { floors: 9, variant: 1 }, 'Fiona Building']],
  '0,3': [[0, 1, 0, 1, 'office', { floors: 11, variant: 2 }, 'Kumo Building']],
  '1,3': [[0, 0.44, 0, 1, 'brick', { floors: 2 }, 'Supply Laundry'], [0.52, 1, 0, 1, 'resi', { floors: 27, tw: 26, td: 30 }, 'Stratus Apartments']],
  '0,4': [[0, 1, 0, 1, 'lab', { floors: 9 }, 'Mercer Research Institute']],
  '1,4': [[0, 0.47, 0, 1, 'office', { floors: 8, variant: 0 }, 'Arizona Building'], [0.55, 1, 0, 1, 'office', { floors: 12, variant: 1 }, 'Ruby Building']],
  '0,5': [[0, 1, 0, 1, 'lab', { floors: 6, lit: 0.8 }, 'Brain Science Institute']],
  '1,5': [[0, 0.56, 0, 1, 'office', { floors: 10, variant: 2 }, 'Lakefront Tech Campus'], [0.64, 1, 0, 1, 'resi', { floors: 14, tw: 20, td: 40 }, 'Valley Street Hotel']],
};

export function createBuildings() {
  const g = new FacadeGeo();
  const out = { stacks: [], beacons: [] };
  const colliders = [];   // axis-aligned boxes {x0,x1,z0,z1}
  const lots = [];        // named buildings with their footprint
  const r = rng(20261123);

  const add = (type, L, o, name) => {
    const H = BUILDERS[type](g, r, L, { ...o, out });
    colliders.push({ x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1 });
    lots.push({ ...L, type, name, h: H });
  };

  for (const b of cityBlocks()) {
    const x0 = b.x0 + SIDEWALK, x1 = b.x1 - SIDEWALK, z0 = b.z0 + SIDEWALK, z1 = b.z1 - SIDEWALK;
    const w = x1 - x0, d = z1 - z0;
    if (b.kind === 'inner') {
      for (const [u0, u1, v0, v1, type, o, name] of INNER[`${b.col},${rowIndex(b)}`]) {
        add(type, { x0: x0 + w * u0, x1: x0 + w * u1, z0: z0 + d * v0, z1: z0 + d * v1 }, o, name);
      }
    } else if (b.kind === 'outerW' || b.kind === 'outerE') {
      // one row of buildings facing the boundary avenue, then a cheaper second row for depth
      const face = b.kind === 'outerW' ? { x0: x1 - 44, x1 } : { x0, x1: x0 + 44 };
      const split = r() < 0.6;
      const kinds = ['office', 'office', 'brick', 'resi', 'lab', 'office'];
      const parts = split ? [[z0, z0 + d * 0.46], [z0 + d * 0.54, z1]] : [[z0, z1]];
      for (const [a, c] of parts) {
        const type = pick(r, kinds);
        const o = type === 'office' ? { floors: 6 + Math.floor(r() * 9) } : type === 'brick' ? { floors: 2 + Math.floor(r() * 3) }
          : type === 'resi' ? { floors: 18 + Math.floor(r() * 16), tw: 26, td: Math.min(28, c - a - 6) } : { floors: 6 + Math.floor(r() * 4) };
        add(type, { ...face, z0: a, z1: c }, o, null);
      }
      backdrop(g, r, b.kind === 'outerW' ? { x0: b.x0 + 40, x1: face.x0 - 16, z0, z1 } : { x0: face.x1 + 16, x1: b.x1 - 40, z0, z1 });
    } else if (b.kind === 'outerS') {
      const L = { x0, x1, z0, z1: z0 + 52 };
      if (b.col === 0) add('grocery', L, {}, 'Whole Foods Market');
      else add('office', L, { floors: 30, variant: 2, lit: 0.6 }, 'Denny Tower');
      backdrop(g, r, { x0, x1, z0: z0 + 70, z1: z0 + 250 });
    } else {
      // corners south of Denny
      const west = b.x1 <= X_WEST + 1;
      const L = west ? { x0: x1 - 46, x1, z0, z1: z0 + 50 } : { x0, x1: x0 + 46, z0, z1: z0 + 50 };
      add(west ? 'resi' : 'office', L, west ? { floors: 30, tw: 28, td: 30 } : { floors: 17, variant: 1 }, null);
      backdrop(g, r, west ? { x0: b.x0 + 40, x1: L.x0 - 16, z0, z1: z0 + 250 } : { x0: L.x1 + 16, x1: b.x1 - 40, z0, z1: z0 + 250 });
    }
  }

  skyline(g, r);

  const { material, uniforms } = createFacadeMaterial();
  const mesh = new THREE.Mesh(g.build(), material);
  mesh.frustumCulled = false;
  return { mesh, uniforms, colliders, lots, stacks: out.stacks, beacons: out.beacons };
}

function rowIndex(b) {
  // cityBlocks() rows run south -> north starting at 0 for the first inner row
  return b.row;
}

// Cheap, fog-softened towers filling the area behind the playable streets.
function backdrop(g, r, A) {
  const w = A.x1 - A.x0, d = A.z1 - A.z0;
  if (w < 30 || d < 30) return;
  const nx = Math.max(1, Math.round(w / 70)), nz = Math.max(1, Math.round(d / 70));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (r() < 0.2) continue;
    const cx = A.x0 + (i + 0.5) * w / nx, cz = A.z0 + (j + 0.5) * d / nz;
    const bw = 22 + r() * 22, bd = 22 + r() * 22, h = 22 + r() * r() * 110;
    g.box(cx - bw / 2, cx + bw / 2, cz - bd / 2, cz + bd / 2, 0, h, {
      style: STYLE.SKYLINE, seed: r() * 90, lit: 0.3 + r() * 0.3, a: r() < 0.3 ? 1 : 0, b: 1,
      tint: [0.03 + r() * 0.03, 0.035 + r() * 0.03, 0.045 + r() * 0.03], tint2: pick(r, [[0.5, 0.8, 1.0], [1.0, 0.7, 0.4], [1.0, 0.3, 0.45]]),
    });
  }
}

// Downtown: a cluster of tall towers to the south, glowing through the rain.
function skyline(g, r) {
  for (let i = 0; i < 46; i++) {
    const cx = -330 + r() * 560, cz = Z_SOUTH + 300 + r() * 420;
    const k = Math.exp(-Math.pow((cx + 40) / 220, 2));
    const h = 60 + r() * 90 + k * r() * 190;
    const bw = 26 + r() * 22, bd = 26 + r() * 22;
    g.box(cx - bw / 2, cx + bw / 2, cz - bd / 2, cz + bd / 2, 0, h, {
      style: STYLE.SKYLINE, seed: r() * 90, lit: 0.3 + r() * 0.3, a: r() < 0.45 ? 1 : 0,
      tint: [0.03 + r() * 0.03, 0.035 + r() * 0.03, 0.05 + r() * 0.03], tint2: pick(r, [[0.5, 0.8, 1.0], [1.0, 0.7, 0.4], [1.0, 0.3, 0.45], [0.5, 1.0, 0.7]]),
    });
    if (h > 190) g.box(cx - 1, cx + 1, cz - 1, cz + 1, h, h + 30, { style: STYLE.SOLID, seed: 1, floorH: 30, bayW: 2, a: 1, tint: [0.1, 0.1, 0.1] });
  }
}
