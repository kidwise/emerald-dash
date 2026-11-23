import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityCells, CURB, Z_NORTH, LAKE_Z, HILL_Z, CAMPUS, heightAt } from '../config.js';
import { rng } from './buildings.js';

// People with umbrellas walking the sidewalks. They jump clear of the van; they are never hit.
const COATS = [0x2a2d33, 0x2f3a52, 0x4a443c, 0x555b63, 0x6a4a36, 0x2f4a3e, 0x7a2c30, 0x3a5580, 0x8a8278, 0xa58a52, 0x9aa3ad];
const BROLLIES = [0x0d0e10, 0x0d0e10, 0x16181c, 0xc22026, 0xe0b020, 0x1f8fa6, 0x2d5fb8, 0xd9d9d6, 0x7b2d86, 0x2f8f4e, 0xe2622a];

function closedPath(pts) {
  const segs = []; let total = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    segs.push({ a, b, len, start: total, h: Math.atan2(b[1] - a[1], b[0] - a[0]) }); total += len;
  }
  return { segs, total };
}
function at(path, s, out) {
  s = ((s % path.total) + path.total) % path.total;
  for (const g of path.segs) {
    if (s <= g.start + g.len) { const t = (s - g.start) / g.len; out.x = g.a[0] + (g.b[0] - g.a[0]) * t; out.z = g.a[1] + (g.b[1] - g.a[1]) * t; out.h = g.h; return; }
  }
}

// lower storeys are washed by lamps and shop light; give matte figures the same glow so they are not silhouettes
function washed(mat, k = 1.0) {
  mat.customProgramCacheKey = () => 'wash' + k;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.48) * ${k.toFixed(2)};`);
  };
  return mat;
}

export function createPedestrians(count = 260, custom = null) {
  const r = rng(8088);
  const paths = [];
  const rectPath = (x0, x1, z0, z1) => closedPath([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  for (const c of custom ? [] : cityCells()) {
    if (!['slu', 'sluW', 'downtown', 'outerE', 'outerS', 'market'].includes(c.kind)) continue;
    const R = c.roads;
    if (R.n && R.s && R.e && R.w && !c.cliff) {
      for (const inset of [2.5, 3.5]) paths.push({ p: rectPath(c.x0 + inset, c.x1 - inset, c.z0 + inset, c.z1 - inset), w: 6 });
      continue;
    }
    // partial blocks: stroll back and forth along whichever sides have a street
    const x0 = Math.max(c.x0, -540) + 6, x1 = Math.min(c.x1, 110) - 6, z0 = c.z0 + 6, z1 = Math.min(c.z1, 806) - 6;
    if (R.n && x1 - x0 > 20) paths.push({ p: closedPath([[x0, c.z0 + 3], [x1, c.z0 + 3]]), w: 2.5 });
    if (R.s && x1 - x0 > 20) { const z = c.cliff ? HILL_Z + 2.3 : c.z1 - 3; paths.push({ p: closedPath([[x0, z], [x1, z]]), w: 2.5 }); }
    if (R.w && z1 - z0 > 20) paths.push({ p: closedPath([[c.x0 + 3, z0], [c.x0 + 3, z1]]), w: 2.5 });
    if (R.e && z1 - z0 > 20) paths.push({ p: closedPath([[c.x1 - 3, z0], [c.x1 - 3, z1]]), w: 2.5 });
  }
  // the park and the Seattle Center campus
  paths.push({ p: rectPath(-3, 3, LAKE_Z + 12, Z_NORTH - 5), w: 7 });
  paths.push({ p: closedPath([[-170, LAKE_Z + 7], [170, LAKE_Z + 7], [170, LAKE_Z + 10], [-170, LAKE_Z + 10]]), w: 8 });
  paths.push({ p: rectPath(CAMPUS.x0 + 30, CAMPUS.x1 - 12, CAMPUS.z0 + 14, CAMPUS.z1 - 14), w: 12 });
  paths.push({ p: rectPath(CAMPUS.x0 + 70, CAMPUS.x1 - 50, CAMPUS.z0 + 50, CAMPUS.z1 - 60), w: 8 });
  if (custom) { paths.length = 0; for (const q of custom.paths) paths.push({ p: closedPath(q.pts), w: q.w }); }
  const wsum = paths.reduce((a, p) => a + p.w, 0);

  const peds = [];
  for (let n = 0; n < count; n++) {
    let pick = r() * wsum, path = paths[0].p;
    for (const p of paths) { pick -= p.w; if (pick <= 0) { path = p.p; break; } }
    peds.push({
      path, s: r() * path.total, dir: r() < 0.5 ? 1 : -1, speed: 1.05 + r() * 0.6, phase: r() * 6.28, h: 0,
      ox: 0, oz: 0, tx: 0, tz: 0, flee: 0, hop: 0, umbrella: r() < 0.72, scale: 0.92 + r() * 0.16, x: 0, z: 0,
      coat: COATS[Math.floor(r() * COATS.length)], brolly: BROLLIES[Math.floor(r() * BROLLIES.length)],
    });
  }

  // geometry: figure faces +x, feet at y = 0
  const torso = mergeGeometries([
    new THREE.CapsuleGeometry(0.19, 0.50, 4, 10).scale(0.82, 1, 1.22).translate(0, 1.16, 0),
    new THREE.SphereGeometry(0.125, 10, 8).translate(0.01, 1.70, 0),
    new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, 0.29),
    new THREE.CapsuleGeometry(0.055, 0.46, 3, 6).translate(0, 1.18, -0.29),
  ].map(g => g.index ? g.toNonIndexed() : g));
  const leg = new THREE.BoxGeometry(0.13, 0.86, 0.14).translate(0, -0.43, 0);
  const canopy = mergeGeometries([
    new THREE.SphereGeometry(0.66, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.44).scale(1, 0.5, 1).translate(0.06, 1.86, 0.16),
    new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5).translate(0.06, 1.68, 0.16),
  ].map(g => g.index ? g.toNonIndexed() : g));

  const coatMat = washed(new THREE.MeshStandardMaterial({ roughness: 0.75 }));
  const legMat = washed(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8 }), 0.8);
  const brollyMat = washed(new THREE.MeshStandardMaterial({ roughness: 0.3, side: THREE.DoubleSide }), 0.6);
  const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, count); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); return m; };
  const mTorso = mk(torso, coatMat), mLegL = mk(leg, legMat), mLegR = mk(leg, legMat), mCanopy = mk(canopy, brollyMat);
  const C = new THREE.Color();
  peds.forEach((p, n) => { mTorso.setColorAt(n, C.setHex(p.coat)); mCanopy.setColorAt(n, C.setHex(p.brolly)); });
  const group = new THREE.Group();
  group.add(mTorso, mLegL, mLegR, mCanopy);

  const P = { x: 0, z: 0, h: 0 };
  const M = new THREE.Matrix4(), ML = new THREE.Matrix4(), Q = new THREE.Quaternion(), QL = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), ZA = new THREE.Vector3(0, 0, 1), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const events = [];
  let scareCd = 0;

  function update(dt, van, time) {
    events.length = 0;
    scareCd -= dt;
    const vx = van.pos.x, vz = van.pos.z, vs = van.speed;
    peds.forEach((p, n) => {
      const fleeing = p.flee > 0;
      if (!fleeing) p.s += p.dir * p.speed * dt;
      at(p.path, p.s, P);
      let x = P.x + p.ox, z = P.z + p.oz;
      const dx = x - vx, dz = z - vz, d = Math.hypot(dx, dz) + 1e-4;

      // the van is coming: leap away from it
      const danger = vs > 3.5 && d < 3.6 + vs * 0.28 && (van.onKerb || d < 4.2 + vs * 0.1);
      if (danger && p.flee <= 0) {
        // jump sideways out of the van's path rather than along it
        const hx = Math.cos(van.heading), hz = Math.sin(van.heading);
        const side = (dx * -hz + dz * hx) >= 0 ? 1 : -1;
        p.tx = p.ox + (-hz * side * 2.6 + dx / d * 0.8); p.tz = p.oz + (hx * side * 2.6 + dz / d * 0.8);
        p.flee = 1.5; p.hop = 0.55; p.scared = false;
      }
      // a genuinely close shave costs the driver
      if (p.flee > 0 && !p.scared && d < 3.4 && vs > 4 && scareCd <= 0) { p.scared = true; scareCd = 2.5; events.push({ type: 'scare', x, z }); }
      if (p.flee > 0) {
        p.flee -= dt;
        const k = Math.min(1, dt * 7);
        p.ox += (p.tx - p.ox) * k; p.oz += (p.tz - p.oz) * k;
        if (p.flee <= 0) { p.tx = 0; p.tz = 0; }
      } else if (p.ox !== 0 || p.oz !== 0) {
        const k = Math.min(1, dt * 1.2);
        p.ox -= p.ox * k; p.oz -= p.oz * k;
        if (Math.abs(p.ox) + Math.abs(p.oz) < 0.01) { p.ox = 0; p.oz = 0; }
      }
      x = P.x + p.ox; z = P.z + p.oz;
      // hard guarantee: a figure is never inside the van
      const ddx = x - vx, ddz = z - vz, dd = Math.hypot(ddx, ddz) + 1e-4;
      if (dd < 2.2) { const push = 2.2 - dd; p.ox += ddx / dd * push; p.oz += ddz / dd * push; x += ddx / dd * push; z += ddz / dd * push; }
      p.x = x; p.z = z;

      const want = p.dir > 0 ? P.h : P.h + Math.PI;
      let dh = want - p.h; dh = ((dh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      p.h += dh * Math.min(1, dt * 5);
      let y = custom ? (typeof custom.y === 'function' ? custom.y(x, z) : custom.y) : heightAt(x, z) + CURB;
      if (p.hop > 0) { p.hop -= dt; y += Math.sin(Math.max(0, p.hop) / 0.55 * Math.PI) * 0.38; }
      const stride = fleeing ? 0 : Math.sin(time * p.speed * 5.2 + p.phase);
      y += Math.abs(stride) * 0.025;

      Q.setFromAxisAngle(UP, -p.h);
      S.setScalar(p.scale);
      M.compose(V.set(x, y, z), Q, S);
      mTorso.setMatrixAt(n, M);
      mCanopy.setMatrixAt(n, p.umbrella ? M : ZERO);
      for (const [mesh, sgn] of [[mLegL, 1], [mLegR, -1]]) {
        QL.setFromAxisAngle(ZA, stride * 0.40 * sgn + (fleeing ? 0.5 * sgn : 0));
        ML.compose(V.set(0, 0.86, 0.1 * sgn), QL, S.setScalar(1));
        ML.premultiply(M);
        mesh.setMatrixAt(n, ML);
      }
    });
    for (const m of [mTorso, mLegL, mLegR, mCanopy]) m.instanceMatrix.needsUpdate = true;
    return events;
  }
  update(0, { pos: new THREE.Vector3(1e4, 0, 1e4), speed: 0, heading: 0, onKerb: false }, 0);
  return { group, peds, update };
}
