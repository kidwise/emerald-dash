import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, GLSL_LAMPS, GLSL_SKY } from '../gfx/glsl.js';
import { cityCells, CURB, FOG_COLOR, FOG_DENSITY, Z_NORTH, LAKE_Z, HILL_Z, hillF, heightAt, WESTLAKE_INDEX, BRICK_INDEX } from '../config.js';

const VERT = /* glsl */`
varying vec3 vWPos;
varying vec3 vN;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform sampler2D tReflect;
uniform mat4 uReflectMatrix;
uniform float uTime;
uniform float uPlaneY;
uniform float uRain;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uAmbient;
uniform vec4 uHeadPos[12];   // xyz = position, w = intensity
uniform vec4 uHeadDir[12];   // xyz = direction, w = warm(0)/red(1) tint
uniform vec4 uGlow[8];      // xyz = position, w = radius   (coloured local glows: targets, signs)
uniform vec3 uGlowCol[8];
varying vec3 vWPos;
varying vec3 vN;
${GLSL_NOISE}
${GLSL_LAMPS}
${GLSL_SKY}

const float PARK_WATER_Z = ${(LAKE_Z + 2.6).toFixed(1)};
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

// Paint for one road. c = across, a = along, hw = half width, dInt = distance to the crossing road's kerb line.
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

  float avD = 1e4, avC = 0.0, avHW = 0.0; int avI = 0;
  float stD = 1e4, stC = 0.0, stHW = 0.0; int stI = 0;
  for (int i = 0; i < N_AV; i++) { if (p.y < AVZ0[i] || p.y > AVZ1[i]) continue; float c = p.x - AVX[i]; float d = abs(c) - AVHW[i]; if (d < avD) { avD = d; avC = c; avHW = AVHW[i]; avI = i; } }
  for (int j = 0; j < N_ST; j++) { if (p.x < STX0[j] || p.x > STX1[j]) continue; float c = p.y - STZ[j]; float d = abs(c) - STHW[j]; if (d < stD) { stD = d; stC = c; stHW = STHW[j]; stI = j; } }
  // water runs off the hills: standing puddles only on level ground
  float level = 1.0 - smoothstep(0.02, 0.07, abs(terrainH(p + vec2(1.0, 0.0)) - terrainH(p - vec2(1.0, 0.0))) * 0.5);

  float detail = 1.0 / (1.0 + dist * 0.02);
  float nLow = fbm(p * 0.085 + 3.1);
  float nMid = vnoise(p * 1.7);
  float nHi = vnoise(p * 23.0);

  vec3 albedo; float rough; float puddle; float reflK; float bump;
  vec3 N = vec3(0.0, 1.0, 0.0);

#if MODE == 0
  // ---------------- asphalt road ----------------
  albedo = vec3(0.034, 0.036, 0.040) * (0.75 + 0.6 * nLow) + (nHi - 0.5) * 0.018 * detail;
  // old repair patches and sealant lines
  float patchK = smoothstep(0.60, 0.62, vnoise(floor(p / vec2(3.1, 5.3)) * 1.7));
  albedo *= 1.0 - 0.22 * patchK * step(0.7, vnoise(p * 0.21));
  float crack = smoothstep(0.012, 0.0, abs(vnoise(p * 0.55) - 0.5)) * smoothstep(0.45, 0.6, vnoise(p * 0.13 + 9.0));
  albedo *= 1.0 - 0.6 * crack * detail;

  float kerb = 1e4;
  bool inAv = avD < 0.0, inSt = stD < 0.0;
  if (inAv && !inSt) kerb = -avD; else if (inSt && !inAv) kerb = -stD;
  float gutter = smoothstep(1.9, 0.15, kerb);
  puddle = smoothstep(0.50, 0.60, nLow + gutter * 0.16 * (0.5 + nMid)) * level;
  rough = mix(0.34, 0.02, puddle);
  bump = mix(0.55, 0.0, puddle);
  reflK = mix(0.55, 1.0, puddle);

  vec4 paint = vec4(0.0);
  if (inAv && !inSt) paint = roadPaint(avC, p.y, avHW, stD, avI == ${WESTLAKE_INDEX} ? 1.0 : 0.0);
  else if (inSt && !inAv) paint = roadPaint(stC, p.x, stHW, avD, 1.0 - step(9.0, stHW) * 1.0);
  float wear = smoothstep(0.18, 0.5, nMid * 0.6 + nHi * 0.4 + 0.12);
  paint.a *= wear;
  albedo = mix(albedo, paint.rgb * (0.8 + 0.3 * nMid), paint.a);
  rough = mix(rough, max(rough, 0.2), paint.a);

  // streetcar track slab + rails on Westlake
  if (avI == ${BRICK_INDEX} && avD < 0.0) {
    // Pike Place: worn red brick paving
    vec2 bq = p / vec2(0.11, 0.22); bq.y += 0.5 * mod(floor(bq.x), 2.0);
    vec2 bf = fract(bq); float bw = fwidth(bq.x) + fwidth(bq.y);
    float mortar = (1.0 - smoothstep(0.04 + bw, 0.09 + bw, min(min(bf.x, 1.0 - bf.x), min(bf.y, 1.0 - bf.y)))) / (1.0 + bw * 3.0);
    vec3 brick = vec3(0.16, 0.055, 0.04) * (0.7 + 0.6 * hash12(floor(bq)) * detail + 0.3 * (1.0 - detail)) * (0.8 + 0.4 * nLow);
    albedo = mix(albedo, brick * (1.0 - 0.5 * mortar), 1.0 - paint.a * 0.85);
    rough = mix(0.30, 0.03, puddle); bump = 0.7 * (1.0 - puddle);
  }
  if (avI == ${WESTLAKE_INDEX} && avD < 0.0 && p.y < 252.0) {
    float tc = abs(abs(avC) - 5.2);
    float slab = 1.0 - smoothstep(1.48, 1.52, tc);
    vec2 sj = fract(vec2(avC, p.y) / vec2(1.5, 3.0));
    float joint = max(band(sj.y, 0.0, 0.012), band(sj.y, 1.0, 0.012));
    albedo = mix(albedo, vec3(0.085, 0.085, 0.082) * (0.85 + 0.3 * nMid) * (1.0 - 0.5 * joint), slab * (1.0 - paint.a));
    float rail = band(tc, 0.72, 0.045);
    albedo = mix(albedo, vec3(0.30, 0.31, 0.33), rail);
    rough = mix(rough, 0.12, rail); reflK = mix(reflK, 1.3, rail); bump *= 1.0 - rail;
    float groove = band(tc, 0.80, 0.02);
    albedo *= 1.0 - 0.7 * groove;
  }
  // manhole covers
  vec2 mc = floor(p / 29.0); vec2 mo = (hash22(mc) - 0.5) * 16.0;
  float md = length(p - (mc + 0.5) * 29.0 - mo);
  float mh = 1.0 - smoothstep(0.42, 0.44, md);
  albedo = mix(albedo, vec3(0.05, 0.045, 0.04) * (0.7 + 0.6 * step(0.5, fract(md * 9.0))), mh);
  rough = mix(rough, 0.22, mh);
#elif MODE == 1
  // ---------------- concrete sidewalk ----------------
  float roadD = min(avD, stD);
  vec2 sc = p / 0.61;
  vec2 cell = floor(sc); vec2 sf = fract(sc);
  float fw = fwidth(sc.x) + fwidth(sc.y);
  float jointK = 1.0 - smoothstep(0.02 + fw, 0.035 + fw, min(min(sf.x, 1.0 - sf.x), min(sf.y, 1.0 - sf.y)));
  jointK *= 1.0 / (1.0 + fw * 6.0);
  float tone = 0.86 + 0.24 * hash12(cell) * detail;
  albedo = vec3(0.145, 0.142, 0.136) * tone * (0.8 + 0.4 * nLow) + (nHi - 0.5) * 0.02 * detail;
  albedo *= 1.0 - 0.45 * jointK;
  float kerbBand = 1.0 - smoothstep(0.16, 0.2, roadD);
  albedo = mix(albedo, vec3(0.17, 0.17, 0.168) * (0.9 + 0.2 * nMid), kerbBand);
  // stained, darker strip near the kerb and random gum / oil spots
  albedo *= 1.0 - 0.25 * smoothstep(0.75, 0.9, vnoise(p * 2.3)) ;
  puddle = smoothstep(0.60, 0.68, nLow + 0.05 * nMid);
  rough = mix(0.30, 0.03, puddle);
  bump = mix(0.35, 0.0, puddle);
  reflK = mix(0.42, 0.95, puddle);
  if (vN.y < 0.5) { albedo = vec3(0.10, 0.10, 0.098) * (0.8 + 0.4 * nMid); N = normalize(vN); reflK = 0.0; }
#else
  // ---------------- park: lawn, paths, plaza ----------------
  float path = 0.0;
  path = max(path, 1.0 - smoothstep(4.6, 4.8, abs(p.x)));                         // central promenade
  path = max(path, 1.0 - smoothstep(6.5, 6.7, abs(p.y - (${(LAKE_Z + 8).toFixed(1)}))));  // waterfront walk
  path = max(path, 1.0 - smoothstep(3.0, 3.2, abs(p.y - (${(Z_NORTH - 4).toFixed(1)}))));  // street-side walk
  path = max(path, 1.0 - smoothstep(2.4, 2.6, abs(abs(p.x) - 60.0 - (p.y - ${Z_NORTH.toFixed(1)}) * 0.45)));
  path = max(path, 1.0 - smoothstep(26.0, 26.3, length(p - vec2(0.0, ${(LAKE_Z + 34).toFixed(1)}))));  // plaza disc
  vec2 pc = p / 1.2; vec2 pf = fract(pc);
  float fw2 = fwidth(pc.x) + fwidth(pc.y);
  float pj = (1.0 - smoothstep(0.02 + fw2, 0.04 + fw2, min(min(pf.x, 1.0 - pf.x), min(pf.y, 1.0 - pf.y)))) / (1.0 + fw2 * 6.0);
  vec3 paver = vec3(0.12, 0.115, 0.11) * (0.85 + 0.3 * hash12(floor(pc))) * (1.0 - 0.4 * pj);
  vec3 grass = vec3(0.020, 0.050, 0.018) * (0.6 + 0.9 * nLow) * (0.8 + 0.4 * vnoise(p * 7.0));
  albedo = mix(grass, paver, path);
  puddle = path * smoothstep(0.58, 0.66, nLow);
  rough = mix(mix(0.95, 0.3, path), 0.03, puddle);
  bump = mix(0.9, 0.3, path) * (1.0 - puddle);
  reflK = mix(0.0, 0.45, path); reflK = mix(reflK, 0.95, puddle);
#endif

  // micro normal from noise gradient + rain ripples in standing water
  vec2 e = vec2(0.02, 0.0);
  float n0 = vnoise(p * 27.0), nx = vnoise((p + e.xy) * 27.0), nz = vnoise((p + e.yx) * 27.0);
  vec2 grad = vec2(nx - n0, nz - n0) * detail;
  float m0 = vnoise(p * 2.3), mx = vnoise((p + vec2(0.15, 0.0)) * 2.3), mz = vnoise((p + vec2(0.0, 0.15)) * 2.3);
  vec2 grad2 = vec2(mx - m0, mz - m0);
  vec2 rip = ripple(p, uTime) * puddle * 0.05 * smoothstep(70.0, 12.0, dist) * uRain;
  vec2 tilt = (grad * 0.26 + grad2 * 0.10) * bump + rip;
  if (vN.y > 0.5) N = normalize(vec3(-tilt.x, 1.0, -tilt.y));

  // ---------------- lighting ----------------
  vec3 light = uAmbient;
  light += LAMP_COLOR * lampSum(P) * 7.5;
#if MODE == 2
  {
    // park lamps: a row along the waterfront walk and a pair of rows down the promenade
    float kx = floor(P.x / 22.0 + 0.5) * 22.0;
    for (int o = -1; o <= 1; o++) { float lx = kx + float(o) * 22.0; if (abs(lx) < 200.0) light += LAMP_COLOR * lampFall(P, vec3(lx, 5.2, PARK_WATER_Z)) * 6.0; }
    for (int j = 0; j < 4; j++) { float lz = Z_NORTH - 12.0 - 22.0 * float(j); light += LAMP_COLOR * (lampFall(P, vec3(-5.6, 5.2, lz)) + lampFall(P, vec3(5.6, 5.2, lz))) * 6.0; }
  }
#endif
#if MODE == 1
  if (P.x < -536.0 && P.z > 0.0 && P.z < 262.0) {
    // Seattle Center: pedestrian lamps on a 44 m grid
    vec2 b = floor((P.xz - vec2(-730.0, 30.0)) / 44.0 + 0.5);
    for (int ox = -1; ox <= 1; ox++) for (int oz = -1; oz <= 1; oz++) {
      vec2 k = b + vec2(float(ox), float(oz));
      if (k.x < 0.0 || k.x > 4.0 || k.y < 0.0 || k.y > 5.0) continue;
      light += LAMP_COLOR * lampFall(P, vec3(-730.0 + k.x * 44.0, 6.2, 30.0 + k.y * 44.0)) * 9.0;
    }
  }
  if (P.x < -452.0 && P.z > 345.0) {
    // Pike Place deck lamps
    float kd = floor(P.z / 22.0 + 0.5);
    for (int o = -1; o <= 1; o++) light += LAMP_COLOR * lampFall(P, vec3(-512.0, hillF(-512.0) + 5.3, (kd + float(o)) * 22.0)) * 7.0;
  }
#endif
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

  // ---------------- mirror-like wet reflection ----------------
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.035 + 0.965 * pow(1.0 - NdV, 5.0);
  vec4 rc = uReflectMatrix * vec4(P.x, uPlaneY, P.z, 1.0);
  vec2 ruv = rc.xy / rc.w + N.xz * 0.07;
  float lod = rough * 9.0;
  vec3 refl = vec3(0.0); float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    float w = 1.0 - abs(float(i)) / 4.0;
    vec2 o = vec2(0.0, float(i)) * rough * 0.05;        // vertical streaking on rough wet asphalt
    refl += min(textureLod(tReflect, ruv + o, lod).rgb, vec3(48.0)) * w; wsum += w;
  }
  refl /= wsum;
  // the mirror image is only valid on ground level with the mirror plane; elsewhere reflect the sky
  float onPlane = 1.0 - smoothstep(0.45, 0.9, abs(P.y - uPlaneY));
  vec3 Rv = reflect(-V, N);
  vec3 skyR = skyColor(normalize(vec3(Rv.x, abs(Rv.y) + 0.03, Rv.z)), uTime) * 1.5 + LAMP_COLOR * lampSum(P + vec3(Rv.x, 0.0, Rv.z) * 9.0) * 0.5;
  refl = mix(skyR, refl, onPlane);
  col += refl * fres * reflK * 1.6;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(48.0)), 1.0);
}`;

function roundedRect(x0, x1, z0, z1, r) {
  // r = corner radii [NW, NE, SE, SW]; shape y = -z (the extrusion is rotated to lie flat)
  const [rnw, rne, rse, rsw] = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  const y0 = -z1, y1 = -z0;
  s.moveTo(x0 + rsw, y0);
  s.lineTo(x1 - rse, y0); if (rse) s.quadraticCurveTo(x1, y0, x1, y0 + rse);
  s.lineTo(x1, y1 - rne); if (rne) s.quadraticCurveTo(x1, y1, x1 - rne, y1);
  s.lineTo(x0 + rnw, y1); if (rnw) s.quadraticCurveTo(x0, y1, x0, y1 - rnw);
  s.lineTo(x0, y0 + rsw); if (rsw) s.quadraticCurveTo(x0, y0, x0 + rsw, y0);
  return s;
}
function slab(x0, x1, z0, z1, r, hill) {
  const g = new THREE.ExtrudeGeometry(roundedRect(x0, x1, z0, z1, r), { depth: CURB, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2);
  if (hill) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + hillF(p.getX(i))); g.computeVertexNormals(); }
  return g;
}
// flat quad or, with xs given, a strip that follows the hill profile
function patch(x0, x1, z0, z1, xs) {
  const cols = xs || [x0, x1];
  const pos = [], idx = [];
  cols.forEach((x, i) => { const y = xs ? hillF(x) : 0; pos.push(x, y, z0, x, y, z1); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function createGround(reflection) {
  const shared = {
    tReflect: { value: reflection.rt.texture },
    uReflectMatrix: { value: reflection.textureMatrix },
    uTime: { value: 0 }, uPlaneY: { value: 0 }, uRain: { value: 1 },
    uFogColor: { value: new THREE.Color().fromArray(FOG_COLOR) },
    uFogDensity: { value: FOG_DENSITY },
    uAmbient: { value: new THREE.Color(0.20, 0.30, 0.50) },
    uHeadPos: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, -100, 0, 0)) },
    uHeadDir: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uGlow: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uGlowCol: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
  };
  const mk = (mode) => new THREE.ShaderMaterial({
    uniforms: shared, vertexShader: VERT, fragmentShader: FRAG, defines: { MODE: mode },
  });

  const group = new THREE.Group();
  // road surface: level everywhere except the downtown hill, which gets its own stepped strip
  const hillXs = [-520, -448];
  for (let k = 0; k < 4; k++) hillXs.push(-432 + 88 * k, -360 + 88 * k);
  hillXs.push(-96);
  const road = new THREE.Mesh(mergeGeometries([
    patch(-1500, 900, -1100, HILL_Z), patch(-96, 900, HILL_Z, 1500), patch(-520, -96, HILL_Z, 1500, hillXs),
  ]), mk(0));
  road.frustumCulled = false;
  group.add(road);

  const geos = [];
  for (const c of cityCells()) {
    if (c.kind === 'bay') continue;
    const R = 4.5, r = c.roads;
    geos.push(slab(c.x0, c.x1, c.z0, c.z1, [r.n && r.w ? R : 0, r.n && r.e ? R : 0, r.s && r.e ? R : 0, r.s && r.w ? R : 0], c.hill));
    // north sidewalk of Lenora St: it slopes with the street while the block above stays level
    if (c.cliff && c.x0 >= -440) geos.push(slab(c.x0, c.x1, HILL_Z, 345, [0, 0, r.e ? R : 0, r.w ? R : 0], true));
  }
  const slabs = new THREE.Mesh(mergeGeometries(geos), mk(1));
  slabs.frustumCulled = false;
  group.add(slabs);

  const parkShape = roundedRect(-420, 420, LAKE_Z, Z_NORTH, 2);
  const parkGeo = new THREE.ExtrudeGeometry(parkShape, { depth: CURB, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const park = new THREE.Mesh(parkGeo, mk(2));
  group.add(park);

  group.traverse(o => o.layers.set(1));
  void heightAt;
  return { group, uniforms: shared };
}
