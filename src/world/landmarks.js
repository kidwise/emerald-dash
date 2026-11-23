import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, GLSL_SKY } from '../gfx/glsl.js';
import { darkMetal } from './props.js';
import { FOG_COLOR, FOG_DENSITY } from '../config.js';

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// ---------------------------------------------------------------- Lake Union
export function createLake(reflection, o = {}) {
  const uniforms = {
    tReflect: { value: reflection.rt.texture }, uReflectMatrix: { value: reflection.textureMatrix },
    uTime: { value: 0 }, uPlanar: { value: o.planar ?? 1 }, uMirrorY: { value: 0 }, uFogColor: { value: new THREE.Color().fromArray(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vWPos; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tReflect; uniform mat4 uReflectMatrix; uniform float uTime; uniform float uPlanar; uniform float uMirrorY; uniform vec3 uFogColor; uniform float uFogDensity;
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
        vec4 rc = uReflectMatrix * vec4(vWPos.x, uMirrorY, vWPos.z, 1.0);
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
  if (o.geometry) mesh.position.set(0, o.y ?? 0, 0); else mesh.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  mesh.layers.set(1);
  return { mesh, uniforms };
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
