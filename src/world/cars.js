import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural civilian cars: body shell with wheel arches, glasshouse with roof and pillars,
// bumpers, grille, mirrors, alloy wheels and lamp clusters. Shared by parked cars and traffic.
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const flat = (list) => mergeGeometries(list.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));

// Outlines are side views (x forward, y up) as path commands: [x, y] = line, [cx, cy, x, y] = curve.
const SPECS = [
  { // saloon
    W: 1.84, wr: 0.33, ax: 1.40, y0: 0.30, xf: 2.32, xr: -2.32,
    body: [[-2.26, 0.30], [-2.32, 0.55], [-2.30, 0.80], [-2.28, 0.97, -1.95, 0.99], [-1.2, 1.0], [1.15, 0.97], [2.1, 0.90, 2.30, 0.66], [2.32, 0.42], [2.32, 0.30, 2.2, 0.30]],
    cabin: [[-1.75, 0.97], [-1.35, 1.42, -0.8, 1.44], [0.3, 1.44], [0.75, 1.41, 1.28, 0.96]],
    roof: [-0.85, 0.35, 1.44], pillars: [-0.2], headY: 0.70, tailY: 0.84, belt: 0.98,
  },
  { // SUV
    W: 1.94, wr: 0.38, ax: 1.45, y0: 0.36, xf: 2.36, xr: -2.36,
    body: [[-2.3, 0.36], [-2.36, 0.7], [-2.34, 1.0], [-2.33, 1.15, -2.05, 1.16], [1.25, 1.12], [2.2, 1.04, 2.34, 0.78], [2.36, 0.5], [2.36, 0.36, 2.24, 0.36]],
    cabin: [[-2.12, 1.14], [-2.02, 1.70, -1.6, 1.72], [0.25, 1.72], [0.68, 1.69, 1.32, 1.10]],
    roof: [-1.68, 0.3, 1.72], pillars: [-0.45, -1.4], headY: 0.86, tailY: 0.98, belt: 1.14,
  },
  { // hatchback
    W: 1.76, wr: 0.32, ax: 1.26, y0: 0.30, xf: 2.05, xr: -2.0,
    body: [[-1.94, 0.30], [-2.0, 0.6], [-1.98, 0.95], [-1.96, 1.06, -1.8, 1.07], [1.05, 1.0], [1.9, 0.93, 2.03, 0.68], [2.05, 0.42], [2.05, 0.30, 1.94, 0.30]],
    cabin: [[-1.9, 1.05], [-1.78, 1.50, -1.4, 1.52], [0.2, 1.52], [0.6, 1.49, 1.12, 0.99]],
    roof: [-1.45, 0.25, 1.52], pillars: [-0.45], headY: 0.72, tailY: 0.92, belt: 1.03,
  },
];

function trace(shape, cmds) {
  cmds.forEach((c, i) => {
    if (i === 0) shape.moveTo(c[0], c[1]);
    else if (c.length === 2) shape.lineTo(c[0], c[1]);
    else shape.quadraticCurveTo(c[0], c[1], c[2], c[3]);
  });
}
function extrudeX(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 6 });
  return g.translate(0, 0, -(width - bevel * 2) / 2);
}

export const CAR_KINDS = SPECS.length;

export function buildCarGeometries(kind) {
  const S = SPECS[kind], W = S.W, hw = W / 2, ra = S.wr + 0.07;
  const bodyShape = new THREE.Shape();
  trace(bodyShape, S.body);
  bodyShape.lineTo(S.ax + ra, S.y0); bodyShape.absarc(S.ax, S.y0, ra, 0, Math.PI, false);
  bodyShape.lineTo(-S.ax + ra, S.y0); bodyShape.absarc(-S.ax, S.y0, ra, 0, Math.PI, false);
  bodyShape.closePath();
  const cabShape = new THREE.Shape(); trace(cabShape, S.cabin); cabShape.closePath();

  const [r0, r1, ry] = S.roof;
  const body = flat([
    extrudeX(bodyShape, W, 0.08),
    box(r1 - r0, 0.045, W - 0.24, (r0 + r1) / 2, ry + 0.012, 0),                                             // roof skin
    ...S.pillars.flatMap(px => [1, -1].map(s => box(0.09, ry - S.belt, 0.05, px, (ry + S.belt) / 2, s * (hw - 0.105)))),
  ]);
  const cabin = flat([extrudeX(cabShape, W - 0.2, 0.06)]);
  const wheelPos = [[S.ax, 1], [S.ax, -1], [-S.ax, 1], [-S.ax, -1]];
  const wheels = flat(wheelPos.map(([x, s]) => new THREE.CylinderGeometry(S.wr, S.wr, 0.24, 12).rotateX(Math.PI / 2).translate(x, S.wr, s * (hw - 0.11))));
  const rims = flat(wheelPos.map(([x, s]) => new THREE.CylinderGeometry(S.wr * 0.64, S.wr * 0.64, 0.02, 10).rotateX(Math.PI / 2).translate(x, S.wr, s * (hw + 0.015))));
  const trim = flat([
    box(0.14, 0.17, W - 0.08, S.xf - 0.05, S.y0 + 0.10, 0), box(0.14, 0.17, W - 0.08, S.xr + 0.05, S.y0 + 0.10, 0),   // bumpers
    box(0.05, 0.13, W * 0.42, S.xf - 0.012, S.headY - 0.17, 0),                                                      // grille
    box(S.ax * 2 - ra * 2 - 0.1, 0.07, W + 0.02, 0, S.y0 + 0.035, 0),                                                // sills
    ...[1, -1].map(s => box(0.13, 0.09, 0.17, 0.92, S.belt + 0.09, s * (hw + 0.08))),                                 // mirrors
    box(0.02, 0.11, 0.5, S.xr + 0.004, S.y0 + 0.30, 0),                                                              // rear plate recess
  ]);
  const headl = flat([1, -1].map(s => box(0.08, 0.10, 0.40, S.xf - 0.045, S.headY, s * (hw - 0.33))));
  const tail = flat([...[1, -1].map(s => box(0.07, 0.11, 0.48, S.xr + 0.03, S.tailY, s * (hw - 0.34))), box(0.05, 0.03, 0.5, S.roof[0] - 0.42, ry - 0.06, 0)]);
  return { body, cabin, wheels, rims, trim, tail, headl, W };
}

export const carMaterials = {
  paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.40, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.06 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x05080b, roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03, specularIntensity: 1.0, ior: 2.0 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.75 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x8b9199, roughness: 0.32, metalness: 0.9 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.3 }),
  tailOff: new THREE.MeshStandardMaterial({ color: 0x2a0204, roughness: 0.3, emissive: 0x3a0306, emissiveIntensity: 1.2 }),
  headOff: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.15, metalness: 0.6 }),
  headOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(11, 10.5, 9) }),
  tailOn: new THREE.MeshBasicMaterial({ color: 0xffffff }),      // brightness comes from the per-instance colour
};
export const CAR_COLORS = [0x0a0a0c, 0x15171b, 0x4a4f55, 0x9ea3a8, 0xd9dcde, 0x7a0e12, 0x0d2a52, 0x14342a, 0x3a2a1a, 0xc8c2b0, 0xb9862b, 0x5b2a6b, 0x1f5f7a];

let _geo = null;
export function carGeometries() { return _geo || (_geo = SPECS.map((_, k) => buildCarGeometries(k))); }

// One style of car as a bundle of instanced meshes sharing transforms.
export function makeCarSet(kind, count, lit, dynamic = false) {
  const G = carGeometries()[kind], M = carMaterials;
  const mk = (geo, mat) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.count = count; m.frustumCulled = false;
    if (dynamic) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  };
  const body = mk(G.body, M.paint), tail = mk(G.tail, lit ? M.tailOn : M.tailOff);
  const all = [body, mk(G.cabin, M.glass), mk(G.wheels, M.tyre), mk(G.rims, M.rim), mk(G.trim, M.trim), mk(G.headl, lit ? M.headOn : M.headOff), tail];
  return {
    all, body, tail, W: G.W,
    setMatrixAt(i, m) { for (const p of all) p.setMatrixAt(i, m); },
    commit() { for (const p of all) p.instanceMatrix.needsUpdate = true; },
  };
}
