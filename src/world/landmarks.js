import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, GLSL_SKY } from '../gfx/glsl.js';
import { FacadeGeo, STYLE, createFacadeMaterial } from './facade.js';
import { createGlowPoints, darkMetal } from './props.js';
import { rng } from './buildings.js';
import { CURB, LAKE_Z, FOG_COLOR, FOG_DENSITY, Z_NORTH } from '../config.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// ---------------------------------------------------------------- Lake Union
export function createLake(reflection, o = {}) {
  const uniforms = {
    tReflect: { value: reflection.rt.texture }, uReflectMatrix: { value: reflection.textureMatrix },
    uTime: { value: 0 }, uPlanar: { value: o.planar ?? 1 }, uFogColor: { value: new THREE.Color().fromArray(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vWPos; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tReflect; uniform mat4 uReflectMatrix; uniform float uTime; uniform float uPlanar; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vWPos;
      ${GLSL_NOISE}
      ${GLSL_SKY}
      float wave(vec2 p){ return vnoise(p * 0.55 + vec2(uTime * 0.35, uTime * 0.12)) * 0.6 + vnoise(p * 1.7 - vec2(uTime * 0.5, -uTime * 0.2)) * 0.3 + vnoise(p * 4.3 + uTime * 0.7) * 0.1; }
      void main(){
        vec2 p = vWPos.xz;
        vec3 toC = cameraPosition - vWPos; float dist = length(toC); vec3 V = toC / dist;
        float e = 0.25;
        float h0 = wave(p), hx = wave(p + vec2(e, 0.0)), hz = wave(p + vec2(0.0, e));
        float amp = 0.55 / (1.0 + dist * 0.012);
        vec3 N = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
        float NdV = clamp(dot(N, V), 0.0, 1.0);
        float fres = 0.03 + 0.97 * pow(1.0 - NdV, 5.0);
        vec4 rc = uReflectMatrix * vec4(vWPos.x, 0.0, vWPos.z, 1.0);
        vec2 ruv = rc.xy / rc.w + N.xz * vec2(0.10, 0.22);
        vec3 refl = vec3(0.0);
        for (int i = -2; i <= 2; i++) refl += min(textureLod(tReflect, ruv + vec2(0.0, float(i) * 0.012), 1.5).rgb, vec3(48.0));
        refl /= 5.0;
        vec3 R = reflect(-V, N);
        vec3 sky = skyColor(normalize(vec3(R.x, abs(R.y) + 0.02, R.z)), uTime);
        refl = mix(sky * 1.3, max(refl, sky * 0.6), uPlanar);
        vec3 deep = vec3(0.004, 0.012, 0.018);
        vec3 col = mix(deep, refl, clamp(fres * 1.5 + 0.08, 0.0, 1.0));
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 0.5);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(o.geometry || new THREE.PlaneGeometry(o.w ?? 2600, o.d ?? 1300).rotateX(-Math.PI / 2), mat);
  if (o.geometry) mesh.position.set(0, o.y ?? 0, 0); else mesh.position.set(o.x ?? 0, o.y ?? -0.55, o.z ?? LAKE_Z - 650 + 0.5);
  mesh.layers.set(1);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------- park, museum, boats, far shore
export function createPark(colliders) {
  const group = new THREE.Group();
  const r = rng(3301);
  const geos = [];

  // railing + lamp bollards along the water
  for (let x = -200; x <= 200; x += 2.5) geos.push(box(0.08, 1.05, 0.08, x, CURB + 0.52, LAKE_Z + 1.2));
  geos.push(box(400, 0.07, 0.1, 0, CURB + 1.08, LAKE_Z + 1.2), box(400, 0.04, 0.05, 0, CURB + 0.6, LAKE_Z + 1.2));
  // seawall
  geos.push(box(840, 1.2, 0.8, 0, -0.3, LAKE_Z - 0.2));
  // benches
  for (let i = 0; i < 12; i++) { const x = -150 + i * 27 + r() * 6; geos.push(box(1.9, 0.08, 0.5, x, CURB + 0.45, LAKE_Z + 5), box(1.9, 0.5, 0.06, x, CURB + 0.75, LAKE_Z + 5.25), box(0.08, 0.45, 0.45, x - 0.8, CURB + 0.22, LAKE_Z + 5), box(0.08, 0.45, 0.45, x + 0.8, CURB + 0.22, LAKE_Z + 5)); }

  // pedestrian lamps (the park ground shader lights itself from the same positions)
  const lampPos = [];
  for (let x = -198; x <= 198; x += 22) lampPos.push([x, LAKE_Z + 2.6]);
  for (let j = 0; j < 4; j++) for (const sx of [-5.6, 5.6]) lampPos.push([sx, Z_NORTH - 12 - 22 * j]);
  const gp = [], gc = [], gs = [], gph = [];
  for (const [x, z] of lampPos) {
    geos.push(new THREE.CylinderGeometry(0.06, 0.08, 5.0, 8).translate(x, CURB + 2.5, z), new THREE.CylinderGeometry(0.34, 0.22, 0.2, 12).translate(x, CURB + 5.1, z));
    gp.push(x, CURB + 5.0, z); gc.push(1.0, 0.64, 0.32); gs.push(2.3); gph.push(x * 0.1);
  }
  const parkHalo = createGlowPoints(gp, gc, gs, gph, { twinkle: 0 });
  group.add(parkHalo.points);

  // museum pier + floating docks
  const pier = { x0: -112, x1: -22, z0: LAKE_Z - 78, z1: LAKE_Z };
  geos.push(box(pier.x1 - pier.x0, 0.5, pier.z1 - pier.z0, (pier.x0 + pier.x1) / 2, CURB - 0.25, (pier.z0 + pier.z1) / 2));
  for (let x = pier.x0 + 4; x < pier.x1; x += 9) for (let z = pier.z0 + 4; z < pier.z1; z += 12) geos.push(new THREE.CylinderGeometry(0.35, 0.35, 3, 8).translate(x, -1.4, z));
  const docks = [[30, LAKE_Z - 28, 5, 56], [78, LAKE_Z - 34, 5, 68], [126, LAKE_Z - 24, 4, 48], [54, LAKE_Z - 54, 52, 3.5]];
  for (const [x, z, w, d] of docks) geos.push(box(w, 0.35, d, x, -0.25, z));
  const deck = new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6, metalness: 0.1 }));
  group.add(deck);

  // the museum: a white deco armoury hall on the pier
  const fg = new FacadeGeo();
  const mx0 = -98, mx1 = -36, mz0 = LAKE_Z - 66, mz1 = LAKE_Z - 14;
  const stone = [0.46, 0.45, 0.42];
  fg.box(mx0, mx1, mz0, mz1, CURB, CURB + 15, { style: STYLE.BRICK, seed: 3.3, floorH: 12.4, bayW: 5.2, groundH: 2.0, lit: 0.92, a: 0, tint: stone });
  fg.box(mx0 + 14, mx1 - 14, mz0 + 8, mz1 - 8, CURB + 15, CURB + 21, { style: STYLE.BRICK, seed: 8.1, floorH: 5.4, bayW: 4.2, groundH: 0, lit: 0.9, a: 0, tint: stone });
  fg.box(mx0 + 24, mx1 - 24, mz1, mz1 + 3.5, CURB, CURB + 11, { style: STYLE.SOLID, seed: 2, floorH: 11, bayW: 3.5, tint: stone });
  fg.box(mx0 + 26, mx1 - 26, mz1 + 3.5, mz1 + 3.6, CURB + 0.3, CURB + 6.5, { style: STYLE.EMISSIVE, lit: 1.6, tint: [1.0, 0.8, 0.55] }, false);
  // wash lights at the base
  fg.box(mx0 - 0.1, mx1 + 0.1, mz0 - 0.1, mz1 + 0.1, CURB + 14.3, CURB + 14.5, { style: STYLE.EMISSIVE, lit: 2.6, tint: [1.0, 0.82, 0.6] }, false);
  const fm = createFacadeMaterial();
  group.add(new THREE.Mesh(fg.build(), fm.material));
  colliders.push({ x0: mx0, x1: mx1, z0: mz0, z1: mz1 + 3.6 });

  // moored boats dressed with lights
  const boats = [];
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-5, 0); hullShape.quadraticCurveTo(-5.2, 1.3, -4.2, 1.4); hullShape.lineTo(3.2, 1.4); hullShape.quadraticCurveTo(5.4, 1.2, 6.2, 0); hullShape.quadraticCurveTo(2, -0.9, -5, 0);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 2.2, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.6, bevelSegments: 3 }).translate(0, 0, -1.1);
  const hullMats = [0x1c2d3d, 0x3a1f18, 0xe8e4da, 0x12281f].map(c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  const lp = [], lc = [], ls = [], lph = [];
  const berths = [[36, LAKE_Z - 18, 0], [36, LAKE_Z - 40, 0], [24, LAKE_Z - 30, Math.PI], [84, LAKE_Z - 20, 0], [84, LAKE_Z - 46, 0], [72, LAKE_Z - 32, Math.PI], [72, LAKE_Z - 58, Math.PI], [131, LAKE_Z - 16, 0], [131, LAKE_Z - 36, 0], [121, LAKE_Z - 26, Math.PI], [50, LAKE_Z - 60, Math.PI / 2], [-6, LAKE_Z - 22, Math.PI / 2]];
  const palette = [[1.0, 0.72, 0.36], [1.0, 0.72, 0.36], [0.4, 0.8, 1.0], [1.0, 0.3, 0.35], [0.4, 1.0, 0.6]];
  berths.forEach(([x, z, ry], i) => {
    const s = 0.8 + r() * 0.7;
    const b = new THREE.Group();
    const hull = new THREE.Mesh(hullGeo, hullMats[i % hullMats.length]); hull.rotation.y = -Math.PI / 2;
    b.add(hull);
    const mastH = 9 + r() * 7;
    const parts = [new THREE.CylinderGeometry(0.06, 0.09, mastH, 6).translate(0, 1.4 + mastH / 2, 0.6), box(1.5, 1.0, 3.2, 0, 1.9, -1.0), new THREE.CylinderGeometry(0.04, 0.04, 4.2, 5).rotateX(Math.PI / 2).translate(0, 3.2, -1.6)];
    b.add(new THREE.Mesh(mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)), darkMetal));
    b.position.set(x, -0.5, z); b.rotation.y = ry; b.scale.setScalar(s);
    group.add(b);
    boats.push({ g: b, ph: r() * 6.28, lightStart: lp.length / 3, base: [] });
    // string lights from bow to masthead to stern
    const c = palette[Math.floor(r() * palette.length)];
    const top = new THREE.Vector3(0, 1.4 + mastH, 0.6), bow = new THREE.Vector3(0, 1.5, 6.0), stern = new THREE.Vector3(0, 1.5, -5.0);
    const pts = [];
    for (let k = 0; k <= 16; k++) { pts.push(bow.clone().lerp(top, k / 16)); pts.push(stern.clone().lerp(top, k / 16)); }
    b.updateMatrixWorld(true);
    for (const p of pts) { p.y -= Math.sin(Math.PI * (p.y - 1.5) / (mastH)) * 0.5; p.applyMatrix4(b.matrixWorld); lp.push(p.x, p.y, p.z); lc.push(c[0] * 3.2, c[1] * 3.2, c[2] * 3.2); ls.push(0.16); lph.push(r()); }
  });
  const boatLights = createGlowPoints(lp, lc, ls, lph, { twinkle: 0.2 });
  group.add(boatLights.points);

  // far shore: dark hills with a scatter of house lights (reduced fog so it glows through the rain)
  const hillShape = new THREE.Shape();
  hillShape.moveTo(-1500, 0);
  for (let x = -1500; x <= 1500; x += 60) hillShape.lineTo(x, 26 + 42 * (0.5 + 0.5 * Math.sin(x * 0.0031 + 1.0)) + 18 * Math.sin(x * 0.011) + (x < -300 ? 55 * Math.exp(-Math.pow((x + 760) / 330, 2)) : 0));
  hillShape.lineTo(1500, 0);
  const hills = new THREE.Mesh(new THREE.ShapeGeometry(hillShape), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.018, 0.028, 0.048), fog: false }));
  hills.position.set(0, -1, LAKE_Z - 1150);
  group.add(hills);
  const hp = [], hc = [], hs = [], hph = [];
  for (let i = 0; i < 1500; i++) {
    const x = -1400 + r() * 2800;
    const top = 26 + 42 * (0.5 + 0.5 * Math.sin(x * 0.0031 + 1.0)) + 18 * Math.sin(x * 0.011) + (x < -300 ? 55 * Math.exp(-Math.pow((x + 760) / 330, 2)) : 0);
    const y = 1 + Math.pow(r(), 1.6) * (top - 6);
    hp.push(x, y, LAKE_Z - 1145 + r() * 40);
    const warm = r() < 0.8; const k = 0.5 + r() * 1.3;
    hc.push((warm ? 1.0 : 0.6) * k, (warm ? 0.68 : 0.8) * k, (warm ? 0.36 : 1.0) * k); hs.push(1.6 + r() * 1.6); hph.push(r());
  }
  const shore = createGlowPoints(hp, hc, hs, hph, { twinkle: 0.12, fogK: 0.14 });
  group.add(shore.points);

  const update = (t) => {
    for (const b of boats) { b.g.rotation.z = Math.sin(t * 0.7 + b.ph) * 0.025; b.g.position.y = -0.5 + Math.sin(t * 0.9 + b.ph * 2.0) * 0.06; }
  };
  return { group, update, glow: [boatLights, shore, parkHalo], facadeUniforms: fm.uniforms };
}

// ---------------------------------------------------------------- Space Needle on the western skyline
export function createNeedle() {
  const group = new THREE.Group();
  const H = 184;
  const fogC = new THREE.Color().fromArray(FOG_COLOR);
  const haze = (c, k) => new THREE.Color(...c).lerp(fogC, k);
  const steel = new THREE.MeshBasicMaterial({ color: haze([0.50, 0.46, 0.40], 0.42), fog: false });
  const dark = new THREE.MeshBasicMaterial({ color: haze([0.10, 0.11, 0.13], 0.5), fog: false });
  const geos = [];
  // three pairs of legs: wide at the base, pinched at the waist, flaring under the saucer
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    for (const off of [-0.11, 0.11]) {
      const pts = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20; const y = t * 150;
        const rad = 3.2 + 15 * Math.pow(1 - t, 2.4) + 9 * Math.pow(Math.max(0, t - 0.72) / 0.28, 2.0);
        pts.push(new THREE.Vector3(Math.cos(a + off * (1 - t * 0.5)) * rad, y, Math.sin(a + off * (1 - t * 0.5)) * rad));
      }
      geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 1.25, 6, false));
    }
  }
  geos.push(new THREE.CylinderGeometry(2.6, 3.0, 150, 12, 1, true).translate(0, 75, 0));        // core
  geos.push(new THREE.CylinderGeometry(9, 7, 2, 24).translate(0, 30, 0));                        // skyline level ring
  group.add(new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), steel));
  // saucer
  const prof = [[0, 146], [6, 146.5], [14, 149], [19.5, 152.5], [21, 154.2], [20.2, 155.6], [17.5, 156.6], [16.8, 159.2], [20.6, 160.2], [20.2, 161.2], [12, 163.5], [6, 166], [2.2, 168], [1.2, 176], [0.5, H]].map(([x, y]) => new THREE.Vector2(x, y));
  group.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshBasicMaterial({ color: haze([0.62, 0.56, 0.46], 0.4), fog: false })));
  // glowing observation band
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(17.3, 17.3, 2.3, 48, 1, true).translate(0, 157.9, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.9), fog: false })));
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(20.7, 20.7, 0.5, 48, 1, true).translate(0, 160.4, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.9), fog: false })));
  void dark;
  const p = [], c = [], s = [], ph = [];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * 6.283; p.push(Math.cos(a) * 21, 154.4, Math.sin(a) * 21); c.push(2.2, 1.6, 0.9); s.push(1.6); ph.push(i / 36); }
  const rim = createGlowPoints(p, c, s, ph, { twinkle: 0.1, fogK: 0.2 });
  const beacon = createGlowPoints([0, H + 1, 0], [9, 0.5, 0.3], [7], [0], { blink: 1, fogK: 0.2 });
  group.add(rim.points, beacon.points);
  group.position.set(-640, 0, 92);
  return { group, glow: [rim, beacon] };
}

// ---------------------------------------------------------------- South Lake Union streetcar
export function createStreetcar() {
  const group = new THREE.Group();
  const s = new THREE.Shape();   // side profile, x along the car
  const L = 9.6;
  s.moveTo(-L, 0.45); s.lineTo(-L - 0.5, 1.2); s.quadraticCurveTo(-L - 0.2, 3.3, -L + 1.2, 3.45);
  s.lineTo(L - 1.2, 3.45); s.quadraticCurveTo(L + 0.2, 3.3, L + 0.5, 1.2); s.lineTo(L, 0.45); s.closePath();
  const bodyG = new THREE.ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelOffset: -0.12, bevelSegments: 3 }).translate(0, 0, -1.1);
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x7a1fa2, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  group.add(new THREE.Mesh(bodyG, paint));
  const win = [], dark = [];
  for (const side of [-1, 1]) {
    win.push(box(L * 2 - 2.6, 1.15, 0.03, 0, 2.3, side * 1.235));
    for (let x = -L + 2; x < L - 1; x += 2.1) dark.push(box(0.14, 1.25, 0.05, x, 2.3, side * 1.24));
    dark.push(box(L * 2 + 0.6, 0.5, 0.06, 0, 0.6, side * 1.22));
  }
  dark.push(box(4, 0.25, 1.4, 0, 3.6, 0), box(0.08, 1.3, 0.08, 0.6, 4.3, 0), box(2.6, 0.06, 0.06, 0, 4.95, 0));   // roof gear + pantograph
  group.add(new THREE.Mesh(mergeGeometries(win), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.6) })));
  group.add(new THREE.Mesh(mergeGeometries(dark), darkMetal));
  const headM = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 11, 9) }), tailM = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.15) });
  const lampG = (x) => mergeGeometries([box(0.05, 0.16, 0.34, x, 1.15, 0.72), box(0.05, 0.16, 0.34, x, 1.15, -0.72), box(0.05, 0.3, 1.2, x * 0.985, 3.05, 0)]);
  const front = new THREE.Mesh(lampG(L + 0.42), headM), back = new THREE.Mesh(lampG(-L - 0.42), tailM);
  group.add(front, back);

  // loop: north on the east track, south on the west track, pausing at stops
  const TRACK = 5.2, Z0 = 246, Z1 = -246;
  const stops = [200, 44, -132, -230];
  const state = { dir: -1, z: 150, v: 0, wait: 0, x: TRACK };
  const collider = { x0: 0, x1: 0, z0: 0, z1: 0, moving: true };
  const update = (dt) => {
    const maxV = 9.5;
    if (state.wait > 0) { state.wait -= dt; state.v = Math.max(0, state.v - 6 * dt); }
    else {
      // slow for the next stop
      const next = stops.map(q => (q - state.z) * state.dir).filter(d => d > 0.5).sort((a, b) => a - b)[0];
      const endD = (state.dir < 0 ? state.z - Z1 : Z0 - state.z);
      const dStop = Math.min(next ?? 1e9, endD);
      const target = Math.min(maxV, Math.sqrt(Math.max(0, 2 * 1.4 * dStop)) + 0.3);
      state.v += THREE.MathUtils.clamp(target - state.v, -3 * dt, 1.6 * dt);
      state.z += state.dir * state.v * dt;
      if (endD < 0.6) { state.dir *= -1; state.x = -state.x; state.wait = 4; state.v = 0; }
      else if (next !== undefined && next < 0.6) { state.wait = 5; state.z += state.dir * 0.7; }
    }
    group.position.set(state.x, 0.02, state.z);
    group.rotation.y = state.dir < 0 ? Math.PI / 2 : -Math.PI / 2;
    collider.x0 = state.x - 1.3; collider.x1 = state.x + 1.3; collider.z0 = state.z - L - 0.6; collider.z1 = state.z + L + 0.6;
  };
  update(0);
  return { group, update, state, collider, halfLen: L };
}

export const PARK_Z = Z_NORTH;
