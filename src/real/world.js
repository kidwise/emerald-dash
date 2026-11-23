import * as THREE from 'three';
import { FacadeGeo, STYLE, createFacadeMaterial } from '../world/facade.js';
import { buildLamps, buildTrees, createGlowPoints, chunks, byChunk, registerChunk, shadowTex } from '../world/props.js';
import { createRain } from '../world/rain.js';
import { createLake } from '../world/landmarks.js';
import { rng } from '../world/rng.js';
import { setMap } from '../config.js';
import { createIcons } from '../world/icons.js';
import { createScenes } from '../world/scenes.js';
import { createPikePlace, PIKE } from '../world/market.js';
import { createCenter, createMonorail, createMarket, createRetailCore, textTexture, signPlane } from '../world/districts.js';
import { createStreetcar } from '../world/landmarks.js';
import { darkMetal } from '../world/props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MARKET_Y } from '../config.js';
import { makeCarSet, CAR_KINDS, CAR_COLORS } from '../world/cars.js';
import { createPedestrians } from '../world/pedestrians.js';

// A district built from real map data (OpenStreetMap, baked by tools/bake-map.mjs):
// true street geometry at any angle, real building footprints and heights, the real shoreline.
const FRAMES = [[0.035, 0.036, 0.04], [0.10, 0.10, 0.105], [0.05, 0.042, 0.035], [0.20, 0.21, 0.22], [0.022, 0.03, 0.04]];
const ACCENTS = [[0.85, 0.30, 0.04], [0.04, 0.42, 0.62], [0.62, 0.08, 0.10], [0.10, 0.50, 0.26], [0.80, 0.58, 0.06], [0.36, 0.14, 0.52]];
const BRICKS = [[0.30, 0.10, 0.065], [0.24, 0.085, 0.06], [0.34, 0.20, 0.12], [0.16, 0.13, 0.115], [0.36, 0.30, 0.22]];
const PANELS = [[0.30, 0.31, 0.32], [0.16, 0.17, 0.18], [0.34, 0.30, 0.25], [0.09, 0.10, 0.11]];

const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
function inPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function flatShape(ring, y) {
  const s = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).translate(0, y, 0);
}

export async function initRealWorld(app, mapName = 'slu') {
  const { scene, renderer, ground, reflection } = app;
  const data = await (await fetch(`/assets/map/${mapName}.json`)).json();
  const B = data.bounds, r = rng(47618);
  // real ground heights (tools/bake-dem.mjs); without the file the district is simply flat
  let HG = null;
  try { const res = await fetch(`/assets/map/${mapName}-height.json`); if (res.ok) HG = await res.json(); } catch { /* flat */ }
  const hgt = HG ? Float32Array.from(HG.data, v => v * HG.unit) : null;
  const H = (x, z) => {
    if (!hgt) return 0;
    const fx = Math.max(0, Math.min(HG.nx - 1.001, (x - HG.x0) / HG.step)), fz = Math.max(0, Math.min(HG.nz - 1.001, (z - HG.z0) / HG.step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * HG.nx + i;
    const a = hgt[k], b = hgt[k + 1], c = hgt[k + HG.nx + 1], d = hgt[k + HG.nx];
    return u > v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;    // the same two triangles the terrain mesh draws
  };
  const updaters = [], glow = [], obstacles = [], colliders = [];
  let parkedCount = 0, signCount = 0, iconSpots = null, treeAt = null, railRef = null;

  // ---- hand-built landmarks take their real places; the map's own buildings make way for them
  const centreOf = (b) => { let x = 0, z = 0; for (const q of b.p) { x += q[0]; z += q[1]; } return [x / b.p.length, z / b.p.length]; };
  let pikeT = null;
  const pikeRoad = data.roads.filter(q => q.n === 'Pike Place');
  if (pikeRoad.length) {
    const tips = pikeRoad.flatMap(q => [q.p[0], q.p[q.p.length - 1]]);
    const se = tips.reduce((a, b) => (b[1] > a[1] ? b : a)), nw = tips.reduce((a, b) => (b[1] < a[1] ? b : a));
    const th = Math.atan2(se[0] - nw[0], se[1] - nw[1]), c = Math.cos(th), sn = Math.sin(th), OX = -440, OZ = 704;
    pikeT = {
      th, origin: se,
      toWorld: (lx, lz) => { const x = lx - OX, z = lz - OZ; return [se[0] + x * c + z * sn, se[1] - x * sn + z * c]; },
      toLocal: (wx, wz) => { const x = wx - se[0], z = wz - se[1]; return [OX + x * c - z * sn, OZ + x * sn + z * c]; },
    };
  }
  const needleB = data.buildings.find(b => b.n === 'Space Needle');
  const needleAt = needleB ? centreOf(needleB) : null;
  const glassAt = needleAt && [needleAt[0] - 65, needleAt[1] - 4];      // Chihuly Garden and Glass, from the map data
  const fountainAt = needleAt && [needleAt[0] - 203, needleAt[1] - 221];
  const inSet = (x, z, m = 0) => { if (!pikeT) return false; const [lx, lz] = pikeT.toLocal(x, z); return lx > -498 - m && lx < -386 + m && lz > 438 - m && lz < 714 + m; };
  const spheresB = data.buildings.find(b => /The Spheres/.test(b.n));
  const pickB = (re) => data.buildings.find(b => re.test(b.n));
  const mopopB = pickB(/MoPOP/), libraryB = pickB(/Central Library/), arenaB = pickB(/Climate Pledge Arena/), scienceB = pickB(/Pacific Science Center/);
  if (arenaB) arenaB.h = 11;        // low walls; the pyramid roof is added on top
  data.buildings = data.buildings.filter((b) => {
    if (b === spheresB || b === mopopB || b === libraryB) return false;
    const [x, z] = centreOf(b);
    if (needleAt && (b === needleB || Math.hypot(x - glassAt[0], z - glassAt[1]) < 30)) return false;
    return !inSet(x, z);
  });

  // ---- shape the ground: level pads under the hand-built landmarks, and beds under the water
  const lakes = data.water.filter(w => w.length > 3);
  const waterY = lakes.map((ring) => { let lo = 1e9; for (const [x, z] of ring) if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) lo = Math.min(lo, H(x, z)); return lo > 1e8 ? 0 : Math.max(0, lo - 0.25); });
  const inWater = (x, z) => lakes.some(ring => inPoly(x, z, ring));
  const ease = (t) => { const q = Math.max(0, Math.min(1, t)); return q * q * (3 - 2 * q); };
  let pikeY = 0, needleY = 0;
  if (hgt) {
    const pads = [];
    if (pikeT) {
      const c = pikeT.toWorld(-440, 574); pikeY = H(c[0], c[1]);
      pads.push({ level: pikeY, w: (x, z) => { const [lx, lz] = pikeT.toLocal(x, z); return 1 - ease(Math.hypot(Math.max(-496 - lx, 0, lx + 384), Math.max(436 - lz, 0, lz - 716)) / 75); } });
    }
    if (needleAt) {
      needleY = H(needleAt[0], needleAt[1]);
      for (const [q, rad] of [[needleAt, 60], [glassAt, 46], [fountainAt, 40]]) pads.push({ level: needleY, w: (x, z) => 1 - ease((Math.hypot(x - q[0], z - q[1]) - rad) / 55) });
    }
    const boxes = lakes.map((ring) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, x1, z0, z1]; });
    for (let j = 0; j < HG.nz; j++) for (let i = 0; i < HG.nx; i++) {
      const x = HG.x0 + i * HG.step, z = HG.z0 + j * HG.step, k = j * HG.nx + i;
      for (const pad of pads) { const w = pad.w(x, z); if (w > 0) hgt[k] += (pad.level - hgt[k]) * w; }
      lakes.forEach((ring, n) => { const b = boxes[n]; if (x > b[0] && x < b[1] && z > b[2] && z < b[3] && inPoly(x, z, ring)) hgt[k] = waterY[n] - 1.8; });
    }
  }

  const footprints = data.buildings.map(b => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of b.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1, p: b.p }; });
  const inBuilding = (x, z) => footprints.some(f => x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && inPoly(x, z, f.p));

  // ================================================================ roads
  // resample every few metres so paint can fade in and out of junctions smoothly
  const junctionR = new Map();
  for (const rd of data.roads) rd.p.forEach((p, i) => { if (rd.j[i]) junctionR.set(key(p), Math.max(junctionR.get(key(p)) || 0, rd.w / 2)); });
  const roads = data.roads.map((rd) => {
    const pts = [], jr = [];
    rd.p.forEach((p, i) => {
      if (i) { const a = rd.p[i - 1], len = Math.hypot(p[0] - a[0], p[1] - a[1]), n = Math.max(1, Math.ceil(len / 6)); for (let k = 1; k < n; k++) { pts.push([a[0] + (p[0] - a[0]) * k / n, a[1] + (p[1] - a[1]) * k / n]); jr.push(0); } }
      pts.push(p); jr.push(rd.j[i] ? junctionR.get(key(p)) : 0);
    });
    const v = [0]; for (let i = 1; i < pts.length; i++) v.push(v[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const dJ = pts.map((_, i) => { let d = 60; for (let k = 0; k < pts.length; k++) if (jr[k]) d = Math.min(d, Math.abs(v[i] - v[k]) - jr[k]); return d; });
    const nodes = []; pts.forEach((p, i) => { if (jr[i]) nodes.push({ i, k: key(p) }); });
    return { name: rd.n, kind: rd.k, w: rd.w, hw: rd.w / 2, oneway: rd.o, bridge: rd.br, pts, v, dJ, nodes, len: v[v.length - 1] };
  });

  const pos = [], uv = [], info = [], idx = [];
  const onBrick = (x, z) => { if (!pikeT) return false; const [lx, lz] = pikeT.toLocal(x, z); return lx > -449 && lx < -431 && lz > 440 && lz < 712; };
  roads.forEach((rd, ri) => {
    if (pikeT && rd.name === 'Pike Place') return;       // the market street is laid in brick by hand
    const base = pos.length / 3, half = rd.hw + 0.3, y = 0.10 + (ri % 32) * 0.0008;
    rd.pts.forEach((p, i) => {
      const a = rd.pts[Math.max(0, i - 1)], b = rd.pts[Math.min(rd.pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      const lx = p[0] - nx * half, lz = p[1] - nz * half, qx = p[0] + nx * half, qz = p[1] + nz * half;
      pos.push(lx, H(lx, lz) + y, lz, qx, H(qx, qz) + y, qz);
      uv.push(-half, rd.v[i], half, rd.v[i]);
      const kind = rd.hw > 6.9 ? 0 : 1;
      info.push(rd.hw, kind, rd.dJ[i], 0, rd.hw, kind, rd.dJ[i], 0);
      if (i) { const q = base + (i - 1) * 2; idx.push(q, q + 1, q + 3, q, q + 3, q + 2); }
    });
  });
  // a disc of plain asphalt over every junction hides the overlaps
  for (const [k, R] of junctionR) {
    if (onBrick(...k.split(',').map(Number))) continue;
    const [x, z] = k.split(',').map(Number), base = pos.length / 3, rad = R + 0.6, N = 14;
    pos.push(x, H(x, z) + 0.14, z); uv.push(0, 0); info.push(rad, 1, -1, 0);
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; pos.push(px, H(px, pz) + 0.14, pz); uv.push(0, 0); info.push(rad, 1, -1, 0); if (i) idx.push(base, base + i + 1, base + i); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  roadGeo.setIndex(idx); roadGeo.computeVertexNormals();
  const roadMat = ground.mk(3); roadMat.side = THREE.DoubleSide;
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  let paveGeo;
  if (hgt) {
    const tp = new Float32Array(HG.nx * HG.nz * 3), ti = [];
    for (let j = 0; j < HG.nz; j++) for (let i = 0; i < HG.nx; i++) { const k = j * HG.nx + i; tp[k * 3] = HG.x0 + i * HG.step; tp[k * 3 + 1] = hgt[k]; tp[k * 3 + 2] = HG.z0 + j * HG.step; if (i < HG.nx - 1 && j < HG.nz - 1) ti.push(k, k + HG.nx + 1, k + 1, k, k + HG.nx, k + HG.nx + 1); }
    paveGeo = new THREE.BufferGeometry(); paveGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3)); paveGeo.setIndex(ti); paveGeo.computeVertexNormals();
  } else paveGeo = new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2);
  const pave = new THREE.Mesh(paveGeo, ground.mk(4));
  const grounds = new THREE.Group();
  grounds.add(pave, roadMesh);
  grounds.traverse(o => { o.layers.set(1); o.frustumCulled = false; });
  scene.add(grounds);

  // ================================================================ water: the real shoreline
  lakes.forEach((ring, n) => {
    const lake = createLake(reflection, { geometry: flatShape(ring, 0), y: waterY[n] + 0.02 });
    lake.mesh.frustumCulled = false;
    scene.add(lake.mesh);
    // the planar mirror only matches the water when it lies level at the water's height
    updaters.push(() => { lake.uniforms.uTime.value = app.time; lake.uniforms.uMirrorY.value = reflection.point.y; lake.uniforms.uPlanar.value = reflection.normal.y > 0.9995 && Math.abs(reflection.point.y - waterY[n]) < 0.9 ? 1 : 0; });
  });

  // ================================================================ buildings from real footprints
  const g = new FacadeGeo();
  const segs = [], lots = [], beacons = [];
  const pick = (a) => a[Math.floor(r() * a.length) % a.length];
  // every road segment, for "which street is this wall on" and for snapping
  const rsegs = [];
  roads.forEach((rd, ri) => { for (let i = 1; i < rd.pts.length; i++) rsegs.push({ ri, i, ax: rd.pts[i - 1][0], az: rd.pts[i - 1][1], bx: rd.pts[i][0], bz: rd.pts[i][1] }); });
  const RC = 60, rgrid = new Map();
  for (const s of rsegs) { const k = `${Math.floor((s.ax + s.bx) / 2 / RC)},${Math.floor((s.az + s.bz) / 2 / RC)}`; if (!rgrid.has(k)) rgrid.set(k, []); rgrid.get(k).push(s); }
  const nearRoad = (x, z, reach = 1) => {
    let best = null, bd = 1e9;
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) for (const s of rgrid.get(`${cx + i},${cz + j}`) || []) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      const px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = { s, t, x: px, z: pz, d, rd: roads[s.ri] }; }
    }
    return best;
  };

  for (const b of data.buildings) {
    const a = b.a;
    const Hb = /Naval Reserve Armory/.test(b.n) ? 15.4 : b.h || (a > 2500 ? 26 + r() * 30 : a > 900 ? 13 + r() * 18 : 7 + r() * 8);
    const home = ['apartments', 'residential', 'hotel', 'dormitory'].includes(b.t), work = ['office', 'commercial'].includes(b.t), shop = ['retail', 'warehouse', 'industrial', 'church'].includes(b.t);
    let style;
    if (home) style = Hb > 32 ? STYLE.RESI : STYLE.BRICK;
    else if (work) style = r() < 0.75 ? STYLE.CURTAIN : STYLE.RIBBON;
    else if (shop) style = STYLE.BRICK;
    else style = Hb > 45 ? (r() < 0.6 ? STYLE.CURTAIN : STYLE.RESI) : Hb < 15 ? STYLE.BRICK : (r() < 0.6 ? STYLE.CURTAIN : r() < 0.5 ? STYLE.RIBBON : STYLE.BRICK);
    const gh = Math.min(Hb * 0.6, style === STYLE.RESI ? 4.6 : 5.4);
    const mohai = /Naval Reserve Armory/.test(b.n);
    if (mohai) b.n = 'MOHAI';
    const o = mohai ? { style: STYLE.BRICK, seed: 3.3, floorH: 6.2, bayW: 5.2, groundH: 2.0, lit: 0.92, a: 0, tint: [0.46, 0.45, 0.42] } : {
      style, seed: r() * 50, groundH: gh, lit: style === STYLE.RESI ? 0.36 : 0.5, a: r() < 0.6 ? 1 : 0, b: r(),
      floorH: style === STYLE.CURTAIN ? 4.1 : style === STYLE.BRICK ? 3.9 : style === STYLE.RIBBON ? 4.6 : 3.05,
      bayW: style === STYLE.CURTAIN ? 1.5 : style === STYLE.BRICK ? 3.3 : style === STYLE.RIBBON ? 1.6 : 3.4,
      tint: style === STYLE.BRICK ? pick(BRICKS) : style === STYLE.RIBBON ? pick(PANELS) : style === STYLE.RESI ? (r() < 0.5 ? [0.42, 0.42, 0.41] : [0.16, 0.165, 0.17]) : pick(FRAMES),
      tint2: pick(ACCENTS),
    };
    const ring = b.p;
    let lo = 1e9, hi = -1e9; for (const [x, z] of ring) { const y = H(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const base = lo - 0.4, top = hi + Hb;
    let door = null, doorLen = 0, cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      cx += p[0]; cz += p[1];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.3) continue;
      g.wall(p[0], p[1], q[0], q[1], base, top, o);
      segs.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1] });
      // a door goes on the longest wall that faces a street
      if (len > 5 && len > doorLen) {
        const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        const nr = nearRoad(mx + nx * 6, mz + nz * 6);
        if (nr && nr.d - nr.rd.hw < 7 && !inPoly(mx + nx * 2.4, mz + nz * 2.4, ring)) { door = { x: mx + nx * 2.4, z: mz + nz * 2.4, nx, nz }; doorLen = len; }
      }
    }
    try {
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [i0, i1, i2] of tris) g.tri(ring[i0], ring[i2], ring[i1], top, { style: STYLE.ROOF });
    } catch { /* a degenerate footprint: walls only */ }
    cx /= ring.length; cz /= ring.length;
    if (Hb > 70) beacons.push([cx, top + 3, cz]);
    if (mohai) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; g.wall(p[0], p[1], q[0], q[1], top - 0.7, top - 0.5, { style: STYLE.EMISSIVE, lit: 2.6, tint: [1.0, 0.82, 0.6] }); }
    if (b.n && door) lots.push({ name: b.n, door, base, top, type: 'office', district: 'slu', x0: cx, x1: cx, z0: cz, z1: cz, h: Hb });
  }
  // ================================================================ hero landmarks at their real addresses
  const boxSegs = (b, tf) => { const c = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].map(q => (tf ? tf(q[0], q[1]) : q)); for (let i = 0; i < 4; i++) segs.push({ ax: c[i][0], az: c[i][1], bx: c[(i + 1) % 4][0], bz: c[(i + 1) % 4][1] }); };
  const heroStops = [], heroSources = [];
  let coffee = { x: 1e5, z: 1e5 }, inSlow = () => false;
  if (pikeT) {
    const tc = [], to = [];
    const pike = createPikePlace(tc, to);
    const pivot = new THREE.Group(); pivot.position.set(pikeT.origin[0], pikeY - PIKE.Y, pikeT.origin[1]); pivot.rotation.y = pikeT.th;
    const inner = new THREE.Group(); inner.position.set(440, 0, -704); inner.add(pike.group); pivot.add(inner); scene.add(pivot);
    glow.push(...pike.glow); updaters.push(() => pike.update(app.time));
    // the blocks behind the stalls and shops, rebuilt to fit the hand-made street
    const sg = new FacadeGeo(), MY = PIKE.Y - 0.16;
    const setBox = (x0, x1, z0, z1, h, o) => { sg.box(x0, x1, z0, z1, MY, MY + h, o); tc.push({ x0, x1, z0, z1 }); };
    const brick = (seed, tint, lit = 0.5) => ({ style: STYLE.BRICK, seed, floorH: 3.9, bayW: 3.3, groundH: 5.2, lit, a: 1, tint });
    setBox(-423.4, -388, 627.6, 692.4, 19, brick(3.1, BRICKS[0]));
    setBox(-427.4, -388, 539.6, 604.4, 15, brick(5.2, BRICKS[2]));
    setBox(-423.4, -388, 451.6, 516.4, 23, { style: STYLE.CURTAIN, seed: 7.7, floorH: 4.1, bayW: 1.5, groundH: 5.6, lit: 0.5, a: 1, b: 0.4, tint: FRAMES[0], tint2: ACCENTS[4] });
    setBox(-492, -459.1, 626, 694, 9.4, brick(2.2, [0.20, 0.27, 0.22], 0.9));
    setBox(-492, -452.6, 538, 606, 13, brick(9.4, BRICKS[1]));
    setBox(-492, -452.6, 450, 518, 13, brick(6.6, BRICKS[3]));
    const sfm = createFacadeMaterial(); inner.add(new THREE.Mesh(sg.build(), sfm.material)); updaters.push(() => { sfm.uniforms.uTime.value = app.time; });
    // the brick street itself
    const ld = new THREE.TextureLoader(), bt = (f, srgb) => { const t = ld.load(f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16 / 2.6, 276 / 2.6); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const bmap = bt('/assets/tex/brick_pavement_02_diff.jpg', true);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(16, 276).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: bmap, normalMap: bt('/assets/tex/brick_pavement_02_nor.jpg', false), color: 0x8f8f8f, roughness: 0.3, emissiveMap: bmap, emissive: 0xffc890, emissiveIntensity: 0.3 }));
    street.position.set(-440, PIKE.Y + 0.2, 574); street.layers.set(1); inner.add(street);
    const mk = createMarket(to, { core: true });
    inner.add(mk.group); glow.push(...mk.glow); updaters.push(() => mk.update(app.time));
    mk.group.remove(mk.far.points);
    const bayY = 0.4, wheelAt = [-325, 1370];      // the wheel's position in the map data
    mk.wheel.position.set(wheelAt[0], bayY + 4 + 26, wheelAt[1]); mk.wheel.rotation.y = pikeT.th + 0.2; scene.add(mk.wheel);
    mk.pier.position.set(wheelAt[0] + 700, bayY - MARKET_Y, wheelAt[1] - 772); scene.add(mk.pier);
    for (const b of tc) boxSegs(b, pikeT.toWorld);
    for (const o of to) { const [x, z] = pikeT.toWorld(o.x, o.z); obstacles.push({ x, z, r: o.r }); }
    const mv = (q) => { const [x, z] = pikeT.toWorld(q.x, q.z); const out = { ...q, x, z }; if (q.look) { const [lx, lz] = pikeT.toWorld(q.look[0], q.look[2]); out.look = [lx, q.look[1] - PIKE.Y + pikeY, lz]; } if (q.from) { const [fx, fz] = pikeT.toWorld(q.from[0], q.from[2]); out.from = [fx, q.from[1] - PIKE.Y + pikeY, fz]; } return out; };
    heroStops.push(...pike.stops.map(mv)); heroSources.push(...pike.sources.map(mv)); coffee = mv(pike.coffee);
    inSlow = (x, z) => { const [lx, lz] = pikeT.toLocal(x, z); return lx > PIKE.slow.x0 && lx < PIKE.slow.x1 && lz > PIKE.slow.z0 && lz < PIKE.slow.z1; };
  }
  if (needleAt) {
    const tc = [];
    const center = createCenter(tc, obstacles, { needle: needleAt, glass: glassAt, fountain: fountainAt, lamps: false, armory: false });
    center.group.position.y = needleY; scene.add(center.group); glow.push(...center.glow); updaters.push(() => center.update(app.time, app.camera.position));
    for (const b of tc) boxSegs(b);
    heroStops.push({ name: 'Space Needle', sub: '605 feet, built for the 1962 World’s Fair', x: needleAt[0] + 36, z: needleAt[1] + 30, look: [needleAt[0], needleY + 84, needleAt[1]], dist: 150, lift: -78, ascent: { x: needleAt[0], z: needleAt[1], base: needleY, top: needleY + 167 } },
      { name: 'Chihuly Garden and Glass', sub: 'Blown glass, lit from within, at the foot of the Needle', x: glassAt[0] + 20, z: glassAt[1], look: [glassAt[0], needleY + 3.5, glassAt[1]], dist: 26, lift: 0.5 });
  }
  // ================================================================ the Amazon Spheres: three glass domes of plants
  if (spheresB) {
    const [sx, sz] = centreOf(spheresB);
    // the domes sit in a row along the footprint's long axis
    let ax = 1, az = 0, far = 0;
    for (const p of spheresB.p) for (const q of spheresB.p) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > far) { far = d; ax = (p[0] - q[0]) / d; az = (p[1] - q[1]) / d; } }
    const baseY = Math.min(H(sx, sz), H(sx + ax * 22, sz + az * 22), H(sx - ax * 22, sz - az * 22));
    const lines = [], glass = [], leaves = [], gp = [], gc = [], gs = [], gph = [];
    const LEAF = [0x1f6a2c, 0x2f8a3a, 0x175224, 0x4a9a3a, 0x2a7a4a];
    for (const [off, R] of [[0, 19.5], [-23, 15.5], [23, 15.5]]) {
      const cx = sx + ax * off, cz = sz + az * off, cy = baseY + R * 0.42;
      const tri = new THREE.IcosahedronGeometry(R, R > 17 ? 3 : 2).attributes.position.array, cen = [], byEdge = new Map(), edgeList = [];
      const vk = (i) => `${tri[i].toFixed(2)},${tri[i + 1].toFixed(2)},${tri[i + 2].toFixed(2)}`;
      for (let f = 0; f < tri.length; f += 9) {
        const c = new THREE.Vector3((tri[f] + tri[f + 3] + tri[f + 6]) / 3, (tri[f + 1] + tri[f + 4] + tri[f + 7]) / 3, (tri[f + 2] + tri[f + 5] + tri[f + 8]) / 3).setLength(R); cen.push(c);
        const ks = [vk(f), vk(f + 3), vk(f + 6)];
        for (let e = 0; e < 3; e++) { const a = ks[e], b = ks[(e + 1) % 3], key2 = a < b ? a + '|' + b : b + '|' + a; if (byEdge.has(key2)) { const o = cen[byEdge.get(key2)]; edgeList.push(o.x, o.y, o.z, c.x, c.y, c.z); } else byEdge.set(key2, cen.length - 1); }
      }
      const edge = edgeList;
      for (let i = 0; i < edge.length; i += 6) { if (cy + edge[i + 1] < baseY - 0.3 && cy + edge[i + 4] < baseY - 0.3) continue; lines.push(cx + edge[i], cy + edge[i + 1], cz + edge[i + 2], cx + edge[i + 3], cy + edge[i + 4], cz + edge[i + 5]); }
      glass.push(new THREE.SphereGeometry(R * 0.99, 36, 22).translate(cx, cy, cz));
      for (let n = 0; n < 150; n++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * R * 0.7, y = baseY + 0.6 + Math.pow(r(), 2.2) * R * 0.85;
        if (Math.hypot(d, y - cy) > R * 0.86) continue;
        leaves.push({ p: [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], s: 0.7 + r() * 1.3, c: LEAF[Math.floor(r() * LEAF.length)] });
      }
      for (let n = 0; n < 34; n++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * R * 0.7, y = baseY + 2 + r() * R * 0.9;
        if (Math.hypot(d, y - cy) > R * 0.85) continue;
        const pink = r() < 0.2;
        gp.push(cx + Math.cos(a) * d, y, cz + Math.sin(a) * d); gc.push(pink ? 2.6 : 2.4, pink ? 0.7 : 1.9, pink ? 1.8 : 1.1); gs.push(0.5 + r() * 0.5); gph.push(r());
      }
      obstacles.push({ x: cx, z: cz, r: R * 0.9 });
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const frame = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.7, 1.75, 1.8) })); frame.frustumCulled = false; scene.add(frame);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    leafMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.75) * 0.5;'); };
    leafMat.customProgramCacheKey = () => 'sphereLeaves2';
    const lm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leafMat, leaves.length), LM = new THREE.Matrix4(), LC = new THREE.Color();
    leaves.forEach((q, n) => { LM.makeScale(q.s, q.s * 0.8, q.s).setPosition(q.p[0], q.p[1], q.p[2]); lm.setMatrixAt(n, LM); lm.setColorAt(n, LC.setHex(q.c)); });
    lm.frustumCulled = false; scene.add(lm);
    const shell = new THREE.Mesh(mergeGeometries(glass), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(vec3(0.55, 0.85, 0.9) * (0.05 + 0.6 * f), 1.0); }',
    }));
    shell.frustumCulled = false; shell.renderOrder = 3; scene.add(shell);
    const grow = createGlowPoints(gp, gc, gs, gph, { twinkle: 0.1 }); scene.add(grow.points); glow.push(grow);
    const nr = nearRoad(sx, sz, 3);
    if (nr) heroStops.push({ name: 'The Spheres', sub: 'Three glass domes of cloud-forest plants at Amazon’s headquarters, opened in 2018', x: nr.x, z: nr.z, look: [sx, baseY + 9, sz], dist: 52, lift: 5 });
  }

  // ================================================================ famous shapes: MoPOP, the library, the arena roof, arches, artworks
  {
    const sam = nearRoad(-23, 1197, 3);
    let hammer = null;
    if (sam) { const dx = -23 - sam.x, dz = 1197 - sam.z, d = Math.hypot(dx, dz) || 1, k = sam.rd.hw + 2.4; hammer = [sam.x + dx / d * k, sam.z + dz / d * k, Math.atan2(-dx, -dz)]; obstacles.push({ x: hammer[0], z: hammer[1], r: 1.4 }); }
    // the gum wall stands on the kerb of the street nearest Post Alley
    const gr = nearRoad(-160, 1122, 3);
    let gum = null;
    if (gr) { const dx = -160 - gr.x, dz = 1122 - gr.z, d = Math.hypot(dx, dz) || 1, k = gr.rd.hw + 2.6; gum = { at: [gr.x + dx / d * k, gr.z + dz / d * k], th: Math.atan2(gr.s.bx - gr.s.ax, gr.s.bz - gr.s.az) }; }
    const icons = createIcons({ H, r, mopop: mopopB && mopopB.p, library: libraryB && libraryB.p, arena: arenaB && arenaB.p, science: scienceB && centreOf(scienceB),
      eagle: [-1312, 251], hammer, gum });
    iconSpots = { hammer, gum: gum && gum.at };
    scene.add(icons.group); glow.push(...icons.glow); updaters.push(() => icons.update(app.time));
    obstacles.push({ x: -1312, z: 251, r: 3 });
    for (const [b, name, sub, dist, up] of [[mopopB, 'MoPOP', 'Museum of Pop Culture, wrapped in crumpled metal', 70, 9], [libraryB, 'Seattle Central Library', 'Faceted glass and steel, opened in 2004', 80, 26]]) {
      if (!b) continue;
      for (let i = 0; i < b.p.length; i++) { const p = b.p[i], q = b.p[(i + 1) % b.p.length]; segs.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1] }); }
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of b.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      footprints.push({ x0, x1, z0, z1, p: b.p });
      const [cx, cz] = centreOf(b), nr = nearRoad(cx, cz, 4);
      if (nr && nr.x > B.x0 + 8 && nr.x < B.x1 - 8 && nr.z > B.z0 + 8 && nr.z < B.z1 - 8) heroStops.push({ name, sub, x: nr.x, z: nr.z, look: [cx, H(cx, cz) + up, cz], dist, lift: 4 });
    }
  }

  // names in lights on the famous fronts, and the holiday star
  {
    const wallSign = (lot, text, color, up, w) => {
      const d = lot.door, wx = d.x - d.nx * 2.4, wz = d.z - d.nz * 2.4, y = H(wx, wz) + up, tex = textTexture([[text, 150, 128]], color, 1024, 256);
      scene.add(signPlane(tex, w, w / 4, wx + d.nx * 0.35, y, wz + d.nz * 0.35, Math.atan2(d.nx, d.nz)));
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, w / 4 + 0.3, 0.2), darkMetal); back.position.set(wx + d.nx * 0.2, y, wz + d.nz * 0.2); back.rotation.y = Math.atan2(d.nx, d.nz); scene.add(back);
      return { wx, wz, y };
    };
    const find = (re) => lots.find(l => re.test(l.name));
    const m = find(/^MOHAI$/); if (m) { wallSign(m, 'MOHAI', '#ffd9a0', 9.5, 14); heroStops.push({ name: 'MOHAI', sub: 'Museum of History & Industry, in the old Naval Reserve Armory', x: m.door.x + m.door.nx * 14, z: m.door.z + m.door.nz * 14, look: [m.x0, H(m.x0, m.z0) + 6, m.z0], dist: 46, lift: 1 }); }
    const wc = find(/^Westlake Center$/); if (wc) wallSign(wc, 'WESTLAKE CENTER', '#7fd4ff', 13, 26);
    const pp = find(/^Pacific Place$/); if (pp) wallSign(pp, 'PACIFIC PLACE', '#ffd35a', 13, 24);
    const nd = find(/^Nordstrom$/);
    if (nd) {
      const at = wallSign(nd, 'NORDSTROM', '#ffffff', 12, 20), d = nd.door, tx = d.nz, tz = -d.nx;
      const sp = [], scol = [], ss = [], sph = [], R1 = 6.5, R2 = 2.7, v = [];
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283 - Math.PI / 2, rr = i % 2 ? R2 : R1; v.push([Math.cos(a) * rr, -Math.sin(a) * rr]); }
      for (let i = 0; i < 10; i++) { const A = v[i], Bq = v[(i + 1) % 10]; for (let t = 0; t < 1; t += 0.085) { const u = A[0] + (Bq[0] - A[0]) * t, w = A[1] + (Bq[1] - A[1]) * t; sp.push(at.wx + d.nx * 0.5 + tx * u, at.y + 12 + w, at.wz + d.nz * 0.5 + tz * u); scol.push(3.0, 2.3, 1.2); ss.push(0.34); sph.push(r()); } }
      const star = createGlowPoints(sp, scol, ss, sph, { twinkle: 0.35 }); scene.add(star.points); glow.push(star);
    }
  }
  // a floating dock off the park for the over-the-water throw
  let dock = null;
  {
    const lakeN = lakes.findIndex(ring => ring.length > 100), cwb = data.buildings.find(b => /Center for Wooden Boats|MOHAI|Naval Reserve Armory/.test(b.n));
    if (lakeN >= 0 && cwb) {
      const [cx, cz] = centreOf(cwb);
      search: for (let rad = 20; rad < 260; rad += 12) for (let a = 0; a < 6.28; a += 0.3) {
        const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
        if (!inWater(x, z) || inBuilding(x, z)) continue;
        for (let b = 0; b < 6.28; b += 0.4) {
          // a spot on dry land 11 m away, beside a street, with open water for the dock itself
          const sx = x + Math.cos(b) * 11, sz = z + Math.sin(b) * 11, nr = nearRoad(sx, sz, 2);
          if (inWater(sx, sz) || inBuilding(sx, sz) || !nr || nr.d > 30 || !inWater(x - Math.cos(b) * 4, z - Math.sin(b) * 4)) continue;
          dock = { x, z, y: waterY[lakeN] + 0.55, stand: { x: sx, z: sz } };
          break search;
        }
      }
      if (dock) {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 7), new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.7, emissive: 0x3a2814, emissiveIntensity: 0.7 }));
        deck.position.set(dock.x, dock.y - 0.27, dock.z); scene.add(deck);
        const dp = [], dc = [], ds = [], dph = [];
        for (const [ox, oz] of [[-3.3, -3.3], [3.3, -3.3], [3.3, 3.3], [-3.3, 3.3]]) { dp.push(dock.x + ox, dock.y + 0.9, dock.z + oz); dc.push(1.2, 2.4, 3.2); ds.push(0.5); dph.push(ox + oz); }
        const dl = createGlowPoints(dp, dc, ds, dph, { twinkle: 0.3 }); scene.add(dl.points); glow.push(dl);
      }
    }
  }

  const mono = (data.monorail || []).slice().sort((a, b) => b.length - a.length)[0];
  if (mono) {
    const js = [...junctionR].map(([k, R]) => [...k.split(',').map(Number), R]);
    const rail = railRef = createMonorail(obstacles, { pts: mono, heightAt: H, inJunction: (x, z) => js.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2] + 9) });
    scene.add(rail.group); updaters.push((dt) => rail.update(dt));
  }

  // ================================================================ parked cars along the wider streets
  // (never on the streetcar tracks)
  const nearTram = (x, z) => (data.tram || []).some((line) => { for (let i = 1; i < line.length; i++) { const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < 3.4) return true; } return false; });
  {
    const spots = [];
    roads.forEach((rd, ri) => {
      if (rd.kind.endsWith('_link') || rd.kind === 'pedestrian' || rd.bridge || rd.len < 50) return;
      // room for a parking lane beside moving traffic: wide two-way streets, or any one-way street
      if (!(rd.oneway ? rd.hw >= 4.5 : rd.hw >= 6)) return;
      for (const side of [-1, 1]) for (let d = 16; d < rd.len - 16; d += 6.1) {
        // cars come in runs with gaps between them
        const busy = Math.abs(Math.sin((Math.floor(d / 42) + ri * 7.3 + side) * 12.9898) * 43758.5453) % 1 < 0.5;
        if (r() > (busy ? 0.58 : 0.05)) continue;
        let i = 1; while (i < rd.pts.length - 1 && rd.v[i] < d) i++;
        const a = rd.pts[i - 1], b = rd.pts[i], t = (d - rd.v[i - 1]) / (rd.v[i] - rd.v[i - 1] || 1);
        if (rd.dJ[i - 1] + (rd.dJ[i] - rd.dJ[i - 1]) * t < 13) continue;
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l, nx = -fz, nz = fx;
        const off = rd.hw - 1.25, x = a[0] + dx * t + nx * side * off, z = a[1] + dz * t + nz * side * off;
        if (x < B.x0 + 10 || x > B.x1 - 10 || z < B.z0 + 10 || z > B.z1 - 10 || inSet(x, z, 8) || inWater(x, z) || nearTram(x, z)) continue;
        const h = Math.atan2(fz, fx) + (side < 0 && !rd.oneway ? Math.PI : 0), cx = Math.cos(h), cz = Math.sin(h);
        spots.push({ x, z, y: H(x, z) + 0.1, h, pitch: Math.atan((H(x + cx * 1.4, z + cz * 1.4) - H(x - cx * 1.4, z - cz * 1.4)) / 2.8), kind: Math.floor(r() * CAR_KINDS) % CAR_KINDS, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
        // a low box the van bumps into; the camera ignores it
        const c = [[2.35, 0.98], [2.35, -0.98], [-2.35, -0.98], [-2.35, 0.98]].map(([u, w]) => [x + cx * u - cz * w, z + cz * u + cx * w]);
        for (let k = 0; k < 4; k++) segs.push({ ax: c[k][0], az: c[k][1], bx: c[(k + 1) % 4][0], bz: c[(k + 1) % 4][1], low: true });
      }
    });
    const PM = new THREE.Matrix4(), PQ = new THREE.Quaternion(), PQ2 = new THREE.Quaternion(), PV = new THREE.Vector3(), PS = new THREE.Vector3(1, 1, 1), PC = new THREE.Color();
    const shMat = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85 }), shGeo = new THREE.PlaneGeometry(5.6, 2.9).rotateX(-Math.PI / 2);
    const mat = (q, lift) => { PQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -q.h).multiply(PQ2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), q.pitch)); return PM.compose(PV.set(q.x, q.y + lift, q.z), PQ, PS); };
    for (const list of byChunk(spots)) {
      const objs = [];
      for (let k = 0; k < CAR_KINDS; k++) {
        const sub = list.filter(q => q.kind === k); if (!sub.length) continue;
        const set = makeCarSet(k, sub.length, false);
        sub.forEach((q, n) => { set.setMatrixAt(n, mat(q, 0)); set.body.setColorAt(n, PC.setHex(q.color)); });
        scene.add(...set.all); objs.push(...set.all);
      }
      const sh = new THREE.InstancedMesh(shGeo, shMat, list.length);
      list.forEach((q, n) => sh.setMatrixAt(n, mat(q, 0.03)));
      sh.layers.set(1); sh.renderOrder = 2; scene.add(sh); objs.push(sh);
      registerChunk(list, objs, 300);
    }
    parkedCount = spots.length;
  }

  // ================================================================ neon blade signs on the shopfronts
  {
    const WORDS = [['COFFEE', '#ff9a3c'], ['PHO', '#ff3b5c'], ['BAR', '#35d6ff'], ['RAMEN', '#ff4d2e'], ['BOOKS', '#ffd35a'], ['TACOS', '#59ff8f'], ['BAKERY', '#ffb7e0'], ['TERIYAKI', '#ff5a36'],
      ['POKE', '#4fe3ff'], ['PIZZA', '#ff6a3d'], ['VINYL', '#c58bff'], ['ESPRESSO', '#ffb056'], ['THAI', '#7dffb0'], ['DELI', '#fff07a'], ['OYSTERS', '#7fd4ff'], ['BREWERY', '#ffc247'], ['SUSHI', '#ff8fa3'], ['BAGELS', '#ffe08a']];
    const neon = (text, color) => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 60 + text.length * 118;
      const x = c.getContext('2d');
      x.fillStyle = '#06070a'; x.fillRect(0, 0, c.width, c.height);
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 104px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      const draw = () => { for (let i = 0; i < text.length; i++) x.fillText(text[i], c.width / 2, 92 + i * 118); };
      x.shadowColor = color; x.fillStyle = color; for (const bl of [44, 22, 10]) { x.shadowBlur = bl; draw(); }
      x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,0.9)'; x.globalAlpha = 0.75; draw(); x.globalAlpha = 1;
      x.strokeStyle = color; x.lineWidth = 5; x.shadowColor = color; x.shadowBlur = 16; x.beginPath(); x.roundRect(12, 12, c.width - 24, c.height - 24, 18); x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return { tex: t, aspect: c.width / c.height };
    };
    const faces = WORDS.map(() => []), backs = [];
    let n = 0;
    for (const L of lots) {
      if (r() > 0.42 || /MOHAI|Westlake Center|Pacific Place|Nordstrom/.test(L.name)) continue;
      const wi = n++ % WORDS.length, d = L.door, hgt = Math.min(4.6, 1.0 + WORDS[wi][0].length * 0.62), w = hgt * 160 / (60 + WORDS[wi][0].length * 118);
      const shift = (r() < 0.5 ? -1 : 1) * (3 + r() * 3), wx = d.x - d.nx * 2.4 + d.nz * shift, wz = d.z - d.nz * 2.4 - d.nx * shift;
      const cx = wx + d.nx * (w / 2 + 0.35), cz = wz + d.nz * (w / 2 + 0.35), y = H(wx, wz) + 6.4 + r() * 1.6, a = Math.atan2(-d.nz, d.nx);
      for (const sgn of [0, Math.PI]) faces[wi].push(new THREE.PlaneGeometry(w, hgt).rotateY(a + sgn).translate(cx + Math.sin(a + sgn) * 0.13, y, cz + Math.cos(a + sgn) * 0.13));
      backs.push(new THREE.BoxGeometry(w + 0.1, hgt + 0.1, 0.24).rotateY(a).translate(cx, y, cz), new THREE.BoxGeometry(w + 0.7, 0.08, 0.08).rotateY(a).translate(cx - d.nx * 0.3, y + hgt * 0.3, cz - d.nz * 0.3));
    }
    WORDS.forEach(([word, color], i) => { if (!faces[i].length) return; const m = new THREE.Mesh(mergeGeometries(faces[i]), new THREE.MeshBasicMaterial({ map: neon(word, color).tex, color: new THREE.Color(2.4, 2.4, 2.4) })); m.frustumCulled = false; scene.add(m); });
    if (backs.length) { const bm = new THREE.Mesh(mergeGeometries(backs), darkMetal); bm.frustumCulled = false; scene.add(bm); }
    signCount = n;
  }

  const fm = createFacadeMaterial();
  const bmesh = new THREE.Mesh(g.build(), fm.material); bmesh.frustumCulled = false;
  scene.add(bmesh);
  updaters.push(() => { fm.uniforms.uTime.value = app.time; });
  // wall segments in a grid for collision
  const SC = 40, segHash = new Map();
  for (const s of segs) {
    for (let cxk = Math.floor(Math.min(s.ax, s.bx) / SC); cxk <= Math.floor(Math.max(s.ax, s.bx) / SC); cxk++) for (let czk = Math.floor(Math.min(s.az, s.bz) / SC); czk <= Math.floor(Math.max(s.az, s.bz) / SC); czk++) {
      const k = `${cxk},${czk}`; if (!segHash.has(k)) segHash.set(k, []); segHash.get(k).push(s);
    }
  }

  // ================================================================ street lamps and trees along the real kerbs
  const sites = [], treeSpots = [];
  roads.forEach((rd) => {
    if (rd.kind.endsWith('_link') || rd.kind === 'pedestrian' || rd.bridge || rd.len < 30) return;
    let side = r() < 0.5 ? 1 : -1;
    for (let d = 14; d < rd.len - 10; d += 14) {
      let i = 1; while (i < rd.pts.length - 1 && rd.v[i] < d) i++;
      const a = rd.pts[i - 1], b = rd.pts[i], t = (d - rd.v[i - 1]) / (rd.v[i] - rd.v[i - 1] || 1);
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      const px = a[0] + dx * t, pz = a[1] + dz * t, dj = rd.dJ[i - 1] + (rd.dJ[i] - rd.dJ[i - 1]) * t;
      if (dj < 9) continue;
      const isLamp = Math.round(d / 14) % 2 === 0;
      const off = rd.hw + (isLamp ? 0.9 : 1.9), x = px + nx * side * off, z = pz + nz * side * off;
      if (x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1 || inWater(x, z) || inBuilding(x, z) || inSet(x, z, -20)) continue;
      const other = nearRoad(x, z); if (other && other.rd !== rd && other.d < other.rd.hw + 0.5) continue;
      if (isLamp) { sites.push({ x, z, y: H(x, z) - 0.16, dirX: -nx * side, dirZ: -nz * side }); side = -side; }
      else if (r() < 0.32) treeSpots.push([x, z, H(x, z)]);
    }
  });
  const lamps = buildLamps(sites, obstacles); scene.add(lamps.group); glow.push(lamps.halo);
  const trees = buildTrees(treeSpots, obstacles); scene.add(trees.group); glow.push(trees.lights);
  // bake the lamp light into a top-down texture the ground reads
  const LT = 1024, lc = document.createElement('canvas'); lc.width = lc.height = LT;
  const lx = lc.getContext('2d'); lx.fillStyle = '#000'; lx.fillRect(0, 0, LT, LT);
  const sx = LT / (B.x1 - B.x0), sz = LT / (B.z1 - B.z0);
  // green channel: where the parks are
  lx.fillStyle = 'rgb(0,255,0)';
  for (const pk of data.parks) { if (pk.p.length < 3) continue; lx.beginPath(); pk.p.forEach(([x, z], i) => (i ? lx.lineTo((x - B.x0) * sx, (z - B.z0) * sz) : lx.moveTo((x - B.x0) * sx, (z - B.z0) * sz))); lx.fill(); }
  lx.globalCompositeOperation = 'lighter';
  for (const s of sites) {
    const hx = (s.x + s.dirX * 2.15 - B.x0) * sx, hz = (s.z + s.dirZ * 2.15 - B.z0) * sz, rad = 19 * sx;
    const grad = lx.createRadialGradient(hx, hz, 0, hx, hz, rad);
    grad.addColorStop(0, 'rgba(255,0,0,0.62)'); grad.addColorStop(0.35, 'rgba(255,0,0,0.22)'); grad.addColorStop(1, 'rgba(255,0,0,0)');
    lx.fillStyle = grad; lx.beginPath(); lx.ellipse(hx, hz, rad, 19 * sz, 0, 0, 7); lx.fill();
  }
  const lightTex = new THREE.CanvasTexture(lc); lightTex.flipY = false; lightTex.minFilter = THREE.LinearFilter; lightTex.generateMipmaps = false;
  ground.uniforms.tLight.value = lightTex; ground.uniforms.uLightRect.value.set(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);

  if (beacons.length) { const bp = createGlowPoints(beacons.flat(), beacons.flatMap(() => [8, 0.4, 0.25]), beacons.map(() => 1.4), beacons.map((_, i) => i * 0.21), { blink: 1, fogK: 0.4 }); scene.add(bp.points); glow.push(bp); }
  const rain = createRain(); scene.add(rain.lines);

  // ================================================================ routing over the real street graph
  const nodes = new Map();
  const node = (k) => { if (!nodes.has(k)) { const [x, z] = k.split(',').map(Number); nodes.set(k, { k, x, z, e: [] }); } return nodes.get(k); };
  roads.forEach((rd) => { for (let i = 1; i < rd.nodes.length; i++) { const A = node(rd.nodes[i - 1].k), Bn = node(rd.nodes[i].k), d = rd.v[rd.nodes[i].i] - rd.v[rd.nodes[i - 1].i]; A.e.push([Bn, d]); if (!rd.oneway) Bn.e.push([A, d]); else Bn.e.push([A, d * 3]); } });
  const ends = (hit) => {
    const rd = hit.rd, at = rd.v[hit.s.i - 1] + (rd.v[hit.s.i] - rd.v[hit.s.i - 1]) * hit.t, out = [];
    let before = null, after = null;
    for (const n of rd.nodes) { if (rd.v[n.i] <= at) before = n; else if (!after) after = n; }
    if (before) out.push([nodes.get(before.k), at - rd.v[before.i]]);
    if (after) out.push([nodes.get(after.k), rd.v[after.i] - at]);
    return out;
  };
  function route(ax, az, bx, bz) {
    const A = nearRoad(ax, az, 3), Bh = nearRoad(bx, bz, 3);
    if (!A || !Bh) return [[ax, az], [bx, bz]];
    const out = [[ax, az], [A.x, A.z]];
    if (A.rd !== Bh.rd || Math.hypot(A.x - Bh.x, A.z - Bh.z) > 300) {
      const dist = new Map(), prev = new Map(), open = new Set();
      for (const [n, d] of ends(A)) if (n) { dist.set(n, d); open.add(n); }
      const goal = new Map(ends(Bh).filter(q => q[0]));
      let end = null, bestD = 1e9;
      while (open.size) {
        let u = null; for (const n of open) if (!u || dist.get(n) < dist.get(u)) u = n;
        open.delete(u);
        if (dist.get(u) > bestD) break;
        if (goal.has(u) && dist.get(u) + goal.get(u) < bestD) { bestD = dist.get(u) + goal.get(u); end = u; }
        for (const [v, w] of u.e) { const nd = dist.get(u) + w; if (nd < (dist.get(v) ?? 1e9)) { dist.set(v, nd); prev.set(v, u); open.add(v); } }
      }
      const chain = []; for (let n = end; n; n = prev.get(n)) chain.unshift(n);
      for (const n of chain) out.push([n.x, n.z]);
    }
    out.push([Bh.x, Bh.z], [bx, bz]);
    return out;
  }
  const streetName = (x, z) => {
    const a = nearRoad(x, z);
    if (!a || a.d > a.rd.hw + 4) return a && a.d < 30 ? `Near ${a.rd.name || 'the street'}` : 'South Lake Union';
    let other = null;
    for (const s of rgrid.get(`${Math.floor(x / RC)},${Math.floor(z / RC)}`) || []) { const rd = roads[s.ri]; if (rd.name && rd.name !== a.rd.name && Math.hypot((s.ax + s.bx) / 2 - x, (s.az + s.bz) / 2 - z) < rd.hw + 9) { other = rd.name; break; } }
    return other && a.rd.name ? `${a.rd.name} & ${other}` : a.rd.name || other || 'Side street';
  };
  const nearestRoad = (x, z) => { const a = nearRoad(x, z, 4); if (!a) return { x: 0, z: 0, h: -Math.PI / 2 }; const h = Math.atan2(a.s.bz - a.s.az, a.s.bx - a.s.ax); return { x: a.x - Math.sin(h) * 1.8, z: a.z + Math.cos(h) * 1.8, h }; };
  const inBounds = (x, z) => x > B.x0 + 4 && x < B.x1 - 4 && z > B.z0 + 4 && z < B.z1 - 4 && !inWater(x, z);
  const districtOf = (x, z) => (pikeT && inSet(x, z, 40) ? 'pike' : needleAt && Math.hypot(x - needleAt[0], z - needleAt[1]) < 420 ? 'center' : z > 330 ? 'downtown' : z > 60 && x < -260 ? 'belltown' : 'slu');
  setMap({ inBounds, route, district: districtOf, heightAt: H });
  // keep the chase camera on the street side of walls: pull it in to the first wall between it and the van
  const camClip = (from, to) => {
    let best = 1; const dx = to.x - from.x, dz = to.z - from.z;
    const seen = new Set();
    for (let k = 0; k <= 3; k++) {
      const key2 = `${Math.floor((from.x + dx * k / 3) / SC)},${Math.floor((from.z + dz * k / 3) / SC)}`; if (seen.has(key2)) continue; seen.add(key2);
      for (const sg3 of segHash.get(key2) || []) {
        const ex = sg3.bx - sg3.ax, ez = sg3.bz - sg3.az, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-6) continue;
        const t = ((sg3.ax - from.x) * ez - (sg3.az - from.z) * ex) / den, u = ((sg3.ax - from.x) * dz - (sg3.az - from.z) * dx) / den;
        if (!sg3.low && t > 0.02 && t < best && u >= 0 && u <= 1) best = t;
      }
    }
    if (best < 1) { const t = Math.max(0.12, best - 0.08); to.x = from.x + dx * t; to.z = from.z + dz * t; }
  };

  // ================================================================ traffic signals where the bigger streets meet
  const incidentRoads = new Map();
  roads.forEach((rd) => rd.nodes.forEach((n) => { if (!incidentRoads.has(n.k)) incidentRoads.set(n.k, []); incidentRoads.get(n.k).push({ rd, i: n.i }); }));
  const signalAt = new Map();      // junction key -> { axisX: boolean per approach is derived from heading }
  {
    const frame = [], lens = { a: { r: [], y: [], g: [] }, b: { r: [], y: [], g: [] } };
    const head = (x, y, z, ry, set) => {
      frame.push(new THREE.BoxGeometry(0.36, 1.08, 0.3).rotateY(ry).translate(x, y, z));
      const fx = Math.sin(ry) * 0.16, fz = Math.cos(ry) * 0.16;
      for (const [c, dy] of [['r', 0.34], ['y', 0], ['g', -0.34]]) set[c].push(new THREE.CircleGeometry(0.115, 10).rotateY(ry).translate(x + fx, y + dy, z + fz));
    };
    for (const [k, list] of incidentRoads) {
      const big = list.filter(q => q.rd.w >= 11 && !q.rd.kind.endsWith('_link'));
      if (big.length < 2 || new Set(big.map(q => q.rd.name)).size < 2) continue;
      const [jx, jz] = k.split(',').map(Number), R = junctionR.get(k) || 7;
      if (inSet(jx, jz, 10) || jx < B.x0 + 20 || jx > B.x1 - 20 || jz < B.z0 + 20 || jz > B.z1 - 20) continue;
      signalAt.set(k, true);
      for (const q of list) for (const dir of [-1, 1]) {
        const j = q.i + dir; if (j < 0 || j >= q.rd.pts.length) continue;
        // a pole on the near-right corner for traffic arriving along this arm
        const ax = q.rd.pts[j][0] - jx, az = q.rd.pts[j][1] - jz, l = Math.hypot(ax, az) || 1, ux = ax / l, uz = az / l;
        const px = jx + ux * (R + 1.5) + uz * (q.rd.hw + 0.9), pz = jz + uz * (R + 1.5) - ux * (q.rd.hw + 0.9), py = H(px, pz);
        if (inBuilding(px, pz)) continue;
        const ry = Math.atan2(ux, uz);       // lamp faces back down the arm, toward arriving traffic
        frame.push(new THREE.CylinderGeometry(0.09, 0.13, 5.2, 7).translate(px, py + 2.6, pz));
        head(px - uz * 0.35, py + 4.4, pz + ux * 0.35, ry, Math.abs(ux) > Math.abs(uz) ? lens.b : lens.a);
        obstacles.push({ x: px, z: pz, r: 0.22 });
      }
    }
    const flatG = (l) => mergeGeometries(l.map(q => { const n = q.index ? q.toNonIndexed() : q; n.deleteAttribute('uv'); return n; }));
    if (frame.length) {
      const fmesh = new THREE.Mesh(flatG(frame), darkMetal); fmesh.frustumCulled = false; scene.add(fmesh);
      const COL = { r: [14, 0.5, 0.35], y: [12, 6.5, 0.5], g: [0.5, 11, 5.5] }, mats = {};
      for (const d of ['a', 'b']) for (const c of ['r', 'y', 'g']) { const m = new THREE.MeshBasicMaterial({ color: 0 }); mats[d + c] = m; if (lens[d][c].length) { const me = new THREE.Mesh(flatG(lens[d][c]), m); me.frustumCulled = false; scene.add(me); } }
      let last = -1;
      updaters.push(() => {
        const t = app.time % 24, ph = t < 10 ? 0 : t < 12 ? 1 : t < 22 ? 2 : 3; signalPhase = ph;
        if (ph === last) return; last = ph;
        const set = (d, on) => { for (const c of ['r', 'y', 'g']) { const kc = COL[c], f = c === on ? 1 : 0.012; mats[d + c].color.setRGB(kc[0] * f, kc[1] * f, kc[2] * f); } };
        set('a', ph === 0 ? 'g' : ph === 1 ? 'y' : 'r'); set('b', ph === 2 ? 'g' : ph === 3 ? 'y' : 'r');
      });
    }
  }
  let signalPhase = 0;

  // ================================================================ the streetcar on its real line
  const tramLine = (data.tram || []).slice().sort((a, b) => b.length - a.length)[0];
  const tram = { x: 1e5, z: 1e5, dir: 1, v: 0 };
  if (tramLine && tramLine.length > 4) {
    const car = createStreetcar(); scene.add(car.group);
    const tv = [0]; for (let i = 1; i < tramLine.length; i++) tv.push(tv[i - 1] + Math.hypot(tramLine[i][0] - tramLine[i - 1][0], tramLine[i][1] - tramLine[i - 1][1]));
    const total = tv[tv.length - 1], st = { s: total * 0.3, dir: 1, wait: 0, v: 0 }, bumpers = [-7, 0, 7].map(() => ({ x: 0, z: 0, r: 1.5 }));
    obstacles.push(...bumpers);
    updaters.push((dt) => {
      if (st.wait > 0) { st.wait -= dt; st.v = Math.max(0, st.v - 5 * dt); }
      else { const lead = st.dir > 0 ? total - 12 - st.s : st.s - 12; st.v += THREE.MathUtils.clamp(Math.min(9, Math.sqrt(Math.max(0, 2.6 * lead)) + 0.3) - st.v, -3 * dt, 1.5 * dt); st.s += st.dir * st.v * dt; if (lead < 0.5) { st.dir *= -1; st.wait = 6; } }
      let i = 1; while (i < tramLine.length - 1 && tv[i] < st.s) i++;
      const a = tramLine[i - 1], b = tramLine[i], t = (st.s - tv[i - 1]) / (tv[i] - tv[i - 1] || 1), h = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      car.group.position.set(x, H(x, z) + 0.12, z); car.group.rotation.y = -(st.dir > 0 ? h : h + Math.PI);
      bumpers.forEach((o, n) => { const d = (n - 1) * 7; o.x = x + Math.cos(h) * d; o.z = z + Math.sin(h) * d; });
      tram.x = x; tram.z = z; tram.v = st.v; tram.dir = st.dir; tram.h = st.dir > 0 ? h : h + Math.PI; tram.vx = Math.cos(tram.h) * st.v; tram.vz = Math.sin(tram.h) * st.v;
    });
  }

  // ================================================================ boats with lights at the wooden-boat docks
  {
    const cwb = data.buildings.find(b => /Center for Wooden Boats/.test(b.n));
    if (cwb) {
      const [bx, bz] = centreOf(cwb), lakeN = lakes.findIndex(ring => ring.length > 100), wy = lakeN >= 0 ? waterY[lakeN] : 0;
      const hullShape = new THREE.Shape(); hullShape.moveTo(-5, 0); hullShape.quadraticCurveTo(-5.2, 1.3, -4.2, 1.4); hullShape.lineTo(3.2, 1.4); hullShape.quadraticCurveTo(5.4, 1.2, 6.2, 0); hullShape.quadraticCurveTo(2, -0.9, -5, 0);
      const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 2.2, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.6, bevelSegments: 3 }).translate(0, 0, -1.1).rotateY(-Math.PI / 2);
      const hullMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2d3d, roughness: 0.35, clearcoat: 0.8 });
      const lp = [], lcol = [], ls = [], lph = [], masts = [];
      let placed = 0;
      for (let n = 0; n < 80 && placed < 12; n++) {
        const x = bx + (r() - 0.5) * 220, z = bz + (r() - 0.5) * 160;
        if (!inWater(x, z) || inBuilding(x, z) || !inWater(x + 7, z) || !inWater(x - 7, z) || !inWater(x, z + 7) || !inWater(x, z - 7)) continue;
        placed++;
        const ry = r() * 6.28, sc = 0.8 + r() * 0.6, mh = 9 + r() * 6;
        const hull = new THREE.Mesh(hullGeo, hullMat); hull.position.set(x, wy - 0.25, z); hull.rotation.y = ry; hull.scale.setScalar(sc); scene.add(hull);
        masts.push(new THREE.CylinderGeometry(0.06, 0.09, mh * sc, 6).translate(x, wy + 1.2 + mh * sc / 2, z));
        const col = [[1.0, 0.72, 0.36], [0.4, 0.8, 1.0], [1.0, 0.3, 0.35], [0.4, 1.0, 0.6]][placed % 4];
        for (const end of [6, -5]) for (let k = 0; k <= 14; k++) { const t = k / 14, lxp = x + Math.sin(ry) * end * sc * (1 - t), lzp = z + Math.cos(ry) * end * sc * (1 - t); lp.push(lxp, wy + 1.4 + mh * sc * t - Math.sin(t * Math.PI) * 0.5, lzp); lcol.push(col[0] * 3, col[1] * 3, col[2] * 3); ls.push(0.16); lph.push(r()); }
      }
      if (masts.length) { scene.add(new THREE.Mesh(mergeGeometries(masts), darkMetal)); const bl = createGlowPoints(lp, lcol, ls, lph, { twinkle: 0.2 }); scene.add(bl.points); glow.push(bl); }
    }
  }

  // open ground: clear of every street (by `need` metres beyond the kerb) and of every building
  const offRoad = (x, z, need) => { const nr = nearRoad(x, z, 2); return (!nr || nr.d - nr.rd.hw > need) && !inBuilding(x, z) && !inWater(x, z); };
  const freeSpot = (cx, cz, r0, r1, need) => { for (let rad = r0; rad <= r1; rad += 3) for (let k = 0; k < 12; k++) { const a = k * 0.5236 + rad, x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad; if (offRoad(x, z, need)) return [x, z]; if (rad === 0) break; } return null; };

  // ================================================================ the holiday tree in Westlake Park
  {
    const wp = data.parks.find(q => /Westlake Park/.test(q.n));
    const mid = wp ? centreOf(wp) : [71, 799], at = freeSpot(mid[0], mid[1], 0, 45, 6.5) || mid;      // streets cut through the park: keep the tree off them
    treeAt = at;
    const retail = createRetailCore(obstacles, [], { tree: at });
    scene.add(retail.group); glow.push(...retail.glow);
    heroStops.push({ name: 'Westlake Park', sub: 'The holiday tree at the heart of the retail core', x: at[0] + 16, z: at[1] + 14, look: [at[0], H(at[0], at[1]) + 9, at[1]], dist: 30, lift: -4 });
  }

  // ================================================================ street-level scenes at the Needle, MOHAI and Westlake Park
  {
    const waterSpot = (cx, cz, clear) => {
      for (let rad = 0; rad < 240; rad += 14) for (let a = 0; a < 6.28; a += 0.35) {
        const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
        if ([[0, 0], [clear, 0], [-clear, 0], [0, clear], [0, -clear]].every(([ox, oz]) => inWater(x + ox, z + oz) && !inBuilding(x + ox, z + oz)) && !(dock && Math.hypot(x - dock.x, z - dock.z) < clear + 8)) return [x, z];
      }
      return null;
    };
    const mLot = lots.find(l => l.name === 'MOHAI'), ken = data.buildings.find(b => /Kenmore Air/.test(b.n));
    const scenes = createScenes({ H, r, clear: offRoad, free: freeSpot, needle: needleAt, mohai: mLot && { x: mLot.door.x, z: mLot.door.z, nx: mLot.door.nx, nz: mLot.door.nz }, waterSpot,
      waterLevel: (x, z) => { const n = lakes.findIndex(ring => inPoly(x, z, ring)); return n >= 0 ? waterY[n] : 0; }, seaplane: ken && centreOf(ken), tree: treeAt });
    scene.add(scenes.group); glow.push(...scenes.glow); obstacles.push(...scenes.obstacles); updaters.push(() => scenes.update(app.time));
  }

  const start0 = [-17, -70];
  // ================================================================ traffic: a bubble of cars around the van
  const incident = new Map();
  roads.forEach((rd) => rd.nodes.forEach((n) => { if (!incident.has(n.k)) incident.set(n.k, []); incident.get(n.k).push({ rd, i: n.i }); }));
  const drivable = roads.filter(rd => !rd.kind.endsWith('_link') && rd.kind !== 'pedestrian' && rd.len > 45 && !rd.bridge);
  const cars = [], NCAR = 34, carGroup = new THREE.Group();
  const place = (c, fx, fz, first) => {
    for (let n = 0; n < 40; n++) {
      const rd = drivable[Math.floor(Math.random() * drivable.length)], s = rd.len * (0.15 + Math.random() * 0.7);
      let i = 1; while (i < rd.pts.length - 1 && rd.v[i] < s) i++;
      const d = Math.hypot(rd.pts[i][0] - fx, rd.pts[i][1] - fz);
      if ((d > (first ? 40 : 170) && d < 420) || n === 39) { c.rd = rd; c.s = s; c.i = i; c.dir = rd.oneway ? 1 : (Math.random() < 0.5 ? 1 : -1); c.v = 6; c.snap = true; return; }
    }
  };
  for (let n = 0; n < NCAR; n++) { const c = { kind: n % CAR_KINDS, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)], cruise: 8 + r() * 3.5, x: 0, z: 0, h: 0, y: 0, v: 6, near: null, collider: { x0: 0, x1: 0, z0: 0, z1: 0, low: true, moving: true } }; place(c, start0[0], start0[1], true); cars.push(c); colliders.push(c.collider); }
  const sets = Array.from({ length: CAR_KINDS }, (_, k) => { const list = cars.filter(c => c.kind === k), set = makeCarSet(k, list.length, true, true), C0 = new THREE.Color(); list.forEach((c, n) => { set.body.setColorAt(n, C0.setHex(c.color)); set.tail.setColorAt(n, C0.setRGB(3, 0.08, 0.05)); }); carGroup.add(...set.all); return { list, set }; });
  scene.add(carGroup);
  const CM = new THREE.Matrix4(), CQ = new THREE.Quaternion(), CV = new THREE.Vector3(), CS = new THREE.Vector3(1, 1, 1), CUP = new THREE.Vector3(0, 1, 0), CZA = new THREE.Vector3(0, 0, 1), CQ2 = new THREE.Quaternion(), tevents = [];
  const trafficUpdate = (dt, van) => {
    tevents.length = 0;
    for (const c of cars) {
      const rd = c.rd;
      if (Math.hypot(c.x - van.pos.x, c.z - van.pos.z) > 520 && !c.snap) place(c, van.pos.x, van.pos.z, false);
      // the junction ahead on this road
      let ahead = null; for (const n of c.rd.nodes) { const d = (c.rd.v[n.i] - c.s) * c.dir; if (d > 0.01 && (!ahead || d < ahead.d)) ahead = { n, d }; }
      let target = c.cruise; if (ahead && ahead.d < 16) target = Math.min(target, 3.5 + ahead.d * 0.45);
      if (ahead && ahead.d < 40 && signalAt.has(ahead.n.k)) {
        // green for east-west arms in phase 2, for north-south arms in phase 0; stop at the line otherwise
        const ew = Math.abs(Math.cos(c.h)) > Math.abs(Math.sin(c.h)), go = ew ? signalPhase === 2 : signalPhase === 0;
        const stopD = ahead.d - (junctionR.get(ahead.n.k) || 7) - 6;
        if (!go && stopD > -2) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 4.5 * (stopD - 0.3))));
      }
      const fx = Math.cos(c.h), fz = Math.sin(c.h);
      let gap = 1e9;
      for (const o of cars) { if (o === c) continue; const rx = o.x - c.x, rz = o.z - c.z, a = rx * fx + rz * fz; if (a > 0 && a < 30 && Math.abs(-rx * fz + rz * fx) < 1.9) gap = Math.min(gap, a - 5.2); }
      { const rx = van.pos.x - c.x, rz = van.pos.z - c.z, a = rx * fx + rz * fz; if (a > 0 && a < 30 && Math.abs(-rx * fz + rz * fx) < 2.3) gap = Math.min(gap, a - 5.6); }
      if (gap < 30) target = Math.min(target, Math.max(0, gap) * 0.9);
      if (c.stun > 0) { c.stun -= dt; target = 0; }
      c.braking = target < c.v - 0.5 || (c.v < 0.4 && target < 0.4);
      c.v += THREE.MathUtils.clamp(target - c.v, -9 * dt, 3.2 * dt); if (c.v < 0.05 && target <= 0) c.v = 0;
      const move = c.v * dt;
      if (ahead && move >= ahead.d) {
        // at the junction: carry on, or turn onto one of the roads that meet here
        const opts = [];
        for (const q of incident.get(ahead.n.k) || []) {
          if (q.i < q.rd.pts.length - 1 && !(q.rd === c.rd && c.dir < 0)) opts.push([q, 1, q.rd === c.rd ? 4 : 1.5]);
          if (q.i > 0 && !q.rd.oneway && !(q.rd === c.rd && c.dir > 0)) opts.push([q, -1, q.rd === c.rd ? 4 : 1.5]);
        }
        const ok = opts.filter(o => o[0].rd.kind !== 'pedestrian' && !o[0].rd.kind.endsWith('_link'));
        if (!ok.length) { if (!c.rd.oneway) c.dir = -c.dir; else place(c, van.pos.x, van.pos.z, false); }
        else { let pk = Math.random() * ok.reduce((a, o) => a + o[2], 0), o = ok[0]; for (const q of ok) { pk -= q[2]; if (pk <= 0) { o = q; break; } } c.rd = o[0].rd; c.dir = o[1]; c.s = o[0].rd.v[o[0].i] + o[1] * 0.05; c.i = Math.max(1, o[0].i); }
      } else c.s += c.dir * move;
      if (c.s <= 0 || c.s >= c.rd.len) { if (!c.rd.oneway) { c.dir = -c.dir; c.s = Math.max(0.1, Math.min(c.rd.len - 0.1, c.s)); } else place(c, van.pos.x, van.pos.z, false); }
      const R2 = c.rd; let i = Math.max(1, Math.min(R2.pts.length - 1, c.i || 1)); while (i < R2.pts.length - 1 && R2.v[i] < c.s) i++; while (i > 1 && R2.v[i - 1] > c.s) i--; c.i = i;
      const a = R2.pts[i - 1], b = R2.pts[i], t = (c.s - R2.v[i - 1]) / (R2.v[i] - R2.v[i - 1] || 1), dx = (b[0] - a[0]) * c.dir, dz = (b[1] - a[1]) * c.dir, l = Math.hypot(dx, dz) || 1;
      const off = R2.oneway ? 0 : Math.min(R2.hw * 0.45, 3.2), wantH = Math.atan2(dz, dx);
      const tx = a[0] + (b[0] - a[0]) * t - (dz / l) * off, tz = a[1] + (b[1] - a[1]) * t + (dx / l) * off;
      if (c.snap) { c.x = tx; c.z = tz; c.h = wantH; c.snap = false; }
      else { const k = Math.min(1, dt * 6); c.x += (tx - c.x) * k; c.z += (tz - c.z) * k; let dh = wantH - c.h; dh = ((dh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; c.h += dh * Math.min(1, dt * 7); }
      const ex = Math.abs(Math.cos(c.h)) * 2.35 + Math.abs(Math.sin(c.h)) * 0.98, ez = Math.abs(Math.sin(c.h)) * 2.35 + Math.abs(Math.cos(c.h)) * 0.98, cb = c.collider;
      cb.x0 = c.x - ex; cb.x1 = c.x + ex; cb.z0 = c.z - ez; cb.z1 = c.z + ez;
      const dist = Math.hypot(van.pos.x - c.x, van.pos.z - c.z), rel = Math.hypot(van.vel.x - fx * c.v, van.vel.y - fz * c.v);
      if (dist < 4.4 && rel > 8 && van.speed > 9) { if (!c.near) c.near = { min: dist, hit: false }; else c.near.min = Math.min(c.near.min, dist); }
      if (c.near && dist > 7.5) { if (!c.near.hit && van.impact <= 0.01) tevents.push({ type: 'nearmiss', car: c, min: c.near.min }); c.near = null; }
      if (c.near && van.impact > 0.05) c.near.hit = true;
    }
    const C1 = new THREE.Color();
    for (const st of sets) { st.list.forEach((c, n) => { const kx = Math.cos(c.h), kz = Math.sin(c.h); c.y = H(c.x, c.z) + 0.1; CQ.setFromAxisAngle(CUP, -c.h); CQ.multiply(CQ2.setFromAxisAngle(CZA, Math.atan((H(c.x + kx * 1.4, c.z + kz * 1.4) - H(c.x - kx * 1.4, c.z - kz * 1.4)) / 2.8))); CM.compose(CV.set(c.x, c.y, c.z), CQ, CS); st.set.setMatrixAt(n, CM); st.set.tail.setColorAt(n, c.braking ? C1.setRGB(14, 0.35, 0.2) : C1.setRGB(3.2, 0.08, 0.05)); }); st.set.commit(); if (st.set.tail.instanceColor) st.set.tail.instanceColor.needsUpdate = true; }
    return tevents;
  };
  const bump = (x, z) => { let best = null, bd = 5.5; for (const c of cars) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } } if (best) { best.stun = 1.6; best.v = 0; if (best.near) best.near.hit = true; } return best; };

  // ================================================================ pedestrians along the real kerbs
  const pedPaths = [];
  for (const rd of data.roads) {
    if (rd.k.endsWith('_link') || rd.p.length < 2 || rd.br) continue;
    const side = (sg2) => rd.p.map((q, i) => { const a = rd.p[Math.max(0, i - 1)], b = rd.p[Math.min(rd.p.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [q[0] - (b[1] - a[1]) / l * sg2 * (rd.w / 2 + 2.3), q[1] + (b[0] - a[0]) / l * sg2 * (rd.w / 2 + 2.3)]; });
    const len = rd.p.reduce((a, q, i) => a + (i ? Math.hypot(q[0] - rd.p[i - 1][0], q[1] - rd.p[i - 1][1]) : 0), 0);
    if (len < 50) continue;
    pedPaths.push({ pts: [...side(1), ...side(-1).reverse()], w: len });
  }
  const peds = createPedestrians(520, { paths: pedPaths, y: (x, z) => H(x, z) + 0.05 }); scene.add(peds.group);

  // ================================================================ what the game needs to know
  const startRoad = roads.filter(rd => rd.name === 'Westlake Avenue North').map(rd => rd.pts[Math.floor(rd.pts.length / 2)]).sort((p, q) => Math.hypot(p[0] + 17, p[1] + 70) - Math.hypot(q[0] + 17, q[1] + 70))[0] || [0, 0];
  const st = nearRoad(startRoad[0], startRoad[1], 2);
  const sh = st ? Math.atan2(st.s.bz - st.s.az, st.s.bx - st.s.ax) : -Math.PI / 2, north = Math.sin(sh) < 0 ? sh : sh + Math.PI;
  const start = [startRoad[0] - Math.sin(north) * 2.0, startRoad[1] + Math.cos(north) * 2.0, north];
  const named = (re) => data.buildings.find(b => re.test(b.n));
  const centre = (b) => { let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } return [x / b.p.length, z / b.p.length]; };
  // places you discover by driving past them
  const pois = [
    [/Center for Wooden Boats/, 'Center for Wooden Boats', 'Historic boats on Lake Union'], [/Kenmore Air/, 'Kenmore Air', 'Seaplanes off the lake'],
    [/Amazon Day 1/, 'Amazon Day 1', 'The headquarters tower beside the Spheres'], [/Amazon Doppler/, 'Amazon Doppler', 'The first of the downtown Amazon towers'],
    [/^Google$/, 'Google', 'The South Lake Union campus'], [/Allen Institute/, 'Allen Institute', 'Brain science on Mercer St'],
    [/MoPOP/, 'MoPOP', 'Museum of Pop Culture', 75], [/Climate Pledge Arena/, 'Climate Pledge Arena', 'Home of the Kraken and the Storm', 95], [/Pacific Science Center/, 'Pacific Science Center', 'The arches from the 1962 World’s Fair', 75],
    [/Seattle Center Armory/, 'Seattle Center Armory', 'The food hall at Seattle Center', 70], [/Paramount Theatre/, 'Paramount Theatre', 'A 1928 movie palace'], [/Benaroya Hall/, 'Benaroya Hall', 'Home of the Seattle Symphony', 65],
    [/Central Library/, 'Seattle Central Library', 'Glass and steel, opened in 2004', 65], [/^Rainier Tower$/, 'Rainier Tower', 'The tower on a pedestal'],
    [/^Westlake Center$/, 'Westlake Center', 'Heart of the retail core'], [/^Pacific Place$/, 'Pacific Place', 'Downtown shopping'], [/^Nordstrom$/, 'Nordstrom', 'The flagship store'],
  ].map(([re, name, sub, rad]) => { const b = named(re); if (!b) return null; const [x, z] = centre(b); return { name, sub, x, z, r: rad || 55 }; }).filter(Boolean);
  // places the baked map has no named building for; positions looked up in OpenStreetMap
  for (const [name, sub, x, z, rad] of [
    ['Seattle Art Museum', 'Modern and Native American art on 1st Ave', -23, 1197, 60], ['Gum Wall', 'Post Alley, under the market', -160, 1122, 40],
    ['Olympic Sculpture Park', 'Sculpture above the bay in Belltown', -1312, 251, 90], ['Seattle Aquarium', 'Pier 59 on the waterfront', -359, 1179, 80],
    ['Great Wheel', 'The ferris wheel on Pier 57', -325, 1370, 95], ['International Fountain', 'The dome and its jets at Seattle Center', -1034, -439, 60],
    ['REI', 'The flagship store', 635, -193, 70],
  ]) if (x > B.x0 - 60 && x < B.x1 + 60 && z > B.z0 - 60 && z < B.z1 + 60) pois.push({ name, sub, x, z, r: rad });
  if (mono) { const q = mono[Math.floor(mono.length / 2)]; pois.push({ name: 'Seattle Center Monorail', sub: 'Built for the 1962 World’s Fair', x: q[0], z: q[1], r: 45 }); }
  for (const [re, sub] of [[/^Denny Park$/, 'Seattle’s oldest park'], [/Victor Steinbrueck Park/, 'Overlooking Elliott Bay, beside the market']]) { const pk = data.parks.find(q => re.test(q.n)); if (pk) { const [x, z] = centre(pk); pois.push({ name: pk.n, sub, x, z, r: 60 }); } }
  // every postcard stop sits in the kerb lane of the nearest street, so it can always be driven to
  for (const q of heroStops) {
    const nr = nearRoad(q.x, q.z, 4); if (!nr) continue;
    const dx = q.look[0] - nr.x, dz = q.look[2] - nr.z, d = Math.hypot(dx, dz) || 1, k = Math.max(0, nr.rd.hw - 2.4);
    q.x = nr.x + dx / d * k; q.z = nr.z + dz / d * k;
  }
  // a landmark with a postcard stop is listed once, as the stop
  for (let i = pois.length - 1; i >= 0; i--) if (heroStops.some(q => q.name === pois[i].name)) pois.splice(i, 1);
  // every landmark must be discoverable from the nearest street
  for (const q of pois) { const nr = nearRoad(q.x, q.z, 4); if (nr) q.r = Math.max(q.r, Math.hypot(nr.x - q.x, nr.z - q.z) + 25); }
  const wf = nearRoad(-25, 45, 3);
  const sources = [...(wf ? [{ name: 'Whole Foods Market', x: wf.x, z: wf.z, cargo: 'GROCERIES', rule: { fragile: 8.5, gentle: true } }] : []), ...heroSources];
  const coffeeSpots = []; for (let n = 0; n < 60 && coffeeSpots.length < 26; n++) { const rd = roads[Math.floor(r() * roads.length)]; if (rd.len < 60 || rd.kind.endsWith('_link')) continue; const p = rd.pts[Math.floor(rd.pts.length * (0.3 + r() * 0.4))]; if (p[0] > B.x0 + 30 && p[0] < B.x1 - 30 && p[1] > B.z0 + 30 && p[1] < B.z1 - 30) coffeeSpots.push(p); }

  const drawMap = (c, X, Z, k) => {
    c.fillStyle = 'rgba(40,110,150,0.55)';
    for (const ring of lakes) { c.beginPath(); ring.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.fill(); }
    c.fillStyle = 'rgba(40,110,70,0.45)';
    for (const pk of data.parks) { c.beginPath(); pk.p.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.fill(); }
    c.strokeStyle = 'rgba(190,210,230,0.5)'; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const rd of data.roads) { c.lineWidth = Math.max(1.5, rd.w * k); c.beginPath(); rd.p.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); }
  };

  // a few real lights that follow the van between the nearest lamps
  const pool = [];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffb066, 0, 26, 1.6); scene.add(l); pool.push(l); }
  const heads = sites.map(s => new THREE.Vector3(s.x + s.dirX * 2.15, s.y + 8.26, s.z + s.dirZ * 2.15)), tmp = [];
  const updateLampPool = (f) => {
    tmp.length = 0;
    for (const h of heads) { const dx = h.x - f.x, dz = h.z - f.z; if (dx > 30 || dx < -30 || dz > 30 || dz < -30) continue; tmp.push([dx * dx + dz * dz, h]); }
    tmp.sort((a, b) => a[0] - b[0]);
    pool.forEach((l, i) => { if (tmp[i]) { l.position.copy(tmp[i][1]); l.intensity = 260; } else l.intensity = 0; });
  };
  updaters.push(() => {
    const t = app.time, cp = app.camera.position;
    rain.uniforms.uTime.value = t;
    const dk = app.detail ?? 1;      // main.js lowers this on slow machines
    for (const c of chunks) { const rg = c.range * dk, vis = (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2 < rg * rg; for (const o of c.objs) o.visible = vis; }
    peds.group.visible = dk > 0.7;
    const sc = renderer.domElement.height * app.camera.projectionMatrix.elements[5] * 0.5;
    for (const gl of glow) { gl.uniforms.uTime.value = t; gl.uniforms.uScale.value = sc; }
  });

  const far = { x: 1e5, z: 1e5 };
  app.world = {
    real: true, colliders, obstacles, segHash, segCell: SC, rain, updateLampPool, camClip, heightAt: H, dock, inWater,
    waterLevel: (x, z) => { const n = lakes.findIndex(ring => inPoly(x, z, ring)); return n >= 0 ? waterY[n] : 0; },
    buildings: { lots }, streetcar: { state: tram },
    traffic: { cars, update: trafficUpdate, bump }, peds,
    pike: { sources: [], stops: [], coffee }, inSlow,
    // the monorail, for racing it: a start gate on the street by each end of the line
    monorail: railRef && { state: railRef.state, total: railRef.total, gates: railRef.ends.map(([x, z]) => { const nr = nearRoad(x, z, 4); return nr ? { x: nr.x, z: nr.z } : { x, z }; }) },
    start, pois, sources, stops: heroStops, coffeeSpots, streetName, nearestRoad, drawMap, credit: data.credit,
    stats: { roads: roads.length, buildings: data.buildings.length, named: lots.length, lamps: sites.length, trees: treeSpots.length, parked: parkedCount, signs: signCount, iconSpots },
  };
  app.updateWorld = (dt) => { for (const u of updaters) u(dt); };
  app.update = (dt) => app.updateWorld(dt);
  console.log('[dbg] real map', JSON.stringify(app.world.stats));
}
