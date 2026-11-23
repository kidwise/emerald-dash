import * as THREE from 'three';
import { GLSL_NOISE } from '../gfx/glsl.js';

// Facade styles understood by the shader.
export const STYLE = { ROOF: 0, CURTAIN: 1, BRICK: 2, RIBBON: 3, RESI: 4, SOLID: 5, SKYLINE: 6, EMISSIVE: 7 };

// Accumulates wall / roof quads with the per-vertex data the facade shader needs.
export class FacadeGeo {
  constructor() {
    this.pos = []; this.nor = []; this.fuv = []; this.dim = []; this.par = []; this.par2 = []; this.tint = []; this.tint2 = []; this.idx = [];
    this.n = 0;
  }
  _v(x, y, z, nx, ny, nz, u, v, w, h, o) {
    this.pos.push(x, y + (this.yOff || 0), z); this.nor.push(nx, ny, nz); this.fuv.push(u, v); this.dim.push(w, h);
    this.par.push(o.style, o.seed ?? 0, o.floorH ?? 4, o.bayW ?? 1.5);
    this.par2.push(o.groundH ?? 0, o.lit ?? 0.4, o.a ?? 0, o.b ?? 0);
    const t = o.tint ?? [0.2, 0.2, 0.2], t2 = o.tint2 ?? [0.5, 0.5, 0.5];
    this.tint.push(t[0], t[1], t[2]); this.tint2.push(t2[0], t2[1], t2[2]);
    return this.n++;
  }
  // Vertical wall from (ax,az) to (bx,bz). Outward normal is to the right of a->b seen from above.
  wall(ax, az, bx, bz, y0, y1, o) {
    const dx = bx - ax, dz = bz - az, w = Math.hypot(dx, dz), h = y1 - y0;
    const nx = -dz / w, nz = dx / w;
    const a = this._v(ax, y0, az, nx, 0, nz, 0, 0, w, h, o);
    const b = this._v(bx, y0, bz, nx, 0, nz, w, 0, w, h, o);
    const c = this._v(bx, y1, bz, nx, 0, nz, w, h, w, h, o);
    const d = this._v(ax, y1, az, nx, 0, nz, 0, h, w, h, o);
    this.idx.push(a, b, c, a, c, d);
  }
  flat(x0, x1, z0, z1, y, o, up = true) {
    const ny = up ? 1 : -1;
    const a = this._v(x0, y, z1, 0, ny, 0, 0, 0, x1 - x0, z1 - z0, o);
    const b = this._v(x1, y, z1, 0, ny, 0, x1 - x0, 0, x1 - x0, z1 - z0, o);
    const c = this._v(x1, y, z0, 0, ny, 0, x1 - x0, z1 - z0, x1 - x0, z1 - z0, o);
    const d = this._v(x0, y, z0, 0, ny, 0, 0, z1 - z0, x1 - x0, z1 - z0, o);
    if (up) this.idx.push(a, b, c, a, c, d); else this.idx.push(a, c, b, a, d, c);
  }
  // flat roof triangle (points are [x, z])
  tri(a, b, c, y, o) {
    const i = [a, b, c].map(p => this._v(p[0], y, p[1], 0, 1, 0, p[0], p[1], 1, 1, o));
    this.idx.push(i[0], i[1], i[2]);
  }
  box(x0, x1, z0, z1, y0, y1, o, roof = { style: STYLE.ROOF }, bottom = false) {
    this.wall(x0, z1, x1, z1, y0, y1, o);
    this.wall(x1, z1, x1, z0, y0, y1, o);
    this.wall(x1, z0, x0, z0, y0, y1, o);
    this.wall(x0, z0, x0, z1, y0, y1, o);
    if (roof) this.flat(x0, x1, z0, z1, y1, roof.style === undefined ? { ...o, ...roof } : roof);
    if (bottom) this.flat(x0, x1, z0, z1, y0, bottom === true ? o : bottom, false);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aFuv', new THREE.Float32BufferAttribute(this.fuv, 2));
    g.setAttribute('aDim', new THREE.Float32BufferAttribute(this.dim, 2));
    g.setAttribute('aPar', new THREE.Float32BufferAttribute(this.par, 4));
    g.setAttribute('aPar2', new THREE.Float32BufferAttribute(this.par2, 4));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setAttribute('aTint2', new THREE.Float32BufferAttribute(this.tint2, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const VERT_PARS = /* glsl */`
attribute vec2 aFuv; attribute vec2 aDim; attribute vec4 aPar; attribute vec4 aPar2; attribute vec3 aTint; attribute vec3 aTint2;
varying vec2 vFuv; varying vec2 vDim; varying vec4 vPar; varying vec4 vPar2; varying vec3 vTint; varying vec3 vTint2;
varying vec3 vWPos; varying vec3 vWN;
`;
const VERT_MAIN = /* glsl */`
vFuv = aFuv; vDim = aDim; vPar = aPar; vPar2 = aPar2; vTint = aTint; vTint2 = aTint2;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * normal);
`;

const FRAG_PARS = /* glsl */`
varying vec2 vFuv; varying vec2 vDim; varying vec4 vPar; varying vec4 vPar2; varying vec3 vTint; varying vec3 vTint2;
varying vec3 vWPos; varying vec3 vWN;
uniform float uTime;
${GLSL_NOISE}
vec3 fAlbedo; float fRough; float fMetal; vec3 fEmis; float fGlass; vec2 fTilt; float fFogK;

float lineAA(float d, float w, float px){ return 1.0 - smoothstep(w - px, w + px, d); }
float edgeD(float f, float size){ return min(f, 1.0 - f) * size; }

vec3 lightTint(float r){
  return r < 0.50 ? vec3(1.00, 0.78, 0.52) : (r < 0.82 ? vec3(1.00, 0.92, 0.80) : vec3(0.76, 0.89, 1.00));
}
vec3 roomTone(float r){
  return r < 0.38 ? vec3(0.82, 0.76, 0.66) : (r < 0.62 ? vec3(0.56, 0.62, 0.66) : (r < 0.84 ? vec3(0.70, 0.48, 0.30) : vec3(0.26, 0.46, 0.50)));
}

// Interior mapping: intersect the view ray with a box "room" behind the window so glass shows real parallax depth.
// p = entry point on the window plane in metres, cs = room size, d = view dir in facade space (z into the wall).
vec3 wallDetail(float u, float v, float wM, vec3 wallC, vec2 id, float seed, float kind, float r1, float r2){
  vec3 col = wallC;
  if (kind > 0.5) {
    // shop: shelving with rows of coloured product, lit cove above
    float rows = smoothstep(0.06, 0.16, abs(fract(v * 5.0) - 0.5));
    vec3 prod = hash32(floor(vec2(u * 3.2, v * 5.0)) + id * 7.0 + seed);
    float zone = step(v, 0.70) * step(0.14, fract(u / 2.6 + r1));
    vec3 pc = mix(vec3(dot(prod, vec3(0.333))), prod, 0.45) * mix(vec3(1.0, 0.82, 0.62), vec3(1.0), 0.4);
    float shopKind = step(0.42, r2);
    col = mix(col, (0.10 + 0.6 * pc * pc) * rows, 0.85 * zone * shopKind);
    col = mix(col, wallC * (0.55 + 0.45 * step(0.5, fract(u / 0.9))), (1.0 - shopKind) * 0.6 * step(v, 0.45));
    col += vec3(1.0, 0.86, 0.66) * 0.9 * step(0.76, v) * step(v, 0.83);
  } else {
    float q = u / wM;
    float door = step(abs(q - (0.2 + 0.6 * r2)), 0.45 / wM) * step(v, 0.70);
    col *= 1.0 - 0.7 * door;
    float art = step(abs(q - fract(r1 * 7.0)), 0.5 / wM) * step(abs(v - 0.56), 0.10) * step(0.4, r2);
    col = mix(col, hash32(id + seed + 2.0) * 0.5, art);
    float scr = step(abs(q - fract(r2 * 5.0)), 0.45 / wM) * step(abs(v - 0.40), 0.07) * step(r1, 0.6);
    col += vec3(0.30, 0.50, 1.0) * 1.6 * scr;
    float shelf = step(0.72, fract(r1 * 13.0)) * step(v, 0.6) * step(0.3, fract(u / 1.9 + r2)) * smoothstep(0.05, 0.12, abs(fract(v * 6.0) - 0.5));
    col *= 1.0 - 0.6 * shelf;
  }
  return col;
}
vec3 interior(vec2 p, vec2 cs, float depth, vec3 d, vec2 id, float seed, float kind){
  float tx = (d.x > 0.0 ? cs.x - p.x : -p.x) / (abs(d.x) < 1e-4 ? 1e-4 : d.x);
  float ty = (d.y > 0.0 ? cs.y - p.y : -p.y) / (abs(d.y) < 1e-4 ? 1e-4 : d.y);
  float tz = depth / d.z;
  float t = min(tz, min(tx, ty));
  vec3 h = vec3(p, 0.0) + d * t;
  float r1 = hash12(id * 1.37 + seed), r2 = hash12(id * 2.11 + seed + 5.7);
  vec3 wallC = roomTone(r1) * 0.62;
  float up = clamp(h.y / cs.y, 0.0, 1.0);
  float fall = mix(0.30, 1.0, up * up);
  vec3 col;
  if (t == tz) {
    col = wallDetail(h.x, up, cs.x, wallC, id, seed, kind, r1, r2) * fall;
  } else if (t == ty) {
    if (d.y > 0.0) {
      col = vec3(0.36, 0.36, 0.35);
      vec2 lq = fract(vec2(h.x, h.z) / vec2(1.5, 2.2)) - 0.5;
      float panel = step(abs(lq.x), 0.33) * step(abs(lq.y), 0.10 + 0.12 * kind);
      col += panel * 6.0;
    } else {
      vec2 fq = fract(vec2(h.x, h.z) / 1.2);
      col = mix(vec3(0.07, 0.06, 0.05), wallC * 0.3, 0.5) * (0.75 + 0.25 * step(0.5, fq.x) * step(0.5, fq.y) + 0.25 * step(fq.x, 0.5) * step(fq.y, 0.5));
      col += vec3(0.25) * exp(-h.z * 0.5) * 0.3;
    }
  } else {
    col = wallDetail(h.z + r2 * 3.0, up, depth, wallC * 0.8, id + 3.0, seed, kind, r2, r1) * fall;
  }
  col *= mix(1.0, 0.45, clamp(h.z / depth, 0.0, 1.0));
  // a plane of silhouettes part-way into the room: desks, people, plants
  float tm = depth * 0.36 / d.z;
  if (tm < t) {
    vec3 hm = vec3(p, 0.0) + d * tm;
    float cw = 1.9;
    float sx = hm.x / cw + r1 * 3.0;
    float cx = (fract(sx) - 0.5) * cw;
    float rr = hash12(vec2(floor(sx), id.y * 1.7) + id.x * 3.1 + seed);
    float sil = 0.0;
    if (rr < 0.40) {
      sil = step(abs(cx), 0.72) * step(abs(hm.y - 0.72), 0.04) + step(abs(abs(cx) - 0.6), 0.04) * step(hm.y, 0.72);
      sil = max(sil, step(abs(cx - 0.1), 0.27) * step(abs(hm.y - 1.08), 0.17));
      sil = max(sil, step(abs(cx + 0.35), 0.2) * step(abs(hm.y - 0.62), 0.38));
    } else if (rr < 0.56) {
      sil = step(abs(cx), 0.19 - 0.05 * step(hm.y, 0.8)) * step(hm.y, 1.48);
      sil = max(sil, step(length(vec2(cx, hm.y - 1.62)), 0.125));
    } else if (rr < 0.66) {
      sil = step(length(vec2(cx, (hm.y - 1.25) * 0.7)), 0.36 + 0.1 * sin(hm.y * 23.0 + cx * 31.0));
      sil = max(sil, step(abs(cx), 0.17) * step(hm.y, 0.55));
    }
    col = mix(col, vec3(0.012, 0.011, 0.010), min(sil, 1.0) * 0.93);
  }
  return col;
}

void setGlass(vec2 paneId, float seed, vec3 emis){
  fAlbedo = vec3(0.012, 0.018, 0.024); fRough = 0.05; fMetal = 0.0; fGlass = 1.0;
  fTilt = (hash22(paneId + seed) - 0.5) * 0.035;
  fEmis = emis;
}

void facade(){
  float style = vPar.x, seed = vPar.y, floorH = vPar.z, bayW = vPar.w;
  float groundH = vPar2.x, litFrac = vPar2.y, optA = vPar2.z, optB = vPar2.w;
  vec2 fuv = vFuv;
  float px = max(fwidth(fuv.x), fwidth(fuv.y)) * 0.75 + 1e-4;
  vec3 N = normalize(vWN);
  vec3 T = vec3(N.z, 0.0, -N.x);
  vec3 toP = vWPos - cameraPosition;
  float dist = length(toP);
  vec3 Vw = toP / dist;
  vec3 d = vec3(dot(Vw, T), Vw.y, max(-dot(Vw, N), 0.03));
  fAlbedo = vTint; fRough = 0.7; fMetal = 0.0; fEmis = vec3(0.0); fGlass = 0.0; fTilt = vec2(0.0); fFogK = 1.0;
  float wetN = fbm(vec2(fuv.x * 0.9 + seed * 3.0, fuv.y * 0.06));
  float grime = 0.82 + 0.3 * wetN;

  if (style < 0.5) {
    // ROOF
    fAlbedo = vec3(0.045, 0.047, 0.05) * (0.7 + 0.6 * vnoise(vWPos.xz * 0.4)) + 0.02 * vnoise(vWPos.xz * 9.0);
    fRough = 0.55;
    return;
  }
  if (style > 6.5) {
    // EMISSIVE strip / panel
    fAlbedo = vec3(0.02); fEmis = vTint * litFrac; fRough = 0.4;
    return;
  }
  if (style > 5.5) {
    // SKYLINE: cheap distant tower
    vec2 g = fuv / vec2(3.0, 3.6); vec2 id = floor(g); vec2 f = fract(g);
    float r = hash12(id + seed);
    float fl = hash11(id.y * 3.1 + seed);
    float lit = step(r, (fl < 0.5 ? 0.75 : 0.16) * litFrac * 2.0);
    float win = step(0.12, f.x) * step(f.x, 0.88) * step(0.3, f.y) * step(f.y, 0.85);
    win *= 1.0 / (1.0 + px * 0.6);
    fAlbedo = vTint * 0.6; fRough = 0.3; fMetal = 0.3;
    fEmis = lightTint(hash11(r * 91.0)) * lit * win * 1.6;
    float crown = step(vDim.y - fuv.y, 2.5) * optA;
    fEmis += vTint2 * crown * 3.0;
    fFogK = 0.34;
    return;
  }
  if (style > 4.5) {
    // SOLID panel wall
    vec2 g = fuv / vec2(max(bayW, 0.5), max(floorH, 0.5)); vec2 f = fract(g);
    float joint = max(lineAA(edgeD(f.x, bayW), 0.012, px), lineAA(edgeD(f.y, floorH), 0.012, px));
    fAlbedo = vTint * grime * (1.0 - 0.45 * joint) * (0.92 + 0.16 * hash12(floor(g) + seed));
    fRough = mix(0.62, 0.38, optA); fMetal = optA;
    if (optB > 0.5) {
      // louvres
      float lv = smoothstep(0.3, 0.5, abs(fract(fuv.y / 0.18) - 0.5) * 2.0);
      fAlbedo *= mix(0.35, 1.0, lv / (1.0 + px * 8.0) + px * 8.0 / (1.0 + px * 8.0) * 0.6);
    }
    return;
  }

  // ------------------------------------------------------------------ ground floor storefront
  if (fuv.y < groundH) {
    float nb = max(1.0, floor(vDim.x / 6.4 + 0.5)); float bw = vDim.x / nb;
    float gx = fuv.x / bw; float bid = floor(gx); float fx = fract(gx) * bw;
    float y = fuv.y;
    float glassTop = groundH - 1.15;
    float pierD = min(fx, bw - fx);
    float r = hash12(vec2(bid * 3.7, seed));
    float r2 = hash12(vec2(bid * 1.3 + 9.0, seed + 2.0));
    vec3 stone = mix(vTint, vec3(0.05, 0.05, 0.055), 0.55) * grime;
    if (pierD < 0.30 || y < 0.42) {
      fAlbedo = stone * (y < 0.42 ? 0.7 : 1.0); fRough = 0.45; fMetal = 0.2;
      // low warm wash from the street
    } else if (y < glassTop) {
      float inner = bw - 0.6;
      float nm = max(1.0, floor(inner / 1.7 + 0.5)); float mw = inner / nm;
      float mx = mod(fx - 0.3, mw);
      float mull = lineAA(min(mx, mw - mx), 0.028, px);
      mull = max(mull, lineAA(abs(y - 2.55), 0.03, px));
      mull = max(mull, lineAA(min(y - 0.42, glassTop - y), 0.04, px));
      float lit = step(r, 0.9);
      vec3 ic = interior(vec2(fx, y), vec2(bw, groundH), 8.0 + 4.0 * r2, d, vec2(bid, -3.0), seed, 1.0);
      vec3 em = ic * lightTint(r2) * mix(0.02, 1.05, lit);
      setGlass(vec2(bid, floor((fx - 0.3) / mw)), seed, em);
      fAlbedo = mix(fAlbedo, vec3(0.02), mull); fRough = mix(fRough, 0.35, mull);
      fEmis *= 1.0 - mull; fGlass *= 1.0 - mull; fMetal = mull * 0.8;
    } else {
      // fascia with an illuminated sign
      fAlbedo = vec3(0.022, 0.022, 0.026); fRough = 0.42; fMetal = 0.5;
      vec2 sp = vec2(fx - bw * 0.5, y - (glassTop + 0.58));
      float sw = bw * (0.16 + 0.2 * r2);
      if (r > 0.3 && abs(sp.x) < sw && abs(sp.y) < 0.24) {
        float ci = floor(sp.x / 0.27);
        float cf = fract(sp.x / 0.27);
        float lr = hash12(vec2(ci, bid + seed));
        float letter = step(0.12, cf) * step(cf, 0.82) * step(0.18, lr) * step(abs(sp.y + 0.03 * (lr - 0.5)), 0.13 + 0.07 * lr);
        vec3 sc = r2 < 0.3 ? vec3(1.0, 0.95, 0.85) : (r2 < 0.5 ? vec3(1.0, 0.25, 0.2) : (r2 < 0.7 ? vec3(0.2, 0.85, 1.0) : (r2 < 0.85 ? vec3(1.0, 0.55, 0.1) : vec3(0.35, 1.0, 0.45))));
        fEmis = sc * letter * 3.2 / (1.0 + px * 2.0) + sc * 0.5 * px * 2.0 / (1.0 + px * 2.0);
      }
      float strip = lineAA(abs(y - glassTop - 0.05), 0.03, px);
      fEmis += vec3(1.0, 0.85, 0.62) * strip * 2.2;
    }
    return;
  }

  // ------------------------------------------------------------------ upper floors
  float bodyH = vDim.y - groundH;
  float y = fuv.y - groundH;
  float nf = max(1.0, floor(bodyH / floorH + 0.5)); float fh = bodyH / nf;
  float nb = max(1.0, floor(vDim.x / bayW + 0.5)); float bw = vDim.x / nb;
  vec2 g = vec2(fuv.x / bw, y / fh); vec2 id = floor(g); vec2 f = fract(g);
  float fx = f.x * bw, fy = f.y * fh;
  float coping = step(vDim.y - fuv.y, 0.4);
  float farK = smoothstep(120.0, 320.0, dist);

  if (style < 1.5) {
    // ---- CURTAIN WALL: unitised glass, spandrels, mullion caps, accent fins
    float span = 0.95;
    float roomBays = 4.0;
    vec2 rid = vec2(floor(id.x / roomBays), id.y);
    float floorLit = step(hash11(id.y * 7.31 + seed * 3.0), 0.22 + 0.5 * litFrac);
    float lit = step(hash12(rid * 1.9 + seed), mix(0.07, 0.86, floorLit));
    float mull = lineAA(edgeD(f.x, bw), 0.032, px);
    float trans = lineAA(abs(fy - span), 0.03, px);
    trans = max(trans, lineAA(edgeD(f.y, fh), 0.02, px));
    if (fy > span) {
      vec2 rp = vec2((mod(id.x, roomBays) + f.x) * bw, fy);
      vec3 ic = interior(rp, vec2(roomBays * bw, fh), 7.0, d, rid, seed, 0.0);
      ic = mix(ic, vec3(0.45, 0.42, 0.38), farK * 0.7);
      float lr = hash12(rid + seed + 1.0);
      vec3 em = ic * lightTint(lr * 0.9 + 0.1 * optB) * mix(0.010, 0.62 + 0.45 * lr, lit);
      // roller blinds on some panes
      float bl = hash12(id * 3.3 + seed);
      float blind = step(bl, 0.16) * step(fh - (fh - span) * (0.3 + 0.6 * fract(bl * 9.0)), fy);
      em = mix(em, vec3(0.75, 0.70, 0.6) * mix(0.015, 0.45, lit), blind);
      setGlass(id, seed, em);
    } else {
      // spandrel: back-painted glass, occasionally an accent colour
      float acc = step(hash12(id * 0.77 + seed + 3.0), optA * 0.12);
      fAlbedo = mix(vTint * 0.55, vTint2, acc) * grime; fRough = 0.12; fGlass = 0.6;
      fTilt = (hash22(id + seed + 4.0) - 0.5) * 0.03;
    }
    float frame = max(mull, trans);
    // vertical accent fins every few bays
    float finBay = step(mod(id.x + floor(seed * 7.0), 3.0), 0.5) * step(0.5, optA);
    float fin = lineAA(f.x * bw, 0.10, px) * finBay;
    fAlbedo = mix(fAlbedo, vTint * 0.8, frame); fRough = mix(fRough, 0.35, frame);
    fEmis *= 1.0 - frame; fGlass *= 1.0 - frame; fMetal = mix(fMetal, 0.85, frame);
    fAlbedo = mix(fAlbedo, vTint2, fin); fEmis *= 1.0 - fin; fGlass *= 1.0 - fin; fMetal = mix(fMetal, 0.3, fin); fRough = mix(fRough, 0.4, fin);
  } else if (style < 2.5) {
    // ---- BRICK with punched windows
    vec2 w0 = vec2(0.22, 0.20), w1 = vec2(0.78, 0.80);
    vec2 wp = (f - w0) / (w1 - w0);
    vec2 ws = (w1 - w0) * vec2(bw, fh);
    bool inWin = wp.x > 0.0 && wp.x < 1.0 && wp.y > 0.0 && wp.y < 1.0;
    if (inWin) {
      float lit = step(hash12(id * 1.7 + seed), litFrac);
      vec3 ic = interior(vec2(fx, fy), vec2(bw, fh), 5.0, d, id, seed, 0.0);
      ic = mix(ic, vec3(0.5, 0.42, 0.32), farK * 0.7);
      float lr = hash12(id + seed + 1.0);
      vec3 em = ic * lightTint(lr * 0.7) * mix(0.012, 0.9 + 0.5 * lr, lit);
      float bl = hash12(id * 3.3 + seed);
      float blind = step(bl, 0.35) * step(1.0 - (0.25 + 0.6 * fract(bl * 9.0)), wp.y);
      em = mix(em, vec3(0.80, 0.68, 0.5) * mix(0.012, 0.5, lit), blind);
      setGlass(id, seed, em);
      vec2 wm = wp * ws;
      float fr = lineAA(min(min(wm.x, ws.x - wm.x), min(wm.y, ws.y - wm.y)), 0.06, px);
      fr = max(fr, lineAA(abs(wm.x - ws.x * 0.5), 0.03, px));
      fr = max(fr, lineAA(abs(wm.y - ws.y * 0.58), 0.03, px));
      vec3 frameC = optA > 0.5 ? vec3(0.02) : vec3(0.42, 0.40, 0.36);
      fAlbedo = mix(fAlbedo, frameC, fr); fRough = mix(fRough, 0.5, fr); fEmis *= 1.0 - fr; fGlass *= 1.0 - fr;
      float sh = smoothstep(0.22, 0.0, ws.y - wm.y);    // reveal shadow under the lintel
      fEmis *= 1.0 - 0.6 * sh; fAlbedo *= 1.0 - 0.6 * sh;
    } else {
      vec2 bs = vec2(0.23, 0.075);
      vec2 bq = fuv / bs; bq.x += 0.5 * mod(floor(bq.y), 2.0);
      vec2 bidv = floor(bq); vec2 bf = fract(bq);
      float mort = max(lineAA(edgeD(bf.x, bs.x), 0.006, px), lineAA(edgeD(bf.y, bs.y), 0.006, px));
      float lod = 1.0 / (1.0 + px * 30.0);
      vec3 brick = vTint * (0.72 + 0.56 * hash12(bidv + seed) * lod + 0.28 * (1.0 - lod));
      brick = mix(brick, vec3(0.20, 0.19, 0.17), mort * lod * 0.8);
      fAlbedo = brick * grime; fRough = 0.72;
      // stone lintels, sills and a cornice
      float lint = step(w0.x - 0.04, f.x) * step(f.x, w1.x + 0.04) * (step(abs(f.y - w1.y - 0.035), 0.035) + step(abs(f.y - w0.y + 0.02), 0.02));
      fAlbedo = mix(fAlbedo, vec3(0.30, 0.28, 0.25) * grime, min(lint, 1.0));
      float corn = step(vDim.y - fuv.y, 0.75);
      float dent = step(0.5, fract(fuv.x / 0.5)) * step(vDim.y - fuv.y, 0.75) * step(0.45, vDim.y - fuv.y);
      fAlbedo = mix(fAlbedo, vec3(0.26, 0.24, 0.22) * grime * (1.0 - 0.35 * dent), corn);
    }
  } else if (style < 3.5) {
    // ---- RIBBON windows in metal / precast panels (labs)
    float b0 = 1.0, b1 = fh - 0.75;
    if (fy > b0 && fy < b1) {
      float roomBays = 3.0;
      vec2 rid = vec2(floor(id.x / roomBays), id.y);
      float lit = step(hash12(rid * 1.9 + seed), litFrac);
      vec2 rp = vec2((mod(id.x, roomBays) + f.x) * bw, fy);
      vec3 ic = interior(rp, vec2(roomBays * bw, fh), 8.0, d, rid, seed, 0.0);
      ic = mix(ic, vec3(0.48, 0.48, 0.46), farK * 0.7);
      vec3 em = ic * lightTint(0.86 + 0.1 * hash12(rid + seed)) * mix(0.012, 1.0, lit);
      setGlass(id, seed, em);
      float fr = max(lineAA(edgeD(f.x, bw), 0.03, px), lineAA(min(fy - b0, b1 - fy), 0.04, px));
      fAlbedo = mix(fAlbedo, vec3(0.03), fr); fRough = mix(fRough, 0.4, fr); fEmis *= 1.0 - fr; fGlass *= 1.0 - fr; fMetal = fr * 0.8;
    } else {
      float jx = lineAA(edgeD(fract(g.x * 0.5), bw * 2.0), 0.012, px);
      fAlbedo = vTint * grime * (1.0 - 0.5 * jx) * (0.93 + 0.14 * hash12(vec2(floor(g.x * 0.5), id.y) + seed));
      fRough = mix(0.6, 0.34, optA); fMetal = optA * 0.9;
      float rib = smoothstep(0.35, 0.5, abs(fract(fuv.x / 0.3) - 0.5) * 2.0) * optB;
      fAlbedo *= 1.0 - 0.25 * rib / (1.0 + px * 10.0);
    }
  } else {
    // ---- RESIDENTIAL tower: floor-to-ceiling glass between exposed slab edges
    float slab = 0.30;
    float solidBay = step(hash12(vec2(id.x * 1.3, floor(id.y / 3.0)) + seed + 8.0), 0.16);
    if (fy > slab && solidBay < 0.5) {
      float lit = step(hash12(id * 1.7 + seed), litFrac);
      vec3 ic = interior(vec2(fx, fy), vec2(bw, fh), 5.5, d, id, seed, 0.0);
      ic = mix(ic, vec3(0.5, 0.42, 0.32), farK * 0.7);
      float lr = hash12(id + seed + 1.0);
      vec3 em = ic * lightTint(lr * 0.62) * mix(0.012, 0.75 + 0.6 * lr, lit);
      // curtains drawn part way from the sides
      float cr = hash12(id * 2.9 + seed + 4.0);
      float curtain = step(cr, 0.55) * step(abs(f.x - 0.5), 0.5) * step(0.5 - 0.42 * fract(cr * 7.0), abs(f.x - 0.5));
      float fold = 0.8 + 0.2 * sin(fx * 40.0);
      em = mix(em, vec3(0.78, 0.66, 0.5) * fold * mix(0.012, 0.42, lit), curtain);
      // TV flicker in a few flats
      float tv = step(0.93, hash12(id + seed + 11.0)) * lit;
      em += tv * vec3(0.3, 0.45, 0.9) * 0.35 * (0.6 + 0.4 * sin(uTime * 7.0 + cr * 60.0) * sin(uTime * 3.1 + cr * 9.0));
      setGlass(id, seed, em);
      float fr = max(lineAA(edgeD(f.x, bw), 0.035, px), lineAA(abs(f.x - 0.5) * bw, 0.022, px));
      fr = max(fr, lineAA(abs(fy - 1.25), 0.02, px));          // balcony rail line
      fAlbedo = mix(fAlbedo, vec3(0.03), fr); fRough = mix(fRough, 0.4, fr); fEmis *= 1.0 - fr; fGlass *= 1.0 - fr; fMetal = fr * 0.8;
    } else if (fy <= slab) {
      fAlbedo = vTint * grime; fRough = 0.55;
    } else {
      fAlbedo = vTint2 * grime; fRough = 0.4; fMetal = 0.5;
    }
  }
  fAlbedo = mix(fAlbedo, vec3(0.03, 0.03, 0.034), coping); fEmis *= 1.0 - coping; fGlass *= 1.0 - coping;
  fRough = mix(fRough, 0.4, coping); fMetal = mix(fMetal, 0.7, coping);
}
`;

// A MeshStandardMaterial whose surface is generated by the facade shader above.
export function createFacadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', 'facade();\n diffuseColor.rgb = fAlbedo;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 wn = normalize(vWN);
          vec3 wt = vec3(wn.z, 0.0, -wn.x);
          normal = normalize(normal + mat3(viewMatrix) * (wt * fTilt.x + vec3(0.0, 1.0, 0.0) * fTilt.y));
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        totalEmissiveRadiance = fEmis;
        // street-level light spill: lamps and shopfronts warm the lower storeys
        totalEmissiveRadiance += fAlbedo * vec3(1.0, 0.72, 0.44) * 0.55 * exp(-max(vWPos.y, 0.0) * 0.2);`)
      .replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
        material.diffuseContribution = mix(material.diffuseContribution, vec3(0.008, 0.012, 0.016), fGlass);
        material.specularColorBlended = mix(material.specularColorBlended, vec3(0.20, 0.23, 0.27), fGlass);`)
      .replace('#include <fog_fragment>', /* glsl */`
        #ifdef USE_FOG
          float fd = fogDensity * fFogK;
          float fogFactor = 1.0 - exp(-fd * fd * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'facade-v1';
  return { material: mat, uniforms };
}
