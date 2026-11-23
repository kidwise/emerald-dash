import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CURB, LAMP_H, FOG_DENSITY, heightAt } from '../config.js';
import { rng } from './rng.js';

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

export function buildLamps(sites, obstacles) {
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

export function buildTrees(spots, obstacles, r = rng(78)) {
  const variants = [makeTree(r), makeTree(r), makeTree(r)];
  const bark = new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.9 });
  const group = new THREE.Group();
  const pos = [], col = [], size = [], ph = [];
  const palettes = [[[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[0.75, 0.88, 1.0]], [[1.0, 0.25, 0.2], [0.25, 1.0, 0.4], [0.3, 0.5, 1.0], [1.0, 0.75, 0.2]]];
  const placed = spots.map(([x, z, y]) => ({ x, z, y: y ?? heightAt(x, z) + CURB, vi: Math.floor(r() * 3) % 3, rot: r() * 6.28, sc: 0.9 + r() * 0.35 }));
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
