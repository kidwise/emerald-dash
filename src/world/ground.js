import * as THREE from 'three';
import { GLSL_NOISE, GLSL_LAMPS, GLSL_SKY } from '../gfx/glsl.js';
import { FOG_COLOR, FOG_DENSITY } from '../config.js';

// The wet ground material. One shader, three surfaces (chosen with the MODE define):
//   3 = road ribbon   uv.x = metres across, uv.y = metres along, aInfo = (half width, kind, distance to junction)
//   4 = open paving   (parks are painted in from the green channel of the top-down texture)
//   5 = grass
// Street-lamp light comes from a top-down texture baked by the map (red channel).

const VERT = /* glsl */`
attribute vec4 aInfo;
varying vec4 vInfo;
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vInfo = aInfo; vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform sampler2D tReflect;
uniform sampler2D tLight;
uniform vec4 uLightRect;
uniform mat4 uReflectMatrix;
uniform float uTime;
uniform vec4 uPlane;        // the mirror plane: normal.xyz, d
uniform float uRain;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uAmbient;
uniform vec4 uHeadPos[12];   // xyz = position, w = intensity
uniform vec4 uHeadDir[12];   // xyz = direction, w = warm(0)/red(1) tint
uniform vec4 uGlow[8];       // xyz = position, w = radius   (coloured local glows: job markers)
uniform vec3 uGlowCol[8];
varying vec4 vInfo;
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vN;
${GLSL_NOISE}
${GLSL_LAMPS}
${GLSL_SKY}

float band(float x, float c, float hw){ float w = fwidth(x) * 0.75; return 1.0 - smoothstep(hw - w, hw + w, abs(x - c)); }
float dashes(float a, float period, float len){
  float f = mod(a, period); float w = fwidth(a);
  return smoothstep(0.0, w, f) * (1.0 - smoothstep(len, len + w, f));
}
float bars(float c, float period){
  float w = fwidth(c) / period;
  return smoothstep(0.25 - w, 0.25 + w, abs(fract(c / period) - 0.5));
}

// Rain ripples: expanding rings in a jittered grid.
vec2 ripple(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for (int l = 0; l < 2; l++) {
    vec2 q = p * (l == 0 ? 2.2 : 3.7) + float(l) * 7.3;
    vec2 id = floor(q); vec2 f = fract(q) - 0.5;
    vec2 rnd = hash22(id + float(l) * 13.0);
    float ph = fract(t * (0.7 + rnd.x * 0.5) + rnd.y * 7.0);
    vec2 c = (rnd - 0.5) * 0.5;
    vec2 d = f - c; float r = length(d);
    float ring = sin((r - ph * 0.5) * 42.0) * smoothstep(0.06, 0.0, abs(r - ph * 0.5)) * (1.0 - ph);
    acc += normalize(d + 1e-4) * ring;
  }
  return acc;
}

// Paint for one road. c = across, a = along, hw = half width, dInt = distance to the junction's kerb line.
vec4 roadPaint(float c, float a, float hw, float dInt, float kind){
  float m = 0.0; vec3 col = vec3(0.62, 0.62, 0.60);
  float inside = step(abs(c), hw - 0.35);
  float cw = smoothstep(0.9, 1.1, dInt) * (1.0 - smoothstep(4.1, 4.3, dInt));
  m = max(m, cw * bars(c, 1.5) * inside);
  m = max(m, band(dInt, 5.6, 0.22) * inside);
  float open = smoothstep(6.6, 6.8, dInt);
  float yl = (band(c, 0.17, 0.06) + band(c, -0.17, 0.06)) * open;
  float ac = abs(c);
  float wl = 0.0;
  if (hw > 9.0) {
    wl += band(ac, 3.55, 0.07) * dashes(a, 9.0, 3.0);
    if (kind < 0.5) wl += band(ac, 7.1, 0.07) * dashes(a + 4.0, 9.0, 3.0);
    else wl += band(ac, hw - 2.4, 0.06);
  } else {
    wl += band(ac, hw - 2.3, 0.06);
  }
  m = max(m, wl * open);
  if (yl > m) { col = vec3(0.62, 0.43, 0.05); m = yl; }
  return vec4(col, m);
}

void main(){
  vec3 P = vWPos; vec2 p = P.xz;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // water runs off the hills: standing puddles only on level ground
  float level = smoothstep(0.9900, 0.9985, vN.y);
  float detail = 1.0 / (1.0 + dist * 0.02);
  float nLow = fbm(p * 0.085 + 3.1);
  float nMid = vnoise(p * 1.7);
  float nHi = vnoise(p * 23.0);

  vec3 albedo; float rough; float puddle; float reflK; float bump;
  vec3 N = vec3(0.0, 1.0, 0.0);

#if MODE == 3
  // ---------------- road ribbon
  float hw3 = vInfo.x, c3 = vUv.x, dJ = vInfo.z;
  albedo = vec3(0.034, 0.036, 0.040) * (0.75 + 0.6 * nLow) + (nHi - 0.5) * 0.018 * detail;
  float crack3 = smoothstep(0.012, 0.0, abs(vnoise(p * 0.55) - 0.5)) * smoothstep(0.45, 0.6, vnoise(p * 0.13 + 9.0));
  albedo *= 1.0 - 0.6 * crack3 * detail;
  float kerb3 = hw3 - abs(c3);
  float gutter3 = smoothstep(1.9, 0.15, kerb3) * step(1.0, dJ);
  puddle = smoothstep(0.50, 0.60, nLow + gutter3 * 0.16 * (0.5 + nMid)) * level;
  rough = mix(0.34, 0.02, puddle); bump = mix(0.55, 0.0, puddle); reflK = mix(0.55, 1.0, puddle);
  vec4 paint3 = roadPaint(c3, vUv.y, hw3, dJ, vInfo.y);
  paint3.a *= smoothstep(0.18, 0.5, nMid * 0.6 + nHi * 0.4 + 0.12) * step(0.9, dJ);
  albedo = mix(albedo, paint3.rgb * (0.8 + 0.3 * nMid), paint3.a);
  rough = mix(rough, max(rough, 0.2), paint3.a);
  // the outer strip of the ribbon is the kerb stone
  if (kerb3 < 0.0 && dJ > 0.6) { albedo = vec3(0.17, 0.17, 0.168) * (0.9 + 0.2 * nMid); puddle = 0.0; rough = 0.3; reflK = 0.35; bump = 0.3; }
#elif MODE == 4
  // ---------------- open paving between buildings, with parks painted in
  vec2 sc4 = p / 0.61; vec2 cell4 = floor(sc4); vec2 sf4 = fract(sc4);
  float fw4 = fwidth(sc4.x) + fwidth(sc4.y);
  float joint4 = (1.0 - smoothstep(0.02 + fw4, 0.035 + fw4, min(min(sf4.x, 1.0 - sf4.x), min(sf4.y, 1.0 - sf4.y)))) / (1.0 + fw4 * 6.0);
  albedo = vec3(0.145, 0.142, 0.136) * (0.86 + 0.24 * hash12(cell4) * detail) * (0.8 + 0.4 * nLow) + (nHi - 0.5) * 0.02 * detail;
  albedo *= (1.0 - 0.45 * joint4) * (1.0 - 0.25 * smoothstep(0.75, 0.9, vnoise(p * 2.3)));
  puddle = smoothstep(0.60, 0.68, nLow + 0.05 * nMid) * level;
  rough = mix(0.30, 0.03, puddle); bump = mix(0.35, 0.0, puddle); reflK = mix(0.42, 0.95, puddle);
  float park = texture2D(tLight, (p - uLightRect.xy) / uLightRect.zw).g;
  vec3 grass4 = vec3(0.020, 0.050, 0.018) * (0.6 + 0.9 * nLow) * (0.8 + 0.4 * vnoise(p * 7.0));
  albedo = mix(albedo, grass4, park); puddle *= 1.0 - park; rough = mix(rough, 0.95, park); reflK *= 1.0 - park; bump = mix(bump, 0.9, park);
#else
  // ---------------- grass
  albedo = vec3(0.020, 0.050, 0.018) * (0.6 + 0.9 * nLow) * (0.8 + 0.4 * vnoise(p * 7.0));
  puddle = 0.0; rough = 0.95; bump = 0.9; reflK = 0.0;
#endif

  // micro normal from noise gradient + rain ripples in standing water
  vec2 e = vec2(0.02, 0.0);
  float n0 = vnoise(p * 27.0), nx = vnoise((p + e.xy) * 27.0), nz = vnoise((p + e.yx) * 27.0);
  vec2 grad = vec2(nx - n0, nz - n0) * detail;
  float m0 = vnoise(p * 2.3), mx = vnoise((p + vec2(0.15, 0.0)) * 2.3), mz = vnoise((p + vec2(0.0, 0.15)) * 2.3);
  vec2 grad2 = vec2(mx - m0, mz - m0);
  vec2 rip = ripple(p, uTime) * puddle * 0.05 * smoothstep(70.0, 12.0, dist) * uRain;
  vec2 tilt = (grad * 0.26 + grad2 * 0.10) * bump + rip;
  if (vN.y > 0.5) N = normalize(normalize(vN) + vec3(-tilt.x, 0.0, -tilt.y));

  // ---------------- lighting
  vec3 light = uAmbient;
  light += LAMP_COLOR * texture2D(tLight, (p - uLightRect.xy) / uLightRect.zw).r * 3.0;
  for (int i = 0; i < 12; i++) {
    if (uHeadPos[i].w <= 0.0) continue;
    vec3 L = P - uHeadPos[i].xyz; float d = length(L); vec3 ld = L / max(d, 1e-3);
    float cone = smoothstep(0.80, 0.985, dot(ld, uHeadDir[i].xyz));
    float pool = cone * exp(-d * 0.050) * smoothstep(1.0, 4.5, d);
    light += mix(vec3(1.0, 0.94, 0.82), vec3(1.0, 0.06, 0.03), uHeadDir[i].w) * pool * uHeadPos[i].w;
  }
  for (int i = 0; i < 8; i++) {
    vec3 L = uGlow[i].xyz - P; float r = uGlow[i].w;
    light += uGlowCol[i] * max(0.0, 1.0 - dot(L, L) / (r * r));
  }
  vec3 col = albedo * light * mix(1.0, 0.72, puddle);

  // ---------------- mirror-like wet reflection
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.035 + 0.965 * pow(1.0 - NdV, 5.0);
  float pd = dot(uPlane.xyz, P) + uPlane.w;
  vec4 rc = uReflectMatrix * vec4(P - uPlane.xyz * pd, 1.0);
  vec2 ruv = rc.xy / rc.w - tilt * 0.07;
  float lod = rough * 9.0;
  vec3 refl = vec3(0.0); float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    float w = 1.0 - abs(float(i)) / 4.0;
    vec2 o = vec2(0.0, float(i)) * rough * 0.05;        // vertical streaking on rough wet asphalt
    refl += min(textureLod(tReflect, ruv + o, lod).rgb, vec3(48.0)) * w; wsum += w;
  }
  refl /= wsum;
  // the mirror image is only valid on ground lying in the mirror plane; elsewhere reflect the sky
  float onPlane = 1.0 - smoothstep(0.45, 0.9, abs(pd));
  vec3 Rv = reflect(-V, N);
  vec3 skyR = skyColor(normalize(vec3(Rv.x, abs(Rv.y) + 0.03, Rv.z)), uTime) * 1.5;
  refl = mix(skyR, refl, onPlane);
  col += refl * fres * reflK * 1.6;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(48.0)), 1.0);
}`;

export function createGround(reflection) {
  const uniforms = {
    tReflect: { value: reflection.rt.texture },
    uReflectMatrix: { value: reflection.textureMatrix },
    tLight: { value: null }, uLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTime: { value: 0 }, uPlane: { value: new THREE.Vector4(0, 1, 0, 0) }, uRain: { value: 1 },
    uFogColor: { value: new THREE.Color().fromArray(FOG_COLOR) },
    uFogDensity: { value: FOG_DENSITY },
    uAmbient: { value: new THREE.Color(0.20, 0.30, 0.50) },
    uHeadPos: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uHeadDir: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uGlow: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uGlowCol: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
  };
  // mk(mode) makes a material for one of the surfaces listed at the top of this file
  const mk = (mode) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { MODE: mode } });
  return { uniforms, mk };
}
