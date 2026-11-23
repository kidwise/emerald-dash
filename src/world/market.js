import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGlowPoints } from './props.js';
import { rng } from './rng.js';
import { MARKET_Y, CURB, asset } from '../config.js';
import { SIGN_DIR } from '../names.js';

// Pike Place Market, built by hand at true scale: the open Main Arcade on the west side of the street
// (fish, flowers, produce) and four shopfronts on the east side (yogurt, cheese, the first coffee shop, a bakery).
// Everything is laid out in the constants below so the whole market can be re-sited when the map changes.
export const PIKE = {
  Y: MARKET_Y + CURB,
  arcade: { x0: -459.1, x1: -452.6, z0: 628, z1: 694, bay: 6 },
  shopX: -427.4, shopDepth: 4.0,
  shops: {
    yogurt: { z0: 683, z1: 692 }, cheese: { z0: 628, z1: 640.5 }, coffee: { z0: 478, z1: 485.5 }, bakery: { z0: 487, z1: 496 },
  },
  slow: { x0: -472, x1: -414, z0: 436, z1: 716 },
};

const loader = new THREE.TextureLoader();
const texCache = new Map();
function tex(path, srgb = true) {
  if (texCache.has(path)) return texCache.get(path);
  const t = loader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(path, t);
  return t;
}
// A photographic surface that looks lit by the shop's own warm lamps: the texture also drives self-illumination.
function surface(slug, { tint = 0xffffff, glow = 0.8, warm = 0xffd2a0, rough = 0.8 } = {}) {
  const map = tex(asset(`assets/tex/${slug}_diff.jpg`));
  return new THREE.MeshStandardMaterial({ map, normalMap: tex(asset(`assets/tex/${slug}_nor.jpg`), false), color: tint, roughness: rough, emissiveMap: map, emissive: new THREE.Color(warm).multiply(new THREE.Color(tint)), emissiveIntensity: glow });
}
const paint = (color, glow = 0.55, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: new THREE.Color(color).multiply(new THREE.Color(0xffd9b0)), emissiveIntensity: glow });
const glowMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
const sign = (file, k = 1.25) => new THREE.MeshBasicMaterial({ map: tex(asset(`${SIGN_DIR}/${file}.svg`)), color: new THREE.Color(k, k, k) });

// box whose texture repeats every `tile` metres on every face
function tbox(w, h, d, x, y, z, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 6; k++) { const i = f * 6 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g.translate(x, y, z);
}
const prep = (g) => { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; };

class Kit {
  constructor() { this.bins = new Map(); this.group = new THREE.Group(); }
  add(mat, ...geos) { if (!this.bins.has(mat)) this.bins.set(mat, []); for (const g of geos) this.bins.get(mat).push(prep(g)); }
  build() { for (const [mat, list] of this.bins) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.frustumCulled = false; this.group.add(m); } return this.group; }
}
function instances(geo, mat, items, colored = true) {
  // items: { p: [x,y,z], r: [rx,ry,rz], s: number | [sx,sy,sz], c: hex }
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  items.forEach((it, i) => {
    E.set(...(it.r || [0, 0, 0])); Q.setFromEuler(E);
    if (Array.isArray(it.s)) S.set(...it.s); else S.setScalar(it.s ?? 1);
    M.compose(P.set(...it.p), Q, S); m.setMatrixAt(i, M);
    if (colored) m.setColorAt(i, C.set(it.c ?? 0xffffff));
  });
  m.frustumCulled = false;
  return m;
}

export function createPikePlace(colliders, obstacles) {
  const r = rng(1971);
  const Y = PIKE.Y;
  const kit = new Kit();
  const root = new THREE.Group();
  const glowP = [], glowC = [], glowS = [], glowPh = [];
  const lamp = (x, y, z, c = [1.0, 0.72, 0.42], s = 1.5) => { glowP.push(x, y, z); glowC.push(...c); glowS.push(s); glowPh.push(r()); };

  const M = {
    wood: surface('weathered_brown_planks', { glow: 0.75 }),
    darkWood: surface('weathered_brown_planks', { tint: 0x8a6a52, glow: 0.7 }),
    green: surface('green_rough_planks', { glow: 0.75 }),
    floor: surface('old_wood_floor', { glow: 0.6, rough: 0.55 }),
    brick: surface('red_brick_03', { glow: 0.65 }),
    cream: paint(0xefe2c6, 0.85, 0.7),
    tile: surface('painted_brick', { tint: 0xfff1dc, glow: 0.8 }),
    steel: paint(0x1d4d34, 0.5, 0.45, 0.3),
    black: paint(0x101112, 0.2, 0.5, 0.3),
    white: paint(0xf2efe8, 0.8, 0.5),
    blue: paint(0x1b5fc4, 0.75, 0.5),
    frenchBlue: paint(0x2a4d8f, 0.7, 0.5),
    ice: new THREE.MeshStandardMaterial({ color: 0xdff1ff, roughness: 0.25, emissive: 0x9fc8e6, emissiveIntensity: 0.75 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.22, metalness: 1.0, emissive: 0x403a32, emissiveIntensity: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8893a, roughness: 0.3, metalness: 1.0, emissive: 0x4a3410, emissiveIntensity: 0.8 }),
    bulb: glowMat(7, 5.2, 3.0),
    panel: glowMat(3.4, 2.9, 2.2),
    curd: paint(0xf7f0d6, 0.95, 0.7),
  };

  // ============================================================ west side: the Main Arcade
  const A = PIKE.arcade, AW = A.x1 - A.x0, AL = A.z1 - A.z0, AXM = (A.x0 + A.x1) / 2, AZM = (A.z0 + A.z1) / 2;
  const ROOF = Y + 5.3;
  kit.add(M.floor, tbox(AW, 0.06, AL, AXM, Y + 0.03, AZM, 2.2));
  kit.add(M.brick, tbox(0.22, 5.2, AL, A.x0 + 0.11, Y + 2.6, AZM, 2.4));
  kit.add(M.green, tbox(AW + 1.6, 0.22, AL + 0.6, AXM + 0.5, ROOF, AZM, 2.2));                  // canopy
  kit.add(M.steel, tbox(0.5, 0.9, AL + 0.6, A.x1 + 1.05, ROOF - 0.4, AZM, 3));                 // fascia beam
  for (let z = A.z0; z <= A.z1 + 0.1; z += A.bay) {
    kit.add(M.steel, tbox(0.3, 5.2, 0.3, A.x1 + 0.9, Y + 2.6, z), tbox(0.5, 0.25, 0.5, A.x1 + 0.9, Y + 0.12, z), tbox(1.5, 0.16, 0.16, A.x1 + 0.2, ROOF - 0.95, z));
    obstacles.push({ x: A.x1 + 0.9, z, r: 0.3 });
  }
  for (let z = A.z0 + 1.5; z < A.z1; z += 3) kit.add(M.darkWood, tbox(AW + 1.2, 0.18, 0.14, AXM + 0.3, ROOF - 0.2, z));          // rafters
  // green enamel pendant lamps down the aisle
  const shadeG = [], bulbG = [];
  for (let z = A.z0 + 1.5; z < A.z1; z += 3) for (const x of [A.x1 - 1.2, A.x1 - 3.9]) {
    shadeG.push(new THREE.ConeGeometry(0.42, 0.3, 14, 1, true).translate(x, ROOF - 1.15, z), new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4).translate(x, ROOF - 0.55, z));
    bulbG.push(new THREE.SphereGeometry(0.11, 8, 6).translate(x, ROOF - 1.3, z));
    lamp(x, ROOF - 1.3, z, [1.0, 0.74, 0.44], 1.3);
  }
  kit.add(M.steel, ...shadeG); kit.add(M.bulb, ...bulbG);
  // festoon along the canopy edge
  for (let z = A.z0; z < A.z1; z += 0.55) lamp(A.x1 + 1.35, ROOF - 0.9 - Math.abs(Math.sin((z - A.z0) / A.bay * Math.PI)) * 0.3, z, [2.2, 1.5, 0.8], 0.12);

  const bayZ = (i) => A.z1 - A.bay * (i + 0.5);            // bay 0 is the south end, by the big sign
  const counterX = A.x1 - 1.0;                             // counters face the street
  const facing = (g, file, w, h, x, y, z, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sign(file, k)); m.position.set(x, y, z); m.rotation.y = Math.PI / 2; g.add(m); return m; };
  const backing = (w, h, x, y, z) => kit.add(M.black, tbox(0.14, h + 0.16, w + 0.16, x - 0.09, y, z));

  // signs over the stalls
  facing(root, 'fish', 9.6, 3.2, A.x1 + 1.42, ROOF + 1.5, bayZ(0.5)); backing(9.6, 3.2, A.x1 + 1.42, ROOF + 1.5, bayZ(0.5));
  facing(root, 'flowers', 9.0, 3.0, A.x1 + 1.42, ROOF + 1.4, bayZ(4.5)); backing(9.0, 3.0, A.x1 + 1.42, ROOF + 1.4, bayZ(4.5));
  facing(root, 'producer', 14.4, 1.8, A.x1 + 1.42, ROOF + 0.9, bayZ(8)); backing(14.4, 1.8, A.x1 + 1.42, ROOF + 0.9, bayZ(8));
  facing(root, 'farmers', 7.2, 2.4, A.x1 + 1.42, ROOF + 2.6, bayZ(10), 2.6); backing(7.2, 2.4, A.x1 + 1.42, ROOF + 2.6, bayZ(10));

  // ---- counters: a planked front, a display deck that tilts toward the customer
  const inst = { fish: [], crab: [], bucket: [], paper: [], bloom: [], fruit: [], crate: [], card: [], tub: [], swirl: [], wheel: [], bag: [], loaf: [], crescent: [], macaron: [], can: [], sack: [], mug: [] };
  const deck = (i, mat, tilt = 0.22) => {
    const z = bayZ(i), len = A.bay - 0.5;
    kit.add(M.green, tbox(0.12, 0.95, len, counterX + 0.75, Y + 0.48, z, 1.6), tbox(1.5, 0.08, len, counterX, Y + 0.06, z));
    const g = new THREE.BoxGeometry(1.7, 0.12, len).toNonIndexed().rotateZ(tilt).translate(counterX - 0.15, Y + 1.12, z);
    kit.add(mat, g);
    return z;
  };
  const onDeck = (u, tilt = 0.22) => [counterX - 0.15 + u * Math.cos(tilt), Y + 1.19 + u * Math.sin(tilt)];   // u: -0.8 (back, high) .. 0.8 (front, low) -> note sign flips below

  // ---- bays 0-2: Pike Place Fish. Crushed ice, rows of salmon, crab, and a fish in the air
  const FISH_COL = [0xb9c4cc, 0xc8cfd4, 0xd98a7a, 0xa9b6bf, 0x8f9aa3, 0xe0a090];
  for (let i = 0; i < 3; i++) {
    const z = deck(i, M.ice, 0.26), len = A.bay - 0.7;
    for (let row = 0; row < 4; row++) for (let k = 0; k < 11; k++) {
      const u = 0.62 - row * 0.4, [x, y] = [counterX - 0.15 - u * Math.cos(0.26), Y + 1.22 + u * Math.sin(0.26)];
      const zz = z - len / 2 + (k + 0.5) * len / 11 + (r() - 0.5) * 0.06;
      if (i === 2 && row < 2) inst.crab.push({ p: [x, y + 0.05, zz], r: [0, r() * 6.28, 0], s: [0.24, 0.09, 0.19], c: r() < 0.7 ? 0xc8452a : 0xd97a3a });
      else inst.fish.push({ p: [x, y + 0.05, zz], r: [0, Math.PI / 2 + (r() - 0.5) * 0.25, 0.26], s: [0.9 + r() * 0.5, 1, 1], c: FISH_COL[Math.floor(r() * FISH_COL.length)] });
    }
    inst.card.push({ p: [counterX + 0.55, Y + 1.5, z - 1.4], r: [0, Math.PI / 2, 0], s: 0.5, uv: i === 2 ? 3 : 2 }, { p: [counterX + 0.55, Y + 1.5, z + 1.2], r: [0, Math.PI / 2, 0], s: 0.5, uv: 2 });
  }
  // ---- bays 3-7: flowers. Tiered buckets, bouquets wrapped in butcher paper
  const BLOOM = [0xff3f7f, 0xff7a3d, 0xffc928, 0xfff4e0, 0xb04dff, 0xff5a5a, 0xff9ac4, 0xe8327a, 0xffe14d, 0x8f5bff];
  for (let i = 3; i < 8; i++) {
    const z = bayZ(i), len = A.bay - 0.5;
    for (let tier = 0; tier < 3; tier++) kit.add(M.green, tbox(0.62, 0.3 + tier * 0.38, len, A.x1 - 0.45 - tier * 0.66, Y + (0.3 + tier * 0.38) / 2, z, 1.6));
    for (let tier = 0; tier < 3; tier++) for (let k = 0; k < 7; k++) {
      const x = A.x1 - 0.45 - tier * 0.66 + (r() - 0.5) * 0.08, zz = z - len / 2 + (k + 0.5) * len / 7, top = Y + 0.3 + tier * 0.38;
      inst.bucket.push({ p: [x, top + 0.17, zz], s: [1, 1, 1], c: r() < 0.7 ? 0x141516 : 0x2b3a44 });
      const hgt = 0.42 + r() * 0.2;
      inst.paper.push({ p: [x, top + 0.22 + hgt / 2, zz], r: [0, r() * 6.28, 0], s: [1.25, hgt, 1.25], c: r() < 0.6 ? 0xf3ede0 : 0xc9a878 });
      const c0 = BLOOM[Math.floor(r() * BLOOM.length)], c1 = BLOOM[Math.floor(r() * BLOOM.length)], by = top + 0.24 + hgt;
      for (let b = 0; b < 5; b++) { const a = (b / 5) * 6.28 + r(); inst.bloom.push({ p: [x + Math.cos(a) * 0.19, by - 0.02, zz + Math.sin(a) * 0.19], r: [r(), r(), r()], s: [0.07, 0.035, 0.07], c: r() < 0.5 ? 0x2f6a34 : 0x3f8040 }); }
      for (let b = 0; b < 11; b++) { const a = r() * 6.28, e = Math.pow(r(), 0.7) * 1.25, d = Math.sin(e) * 0.17; inst.bloom.push({ p: [x + Math.cos(a) * d, by + Math.cos(e) * 0.13, zz + Math.sin(a) * d], r: [r() * 3, r() * 3, r() * 3], s: 0.045 + r() * 0.03, c: r() < 0.7 ? c0 : c1 }); }
    }
  }
  // ---- bays 8-10: produce highstalls. Colour-blocked fruit on sloping trays, crates below
  const FRUIT = [0xc8201f, 0xd9421f, 0x8fbf2f, 0xff8c1a, 0xffd21f, 0x7a1f4a, 0xd62f2f, 0x4f9e2a];
  for (let i = 8; i < 11; i++) {
    const z = deck(i, M.wood, 0.3), len = A.bay - 0.7;
    for (let block = 0; block < 4; block++) {
      const c = FRUIT[(i * 3 + block) % FRUIT.length], z0 = z - len / 2 + block * len / 4;
      for (let row = 0; row < 5; row++) for (let k = 0; k < 7; k++) {
        const u = 0.7 - row * 0.34;
        inst.fruit.push({ p: [counterX - 0.15 - u * Math.cos(0.3) + (r() - 0.5) * 0.03, Y + 1.25 + u * Math.sin(0.3), z0 + 0.1 + (k + 0.5) * (len / 4 - 0.2) / 7], s: 0.085 + r() * 0.012, c });
      }
      inst.card.push({ p: [counterX + 0.5, Y + 1.55, z0 + len / 8], r: [0, Math.PI / 2, 0], s: 0.42, uv: block % 2 });
    }
    for (let k = 0; k < 3; k++) inst.crate.push({ p: [A.x1 + 0.35, Y + 0.22, z - 1.8 + k * 1.8 + (r() - 0.5) * 0.3], r: [0, (r() - 0.5) * 0.4, 0], s: 1 });
  }
  colliders.push({ x0: A.x0, x1: A.x1 + 0.4, z0: A.z0, z1: A.z1 });

  // ============================================================ east side: four shopfronts
  const SX = PIKE.shopX, SD = PIKE.shopDepth, SXB = SX + SD;      // open face, back wall
  const shell = (z0, z1, { wall = M.cream, floor = M.floor, awning = 0x14301f, stripe = null, h = 4.3 } = {}) => {
    const zm = (z0 + z1) / 2, len = z1 - z0;
    kit.add(floor, tbox(SD, 0.08, len, SX + SD / 2, Y + 0.04, zm, 2));
    kit.add(wall, tbox(0.16, h, len, SXB - 0.08, Y + h / 2, zm, 2.4), tbox(SD, h, 0.16, SX + SD / 2, Y + h / 2, z0 + 0.08, 2.4), tbox(SD, h, 0.16, SX + SD / 2, Y + h / 2, z1 - 0.08, 2.4));
    kit.add(M.black, tbox(SD + 0.3, 0.2, len, SX + SD / 2 - 0.15, Y + h + 0.1, zm), tbox(0.34, 2.3, len + 0.2, SX - 0.1, Y + h + 1.15, zm));       // ceiling + fascia
    kit.add(M.black, tbox(0.1, h, 0.12, SX - 0.02, Y + h / 2, z0 + 0.06), tbox(0.1, h, 0.12, SX - 0.02, Y + h / 2, z1 - 0.06));                       // jambs
    for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.2) { kit.add(M.panel, new THREE.BoxGeometry(1.1, 0.04, 0.3).translate(SX + SD * 0.5, Y + h - 0.03, z)); lamp(SX + SD * 0.5, Y + h - 0.3, z, [1.0, 0.8, 0.55], 1.6); }
    // awning: a sloped slab out over the sidewalk
    const aw = new THREE.BoxGeometry(1.9, 0.07, len + 0.3).toNonIndexed().rotateZ(0.36).translate(SX - 0.95, Y + h - 0.25, zm);
    kit.add(paint(awning, 0.5, 0.7), aw);
    if (stripe !== null) for (let z = z0 + 0.4; z < z1; z += 1.2) kit.add(paint(stripe, 0.6, 0.7), new THREE.BoxGeometry(1.92, 0.075, 0.6).toNonIndexed().rotateZ(0.36).translate(SX - 0.95, Y + h - 0.245, z));
    colliders.push({ x0: SX - 0.1, x1: SXB, z0, z1 });
    return { zm, len, h };
  };
  const fasciaSign = (file, w, h, z, y, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sign(file, k)); m.position.set(SX - 0.29, y, z); m.rotation.y = -Math.PI / 2; root.add(m); };
  const counter = (x, z, w, d, mat = M.darkWood, top = M.white) => { kit.add(mat, tbox(w, 0.95, d, x, Y + 0.48, z, 1.6)); kit.add(top, tbox(w + 0.08, 0.06, d + 0.08, x, Y + 0.98, z)); };

  // ---- yogurt bar: blue and white, a row of tubs with fruit swirled on top
  {
    const S = PIKE.shops.yogurt, { zm, len, h } = shell(S.z0, S.z1, { wall: M.tile, awning: 0x1557b8, stripe: 0xf2efe8 });
    fasciaSign('yogurt', 6.0, 2.0, zm, Y + h + 1.15);
    kit.add(M.blue, tbox(0.06, 1.1, len - 0.3, SXB - 0.2, Y + 0.6, zm));
    counter(SX + 1.2, zm, 1.0, len - 1.6, M.blue);
    const SW = [0xe04a7a, 0xffb347, 0xfff2a8, 0x8e3a8f, 0xf6f1e6, 0xd96a2a, 0x7fb04a, 0xc8102e];
    for (let k = 0; k < 9; k++) { const z = S.z0 + 1.2 + k * (len - 2.4) / 8; inst.tub.push({ p: [SX + 1.2, Y + 1.12, z], s: 1, c: 0xf4f1ea }); inst.swirl.push({ p: [SX + 1.2, Y + 1.25, z], s: [0.2, 0.07, 0.2], c: SW[k % SW.length] }); }
    const mb = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), sign('menu', 1.1)); mb.position.set(SXB - 0.18, Y + 2.6, zm + 1.6); mb.rotation.y = -Math.PI / 2; root.add(mb);
  }
  // ---- cheese: a glass-walled make room with a steel vat of curd, wheels on the shelves, milk cans as stools
  {
    const S = PIKE.shops.cheese, { zm, len, h } = shell(S.z0, S.z1, { wall: M.tile, awning: 0x121212 });
    fasciaSign('cheese', 6.3, 2.1, zm, Y + h + 1.15);
    const vz = S.z0 + len * 0.3;
    kit.add(M.chrome, new THREE.BoxGeometry(1.5, 0.95, 4.6).translate(SX + 2.0, Y + 0.62, vz), ...[-1.9, 1.9].map(dz => new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8).translate(SX + 2.0, Y + 0.25, vz + dz)));
    kit.add(M.curd, new THREE.BoxGeometry(1.34, 0.05, 4.44).translate(SX + 2.0, Y + 1.09, vz));
    kit.add(M.chrome, new THREE.BoxGeometry(0.08, 0.08, 4.8).translate(SX + 2.0, Y + 1.9, vz), new THREE.BoxGeometry(1.2, 0.6, 0.06).translate(SX + 2.0, Y + 1.45, vz + 0.6), new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6).translate(SX + 2.0, Y + 1.5, vz + 0.6));
    for (let z = S.z0 + 0.3; z < S.z0 + len * 0.6; z += 1.5) kit.add(M.black, tbox(0.07, h - 0.9, 0.07, SX + 0.05, Y + (h - 0.9) / 2 + 0.9, z));          // window mullions
    kit.add(M.black, tbox(0.12, 0.5, len * 0.6, SX + 0.05, Y + 0.25, S.z0 + len * 0.3));
    for (let k = 0; k < 5; k++) { inst.can.push({ p: [SX - 0.75, Y, S.z0 + 1.0 + k * 1.35], s: 1, c: 0xaab2b8 }); obstacles.push({ x: SX - 0.75, z: S.z0 + 1.0 + k * 1.35, r: 0.25 }); }
    const cz = S.z0 + len * 0.82;
    counter(SX + 1.3, cz, 1.0, len * 0.3, M.darkWood);
    const WH = [0xe8c860, 0xf1e2a6, 0xd9952f, 0xf4ead0, 0xc97d2a];
    for (let shelf = 0; shelf < 4; shelf++) { kit.add(M.darkWood, tbox(0.4, 0.05, len * 0.34, SXB - 0.32, Y + 0.9 + shelf * 0.62, cz)); for (let k = 0; k < 6; k++) inst.wheel.push({ p: [SXB - 0.32, Y + 1.02 + shelf * 0.62, cz - len * 0.15 + k * len * 0.06], s: [0.9 + r() * 0.3, 1, 0.9 + r() * 0.3], c: WH[Math.floor(r() * WH.length)] }); }
    for (let k = 0; k < 5; k++) inst.wheel.push({ p: [SX + 1.3, Y + 1.1, cz - 1.2 + k * 0.6], s: [1.2, 1.1, 1.2], c: WH[k % WH.length] });
  }
  // ---- the first coffee shop: dark wood, brass machine, shelves of beans, the medallion over the door
  {
    const S = PIKE.shops.coffee, { zm, len, h } = shell(S.z0, S.z1, { wall: M.darkWood, awning: 0x3a2313 });
    const med = sign('coffee', 1.35);
    for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.CircleGeometry(1.0, 48), med); m.position.set(SX - 1.5, Y + h + 1.2, zm + s * 0.07); m.rotation.y = s > 0 ? 0 : Math.PI; root.add(m); }
    kit.add(M.black, new THREE.CylinderGeometry(1.04, 1.04, 0.12, 40).rotateX(Math.PI / 2).translate(SX - 1.5, Y + h + 1.2, zm), tbox(1.5, 0.08, 0.08, SX - 0.75, Y + h + 2.05, zm));
    kit.add(M.brass, tbox(0.04, 0.5, len - 1.6, SX - 0.28, Y + h + 0.5, zm));                                     // brass fascia strip
    counter(SX + 2.2, zm, 0.9, len - 1.4, M.darkWood, M.darkWood);
    kit.add(M.brass, new THREE.BoxGeometry(0.6, 0.55, 1.5).translate(SX + 2.2, Y + 1.3, zm - 0.8), new THREE.CylinderGeometry(0.28, 0.28, 1.5, 16).rotateX(Math.PI / 2).translate(SX + 2.2, Y + 1.7, zm - 0.8));
    kit.add(M.chrome, ...[-0.5, 0, 0.5].map(d => new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8).translate(SX + 1.85, Y + 1.25, zm - 0.8 + d)));
    const BAG = [0x5a3a22, 0x2a2420, 0xd9c9a8, 0x6b1f1f, 0x1f3a2a];
    for (let shelf = 0; shelf < 5; shelf++) { kit.add(M.darkWood, tbox(0.34, 0.04, len - 0.5, SXB - 0.3, Y + 0.6 + shelf * 0.6, zm)); for (let k = 0; k < 14; k++) inst.bag.push({ p: [SXB - 0.3, Y + 0.78 + shelf * 0.6, S.z0 + 0.5 + k * (len - 1) / 13], s: [1, 0.9 + r() * 0.3, 1], c: BAG[Math.floor(r() * BAG.length)] }); }
    for (let k = 0; k < 5; k++) inst.sack.push({ p: [SX + 0.55 + (k % 2) * 0.5, Y + 0.3, S.z0 + 0.7 + k * 0.55], s: [0.34, 0.36, 0.3], c: 0xb89a6a });
    for (let k = 0; k < 8; k++) inst.mug.push({ p: [SX + 2.2, Y + 1.07, zm + 0.3 + k * 0.28], s: 1, c: k % 2 ? 0xf2efe8 : 0x4a2a17 });
    const mb = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), sign('menu', 1.05)); mb.position.set(SX + 0.7, Y + 2.7, S.z1 - 0.18); mb.rotation.y = Math.PI; root.add(mb);
  }
  // ---- bakery: cream walls, French blue, trays of croissants and a forest of baguettes
  {
    const S = PIKE.shops.bakery, { zm, len, h } = shell(S.z0, S.z1, { wall: M.cream, awning: 0x2a4d8f, stripe: 0xf2efe8 });
    fasciaSign('bakery', 6.0, 2.0, zm, Y + h + 1.15);
    kit.add(M.frenchBlue, tbox(0.06, 1.0, len - 0.3, SXB - 0.2, Y + 0.55, zm));
    counter(SX + 1.1, zm, 1.1, len - 1.8, M.frenchBlue);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 12; k++) inst.crescent.push({ p: [SX + 0.8 + row * 0.28, Y + 1.06, S.z0 + 1.3 + k * (len - 2.6) / 11], r: [Math.PI / 2, 0, r() * 0.5], s: 1, c: r() < 0.5 ? 0xd9973f : 0xc17f2a });
    for (let k = 0; k < 4; k++) { const bz = S.z0 + 1.4 + k * (len - 2.8) / 3; kit.add(M.wood, new THREE.CylinderGeometry(0.26, 0.2, 0.55, 12, 1, true).translate(SXB - 0.6, Y + 1.3, bz)); kit.add(M.darkWood, tbox(0.5, 1.0, 0.5, SXB - 0.6, Y + 0.5, bz)); for (let b = 0; b < 7; b++) { const a = r() * 6.28; inst.loaf.push({ p: [SXB - 0.6 + Math.cos(a) * 0.12, Y + 1.55, bz + Math.sin(a) * 0.12], r: [(r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4], s: [1, 0.85 + r() * 0.3, 1], c: 0xd6a55a }); } }
    const MAC = [0xf7a8c4, 0xb7e4c7, 0xfff1a8, 0xc9b6f2, 0xf2c39a, 0x9fd8e8];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 16; k++) inst.macaron.push({ p: [SX + 1.25 + row * 0.11, Y + 1.04, zm - 0.9 + k * 0.115], s: 1, c: MAC[(k + row) % MAC.length] });
  }

  // ============================================================ small goods, instanced
  const std = (rough = 0.6, glow = 0.55) => { const m = new THREE.MeshStandardMaterial({ roughness: rough }); m.emissive = new THREE.Color(0xffd9b0); m.emissiveIntensity = 0; m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.68) * ${glow.toFixed(2)};`); }; m.customProgramCacheKey = () => 'goods' + glow; return m; };
  const goods = std(0.55, 0.62), shiny = std(0.22, 0.5);
  const fishGeo = mergeGeometries([new THREE.CapsuleGeometry(0.075, 0.42, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.55), new THREE.ConeGeometry(0.1, 0.16, 4).rotateZ(Math.PI / 2).scale(1, 1, 0.3).translate(-0.34, 0, 0)].map(prep));
  const cardGeo = (q) => { const g = new THREE.PlaneGeometry(0.5, 0.5); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + (q % 2)) / 2, (uv.getY(i) + (q < 2 ? 1 : 0)) / 2); return g; };
  root.add(
    instances(fishGeo, shiny, inst.fish), instances(new THREE.SphereGeometry(1, 10, 7), goods, inst.crab),
    instances(new THREE.CylinderGeometry(0.15, 0.12, 0.34, 10, 1, true), goods, inst.bucket), instances(new THREE.ConeGeometry(0.17, 1, 9, 1, true).rotateX(Math.PI), goods, inst.paper),
    instances(new THREE.IcosahedronGeometry(1, 1), goods, inst.bloom), instances(new THREE.SphereGeometry(1, 8, 6), goods, inst.fruit),
    instances(new THREE.CylinderGeometry(0.15, 0.13, 0.26, 14), goods, inst.tub), instances(new THREE.SphereGeometry(1, 10, 6), goods, inst.swirl),
    instances(new THREE.CylinderGeometry(0.17, 0.17, 0.11, 18), goods, inst.wheel), instances(new THREE.BoxGeometry(0.14, 0.3, 0.2), goods, inst.bag),
    instances(new THREE.CapsuleGeometry(0.045, 0.5, 3, 6), goods, inst.loaf), instances(new THREE.TorusGeometry(0.075, 0.035, 5, 9, Math.PI * 1.25), goods, inst.crescent),
    instances(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 10), goods, inst.macaron), instances(new THREE.SphereGeometry(1, 9, 7), goods, inst.sack),
    instances(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10), goods, inst.mug),
    instances(new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.21, 0.48], [0.13, 0.6], [0.13, 0.7], [0.16, 0.72], [0, 0.72]].map(([x, y]) => new THREE.Vector2(x, y)), 14), shiny, inst.can),
    instances(tbox(0.7, 0.42, 0.5, 0, 0, 0, 0.8), M.wood, inst.crate, false),
  );
  for (let q = 0; q < 4; q++) { const list = inst.card.filter(c => c.uv === q); if (list.length) root.add(instances(cardGeo(q), sign('cards', 1.1), list, false)); }

  // ============================================================ people: vendors, shoppers, the queue for coffee
  const shade = (g, k) => { const n = prep(g); n.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 3).fill(k), 3)); return n; };
  const figGeo = mergeGeometries([
    shade(new THREE.CapsuleGeometry(0.19, 0.5, 4, 8).scale(0.82, 1, 1.2).translate(0, 1.16, 0), 1),
    shade(new THREE.BoxGeometry(0.13, 0.86, 0.14).translate(0.03, 0.43, 0.1), 0.2), shade(new THREE.BoxGeometry(0.13, 0.86, 0.14).translate(-0.03, 0.43, -0.1), 0.2),
    shade(new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, 0.29), 0.9), shade(new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, -0.29), 0.9),
  ]);
  const headGeo = mergeGeometries([new THREE.SphereGeometry(0.118, 10, 8).translate(0.01, 1.7, 0), new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(-0.012, 1.71, 0)].map(prep));
  const SKIN = [0xe8b896, 0xd9a07a, 0xb97a56, 0x8a5a3c, 0xf0c8a8, 0x6a452e];
  const people = [];
  const person = (x, z, face, c, s = 1) => people.push({ p: [x, Y, z], r: [0, face, 0], s: 0.94 * s + r() * 0.1, c });
  const COAT = [0x3a4a66, 0x5a5048, 0x6a3438, 0x3f5a4a, 0x8a8278, 0x4a4f5a, 0xa58a52, 0x2f3a52, 0x7a5a8a, 0xb0563a];
  const coat = () => COAT[Math.floor(r() * COAT.length)];
  for (let i = 0; i < 3; i++) person(A.x1 - 2.4, bayZ(i) + (r() - 0.5) * 2, 0, 0xe8792a);              // fishmongers in orange
  person(A.x1 + 1.9, bayZ(0.4), Math.PI, 0xe8792a);                                                    // one out front, ready to throw
  for (let i = 3; i < 11; i++) person(A.x1 - 2.5, bayZ(i) + (r() - 0.5) * 3, 0, i < 8 ? 0x2f6a4a : 0x6a4a2a);
  for (let k = 0; k < 16; k++) person(A.x1 + 1.7 + r() * 1.3, A.z0 + 2 + r() * (AL - 4), Math.PI + (r() - 0.5), coat());   // shoppers at the stalls
  for (const key of ['yogurt', 'cheese', 'bakery']) { const S = PIKE.shops[key], n = 2 + Math.floor(r() * 3); person(SX + 2.6, (S.z0 + S.z1) / 2 + 1, Math.PI, 0xf2efe8); for (let k = 0; k < n; k++) person(SX + 0.4 + r() * 0.5, S.z0 + 1 + r() * (S.z1 - S.z0 - 2), 0, coat()); }
  person(SX + 2.9, PIKE.shops.cheese.z0 + 2.2, Math.PI, 0xf4f4f0); person(SX + 2.9, PIKE.shops.cheese.z0 + 4.6, Math.PI, 0xf4f4f0);   // cheesemakers in whites
  person(SX + 3.0, (PIKE.shops.coffee.z0 + PIKE.shops.coffee.z1) / 2, Math.PI, 0x1f4a34);               // barista
  for (let k = 0; k < 11; k++) person(SX - 0.95 + (r() - 0.5) * 0.25, PIKE.shops.coffee.z1 - 1.2 + k * 0.92, -Math.PI / 2 + (r() - 0.5) * 0.5, coat());   // the famous queue
  const washed = new THREE.MeshStandardMaterial({ roughness: 0.75, vertexColors: true });
  washed.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.58) * 0.9;'); };
  washed.customProgramCacheKey = () => 'marketFolk';
  const skin = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  skin.onBeforeCompile = washed.onBeforeCompile; skin.customProgramCacheKey = () => 'marketSkin';
  root.add(instances(figGeo, washed, people), instances(headGeo, skin, people.map(p => ({ ...p, c: SKIN[Math.floor(r() * SKIN.length)] }))));

  // warm light spilling out of each shop onto the pavement
  const spillTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const spillMat = new THREE.MeshBasicMaterial({ map: spillTex, color: new THREE.Color(0.55, 0.38, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const spill = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), spillMat); m.position.set(x, Y + 0.03, z); m.layers.set(1); root.add(m); };
  for (const S of Object.values(PIKE.shops)) spill(SX - 2.2, (S.z0 + S.z1) / 2, 9, S.z1 - S.z0 + 5);
  spill(A.x1 + 2.6, AZM, 10, AL + 6);

  // the flying fish
  const flyer = new THREE.Mesh(fishGeo, new THREE.MeshStandardMaterial({ color: 0xc8cfd4, roughness: 0.25, emissive: 0x7a7468, emissiveIntensity: 0.9 }));
  flyer.scale.setScalar(1.5);
  root.add(flyer);
  const fa = new THREE.Vector3(A.x1 + 1.9, Y + 1.5, bayZ(0.4)), fb = new THREE.Vector3(A.x1 - 2.4, Y + 1.6, bayZ(1));

  root.add(kit.build());
  const lights = createGlowPoints(glowP, glowC, glowS, glowPh, { twinkle: 0.08 });
  root.add(lights.points);

  const update = (t) => {
    const k = (t % 4.5) / 1.0;
    flyer.visible = k < 1;
    if (k < 1) { flyer.position.lerpVectors(fa, fb, k); flyer.position.y += Math.sin(k * Math.PI) * 2.4; flyer.rotation.set(k * 9, k * 4, 0.4); }
  };

  // where the van can stop for a close look, and what each shop hands over
  const roadW = -444.2, roadE = -435.8;
  const stops = [
    { name: 'Pike Place Fish Market', sub: 'South end of the Main Arcade, where the salmon fly', x: roadW, z: bayZ(1), look: [A.x1 - 0.6, Y + 1.6, bayZ(1)], dist: 8.5 },
    { name: 'The Flower Stalls', sub: 'Bouquets by the armful, wrapped in butcher paper', x: roadW, z: bayZ(5), look: [A.x1 - 0.8, Y + 1.4, bayZ(5)], dist: 9 },
    { name: 'The Highstalls', sub: 'Meet the producer: fruit stacked by hand', x: roadW, z: bayZ(9), look: [A.x1 - 0.6, Y + 1.5, bayZ(9)], dist: 8.5 },
    { name: 'Ellenos Real Greek Yogurt', sub: 'A wall of colour by the market entrance', x: roadE, z: 687.5, look: [SX + 1.4, Y + 1.5, 687.5], dist: 8 },
    { name: 'Beecher’s Handmade Cheese', sub: 'Curds stirred in the window, every day', x: roadE, z: 633.5, look: [SX + 1.6, Y + 1.4, 633.5], dist: 9.5 },
    { name: 'The First Starbucks', sub: '1912 Pike Place, and the queue that comes with it', x: roadE, z: 482, look: [SX + 1.2, Y + 2.2, 483.5], dist: 9 },
    { name: 'Le Panier', sub: 'A very French bakery', x: roadE, z: 491.5, look: [SX + 1.4, Y + 1.5, 491.5], dist: 8 },
  ];
  const sources = [
    { name: 'Pike Place Fish', x: roadW, z: bayZ(1), cargo: 'FRESH FISH', rule: { toss: true }, from: [A.x1 + 1.9, Y + 1.6, bayZ(1)] },
    { name: 'The Flower Stalls', x: roadW, z: bayZ(5), cargo: 'FLOWERS', rule: { fragile: 6.0, gentle: true } },
    { name: 'Beecher’s Handmade Cheese', x: roadE, z: 633.5, cargo: 'CHEESE WHEELS', rule: { heavy: true, gentle: true } },
    { name: 'Ellenos Real Greek Yogurt', x: roadE, z: 687.5, cargo: 'GREEK YOGURT', rule: { chilled: true } },
  ];
  const coffee = { name: 'The First Starbucks', x: roadE, z: 482 };
  return { group: root, update, glow: [lights], stops, sources, coffee };
}
