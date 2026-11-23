import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGlowPoints, darkMetal } from './props.js';
import { textTexture, signPlane } from './districts.js';

// Street-level life around three landmarks: the Space Needle plaza, the MOHAI waterfront and Westlake Park.
const prep = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };
const merge = (l) => mergeGeometries(l.map(prep));
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// matte things standing in lamp light: let their own colour glow a little so they are not silhouettes
function lit(color, k = 0.7, rough = 0.7) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.84, 0.62) * ${k.toFixed(2)};`); };
  m.customProgramCacheKey = () => 'sceneLit' + k;
  return m;
}
const glowMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

export function createScenes({ H, r, clear, free, needle, mohai, waterSpot, waterLevel, seaplane, tree }) {
  const group = new THREE.Group();
  const obstacles = [], updaters = [], people = [];
  const gp = [], gc = [], gs = [], gph = [];
  const lamp = (x, y, z, c = [1.0, 0.72, 0.42], s = 1.4) => { gp.push(x, y, z); gc.push(...c); gs.push(s); gph.push(r()); };
  const COAT = [0x3a4a66, 0x5a5048, 0x6a3438, 0x3f5a4a, 0x8a8278, 0x4a4f5a, 0xa58a52, 0x2f3a52, 0x7a5a8a, 0xb0563a, 0xc9c2b0, 0x1f5f7a];
  // nothing in these scenes may stand in a street
  const person = (x, z, face) => clear(x, z, 0.8) && people.push({ x, z, face: face ?? r() * 6.28, s: 0.93 + r() * 0.12, c: COAT[Math.floor(r() * COAT.length)] });
  const crowd = (cx, cz, n, rad, inner = 0) => { for (let i = 0; i < n; i++) { const a = r() * 6.28, d = inner + Math.sqrt(r()) * (rad - inner); person(cx + Math.cos(a) * d, cz + Math.sin(a) * d); } };
  const geos = { metal: [], wood: [], white: [], red: [], cream: [], panel: [], blue: [] };

  const bench = (x, z, a) => { if (!clear(x, z, 1.6)) return; const y = H(x, z); for (const g of [box(1.9, 0.08, 0.5, 0, 0.45, 0), box(1.9, 0.5, 0.06, 0, 0.75, -0.25), box(0.08, 0.45, 0.45, -0.8, 0.22, 0), box(0.08, 0.45, 0.45, 0.8, 0.22, 0)]) geos.wood.push(g.rotateY(a).translate(x, y, z)); };
  // a street-food cart or kiosk: body, serving window, striped awning, a lamp
  const kiosk = (x0, z0, a, text, color, w = 3.2) => {
    const at = clear(x0, z0, w * 0.6 + 1.5) ? [x0, z0] : free(x0, z0, 3, 30, w * 0.6 + 1.5); if (!at) return;
    const [x, z] = at;
    const y = H(x, z), put = (g) => g.rotateY(a).translate(x, y, z);
    geos.metal.push(put(box(w, 2.3, 2.0, 0, 1.15, 0)));
    geos.panel.push(put(box(w - 0.5, 0.9, 0.06, 0, 1.55, 1.02)));
    for (let i = 0; i < 6; i++) geos[i % 2 ? 'cream' : 'red'].push(put(new THREE.BoxGeometry(w / 6, 0.06, 1.3).rotateX(0.35).translate(-w / 2 + (i + 0.5) * w / 6, 2.45, 1.5)));
    const s = signPlane(textTexture([[text, 150, 128]], color, 1024, 256), w, w / 4, x + Math.sin(a) * 1.04, y + 2.9, z + Math.cos(a) * 1.04, a, 2.0); group.add(s);
    lamp(x + Math.sin(a) * 1.6, y + 2.2, z + Math.cos(a) * 1.6, [1.0, 0.78, 0.5], 1.6);
    obstacles.push({ x, z, r: w * 0.55 });
    for (let i = 0; i < 3; i++) person(x + Math.sin(a) * (2.4 + i * 0.9) + (r() - 0.5), z + Math.cos(a) * (2.4 + i * 0.9) + (r() - 0.5), a + Math.PI / 2 + Math.PI);
  };

  // ================================================================ Space Needle plaza
  if (needle) {
    const [nx, nz] = needle, y = H(nx, nz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.5, 36, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.5, emissive: 0x2a2620, emissiveIntensity: 1 }));
    ring.position.set(nx, y + 0.13, nz); ring.layers.set(1); group.add(ring);
    const band = new THREE.Mesh(new THREE.RingGeometry(23.4, 24, 64, 1).rotateX(-Math.PI / 2), glowMat(2.2, 1.6, 0.9));
    band.position.set(nx, y + 0.16, nz); band.layers.set(1); group.add(band);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283, x = nx + Math.cos(a) * 33, z = nz + Math.sin(a) * 33; if (!clear(x, z, 0.6)) continue; geos.metal.push(new THREE.CylinderGeometry(0.14, 0.16, 0.95, 8).translate(x, y + 0.47, z)); lamp(x, y + 1.05, z, [1.0, 0.8, 0.5], 0.7); obstacles.push({ x, z, r: 0.25 }); }
    // festoon of bulbs strung between poles around the base
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * 6.283, a1 = ((i + 1) / 10) * 6.283;
      geos.metal.push(new THREE.CylinderGeometry(0.07, 0.09, 5.4, 6).translate(nx + Math.cos(a0) * 27, y + 2.7, nz + Math.sin(a0) * 27));
      obstacles.push({ x: nx + Math.cos(a0) * 27, z: nz + Math.sin(a0) * 27, r: 0.2 });
      for (let t = 0; t < 1; t += 0.06) { const a = a0 + (a1 - a0) * t; lamp(nx + Math.cos(a) * 27, y + 5.3 - Math.sin(t * Math.PI) * 1.1, nz + Math.sin(a) * 27, [2.2, 1.6, 0.85], 0.14); }
    }
    kiosk(nx + 20, nz + 24, 0.7, 'TICKETS', '#ffd9a0', 4.2); kiosk(nx - 26, nz + 16, -0.9, 'HOT COCOA', '#ff9a3c'); kiosk(nx - 14, nz - 27, 2.6, 'SOUVENIRS', '#7fd4ff'); kiosk(nx + 27, nz - 14, 1.9, 'PRETZELS', '#fff07a');
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283 + 0.4; bench(nx + Math.cos(a) * 21, nz + Math.sin(a) * 21, -a + Math.PI / 2); }
    crowd(nx, nz, 46, 34, 12);
  }

  // ================================================================ MOHAI waterfront: historic ships, a seaplane, the promenade
  if (mohai) {
    const { x: mx, z: mz } = mohai;
    const hullShape = new THREE.Shape(); hullShape.moveTo(-13, 0); hullShape.quadraticCurveTo(-13.6, 3.2, -11.5, 3.4); hullShape.lineTo(10, 3.4); hullShape.quadraticCurveTo(14, 3.0, 15.5, 0.4); hullShape.quadraticCurveTo(4, -1.6, -13, 0);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 5, bevelEnabled: true, bevelSize: 0.9, bevelThickness: 1.0, bevelSegments: 3 }).translate(0, 0, -2.5);
    [[0x1a1c20, 0xb8231c, 'tug'], [0xe9e4d8, 0x14181c, 'steamer']].forEach(([hullC, funnelC, kind], n) => {
      const spot = waterSpot(mx + (n ? 60 : -50), mz + (n ? -30 : -40), 17); if (!spot) return;
      const [x, z] = spot, wy = waterLevel(x, z), ry = r() * 6.28, ship = new THREE.Group();
      ship.add(new THREE.Mesh(hullGeo, lit(hullC, 0.45, 0.5)));
      const house = kind === 'tug' ? [box(9, 2.6, 3.6, -1, 4.7, 0), box(4, 2.2, 3.0, 2.5, 7.1, 0)] : [box(19, 2.5, 4.4, -0.5, 4.65, 0), box(15, 2.3, 3.8, -1, 7.05, 0), box(4, 2.0, 3.0, 5, 9.2, 0)];
      ship.add(new THREE.Mesh(merge(house), lit(0xe6e0d2, 0.6)));
      ship.add(new THREE.Mesh(merge([new THREE.CylinderGeometry(0.9, 1.0, 5.2, 14).translate(-2.5, kind === 'tug' ? 9.4 : 10.8, 0)]), lit(funnelC, 0.6)));
      ship.add(new THREE.Mesh(merge([new THREE.CylinderGeometry(0.08, 0.12, 11, 6).translate(8, 9, 0), new THREE.CylinderGeometry(0.07, 0.1, 9, 6).translate(-9, 8, 0)]), darkMetal));
      const win = []; for (let k = 0; k < (kind === 'tug' ? 5 : 11); k++) for (const s of [1, -1]) win.push(box(0.9, 0.7, 0.05, (kind === 'tug' ? -4 : -9) + k * 1.7, 4.9, s * (kind === 'tug' ? 1.83 : 2.23)));
      ship.add(new THREE.Mesh(merge(win), glowMat(2.6, 2.0, 1.2)));
      ship.position.set(x, wy - 1.1, z); ship.rotation.y = ry; group.add(ship);
      // dressed overall: bulbs from bow to mastheads to stern
      const c = Math.cos(ry), s = Math.sin(ry), at = (lx, ly) => [x + lx * c, wy - 1.1 + ly, z - lx * s];
      for (const [a, b] of [[[15, 3.6], [8, 14.5]], [[8, 14.5], [-9, 12.5]], [[-9, 12.5], [-13, 3.6]]]) for (let t = 0; t <= 1; t += 0.05) { const q = at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.8); lamp(q[0], q[1], q[2], [2.4, 1.7, 0.9], 0.2); }
      updaters.push((t) => { ship.rotation.z = Math.sin(t * 0.5 + n) * 0.012; ship.position.y = wy - 1.1 + Math.sin(t * 0.7 + n * 2) * 0.05; });
    });
    // everything stays on the pavement between the museum wall and the kerb
    const tx = -mohai.nz, tz = mohai.nx, along = (t, n) => [mx + tx * t + mohai.nx * n, mz + tz * t + mohai.nz * n];
    for (let i = 0; i < 6; i++) { const t = (i < 3 ? -1 : 1) * (5 + (i % 3) * 4.5), [bx, bz] = along(t, -1.2); bench(bx, bz, Math.atan2(mohai.nx, mohai.nz)); }
    for (let i = 0; i < 22; i++) { const [px, pz] = along((r() - 0.5) * 30, -0.5 + r() * 2.2); person(px, pz); }
    const [kx, kz] = along(21, -0.4); kiosk(kx, kz, Math.atan2(mohai.nx, mohai.nz), 'CHOWDER', '#ffd35a');
  }
  if (seaplane) {
    const spot = waterSpot(seaplane[0], seaplane[1], 12);
    if (spot) {
      const [x, z] = spot, wy = waterLevel(x, z), p = new THREE.Group();
      p.add(new THREE.Mesh(merge([new THREE.CapsuleGeometry(0.75, 6.5, 6, 14).rotateZ(Math.PI / 2).translate(0, 2.3, 0), box(1.7, 0.16, 13.5, 0.6, 3.25, 0), box(0.9, 0.12, 4.2, -4.0, 2.7, 0), box(1.3, 1.8, 0.12, -4.2, 3.4, 0)]), lit(0xf2efe6, 0.7, 0.4)));
      p.add(new THREE.Mesh(merge([box(8.4, 0.3, 0.18, 0, 2.3, 0.77), box(8.4, 0.3, 0.18, 0, 2.3, -0.77)]), lit(0xf2b417, 0.8)));
      p.add(new THREE.Mesh(merge([...[1.5, -1.5].flatMap(s => [new THREE.CapsuleGeometry(0.42, 5.6, 4, 10).rotateZ(Math.PI / 2).translate(0.4, 0.45, s), box(0.1, 1.5, 0.1, 1.6, 1.3, s), box(0.1, 1.5, 0.1, -0.9, 1.3, s)]), new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).rotateX(Math.PI / 2).translate(4.1, 2.3, 0)]), darkMetal));
      p.position.set(x, wy, z); p.rotation.y = r() * 6.28; group.add(p);
      lamp(x, wy + 3.6, z, [3, 0.3, 0.2], 0.5); lamp(x, wy + 2.4, z, [2.2, 2.2, 2.4], 0.4);
      updaters.push((t) => { p.position.y = wy + Math.sin(t * 0.8) * 0.05; p.rotation.z = Math.sin(t * 0.6) * 0.015; });
    }
  }

  // ================================================================ Westlake Park: the holiday carousel, food trucks, a crowd
  if (tree) {
    const [tx, tz] = tree, cTry = free(tx + 13, tz - 9, 0, 45, 8), cAt = cTry && Math.hypot(cTry[0] - tx, cTry[1] - tz) > 12 ? cTry : null;
    const cx = cAt ? cAt[0] : tx, cz = cAt ? cAt[1] : tz, y = H(cx, cz);
    if (cAt) {
    const still = [new THREE.CylinderGeometry(5.6, 5.8, 0.35, 28).translate(cx, y + 0.18, cz), new THREE.CylinderGeometry(0.5, 0.5, 4.2, 12).translate(cx, y + 2.4, cz)];
    geos.wood.push(...still);
    const canopy = new THREE.ConeGeometry(6.3, 2.4, 20, 1, true).toNonIndexed(), cp = canopy.attributes.position, col = [];
    for (let i = 0; i < cp.count; i += 3) { const a = Math.atan2(cp.getZ(i) + cp.getZ(i + 1) + cp.getZ(i + 2), cp.getX(i) + cp.getX(i + 1) + cp.getX(i + 2)), red = Math.floor(((a + Math.PI) / 6.283) * 20) % 2; for (let k = 0; k < 9; k += 3) col.push(...(red ? [0.75, 0.1, 0.1] : [0.95, 0.9, 0.78])); }
    canopy.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const cm = lit(0xffffff, 0.75); cm.vertexColors = true; cm.side = THREE.DoubleSide;
    const top = new THREE.Mesh(canopy, cm); top.position.set(cx, y + 5.7, cz); group.add(top);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * 6.283; lamp(cx + Math.cos(a) * 6.3, y + 4.45, cz + Math.sin(a) * 6.3, [2.6, 1.9, 1.0], 0.2); }
    lamp(cx, y + 7.2, cz, [3, 2.4, 1.4], 1.2);
    const spin = new THREE.Group(); spin.position.set(cx, y + 0.35, cz); group.add(spin);
    const HORSE = [0xf2efe6, 0x3a2a1e, 0xc9a227, 0x9a1a1a, 0x1f5f7a];
    const horses = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.283, rad = i % 2 ? 4.4 : 3.2, h = new THREE.Group();
      h.add(new THREE.Mesh(merge([new THREE.CapsuleGeometry(0.26, 0.9, 4, 8).rotateZ(Math.PI / 2), new THREE.CapsuleGeometry(0.15, 0.5, 3, 6).rotateZ(-0.7).translate(0.72, 0.42, 0), ...[[0.4, 0.14], [0.4, -0.14], [-0.4, 0.14], [-0.4, -0.14]].map(([lx, lz]) => box(0.09, 0.6, 0.09, lx, -0.5, lz))]), lit(HORSE[i % HORSE.length], 0.8, 0.4)));
      h.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 6).translate(0, 0.9, 0), glowMat(1.6, 1.3, 0.7)));
      h.position.set(Math.cos(a) * rad, 1.3, Math.sin(a) * rad); h.rotation.y = -a - Math.PI / 2; spin.add(h); horses.push(h);
    }
    updaters.push((t) => { spin.rotation.y = t * 0.45; horses.forEach((h, i) => { h.position.y = 1.3 + Math.sin(t * 1.8 + i * 1.3) * 0.28; }); });
    obstacles.push({ x: cx, z: cz, r: 6 });
    }
    kiosk(tx - 14, tz + 8, 0.9, 'CRÊPES', '#ffb7e0', 5.2); kiosk(tx - 9, tz - 13, 2.2, 'TAMALES', '#59ff8f', 5.2); kiosk(tx + 6, tz + 14, -0.4, 'CIDER', '#ffb056');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; bench(tx + Math.cos(a) * 8.5, tz + Math.sin(a) * 8.5, -a + Math.PI / 2); }
    crowd(tx, tz, 34, 17, 5.5); if (cAt) crowd(cx, cz, 12, 9.5, 6.5);
  }

  // ================================================================ build the shared meshes
  const MAT = { metal: lit(0x2a2d31, 0.5, 0.5), wood: lit(0x5a3f28, 0.6), white: lit(0xf2efe6, 0.7), red: lit(0xb01c1c, 0.75), cream: lit(0xf1e6cc, 0.75), panel: glowMat(2.6, 2.0, 1.3), blue: lit(0x1b5fc4, 0.7) };
  for (const [k, list] of Object.entries(geos)) if (list.length) group.add(new THREE.Mesh(merge(list), MAT[k]));
  if (people.length) {
    const shade = (g, k) => { const n = prep(g); n.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 3).fill(k), 3)); return n; };
    const body = mergeGeometries([shade(new THREE.CapsuleGeometry(0.19, 0.5, 4, 8).scale(0.82, 1, 1.2).translate(0, 1.16, 0), 1), shade(new THREE.BoxGeometry(0.13, 0.86, 0.14).translate(0.03, 0.43, 0.1), 0.22), shade(new THREE.BoxGeometry(0.13, 0.86, 0.14).translate(-0.03, 0.43, -0.1), 0.22), shade(new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, 0.29), 0.9), shade(new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, -0.29), 0.9)]);
    const head = merge([new THREE.SphereGeometry(0.118, 10, 8).translate(0.01, 1.7, 0), new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(-0.012, 1.71, 0)]);
    const bm = lit(0xffffff, 0.85); bm.vertexColors = true;
    const SKIN = [0xe8b896, 0xd9a07a, 0xb97a56, 0x8a5a3c, 0xf0c8a8, 0x6a452e];
    const bodies = new THREE.InstancedMesh(body, bm, people.length), heads = new THREE.InstancedMesh(head, lit(0xffffff, 0.85), people.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
    people.forEach((p, i) => { Q.setFromAxisAngle(UP, p.face); M.compose(new THREE.Vector3(p.x, H(p.x, p.z) + 0.1, p.z), Q, new THREE.Vector3(p.s, p.s, p.s)); bodies.setMatrixAt(i, M); heads.setMatrixAt(i, M); bodies.setColorAt(i, C.setHex(p.c)); heads.setColorAt(i, C.setHex(SKIN[Math.floor(r() * SKIN.length)])); });
    group.add(bodies, heads);
  }
  const lights = createGlowPoints(gp, gc, gs, gph, { twinkle: 0.08 });
  group.add(lights.points);
  group.traverse(o => { o.frustumCulled = false; });
  return { group, glow: [lights], obstacles, people: people.length, update: (t) => { for (const u of updaters) u(t); } };
}
