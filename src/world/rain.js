import * as THREE from 'three';
import { GLSL_LAMPS } from '../gfx/glsl.js';

// Rain streaks in a box that follows the camera. Drops catch street-lamp and headlight light.
export function createRain(count = 15000) {
  const base = new Float32Array(count * 2 * 3), end = new Float32Array(count * 2), rnd = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), r = Math.random();
    for (let k = 0; k < 2; k++) {
      base.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; rnd[i * 2 + k] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() },
    uHeadPos: { value: new THREE.Vector3(0, -100, 0) }, uHeadDir: { value: new THREE.Vector3(1, 0, 0) }, uIntensity: { value: 1 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aEnd; attribute float aRnd;
      uniform float uTime; uniform vec3 uCenter; uniform vec3 uCamVel; uniform vec3 uHeadPos; uniform vec3 uHeadDir; uniform float uIntensity;
      varying vec3 vCol;
      ${GLSL_LAMPS}
      const vec3 B = vec3(46.0, 26.0, 46.0);
      void main(){
        float speed = 17.0 + aRnd * 7.0;
        vec3 wind = vec3(2.2, 0.0, 1.1);
        vec3 p = position * B;
        p += vec3(wind.x, -speed, wind.z) * uTime;
        vec3 q = mod(p - uCenter + B * 0.5, B) - B * 0.5 + uCenter;
        vec3 streak = (vec3(wind.x, -speed, wind.z) - uCamVel * 0.85) * 0.021;
        q += streak * aEnd;
        vec4 mv = viewMatrix * vec4(q, 1.0);
        float dist = -mv.z;
        float fade = smoothstep(26.0, 6.0, dist) * smoothstep(0.4, 2.0, dist);
        vec3 lit = vec3(0.30, 0.38, 0.52) * 0.055;
        lit += mix(LAMP_COLOR, vec3(1.0), 0.35) * 0.10 * step(0.0, 9.5 - q.y);
        vec3 L = q - uHeadPos; float d = length(L);
        float cone = smoothstep(0.82, 0.97, dot(L / max(d, 0.01), uHeadDir));
        lit += vec3(1.0, 0.95, 0.85) * cone * exp(-d * 0.09) * 0.9;
        vCol = lit * fade * uIntensity * (0.55 + 0.45 * aEnd);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.0); }`,
  });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  lines.layers.set(2);
  return { lines, uniforms };
}

// Slow drifting steam: rooftop exhaust stacks and street vents.
export function createSteam(sources) {
  const per = 22;
  const n = sources.length * per;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n), sc = new Float32Array(n);
  sources.forEach((s, i) => {
    for (let k = 0; k < per; k++) { const j = i * per + k; pos.set([s[0], s[1], s[2]], j * 3); ph[j] = Math.random(); sc[j] = s[3] ?? 1; }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aScale', new THREE.BufferAttribute(sc, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 700 } };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float aPhase; attribute float aScale;
      uniform float uTime; uniform float uScale;
      varying float vA; varying float vWarm;
      void main(){
        float t = fract(uTime * (0.07 + 0.03 * fract(aPhase * 13.0)) / aScale * 1.6 + aPhase);
        vec3 p = position;
        float rise = 13.0 * aScale;
        p.y += t * rise;
        p.x += (sin(aPhase * 40.0 + t * 5.0) * 0.7 + t * 4.5) * aScale;
        p.z += (cos(aPhase * 31.0 + t * 4.0) * 0.7 + t * 2.0) * aScale;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((1.2 + t * 7.0) * aScale * uScale / max(-mv.z, 0.1), 2.0, 420.0);
        vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * 0.20 * exp(-(mv.z * 0.0034) * (mv.z * 0.0034));
        vWarm = exp(-max(p.y, 0.0) * 0.12);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vWarm;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, d);
        vec3 col = mix(vec3(0.16, 0.20, 0.28), vec3(0.75, 0.52, 0.32), vWarm * 0.8);
        gl_FragColor = vec4(col, a * a * vA);
      }`,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.layers.set(2);
  return { points, uniforms };
}
