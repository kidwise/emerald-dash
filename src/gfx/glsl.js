export const GLSL_NOISE = /* glsl */`
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

// Blue-hour sky. Shared by the sky dome and anything that wants a cheap sky lookup.
export const GLSL_SKY = /* glsl */`
const vec2 SUN_XZ = vec2(-0.88, 0.47);
vec3 skyColor(vec3 d, float time){
  float h = max(d.y, 0.0);
  vec3 zen = vec3(0.010, 0.022, 0.065);
  vec3 hor = vec3(0.060, 0.105, 0.190);
  vec3 col = mix(hor, zen, pow(h, 0.42));
  float az = max(dot(normalize(d.xz + 1e-5), SUN_XZ), 0.0);
  float glow = pow(az, 4.0) * exp(-h * 7.0);
  col += vec3(1.00, 0.36, 0.12) * glow * 0.42;
  col += vec3(0.55, 0.16, 0.30) * pow(az, 2.0) * exp(-h * 3.2) * 0.10;
  col += vec3(0.085, 0.060, 0.050) * exp(-h * 9.0);            // city light dome
  vec2 cuv = d.xz / (h + 0.14);
  float c = fbm(cuv * 0.9 + vec2(time * 0.004, 0.0));
  float c2 = fbm(cuv * 2.3 - vec2(time * 0.006, 3.0));
  float cover = smoothstep(0.34, 0.72, c * 0.75 + c2 * 0.25);
  vec3 cloud = mix(vec3(0.020, 0.028, 0.050), vec3(0.120, 0.082, 0.078), exp(-h * 3.5));
  cloud += vec3(1.0, 0.33, 0.14) * glow * 0.55;
  cloud *= 0.75 + 0.5 * c2;
  col = mix(col, cloud, cover * 0.92);
  if (d.y < 0.0) col = mix(col, vec3(0.012, 0.016, 0.026), smoothstep(0.0, -0.12, d.y));
  return col;
}
`;

// Street-lamp colour, shared by everything the lamps light.
export const GLSL_LAMPS = /* glsl */`
const vec3 LAMP_COLOR = vec3(1.0, 0.70, 0.40);
`;
