import * as THREE from 'three';
import { FacadeGeo, STYLE, createFacadeMaterial } from '../world/facade.js';
import { buildLamps, buildTrees, createGlowPoints, chunks } from '../world/props.js';
import { createRain } from '../world/rain.js';
import { createLake } from '../world/landmarks.js';
import { rng } from '../world/buildings.js';
import { setMapOverride } from '../config.js';
import { createPikePlace, PIKE } from '../world/market.js';
import { createCenter, createMonorail } from '../world/districts.js';
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
  const updaters = [], glow = [], obstacles = [], colliders = [];

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
  const glassAt = needleAt && [needleAt[0] - 62, needleAt[1] + 52], fountainAt = needleAt && [needleAt[0] - 203, needleAt[1] - 221];
  const inSet = (x, z, m = 0) => { if (!pikeT) return false; const [lx, lz] = pikeT.toLocal(x, z); return lx > -498 - m && lx < -386 + m && lz > 438 - m && lz < 714 + m; };
  data.buildings = data.buildings.filter((b) => {
    const [x, z] = centreOf(b);
    if (needleAt && (b === needleB || Math.hypot(x - glassAt[0], z - glassAt[1]) < 30)) return false;
    return !inSet(x, z);
  });

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
  roads.forEach((rd, ri) => {
    const base = pos.length / 3, half = rd.hw + 0.3, y = 0.03 + (ri % 32) * 0.0008;
    rd.pts.forEach((p, i) => {
      const a = rd.pts[Math.max(0, i - 1)], b = rd.pts[Math.min(rd.pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      pos.push(p[0] - nx * half, y, p[1] - nz * half, p[0] + nx * half, y, p[1] + nz * half);
      uv.push(-half, rd.v[i], half, rd.v[i]);
      const kind = rd.hw > 6.9 ? 0 : 1;
      info.push(rd.hw, kind, rd.dJ[i], 0, rd.hw, kind, rd.dJ[i], 0);
      if (i) { const q = base + (i - 1) * 2; idx.push(q, q + 1, q + 3, q, q + 3, q + 2); }
    });
  });
  // a disc of plain asphalt over every junction hides the overlaps
  for (const [k, R] of junctionR) {
    const [x, z] = k.split(',').map(Number), base = pos.length / 3, rad = R + 0.6, N = 14;
    pos.push(x, 0.062, z); uv.push(0, 0); info.push(rad, 1, -1, 0);
    for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; pos.push(x + Math.cos(a) * rad, 0.062, z + Math.sin(a) * rad); uv.push(0, 0); info.push(rad, 1, -1, 0); if (i) idx.push(base, base + i + 1, base + i); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  roadGeo.setIndex(idx); roadGeo.computeVertexNormals();
  const roadMat = ground.mk(3); roadMat.side = THREE.DoubleSide;
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), ground.mk(4));
  const grounds = new THREE.Group();
  grounds.add(pave, roadMesh);
  for (const pk of data.parks) if (pk.p.length > 2) grounds.add(new THREE.Mesh(flatShape(pk.p, 0.015), ground.mk(5)));
  grounds.traverse(o => { o.layers.set(1); o.frustumCulled = false; });
  scene.add(grounds);

  // ================================================================ water: the real shoreline
  const lakes = data.water.filter(w => w.length > 3);
  for (const ring of lakes) {
    const lake = createLake(reflection, { geometry: flatShape(ring, 0.02) });
    lake.mesh.frustumCulled = false;
    scene.add(lake.mesh);
    updaters.push(() => { lake.uniforms.uTime.value = app.time; });
  }
  const inWater = (x, z) => lakes.some(ring => inPoly(x, z, ring));

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
    const H = b.h || (a > 2500 ? 26 + r() * 30 : a > 900 ? 13 + r() * 18 : 7 + r() * 8);
    const home = ['apartments', 'residential', 'hotel', 'dormitory'].includes(b.t), work = ['office', 'commercial'].includes(b.t), shop = ['retail', 'warehouse', 'industrial', 'church'].includes(b.t);
    let style;
    if (home) style = H > 32 ? STYLE.RESI : STYLE.BRICK;
    else if (work) style = r() < 0.75 ? STYLE.CURTAIN : STYLE.RIBBON;
    else if (shop) style = STYLE.BRICK;
    else style = H > 45 ? (r() < 0.6 ? STYLE.CURTAIN : STYLE.RESI) : H < 15 ? STYLE.BRICK : (r() < 0.6 ? STYLE.CURTAIN : r() < 0.5 ? STYLE.RIBBON : STYLE.BRICK);
    const gh = Math.min(H * 0.6, style === STYLE.RESI ? 4.6 : 5.4);
    const o = {
      style, seed: r() * 50, groundH: gh, lit: style === STYLE.RESI ? 0.36 : 0.5, a: r() < 0.6 ? 1 : 0, b: r(),
      floorH: style === STYLE.CURTAIN ? 4.1 : style === STYLE.BRICK ? 3.9 : style === STYLE.RIBBON ? 4.6 : 3.05,
      bayW: style === STYLE.CURTAIN ? 1.5 : style === STYLE.BRICK ? 3.3 : style === STYLE.RIBBON ? 1.6 : 3.4,
      tint: style === STYLE.BRICK ? pick(BRICKS) : style === STYLE.RIBBON ? pick(PANELS) : style === STYLE.RESI ? (r() < 0.5 ? [0.42, 0.42, 0.41] : [0.16, 0.165, 0.17]) : pick(FRAMES),
      tint2: pick(ACCENTS),
    };
    const ring = b.p;
    let door = null, doorLen = 0, cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      cx += p[0]; cz += p[1];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.3) continue;
      g.wall(p[0], p[1], q[0], q[1], 0, H, o);
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
      for (const [i0, i1, i2] of tris) g.tri(ring[i0], ring[i2], ring[i1], H, { style: STYLE.ROOF });
    } catch { /* a degenerate footprint: walls only */ }
    cx /= ring.length; cz /= ring.length;
    if (H > 70) beacons.push([cx, H + 3, cz]);
    if (b.n && door) lots.push({ name: b.n, door, type: 'office', district: 'slu', x0: cx, x1: cx, z0: cz, z1: cz, h: H });
  }
  // ================================================================ hero landmarks at their real addresses
  const boxSegs = (b, tf) => { const c = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].map(q => (tf ? tf(q[0], q[1]) : q)); for (let i = 0; i < 4; i++) segs.push({ ax: c[i][0], az: c[i][1], bx: c[(i + 1) % 4][0], bz: c[(i + 1) % 4][1] }); };
  const heroStops = [], heroSources = [];
  let coffee = { x: 1e5, z: 1e5 }, inSlow = () => false;
  if (pikeT) {
    const tc = [], to = [];
    const pike = createPikePlace(tc, to);
    const pivot = new THREE.Group(); pivot.position.set(pikeT.origin[0], -PIKE.Y, pikeT.origin[1]); pivot.rotation.y = pikeT.th;
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
    street.position.set(-440, PIKE.Y + 0.1, 574); street.layers.set(1); inner.add(street);
    for (const b of tc) boxSegs(b, pikeT.toWorld);
    for (const o of to) { const [x, z] = pikeT.toWorld(o.x, o.z); obstacles.push({ x, z, r: o.r }); }
    const mv = (q) => { const [x, z] = pikeT.toWorld(q.x, q.z); const out = { ...q, x, z }; if (q.look) { const [lx, lz] = pikeT.toWorld(q.look[0], q.look[2]); out.look = [lx, q.look[1] - PIKE.Y, lz]; } if (q.from) { const [fx, fz] = pikeT.toWorld(q.from[0], q.from[2]); out.from = [fx, q.from[1] - PIKE.Y, fz]; } return out; };
    heroStops.push(...pike.stops.map(mv)); heroSources.push(...pike.sources.map(mv)); coffee = mv(pike.coffee);
    inSlow = (x, z) => { const [lx, lz] = pikeT.toLocal(x, z); return lx > PIKE.slow.x0 && lx < PIKE.slow.x1 && lz > PIKE.slow.z0 && lz < PIKE.slow.z1; };
  }
  if (needleAt) {
    const tc = [];
    const center = createCenter(tc, obstacles, { needle: needleAt, glass: glassAt, fountain: fountainAt, lamps: false, armory: false });
    scene.add(center.group); glow.push(...center.glow); updaters.push(() => center.update(app.time, app.camera.position));
    for (const b of tc) boxSegs(b);
    heroStops.push({ name: 'Space Needle', sub: '605 feet, built for the 1962 World’s Fair', x: needleAt[0] + 36, z: needleAt[1] + 30, look: [needleAt[0], 84, needleAt[1]], dist: 150, lift: -78 },
      { name: 'Glass Garden', sub: 'Blown glass, lit from within', x: glassAt[0] + 20, z: glassAt[1], look: [glassAt[0], 3.5, glassAt[1]], dist: 26, lift: 0.5 });
  }
  const mono = (data.monorail || []).slice().sort((a, b) => b.length - a.length)[0];
  if (mono) {
    const js = [...junctionR].map(([k, R]) => [...k.split(',').map(Number), R]);
    const rail = createMonorail(obstacles, { pts: mono, inJunction: (x, z) => js.some(q => Math.hypot(q[0] - x, q[1] - z) < q[2] + 9) });
    scene.add(rail.group); updaters.push((dt) => rail.update(dt));
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
  const footprints = data.buildings.map(b => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of b.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1, p: b.p }; });
  const inBuilding = (x, z) => footprints.some(f => x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && inPoly(x, z, f.p));

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
      if (isLamp) { sites.push({ x, z, y: -0.16, dirX: -nx * side, dirZ: -nz * side }); side = -side; }
      else if (r() < 0.32) treeSpots.push([x, z, 0]);
    }
  });
  const lamps = buildLamps(sites, obstacles); scene.add(lamps.group); glow.push(lamps.halo);
  const trees = buildTrees(treeSpots, obstacles); scene.add(trees.group); glow.push(trees.lights);
  // bake the lamp light into a top-down texture the ground reads
  const LT = 1024, lc = document.createElement('canvas'); lc.width = lc.height = LT;
  const lx = lc.getContext('2d'); lx.fillStyle = '#000'; lx.fillRect(0, 0, LT, LT); lx.globalCompositeOperation = 'lighter';
  const sx = LT / (B.x1 - B.x0), sz = LT / (B.z1 - B.z0);
  for (const s of sites) {
    const hx = (s.x + s.dirX * 2.15 - B.x0) * sx, hz = (s.z + s.dirZ * 2.15 - B.z0) * sz, rad = 19 * sx;
    const grad = lx.createRadialGradient(hx, hz, 0, hx, hz, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.62)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.22)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    lx.fillStyle = grad; lx.beginPath(); lx.ellipse(hx, hz, rad, 19 * sz, 0, 0, 7); lx.fill();
  }
  const lightTex = new THREE.CanvasTexture(lc); lightTex.flipY = false; lightTex.minFilter = THREE.LinearFilter; lightTex.generateMipmaps = false;
  ground.uniforms.tLight.value = lightTex; ground.uniforms.uLightRect.value.set(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);

  if (beacons.length) { const bp = createGlowPoints(beacons.flat(), beacons.flatMap(() => [8, 0.4, 0.25]), beacons.map(() => 1.4), beacons.map((_, i) => i * 0.21), { blink: 1, fogK: 0.4 }); scene.add(bp.points); glow.push(bp); }
  const rain = createRain(); rain.uniforms.uLattice.value = 0; scene.add(rain.lines);

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
    return other ? `${a.rd.name || 'Street'} & ${other}` : a.rd.name || 'Street';
  };
  const nearestRoad = (x, z) => { const a = nearRoad(x, z, 4); if (!a) return { x: 0, z: 0, h: -Math.PI / 2 }; const h = Math.atan2(a.s.bz - a.s.az, a.s.bx - a.s.ax); return { x: a.x - Math.sin(h) * 1.8, z: a.z + Math.cos(h) * 1.8, h }; };
  const inBounds = (x, z) => x > B.x0 + 4 && x < B.x1 - 4 && z > B.z0 + 4 && z < B.z1 - 4 && !inWater(x, z);
  const districtOf = (x, z) => (pikeT && inSet(x, z, 40) ? 'pike' : needleAt && Math.hypot(x - needleAt[0], z - needleAt[1]) < 420 ? 'center' : z > 330 ? 'downtown' : z > 60 && x < -260 ? 'belltown' : 'slu');
  setMapOverride({ inBounds, route, district: districtOf });

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
  const CM = new THREE.Matrix4(), CQ = new THREE.Quaternion(), CV = new THREE.Vector3(), CS = new THREE.Vector3(1, 1, 1), CUP = new THREE.Vector3(0, 1, 0), tevents = [];
  const trafficUpdate = (dt, van) => {
    tevents.length = 0;
    for (const c of cars) {
      const rd = c.rd;
      if (Math.hypot(c.x - van.pos.x, c.z - van.pos.z) > 520 && !c.snap) place(c, van.pos.x, van.pos.z, false);
      // the junction ahead on this road
      let ahead = null; for (const n of c.rd.nodes) { const d = (c.rd.v[n.i] - c.s) * c.dir; if (d > 0.01 && (!ahead || d < ahead.d)) ahead = { n, d }; }
      let target = c.cruise; if (ahead && ahead.d < 16) target = Math.min(target, 3.5 + ahead.d * 0.45);
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
    for (const st of sets) { st.list.forEach((c, n) => { CQ.setFromAxisAngle(CUP, -c.h); CM.compose(CV.set(c.x, 0.03, c.z), CQ, CS); st.set.setMatrixAt(n, CM); st.set.tail.setColorAt(n, c.braking ? C1.setRGB(14, 0.35, 0.2) : C1.setRGB(3.2, 0.08, 0.05)); }); st.set.commit(); if (st.set.tail.instanceColor) st.set.tail.instanceColor.needsUpdate = true; }
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
  const peds = createPedestrians(520, { paths: pedPaths, y: 0 }); scene.add(peds.group);

  // ================================================================ what the game needs to know
  const startRoad = roads.filter(rd => rd.name === 'Westlake Avenue North').map(rd => rd.pts[Math.floor(rd.pts.length / 2)]).sort((p, q) => Math.hypot(p[0] + 17, p[1] + 70) - Math.hypot(q[0] + 17, q[1] + 70))[0] || [0, 0];
  const st = nearRoad(startRoad[0], startRoad[1], 2);
  const sh = st ? Math.atan2(st.s.bz - st.s.az, st.s.bx - st.s.ax) : -Math.PI / 2, north = Math.sin(sh) < 0 ? sh : sh + Math.PI;
  const start = [startRoad[0] - Math.sin(north) * 2.0, startRoad[1] + Math.cos(north) * 2.0, north];
  const named = (re) => data.buildings.find(b => re.test(b.n));
  const centre = (b) => { let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } return [x / b.p.length, z / b.p.length]; };
  const pois = [[/Naval Reserve Armory/, 'MOHAI', 'Museum of History & Industry, in the old Naval Reserve Armory'], [/Center for Wooden Boats/, 'Center for Wooden Boats', 'Historic boats on Lake Union'], [/Kenmore Air/, 'Kenmore Air', 'Seaplanes off the lake'], [/^REI$/, 'REI', 'The flagship store'], [/Amazon Fiona/, 'Amazon Fiona', 'One of the South Lake Union campus buildings'], [/Cascade People/, "Cascade People's Center", 'Cascade Playground']]
    .map(([re, name, sub]) => { const b = named(re); if (!b) return null; const [x, z] = centre(b); return { name, sub, x, z, r: 55 }; }).filter(Boolean);
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
  const heads = sites.map(s => new THREE.Vector3(s.x + s.dirX * 2.15, 8.1, s.z + s.dirZ * 2.15)), tmp = [];
  const updateLampPool = (f) => {
    tmp.length = 0;
    for (const h of heads) { const dx = h.x - f.x, dz = h.z - f.z; if (dx > 30 || dx < -30 || dz > 30 || dz < -30) continue; tmp.push([dx * dx + dz * dz, h]); }
    tmp.sort((a, b) => a[0] - b[0]);
    pool.forEach((l, i) => { if (tmp[i]) { l.position.copy(tmp[i][1]); l.intensity = 260; } else l.intensity = 0; });
  };
  updaters.push(() => {
    const t = app.time, cp = app.camera.position;
    rain.uniforms.uTime.value = t;
    for (const c of chunks) { const vis = (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2 < 440 * 440; for (const o of c.objs) o.visible = vis; }
    const sc = renderer.domElement.height * app.camera.projectionMatrix.elements[5] * 0.5;
    for (const gl of glow) { gl.uniforms.uTime.value = t; gl.uniforms.uScale.value = sc; }
  });

  const far = { x: 1e5, z: 1e5 };
  app.world = {
    real: true, colliders, obstacles, segHash, segCell: SC, rain, updateLampPool,
    buildings: { lots }, streetcar: { state: { x: 1e5, z: 1e5, dir: 1, v: 0 } },
    traffic: { cars, update: trafficUpdate, bump }, peds,
    pike: { sources: [], stops: [], coffee }, inSlow,
    start, pois, sources, stops: heroStops, coffeeSpots, streetName, nearestRoad, drawMap, credit: data.credit,
    stats: { roads: roads.length, buildings: data.buildings.length, named: lots.length, lamps: sites.length, trees: treeSpots.length },
  };
  app.updateWorld = (dt) => { for (const u of updaters) u(dt); };
  app.update = (dt) => app.updateWorld(dt);
  console.log('[dbg] real map', JSON.stringify(app.world.stats));
}
