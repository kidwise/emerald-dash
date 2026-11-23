import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AVENUES, STREETS, CURB, LAMP_H, lampSites, Z_NORTH, Z_SOUTH, X_WEST, X_EAST, FOG_DENSITY } from '../config.js';
import { rng } from './buildings.js';

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
export function createLamps(obstacles) {
  const sites = lampSites();
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, LAMP_H, 8).translate(0, LAMP_H / 2, 0),
    new THREE.CylinderGeometry(0.16, 0.18, 0.9, 8).translate(0, 0.45, 0),
    box(2.3, 0.09, 0.09, 1.1, LAMP_H - 0.05, 0),
    box(0.9, 0.12, 0.34, 2.15, LAMP_H - 0.02, 0),
  ]);
  const poles = new THREE.InstancedMesh(pole, darkMetal, sites.length);
  const lens = new THREE.InstancedMesh(box(0.78, 0.04, 0.26, 2.15, LAMP_H - 0.1, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.2, 3.4) }), sites.length);
  const pos = [], col = [], size = [], ph = [];
  sites.forEach((s, i) => {
    tmpQ.setFromAxisAngle(UP, Math.atan2(-s.dirZ, s.dirX));
    tmpM.compose(tmpV.set(s.x, CURB, s.z), tmpQ, tmpS);
    poles.setMatrixAt(i, tmpM); lens.setMatrixAt(i, tmpM);
    pos.push(s.x + s.dirX * 2.15, LAMP_H + CURB - 0.2, s.z + s.dirZ * 2.15);
    col.push(1.0, 0.62, 0.30); size.push(3.3); ph.push(i * 0.37);
    obstacles.push({ x: s.x, z: s.z, r: 0.28 });
  });
  const halo = createGlowPoints(pos, col, size, ph, { twinkle: 0.0 });
  halo.points.material.uniforms.uScale.value = 700;
  const group = new THREE.Group();
  group.add(poles, lens, halo.points);

  // soft light cones in the wet air under each lamp
  const coneGeo = new THREE.ConeGeometry(4.6, LAMP_H - 0.3, 20, 1, true).translate(0, (LAMP_H - 0.3) / 2, 0);
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
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, sites.length);
  sites.forEach((s, i) => {
    tmpM.compose(tmpV.set(s.x + s.dirX * 2.15, CURB, s.z + s.dirZ * 2.15), tmpQ.identity(), tmpS);
    cones.setMatrixAt(i, tmpM);
  });
  cones.layers.set(1); cones.frustumCulled = false;
  poles.frustumCulled = lens.frustumCulled = false;
  group.add(cones);
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
    for (let z = Z_NORTH + 11; z < Z_SOUTH; z += 22) {
      if (!okAlong(z)) continue;
      for (const s of [-1, 1]) spots.push([a.x + s * (a.hw + 1.7), z]);
    }
  }
  for (const st of STREETS) {
    if (st.z < Z_NORTH + 20) continue;
    for (let x = X_WEST + 19; x < X_EAST; x += 22) {
      if (!okAlong(x)) continue;
      for (const s of [-1, 1]) if (r() < 0.75) spots.push([x, st.z + s * (st.hw + 1.7)]);
    }
  }
  // the park promenade
  for (let z = Z_NORTH - 18; z > Z_NORTH - 92; z -= 12) for (const s of [-1, 1]) spots.push([s * 7.5, z]);

  const bark = new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.9 });
  const group = new THREE.Group();
  const meshes = variants.map(v => new THREE.InstancedMesh(v.geo, bark, spots.length));
  const counts = [0, 0, 0];
  const pos = [], col = [], size = [], ph = [];
  const palettes = [[[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[1.0, 0.72, 0.36]], [[0.75, 0.88, 1.0]], [[1.0, 0.25, 0.2], [0.25, 1.0, 0.4], [0.3, 0.5, 1.0], [1.0, 0.75, 0.2]]];
  spots.forEach(([x, z], i) => {
    const vi = Math.floor(r() * 3) % 3; const v = variants[vi];
    const rot = r() * 6.28, sc = 0.9 + r() * 0.35;
    tmpQ.setFromAxisAngle(UP, rot);
    tmpM.compose(tmpV.set(x, CURB, z), tmpQ, new THREE.Vector3(sc, sc, sc));
    meshes[vi].setMatrixAt(counts[vi]++, tmpM);
    const pal = palettes[Math.floor(r() * palettes.length) % palettes.length];
    const tp = r() * 10;
    for (let k = 0; k < v.lights.length; k += 3) {
      tmpV.set(v.lights[k], v.lights[k + 1], v.lights[k + 2]).applyMatrix4(tmpM);
      pos.push(tmpV.x, tmpV.y, tmpV.z);
      const c = pal[Math.floor(r() * pal.length) % pal.length];
      col.push(c[0] * 2.6, c[1] * 2.6, c[2] * 2.6); size.push(0.085); ph.push(tp + r());
    }
    obstacles.push({ x, z, r: 0.24 });
  });
  meshes.forEach((m, i) => { m.count = counts[i]; m.frustumCulled = false; group.add(m); });
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
      geos.push(new THREE.CylinderGeometry(0.1, 0.14, H, 8).translate(px, CURB + H / 2, pz));
      geos.push(box(dx ? len : 0.12, 0.12, dz ? len : 0.12, px + dx * len / 2, CURB + H - 0.15, pz + dz * len / 2));
      head(px + dx * len, CURB + H - 0.75, pz + dz * len, ry, set);
      head(px + dx * 0.02 + Math.sin(ry) * 0.3, CURB + 3.1, pz + Math.cos(ry) * 0.3, ry, set);   // pole-mounted repeater
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
function carProfile(kind) {
  const s = new THREE.Shape();
  if (kind === 0) {            // saloon
    s.moveTo(-2.25, 0.32); s.lineTo(-2.3, 0.72); s.quadraticCurveTo(-2.28, 0.95, -1.9, 0.98);
    s.lineTo(1.25, 0.94); s.quadraticCurveTo(2.2, 0.86, 2.3, 0.62); s.lineTo(2.3, 0.32);
  } else {                     // SUV / crossover
    s.moveTo(-2.3, 0.36); s.lineTo(-2.36, 0.85); s.quadraticCurveTo(-2.34, 1.12, -2.0, 1.14);
    s.lineTo(1.3, 1.1); s.quadraticCurveTo(2.25, 1.0, 2.36, 0.72); s.lineTo(2.36, 0.36);
  }
  s.closePath();
  return s;
}
function cabinProfile(kind) {
  const s = new THREE.Shape();
  if (kind === 0) { s.moveTo(-1.75, 0.94); s.quadraticCurveTo(-1.3, 1.42, -0.75, 1.44); s.lineTo(0.35, 1.44); s.quadraticCurveTo(0.75, 1.40, 1.3, 0.94); }
  else { s.moveTo(-2.1, 1.1); s.quadraticCurveTo(-1.95, 1.70, -1.55, 1.72); s.lineTo(0.3, 1.72); s.quadraticCurveTo(0.7, 1.68, 1.35, 1.08); }
  s.closePath();
  return s;
}
function extrudeX(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 10 });
  return g.translate(0, 0, -(width - bevel * 2) / 2);   // length along x, width along z
}
export function buildCarGeometries(kind) {
  const W = kind === 0 ? 1.82 : 1.92;
  const body = extrudeX(carProfile(kind), W, 0.09);
  const cabin = extrudeX(cabinProfile(kind), W - 0.2, 0.07);
  const wr = kind === 0 ? 0.33 : 0.37;
  const wheels = mergeGeometries([[-1.42, 1], [-1.42, -1], [1.42, 1], [1.42, -1]].map(([x, s]) =>
    new THREE.CylinderGeometry(wr, wr, 0.24, 18).rotateX(Math.PI / 2).translate(x, wr, s * (W / 2 - 0.1))));
  const hy = kind === 0 ? 0.72 : 0.86, hx = kind === 0 ? 2.305 : 2.365;
  const tail = mergeGeometries([box(0.06, 0.12, 0.5, -hx + 0.015, hy + 0.08, W / 2 - 0.36), box(0.06, 0.12, 0.5, -hx + 0.015, hy + 0.08, -W / 2 + 0.36)]);
  const headl = mergeGeometries([box(0.07, 0.11, 0.42, hx - 0.012, hy - 0.06, W / 2 - 0.34), box(0.07, 0.11, 0.42, hx - 0.012, hy - 0.06, -W / 2 + 0.34)]);
  return { body, cabin, wheels, tail, headl, W };
}
export const carMaterials = {
  paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.06 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x05080b, roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03, specularIntensity: 1.0, ior: 2.0 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.75 }),
  tailOff: new THREE.MeshStandardMaterial({ color: 0x2a0204, roughness: 0.3, emissive: 0x3a0306, emissiveIntensity: 1.2 }),
  headOff: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.15, metalness: 0.6 }),
};
const CAR_COLORS = [0x0a0a0c, 0x15171b, 0x4a4f55, 0x9ea3a8, 0xd9dcde, 0x7a0e12, 0x0d2a52, 0x14342a, 0x3a2a1a, 0xc8c2b0];

export function createParkedCars(colliders) {
  const r = rng(4242);
  const slots = [];   // {x,z,ry}
  const along = (start, end, fn) => { for (let v = start + 2; v < end - 6; v += 6.1) if (r() < 0.62) fn(v + (r() - 0.5) * 0.5); };
  const segs = (list, key) => list.map((s, i) => i < list.length - 1 ? [list[i + 1][key] + list[i + 1].hw + 9, s[key] - s.hw - 9] : null).filter(Boolean);
  for (const a of AVENUES) {
    for (const [z0, z1] of segs(STREETS, 'z')) for (const s of [-1, 1]) {
      if (a.x * s > 80) continue;   // keep the outer kerbs clear for the barriers
      along(z0, z1, (z) => { if (a.x === 0 && z > 214) return; slots.push({ x: a.x + s * (a.hw - 1.2), z: z + 3, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 }); });
    }
  }
  const avs = [...AVENUES].sort((p, q) => p.x - q.x);
  for (const st of STREETS) {
    if (st.hw > 9) continue;       // arterials have no parking
    for (let i = 0; i < avs.length - 1; i++) for (const s of [-1, 1]) {
      if (st.z + s * st.hw < Z_NORTH + 1) continue;
      along(avs[i].x + avs[i].hw + 9, avs[i + 1].x - avs[i + 1].hw - 9, (x) => slots.push({ x: x + 3, z: st.z + s * (st.hw - 1.2), ry: s > 0 ? Math.PI : 0 }));
    }
  }
  const group = new THREE.Group();
  const kinds = [buildCarGeometries(0), buildCarGeometries(1)];
  const per = [[], []];
  for (const s of slots) per[r() < 0.55 ? 0 : 1].push(s);
  const col = new THREE.Color();
  per.forEach((list, k) => {
    const G = kinds[k];
    const body = new THREE.InstancedMesh(G.body, carMaterials.paint, list.length);
    const parts = [new THREE.InstancedMesh(G.cabin, carMaterials.glass, list.length), new THREE.InstancedMesh(G.wheels, carMaterials.tyre, list.length),
      new THREE.InstancedMesh(G.tail, carMaterials.tailOff, list.length), new THREE.InstancedMesh(G.headl, carMaterials.headOff, list.length)];
    list.forEach((s, i) => {
      tmpQ.setFromAxisAngle(UP, s.ry);
      tmpM.compose(tmpV.set(s.x, 0, s.z), tmpQ, tmpS);
      body.setMatrixAt(i, tmpM); parts.forEach(p => p.setMatrixAt(i, tmpM));
      body.setColorAt(i, col.setHex(CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]));
      const alongX = Math.abs(Math.sin(s.ry)) < 0.5;
      const hl = 2.4, hw = G.W / 2 + 0.05;
      colliders.push(alongX ? { x0: s.x - hl, x1: s.x + hl, z0: s.z - hw, z1: s.z + hw, low: true } : { x0: s.x - hw, x1: s.x + hw, z0: s.z - hl, z1: s.z + hl, low: true });
    });
    [body, ...parts].forEach(m => { m.frustumCulled = false; group.add(m); });
  });
  // soft contact shadows
  const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(5.6, 2.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.85 }), slots.length);
  slots.forEach((s, i) => { tmpQ.setFromAxisAngle(UP, s.ry); tmpM.compose(tmpV.set(s.x, 0.02, s.z), tmpQ, tmpS); sh.setMatrixAt(i, tmpM); });
  sh.layers.set(1); sh.frustumCulled = false; sh.renderOrder = 2;
  group.add(sh);
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
function neonTexture(text, color, vertical) {
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
  let wi = 0;
  const addBlade = (x, y, z, nx, nz, word, color, h) => {
    const { tex, aspect } = neonTexture(word, color, true);
    const w = h * aspect;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4) });
    // blade sticks out along the wall normal (nx,nz); its faces look along the street
    const cx = x + nx * (w / 2 + 0.35), cz = z + nz * (w / 2 + 0.35);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(cx + (nz !== 0 ? s * 0.13 : 0), y, cz + (nx !== 0 ? s * 0.13 : 0));
      m.rotation.y = nx !== 0 ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
      group.add(m);
    }
    backing.push(box(nx !== 0 ? w + 0.1 : 0.24, h + 0.1, nx !== 0 ? 0.24 : w + 0.1, cx, y, cz));
    backing.push(box(nx !== 0 ? 0.5 : 0.08, 0.08, nx !== 0 ? 0.08 : 0.5, x + nx * 0.2, y + h * 0.3, z + nz * 0.2));
    backing.push(box(nx !== 0 ? 0.5 : 0.08, 0.08, nx !== 0 ? 0.08 : 0.5, x + nx * 0.2, y - h * 0.3, z + nz * 0.2));
  };
  for (const L of lots) {
    if (!L.name) continue;
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    // the wall that faces the nearest avenue
    const av = AVENUES.reduce((b, a) => Math.abs(a.x - cx) < Math.abs(b.x - cx) ? a : b);
    const nx = av.x > cx ? 1 : -1;
    const wx = nx > 0 ? L.x1 : L.x0;
    const n = L.type === 'brick' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const [word, color] = SIGN_WORDS[wi++ % SIGN_WORDS.length];
      const z = L.z0 + (L.z1 - L.z0) * (n === 1 ? 0.3 + r() * 0.4 : (i + 0.5) / n + (r() - 0.5) * 0.1);
      addBlade(wx, 6.6 + r() * 1.6, z, nx, 0, word, color, Math.min(4.6, 1.0 + word.length * 0.62));
    }
  }
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
  for (const s of STREETS) { add(X_WEST - 7, s.z, false, s.hw * 2 + 1); add(X_EAST + 7, s.z, false, s.hw * 2 + 1); }
  for (const a of AVENUES) add(a.x, Z_SOUTH + 7, true, a.hw * 2 + 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.8 });
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  group.add(m);
  const lights = createGlowPoints(pos, col, size, ph, { blink: 1 });
  group.add(lights.points);
  return { group, lights };
}
