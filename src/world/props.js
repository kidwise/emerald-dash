import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AVENUES, STREETS, CURB, LAMP_H, lampSites, Z_NORTH, X_WEST, X_EAST, FOG_DENSITY, heightAt, HILL_Z, isNode } from '../config.js';
import { rng } from './buildings.js';
import { makeCarSet, CAR_KINDS, CAR_COLORS } from './cars.js';
import { CAMPUS } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1);

function box(w, h, d, x, y, z) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
function cylBetween(a, b, r0, r1, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate(a.x, a.y, a.z);
}
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export const darkMetal = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.42, metalness: 0.85 });

// A shared additive "glowing point" material: fairy lights, halos, beacons.
export function createGlowPoints(positions, colors, sizes, phases, opts = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 700 }, uFog: { value: FOG_DENSITY * (opts.fogK ?? 1) }, uTwinkle: { value: opts.twinkle ?? 0.25 }, uBlink: { value: opts.blink ?? 0 } };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime, uScale, uFog, uTwinkle, uBlink;
      varying vec3 vCol;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float px = aSize * uScale / max(dist, 0.1);
        float cl = clamp(px, 1.8, 90.0);
        float tw = 1.0 - uTwinkle + uTwinkle * sin(uTime * (1.5 + fract(aPhase * 7.0) * 2.0) + aPhase * 50.0);
        if (uBlink > 0.5) tw = smoothstep(0.80, 0.95, sin(uTime * 2.2 + aPhase * 6.283));
        float fog = exp(-uFog * uFog * dist * dist);
        vCol = aColor * tw * fog * min(1.0, (px * px) / (cl * cl));
        gl_PointSize = cl;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vCol * (a * a * a + 0.15 * a), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return { points: pts, uniforms };
}

// ---------------------------------------------------------------- street lamps
// Static instanced props are split into map tiles so far-away tiles can be skipped entirely.
export const CHUNK = 264;
export const chunks = [];      // { objs: [Object3D], x, z }
export function byChunk(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.values()];
}
export function registerChunk(list, objs) {
  const x = list.reduce((a, i) => a + i.x, 0) / list.length, z = list.reduce((a, i) => a + i.z, 0) / list.length;
  for (const o of objs) { o.frustumCulled = true; if (o.computeBoundingSphere) o.computeBoundingSphere(); }
  chunks.push({ objs, x, z });
}

export function createLamps(obstacles) {
  const sites = lampSites();
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, LAMP_H, 8).translate(0, LAMP_H / 2, 0),
    new THREE.CylinderGeometry(0.16, 0.18, 0.9, 8).translate(0, 0.45, 0),
    box(2.3, 0.09, 0.09, 1.1, LAMP_H - 0.05, 0),
    box(0.9, 0.12, 0.34, 2.15, LAMP_H - 0.02, 0),
  ]);
  const lensGeo = box(0.78, 0.04, 0.26, 2.15, LAMP_H - 0.1, 0);
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.2, 3.4) });
  const coneGeo = new THREE.ConeGeometry(4.6, LAMP_H - 0.3, 16, 1, true).translate(0, (LAMP_H - 0.3) / 2, 0);
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uFog: { value: FOG_DENSITY } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vH; varying float vDist;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vH = position.y / ${(LAMP_H - 0.3).toFixed(2)};
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vDist = distance(cameraPosition, wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uFog;
      varying vec3 vN; varying vec3 vV; varying float vH; varying float vDist;
      void main(){
        float rim = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float a = rim * pow(clamp(vH, 0.0, 1.0), 1.6) * 0.050 * smoothstep(1.0, 0.9, vH);
        a *= exp(-uFog * uFog * vDist * vDist) * smoothstep(1.5, 8.0, vDist);
        gl_FragColor = vec4(vec3(1.0, 0.66, 0.36) * a, 1.0);
      }`,
  });
  const group = new THREE.Group();
  const pos = [], col = [], size = [], ph = [];
  for (const list of byChunk(sites)) {
    const poles = new THREE.InstancedMesh(pole, darkMetal, list.length), lens = new THREE.InstancedMesh(lensGeo, lensMat, list.length), cones = new THREE.InstancedMesh(coneGeo, coneMat, list.length);
    list.forEach((s, i) => {
      tmpQ.setFromAxisAngle(UP, Math.atan2(-s.dirZ, s.dirX));
      tmpM.compose(tmpV.set(s.x, s.y + CURB, s.z), tmpQ, tmpS);
      poles.setMatrixAt(i, tmpM); lens.setMatrixAt(i, tmpM);
      tmpM.compose(tmpV.set(s.x + s.dirX * 2.15, s.y + CURB, s.z + s.dirZ * 2.15), tmpQ.identity(), tmpS);
      cones.setMatrixAt(i, tmpM);
      pos.push(s.x + s.dirX * 2.15, s.y + LAMP_H + CURB - 0.2, s.z + s.dirZ * 2.15);
      col.push(1.0, 0.62, 0.30); size.push(3.3); ph.push(i * 0.37);
      obstacles.push({ x: s.x, z: s.z, r: 0.28 });
    });
    cones.layers.set(1);
    group.add(poles, lens, cones);
    registerChunk(list, [poles, lens, cones]);
  }
  const halo = createGlowPoints(pos, col, size, ph, { twinkle: 0.0 });
  group.add(halo.points);
  return { group, sites, halo };
}

// ---------------------------------------------------------------- trees wrapped in fairy lights
function makeTree(r) {
  const geos = [], lights = [];
  const branch = (p, dir, len, rad, depth) => {
    const end = p.clone().addScaledVector(dir, len);
    geos.push(cylBetween(p, end, rad, rad * 0.66, depth < 2 ? 6 : 4));
    const n = Math.ceil(len / (depth === 0 ? 0.11 : 0.3));
    const side = new THREE.Vector3(1, 0, 0).cross(dir).normalize(); const side2 = new THREE.Vector3().crossVectors(dir, side);
    for (let i = 0; i < n; i++) {
      const t = (i + r()) / n;
      const a = depth === 0 ? t * 26 : r() * 6.28;
      const rr = rad * (1 - 0.34 * t) + 0.02;
      const q = p.clone().lerp(end, t).addScaledVector(side, Math.cos(a) * rr).addScaledVector(side2, Math.sin(a) * rr);
      if (depth > 0 || t > 0.25) lights.push(q.x, q.y, q.z);
    }
    if (depth >= 4) return;
    const kids = depth === 0 ? 3 : (r() < 0.4 ? 3 : 2);
    const base = r() * 6.28;
    for (let i = 0; i < kids; i++) {
      const az = base + (i / kids) * 6.28 + (r() - 0.5) * 0.8;
      const tilt = 0.45 + r() * 0.35;
      const nd = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.cos(az) * Math.sin(tilt)).addScaledVector(side2, Math.sin(az) * Math.sin(tilt));
      nd.y += 0.18; nd.normalize();
      branch(end, nd, len * (0.62 + r() * 0.16), rad * 0.62, depth + 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3((r() - 0.5) * 0.08, 1, (r() - 0.5) * 0.08).normalize(), 2.7 + r() * 0.5, 0.13, 0);
  return { geo: mergeGeometries(geos), lights };
}

export function createTrees(obstacles) {
  const r = rng(77);
  const variants = [makeTree(r), makeTree(r), makeTree(r)];
  const spots = [];
  const okAlong = (v) => { const m = ((v % 88) + 88) % 88; return m > 16 && m < 72; };
  for (const a of AVENUES) {
    for (let z = Math.ceil((a.z0 - 11) / 22) * 22 + 11; z < a.z1; z += 22) {
      if (!okAlong(z)) continue;
      for (const s of [-1, 1]) if (r() < 0.85) spots.push([a.x + s * (a.hw + 1.7), z]);
    }
  }
  for (const st of STREETS) {
    if (st.z < Z_NORTH + 20) continue;
    for (let x = Math.ceil((Math.max(st.x0, -540) - 11) / 22) * 22 + 11; x < Math.min(st.x1, 106); x += 22) {
      if (!okAlong(x)) continue;
      for (const s of [-1, 1]) if (r() < 0.6) spots.push([x, st.z + s * (st.hw + 1.7)]);
    }
  }
  // the park promenade
  for (let z = Z_NORTH - 18; z > Z_NORTH - 92; z -= 12) for (const s of [-1, 1]) spots.push([s * 7.5, z]);
  // Seattle Center lawns: scattered, clear of the Needle, the fountain and the glasshouse
  for (let n = 0; n < 60; n++) {
    const x = CAMPUS.x0 + 10 + r() * (CAMPUS.x1 - CAMPUS.x0 - 20), z = CAMPUS.z0 + 10 + r() * (CAMPUS.z1 - CAMPUS.z0 - 20);
    if (Math.hypot(x + 640, z - 92) < 30 || Math.hypot(x + 700, z - 50) < 22 || (Math.abs(x + 590) < 30 && Math.abs(z - 195) < 40) || (x < -685 && z > 200)) continue;
    spots.push([x, z]);
  }

  const bark = new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.9 });
  const group = new THREE.Group();
  const pos = [], col = [], size = [], ph = [];
  const palettes = [[[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[0.75, 0.88, 1.0]], [[1.0, 0.25, 0.2], [0.25, 1.0, 0.4], [0.3, 0.5, 1.0], [1.0, 0.75, 0.2]]];
  const placed = spots.map(([x, z]) => ({ x, z, y: heightAt(x, z) + CURB, vi: Math.floor(r() * 3) % 3, rot: r() * 6.28, sc: 0.9 + r() * 0.35 }));
  for (const list of byChunk(placed)) {
    const meshes = variants.map(v => new THREE.InstancedMesh(v.geo, bark, list.length));
    const counts = [0, 0, 0];
    for (const t of list) {
      const v = variants[t.vi];
      tmpQ.setFromAxisAngle(UP, t.rot);
      tmpM.compose(tmpV.set(t.x, t.y, t.z), tmpQ, new THREE.Vector3(t.sc, t.sc, t.sc));
      meshes[t.vi].setMatrixAt(counts[t.vi]++, tmpM);
      const pal = palettes[Math.floor(r() * palettes.length) % palettes.length];
      const tp = r() * 10;
      for (let k = 0; k < v.lights.length; k += 3) {
        tmpV.set(v.lights[k], v.lights[k + 1], v.lights[k + 2]).applyMatrix4(tmpM);
        pos.push(tmpV.x, tmpV.y, tmpV.z);
        const c = pal[Math.floor(r() * pal.length) % pal.length];
        col.push(c[0] * 2.6, c[1] * 2.6, c[2] * 2.6); size.push(0.085); ph.push(tp + r());
      }
      obstacles.push({ x: t.x, z: t.z, r: 0.24 });
    }
    const live = meshes.filter((m, i) => { m.count = counts[i]; return counts[i] > 0; });
    group.add(...live);
    registerChunk(list, live);
  }
  const lights = createGlowPoints(pos, col, size, ph, { twinkle: 0.3 });
  group.add(lights.points);
  return { group, lights, spots };
}

// ---------------------------------------------------------------- traffic signals
export function createSignals() {
  const geos = [];
  const lensG = { ns: { r: [], y: [], g: [] }, ew: { r: [], y: [], g: [] } };
  const lens = (list, x, y, z, ry) => { list.push(new THREE.CircleGeometry(0.115, 12).rotateY(ry).translate(x, y, z)); };
  const head = (x, y, z, ry, set) => {
    const hb = box(0.36, 1.08, 0.3, 0, 0, 0).rotateY(ry).translate(x, y, z); geos.push(hb);
    geos.push(box(0.6, 1.3, 0.04, 0, 0, -0.17).rotateY(ry).translate(x, y, z));   // backplate
    const fx = Math.sin(ry) * 0.16, fz = Math.cos(ry) * 0.16;
    lens(set.r, x + fx, y + 0.34, z + fz, ry); lens(set.y, x + fx, y, z + fz, ry); lens(set.g, x + fx, y - 0.34, z + fz, ry);
  };
  for (const a of AVENUES) for (const s of STREETS) {
    if (!isNode(a, s)) continue;
    const H = 6.6;
    const corners = [
      // [pole x, pole z, arm dx, arm dz, arm length, facing ry, set]
      [a.x + a.hw + 0.7, s.z - s.hw - 0.7, -1, 0, a.hw * 0.62 + 0.7, 0, lensG.ns],            // faces +z (northbound traffic)
      [a.x - a.hw - 0.7, s.z + s.hw + 0.7, 1, 0, a.hw * 0.62 + 0.7, Math.PI, lensG.ns],       // faces -z (southbound)
      [a.x + a.hw + 0.7, s.z + s.hw + 0.7, 0, -1, s.hw * 0.62 + 0.7, -Math.PI / 2, lensG.ew], // faces -x (eastbound)
      [a.x - a.hw - 0.7, s.z - s.hw - 0.7, 0, 1, s.hw * 0.62 + 0.7, Math.PI / 2, lensG.ew],   // faces +x (westbound)
    ];
    for (const [px, pz, dx, dz, len, ry, set] of corners) {
      if (pz < Z_NORTH - 2) continue;
      const gy = heightAt(a.x, s.z) + CURB;
      geos.push(new THREE.CylinderGeometry(0.1, 0.14, H, 8).translate(px, gy + H / 2, pz));
      geos.push(box(dx ? len : 0.12, 0.12, dz ? len : 0.12, px + dx * len / 2, gy + H - 0.15, pz + dz * len / 2));
      head(px + dx * len, gy + H - 0.75, pz + dz * len, ry, set);
      head(px + dx * 0.02 + Math.sin(ry) * 0.3, gy + 3.1, pz + Math.cos(ry) * 0.3, ry, set);   // pole-mounted repeater
    }
  }
  const group = new THREE.Group();
  const frame = new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), darkMetal);
  frame.frustumCulled = false;
  group.add(frame);
  const COL = { r: [14, 0.5, 0.35], y: [12, 6.5, 0.5], g: [0.5, 11, 5.5] };
  const mats = {};
  for (const dir of ['ns', 'ew']) for (const c of ['r', 'y', 'g']) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000 });
    mats[dir + c] = m;
    const mesh = new THREE.Mesh(mergeGeometries(lensG[dir][c]), m);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const set = (dir, on) => {
    for (const c of ['r', 'y', 'g']) {
      const k = COL[c]; const f = c === on ? 1 : 0.012;
      mats[dir + c].color.setRGB(k[0] * f, k[1] * f, k[2] * f);
    }
  };
  // phase: 0 NS green, 1 NS yellow, 2 EW green, 3 EW yellow
  const state = { phase: -1, nsGreen: true };
  const update = (time) => {
    const t = time % 24;
    const phase = t < 10 ? 0 : t < 12 ? 1 : t < 22 ? 2 : 3;
    if (phase === state.phase) return;
    state.phase = phase;
    set('ns', phase === 0 ? 'g' : phase === 1 ? 'y' : 'r');
    set('ew', phase === 2 ? 'g' : phase === 3 ? 'y' : 'r');
  };
  update(0);
  return { group, update, state };
}

// ---------------------------------------------------------------- parked cars
export { carMaterials } from './cars.js';

export function createParkedCars(colliders) {
  const r = rng(4242);
  const slots = [];   // {x,y,z,ry}
  const along = (start, end, fn) => { for (let v = start + 2; v < end - 6; v += 6.1) if (r() < 0.58) fn(v + (r() - 0.5) * 0.5); };
  for (const a of AVENUES) {
    const zs = STREETS.filter(s => isNode(a, s)).sort((p, q) => p.z - q.z);
    for (let i = 0; i < zs.length - 1; i++) for (const s of [-1, 1]) {
      if (a.brick && zs[i].z > 430) continue;                 // Pike Place stays clear so the stalls can be seen
      along(zs[i].z + zs[i].hw + 9, zs[i + 1].z - zs[i + 1].hw - 9, (z) => {
        if (a.x === 0 && z > 210 && z < 258) return;          // keep the start line clear
        slots.push({ x: a.x + s * (a.hw - 1.2), z: z + 3, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
      });
    }
  }
  for (const st of STREETS) {
    if (st.hw > 9) continue;       // arterials have no parking
    const xs = AVENUES.filter(a => isNode(a, st)).sort((p, q) => p.x - q.x);
    for (let i = 0; i < xs.length - 1; i++) for (const s of [-1, 1]) {
      if (st.z + s * st.hw < Z_NORTH + 1) continue;
      if (st.z > HILL_Z && xs[i].x < -96) continue;           // too steep to park on
      along(xs[i].x + xs[i].hw + 9, xs[i + 1].x - xs[i + 1].hw - 9, (x) => slots.push({ x: x + 3, z: st.z + s * (st.hw - 1.2), ry: s > 0 ? Math.PI : 0 }));
    }
  }
  for (const s of slots) { s.y = heightAt(s.x, s.z); s.kind = Math.floor(r() * CAR_KINDS) % CAR_KINDS; }
  const group = new THREE.Group();
  const col = new THREE.Color();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85 });
  const shadowGeo = new THREE.PlaneGeometry(5.6, 2.9).rotateX(-Math.PI / 2);
  for (const list of byChunk(slots)) {
    const objs = [];
    for (let k = 0; k < CAR_KINDS; k++) {
      const sub = list.filter(s => s.kind === k);
      if (!sub.length) continue;
      const set = makeCarSet(k, sub.length, false);
      sub.forEach((s, i) => {
        tmpQ.setFromAxisAngle(UP, s.ry);
        tmpM.compose(tmpV.set(s.x, s.y, s.z), tmpQ, tmpS);
        set.setMatrixAt(i, tmpM);
        set.body.setColorAt(i, col.setHex(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]));
        const alongX = Math.abs(Math.sin(s.ry)) < 0.5;
        const hl = 2.4, hw = set.W / 2 + 0.05;
        colliders.push(alongX ? { x0: s.x - hl, x1: s.x + hl, z0: s.z - hw, z1: s.z + hw, low: true } : { x0: s.x - hw, x1: s.x + hw, z0: s.z - hl, z1: s.z + hl, low: true });
      });
      group.add(...set.all); objs.push(...set.all);
    }
    const sh = new THREE.InstancedMesh(shadowGeo, shadowMat, list.length);
    list.forEach((s, i) => { tmpQ.setFromAxisAngle(UP, s.ry); tmpM.compose(tmpV.set(s.x, s.y + 0.02, s.z), tmpQ, tmpS); sh.setMatrixAt(i, tmpM); });
    sh.layers.set(1); sh.renderOrder = 2;
    group.add(sh); objs.push(sh);
    registerChunk(list, objs);
  }
  return { group, slots };
}

let _shadowTex = null;
export function shadowTex() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.filter = 'blur(7px)'; x.fillStyle = '#fff';
  x.beginPath(); x.roundRect(18, 13, 92, 38, 10); x.fill();
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

// ---------------------------------------------------------------- neon signs
const _neon = new Map();
function neonTexture(text, color, vertical) {
  const key = text + color + vertical;
  if (_neon.has(key)) return _neon.get(key);
  const made = makeNeon(text, color, vertical);
  _neon.set(key, made);
  return made;
}
function makeNeon(text, color, vertical) {
  const c = document.createElement('canvas');
  const L = text.length;
  if (vertical) { c.width = 160; c.height = 60 + L * 118; } else { c.width = 80 + L * 92; c.height = 190; }
  const x = c.getContext('2d');
  x.fillStyle = '#06070a'; x.fillRect(0, 0, c.width, c.height);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 104px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  const draw = () => {
    if (vertical) for (let i = 0; i < L; i++) x.fillText(text[i], c.width / 2, 92 + i * 118);
    else x.fillText(text, c.width / 2, c.height / 2 + 6);
  };
  x.shadowColor = color; x.fillStyle = color;
  for (const b of [44, 22, 10]) { x.shadowBlur = b; draw(); }
  x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,0.9)'; x.globalAlpha = 0.75; draw(); x.globalAlpha = 1;
  x.strokeStyle = color; x.lineWidth = 5; x.shadowColor = color; x.shadowBlur = 16;
  x.beginPath(); x.roundRect(12, 12, c.width - 24, c.height - 24, 18); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { tex: t, aspect: c.width / c.height };
}

const SIGN_WORDS = [['COFFEE', '#ff9a3c'], ['PHO', '#ff3b5c'], ['BAR', '#35d6ff'], ['RAMEN', '#ff4d2e'], ['BOOKS', '#ffd35a'], ['TACOS', '#59ff8f'],
  ['BAKERY', '#ffb7e0'], ['TERIYAKI', '#ff5a36'], ['POKE', '#4fe3ff'], ['PIZZA', '#ff6a3d'], ['VINYL', '#c58bff'], ['ESPRESSO', '#ffb056'], ['THAI', '#7dffb0'], ['DELI', '#fff07a'], ['OYSTERS', '#7fd4ff'], ['BREWERY', '#ffc247']];

export function createSigns(lots) {
  const r = rng(909);
  const group = new THREE.Group();
  const backing = [];
  const faces = new Map();
  let wi = 0;
  const addBlade = (x, y, z, nx, nz, word, color, h, mats) => {
    const { tex, aspect } = neonTexture(word, color, true);
    const w = h * aspect;
    if (!mats.has(word)) mats.set(word, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4) }));
    const mat = mats.get(word);
    // blade sticks out along the wall normal (nx,nz); its faces look along the street
    const cx = x + nx * (w / 2 + 0.35), cz = z + nz * (w / 2 + 0.35);
    for (const s of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(w, h).rotateY(nx !== 0 ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2)).translate(cx + (nz !== 0 ? s * 0.13 : 0), y, cz + (nx !== 0 ? s * 0.13 : 0));
      if (!faces.has(word)) faces.set(word, []);
      faces.get(word).push(pg);
    }
    void mat;
    backing.push(box(nx !== 0 ? w + 0.1 : 0.24, h + 0.1, nx !== 0 ? 0.24 : w + 0.1, cx, y, cz));
    backing.push(box(nx !== 0 ? 0.5 : 0.08, 0.08, nx !== 0 ? 0.08 : 0.5, x + nx * 0.2, y + h * 0.3, z + nz * 0.2));
    backing.push(box(nx !== 0 ? 0.5 : 0.08, 0.08, nx !== 0 ? 0.08 : 0.5, x + nx * 0.2, y - h * 0.3, z + nz * 0.2));
  };
  const mats = new Map();
  for (const L of lots) {
    if (L.district === 'none') continue;
    if (!L.door || r() < 0.25) continue;
    const { nx, nz } = L.door;
    const n = L.type === 'brick' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const [word, color] = SIGN_WORDS[wi++ % SIGN_WORDS.length];
      const t = n === 1 ? 0.3 + r() * 0.4 : (i + 0.5) / n + (r() - 0.5) * 0.1;
      const wx = nx !== 0 ? (nx > 0 ? L.x1 : L.x0) : L.x0 + (L.x1 - L.x0) * t;
      const wz = nz !== 0 ? (nz > 0 ? L.z1 : L.z0) : L.z0 + (L.z1 - L.z0) * t;
      addBlade(wx, heightAt(L.door.x, L.door.z) + 6.6 + r() * 1.6, wz, nx, nz, word, color, Math.min(4.6, 1.0 + word.length * 0.62), mats);
    }
  }
  for (const [word, list] of faces) { const m = new THREE.Mesh(mergeGeometries(list), mats.get(word)); m.frustumCulled = false; group.add(m); }
  // horizontal fascia lettering for the market hall
  const market = lots.find(l => l.type === 'grocery');
  if (market) {
    const { tex, aspect } = neonTexture('WHOLE FOODS MARKET', '#4dff8a', false);
    const h = 2.3, w = h * aspect;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) }));
    m.position.set(market.x1 - w / 2 - 3, 10.4, market.z0 - 0.3); m.rotation.y = Math.PI;
    group.add(m);
    backing.push(box(w + 0.2, h + 0.2, 0.2, market.x1 - w / 2 - 3, 10.4, market.z0 - 0.17));
    const m2 = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.7), m.material);
    m2.position.set(market.x1 + 0.3, 10.4, market.z0 + w * 0.35 + 3); m2.rotation.y = Math.PI / 2;
    group.add(m2);
  }
  const back = new THREE.Mesh(mergeGeometries(backing), darkMetal);
  group.add(back);
  return { group };
}

// ---------------------------------------------------------------- road-closed barriers at the edge of the map
export function createBarriers(colliders) {
  const geos = [], pos = [], col = [], size = [], ph = [];
  const group = new THREE.Group();
  const add = (x, z, alongX, span) => {
    const n = Math.floor(span / 3.2);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 3.2;
      const bx = x + (alongX ? o : 0), bz = z + (alongX ? 0 : o);
      geos.push(box(alongX ? 3.0 : 0.6, 0.85, alongX ? 0.6 : 3.0, bx, 0.43, bz));
      geos.push(box(alongX ? 2.6 : 0.32, 0.25, alongX ? 0.32 : 2.6, bx, 0.98, bz));
      pos.push(bx, 1.35, bz); col.push(9, 4.2, 0.3); size.push(0.5); ph.push(i * 0.5 + x * 0.01);
    }
    colliders.push(alongX ? { x0: x - span / 2, x1: x + span / 2, z0: z - 0.6, z1: z + 0.6 } : { x0: x - 0.6, x1: x + 0.6, z0: z - span / 2, z1: z + span / 2 });
  };
  for (const s of STREETS) {
    if (s.x1 > X_EAST + 10) add(X_EAST + 7, s.z, false, s.hw * 2 + 1);
    if (s.x0 < X_WEST - 10 && s.x0 > -430) add(X_WEST - 7, s.z, false, s.hw * 2 + 1);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.8 });
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  group.add(m);
  const lights = createGlowPoints(pos, col, size, ph, { blink: 1 });
  group.add(lights.points);
  return { group, lights };
}
