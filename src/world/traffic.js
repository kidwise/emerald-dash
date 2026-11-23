import * as THREE from 'three';
import { AVENUES, STREETS } from '../config.js';
import { buildCarGeometries, carMaterials, shadowTex } from './props.js';
import { rng } from './buildings.js';

// Ambient traffic. Cars follow lanes around the street grid, obey the signals,
// queue behind each other, brake for the van and the streetcar, and pick a new turn at each junction.
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // N, E, S, W as (dx, dz)
const AVS = [...AVENUES].sort((a, b) => a.x - b.x);   // index i, west -> east
const NI = AVS.length, NJ = STREETS.length;           // streets: index j, south -> north
const CAR_COLORS = [0x0a0a0c, 0x1a1c20, 0x555a60, 0xa9aeb3, 0xdfe2e4, 0x8a1014, 0x10315e, 0x18382d, 0xb9862b, 0xc9c3b2, 0x5b2a6b];

const right = (d) => [-DIRS[d][1], DIRS[d][0]];
const alongZ = (d) => d === 0 || d === 2;
const nodeOk = (i, j) => i >= 0 && i < NI && j >= 0 && j < NJ;
const stepNode = (i, j, d) => d === 0 ? [i, j + 1] : d === 2 ? [i, j - 1] : d === 1 ? [i + 1, j] : [i - 1, j];
const crossHW = (i, j, d) => alongZ(d) ? STREETS[j].hw : AVS[i].hw;
// lane centre offset from the road's centre line
function laneOff(i, j, d, lane) {
  if (alongZ(d)) return AVS[i].x === 0 ? 1.9 : 2.9;
  return STREETS[j].hw > 9 ? (lane ? 5.4 : 1.9) : 2.4;
}
function exitPoint(i, j, d, lo) {
  const r = right(d), k = crossHW(i, j, d) + 2;
  return new THREE.Vector2(AVS[i].x + DIRS[d][0] * k + r[0] * lo, STREETS[j].z + DIRS[d][1] * k + r[1] * lo);
}
function stopPoint(i, j, d, lo) {
  const r = right(d), k = crossHW(i, j, d) + 8.6;
  return new THREE.Vector2(AVS[i].x - DIRS[d][0] * k + r[0] * lo, STREETS[j].z - DIRS[d][1] * k + r[1] * lo);
}

function lineSeg(p0, p1) { return { bez: false, p0, p1, len: Math.max(0.01, p0.distanceTo(p1)) }; }
function bezSeg(p0, c, p1) {
  let len = 0; const a = new THREE.Vector2(), b = p0.clone();
  for (let k = 1; k <= 10; k++) { const t = k / 10, u = 1 - t; a.set(u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y); len += a.distanceTo(b); b.copy(a); }
  return { bez: true, p0, c, p1, len };
}
function evalSeg(seg, s, out) {
  const t = Math.min(1, Math.max(0, s / seg.len));
  if (!seg.bez) { out.x = seg.p0.x + (seg.p1.x - seg.p0.x) * t; out.z = seg.p0.y + (seg.p1.y - seg.p0.y) * t; out.h = Math.atan2(seg.p1.y - seg.p0.y, seg.p1.x - seg.p0.x); return; }
  const u = 1 - t, { p0, c, p1 } = seg;
  out.x = u * u * p0.x + 2 * u * t * c.x + t * t * p1.x; out.z = u * u * p0.y + 2 * u * t * c.y + t * t * p1.y;
  out.h = Math.atan2(2 * u * (c.y - p0.y) + 2 * t * (p1.y - c.y), 2 * u * (c.x - p0.x) + 2 * t * (p1.x - c.x));
}

export function createTraffic(signals, streetcar, colliders, count = 24) {
  const r = rng(51515);
  const group = new THREE.Group();
  const kinds = [buildCarGeometries(0), buildCarGeometries(1)];
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(11, 10.5, 9) });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff });   // per-instance colour carries the brightness
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85 });

  const cars = [];
  for (let n = 0; n < count; n++) {
    // start somewhere along a random approach to a random junction
    let i, j, d, pi, pj;
    do { i = Math.floor(r() * NI); j = Math.floor(r() * NJ); d = Math.floor(r() * 4); [pi, pj] = stepNode(i, j, (d + 2) % 4); } while (!nodeOk(pi, pj));
    const lane = r() < 0.4 ? 1 : 0;
    const lo = laneOff(i, j, d, lane);
    const seg = lineSeg(exitPoint(pi, pj, d, lo), stopPoint(i, j, d, lo));
    cars.push({
      i, j, d, lane, seg, s: r() * seg.len, v: 6, cruise: 8.5 + r() * 3.5, crossing: false, nextD: d,
      x: 0, z: 0, h: 0, stuck: 0, ghost: 0, stun: 0, honk: 0, braking: false, kind: r() < 0.55 ? 0 : 1, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)],
      near: null, collider: { x0: 0, x1: 0, z0: 0, z1: 0, low: true, moving: true },
    });
  }
  // spread out cars that spawned on top of each other
  const P = { x: 0, z: 0, h: 0 };
  for (const c of cars) { evalSeg(c.seg, c.s, P); c.x = P.x; c.z = P.z; c.h = P.h; }
  for (let a = 0; a < cars.length; a++) for (let b = 0; b < a; b++) {
    if (Math.hypot(cars[a].x - cars[b].x, cars[a].z - cars[b].z) < 9) { cars[a].s = (cars[a].s + cars[a].seg.len * 0.5) % cars[a].seg.len; evalSeg(cars[a].seg, cars[a].s, P); cars[a].x = P.x; cars[a].z = P.z; }
  }

  // instanced meshes per body style
  const sets = kinds.map((G, k) => {
    const list = cars.filter(c => c.kind === k);
    const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); return m; };
    const body = mk(G.body, carMaterials.paint), cabin = mk(G.cabin, carMaterials.glass), wheels = mk(G.wheels, carMaterials.tyre), head = mk(G.headl, headMat), tail = mk(G.tail, tailMat);
    const col = new THREE.Color();
    list.forEach((c, n) => { body.setColorAt(n, col.setHex(c.color)); tail.setColorAt(n, col.setRGB(3, 0.08, 0.05)); });
    return { list, parts: [body, cabin, wheels, head, tail], tail };
  });
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(5.6, 2.9).rotateX(-Math.PI / 2), shadowMat, cars.length);
  shadows.layers.set(1); shadows.frustumCulled = false; shadows.renderOrder = 2; shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(shadows);
  for (const c of cars) colliders.push(c.collider);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
  const events = [];

  // how much clear road there is ahead of a car before the thing at (ox, oz)
  const gapTo = (c, fx, fz, ox, oz, halfWidth) => {
    const rx = ox - c.x, rz = oz - c.z;
    const ahead = rx * fx + rz * fz, lat = Math.abs(rx * -fz + rz * fx);
    return (ahead > 0 && lat < halfWidth) ? ahead : Infinity;
  };

  function update(dt, van) {
    events.length = 0;
    const phase = signals.state.phase;
    const tram = streetcar.state;
    for (const c of cars) {
      const fx = Math.cos(c.h), fz = Math.sin(c.h);
      let target = c.crossing && c.seg.bez ? 5.2 : c.cruise;
      const remaining = c.seg.len - c.s;

      // signals: stop at the line unless our axis has green (or we are too close to stop on amber)
      let mustStop = false;
      if (!c.crossing) {
        const green = alongZ(c.d) ? phase === 0 : phase === 2;
        const amber = alongZ(c.d) ? phase === 1 : phase === 3;
        mustStop = !(green || (amber && remaining < 5));
        if (mustStop) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 4.5 * (remaining - 0.3))));
      }

      // keep a gap to whatever is ahead: other cars, the streetcar, the van
      let gap = Infinity;
      if (c.ghost <= 0) for (const o of cars) if (o !== c) gap = Math.min(gap, gapTo(c, fx, fz, o.x, o.z, 1.9) - 5.2);
      for (const k of [-7, 0, 7]) gap = Math.min(gap, gapTo(c, fx, fz, tram.x, tram.z + k, 2.4) - 6.5);
      const vanGap = gapTo(c, fx, fz, van.pos.x, van.pos.z, 2.3) - 5.6;
      gap = Math.min(gap, vanGap);
      if (gap < 30) target = Math.min(target, Math.max(0, gap) * 0.9);
      if (vanGap < 2.5 && c.v < 1 && c.honk <= 0) { events.push({ type: 'honk', car: c }); c.honk = 4 + Math.random() * 4; }
      c.honk -= dt;

      if (c.stun > 0) { c.stun -= dt; target = 0; }
      const dv = target - c.v;
      c.braking = dv < -0.5 || (c.v < 0.4 && target < 0.4);
      c.v += THREE.MathUtils.clamp(dv, -9 * dt, 3.2 * dt);
      if (c.v < 0.05 && target <= 0) c.v = 0;
      c.s += c.v * dt;

      // gridlock breaker: if stopped for no good reason for a while, squeeze through
      if (c.v < 0.3 && !mustStop && c.stun <= 0 && vanGap > 3) c.stuck += dt; else c.stuck = 0;
      if (c.stuck > 6) { c.ghost = 2.5; c.stuck = 0; }
      if (c.ghost > 0) c.ghost -= dt;

      if (c.s >= c.seg.len) {
        if (!c.crossing) {
          if (mustStop) { c.s = c.seg.len; c.v = 0; }
          else {
            // choose straight / right / left from what the grid allows
            const opts = [];
            for (const [nd, w] of [[c.d, 5], [(c.d + 1) % 4, 2.5], [(c.d + 3) % 4, 2]]) { const [ni, nj] = stepNode(c.i, c.j, nd); if (nodeOk(ni, nj)) opts.push([nd, w]); }
            let pick = Math.random() * opts.reduce((a, o) => a + o[1], 0), nd = opts[0][0];
            for (const o of opts) { pick -= o[1]; if (pick <= 0) { nd = o[0]; break; } }
            c.nextD = nd; c.lane = Math.random() < 0.4 ? 1 : 0;
            const [ni, nj] = stepNode(c.i, c.j, nd);
            const p0 = c.seg.p1, p1 = exitPoint(c.i, c.j, nd, laneOff(ni, nj, nd, c.lane));
            c.seg = nd === c.d ? lineSeg(p0, p1) : bezSeg(p0, alongZ(c.d) ? new THREE.Vector2(p0.x, p1.y) : new THREE.Vector2(p1.x, p0.y), p1);
            c.s = 0; c.crossing = true;
          }
        } else {
          const [ni, nj] = stepNode(c.i, c.j, c.nextD);
          c.i = ni; c.j = nj; c.d = c.nextD;
          c.seg = lineSeg(c.seg.p1, stopPoint(ni, nj, c.d, laneOff(ni, nj, c.d, c.lane)));
          c.s = 0; c.crossing = false;
        }
      }
      evalSeg(c.seg, c.s, P);
      c.x = P.x; c.z = P.z;
      let dh = P.h - c.h; dh = ((dh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      c.h += dh * Math.min(1, dt * 10);

      const ex = Math.abs(Math.cos(c.h)) * 2.35 + Math.abs(Math.sin(c.h)) * 0.98, ez = Math.abs(Math.sin(c.h)) * 2.35 + Math.abs(Math.cos(c.h)) * 0.98;
      const b = c.collider; b.x0 = c.x - ex; b.x1 = c.x + ex; b.z0 = c.z - ez; b.z1 = c.z + ez;

      // near-miss tracking: a fast, close pass that does not end in a bump
      const dist = Math.hypot(van.pos.x - c.x, van.pos.z - c.z);
      const rel = Math.hypot(van.vel.x - fx * c.v, van.vel.y - fz * c.v);
      if (dist < 4.4 && rel > 8 && van.speed > 9) { if (!c.near) c.near = { min: dist, hit: false }; else c.near.min = Math.min(c.near.min, dist); }
      if (c.near && dist > 7.5) { if (!c.near.hit && van.impact <= 0.01) events.push({ type: 'nearmiss', car: c, min: c.near.min }); c.near = null; }
      if (c.near && van.impact > 0.05) c.near.hit = true;
    }

    // write instance transforms
    let si = 0;
    for (const set of sets) {
      set.list.forEach((c, n) => {
        Q.setFromAxisAngle(UP, -c.h);
        M.compose(V.set(c.x, 0, c.z), Q, S1);
        for (const p of set.parts) p.setMatrixAt(n, M);
        set.tail.setColorAt(n, c.braking ? C.setRGB(14, 0.35, 0.2) : C.setRGB(3.2, 0.08, 0.05));
      });
      for (const p of set.parts) p.instanceMatrix.needsUpdate = true;
      if (set.tail.instanceColor) set.tail.instanceColor.needsUpdate = true;
    }
    for (const c of cars) { Q.setFromAxisAngle(UP, -c.h); M.compose(V.set(c.x, 0.02, c.z), Q, S1); shadows.setMatrixAt(si++, M); }
    shadows.instanceMatrix.needsUpdate = true;
    return events;
  }

  // the van bumped something: stall the nearest car for a moment
  const bump = (x, z) => { let best = null, bd = 5.5; for (const c of cars) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } } if (best) { best.stun = 1.6; best.v = 0; if (best.near) best.near.hit = true; } return best; };

  update(0, { pos: new THREE.Vector3(1e4, 0, 1e4), vel: new THREE.Vector2(), speed: 0, impact: 0 });
  return { group, cars, update, bump };
}
