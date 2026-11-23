import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FacadeGeo, STYLE, createFacadeMaterial } from './facade.js';
import { createGlowPoints, darkMetal } from './props.js';
import { rng } from './buildings.js';
import { AVENUES, STREETS, DENNY, CURB, MARKET_Y, MARKET, CAMPUS, FOG_COLOR, FOG_DENSITY, heightAt, isNode } from '../config.js';

// Landmarks of the downtown and Seattle Center districts.
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = (l) => mergeGeometries(l.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
const hdr = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });

export function textTexture(lines, color, w = 1024, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#07080b'; x.fillRect(0, 0, w, h);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [text, size, cy, col] of lines) {
    x.font = `800 ${size}px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    x.shadowColor = col || color; x.fillStyle = col || color;
    for (const b of [46, 22, 9]) { x.shadowBlur = b; x.fillText(text, w / 2, cy); }
    x.shadowBlur = 0; x.globalAlpha = 0.7; x.fillStyle = '#fff'; x.fillText(text, w / 2, cy); x.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function signPlane(tex, w, h, x, y, z, ry, k = 2.3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(k, k, k) }));
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

// ---------------------------------------------------------------- monorail
export function createMonorail(obstacles, custom = null) {
  const group = new THREE.Group();
  const gy = (custom && custom.heightAt) || (() => 0);
  const BEAM_Y = 9.2, X5 = -88, ZD = DENNY.z, R = 34;
  // centre line: north up 5th Ave, a sweeping left onto Denny Way, west to Seattle Center
  const pts = [new THREE.Vector2(X5, 606), new THREE.Vector2(X5, ZD + R)];
  for (let k = 1; k <= 10; k++) { const a = (k / 10) * Math.PI / 2; pts.push(new THREE.Vector2(X5 - R + Math.cos(a) * R, ZD + R - Math.sin(a) * R)); }
  pts.push(new THREE.Vector2(-548, ZD));
  if (custom) { pts.length = 0; for (const p of custom.pts) pts.push(new THREE.Vector2(p[0], p[1])); }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const at = (s, out) => {
    s = Math.max(0, Math.min(total, s));
    let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
    out.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t; out.z = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
    out.h = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    return out;
  };
  const geos = [];
  // twin beams
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = a.distanceTo(b), h = Math.atan2(b.y - a.y, b.x - a.x);
    for (const off of [-1.55, 1.55]) {
      const g = new THREE.BoxGeometry(len + 0.3, 1.25, 0.75).rotateY(-h);
      const ya = gy(a.x, a.y), yb = gy(b.x, b.y);
      g.rotateY(h).rotateZ(Math.atan2(yb - ya, len)).rotateY(-h);
      g.translate((a.x + b.x) / 2 - Math.sin(h) * off, BEAM_Y + (ya + yb) / 2, (a.y + b.y) / 2 + Math.cos(h) * off);
      geos.push(g);
    }
  }
  // T pylons down the middle of the road, never inside a junction
  const P = { x: 0, z: 0, h: 0 };
  const inJunction = custom ? custom.inJunction : (x, z) => AVENUES.some(a => STREETS.some(s => isNode(a, s) && Math.abs(x - a.x) < a.hw + 10 && Math.abs(z - s.z) < s.hw + 10));
  for (let s = 10; s < total - 6; s += 24) {
    at(s, P);
    if (inJunction(P.x, P.z)) continue;
    const py = gy(P.x, P.z);
    geos.push(new THREE.BoxGeometry(1.15, BEAM_Y + 1.4, 1.15).rotateY(-P.h).translate(P.x, py + (BEAM_Y - 0.6) / 2 - 1, P.z));
    geos.push(new THREE.BoxGeometry(1.3, 0.9, 4.6).rotateY(-P.h).translate(P.x, py + BEAM_Y - 1.0, P.z));
    obstacles.push({ x: P.x, z: P.z, r: 0.75 });
  }
  // stations: a canopy at each end
  for (const [sx, sz, w, d] of custom ? [] : [[X5, 598, 9, 26], [-545, ZD, 22, 9]]) {
    geos.push(box(w, 0.35, d, sx, BEAM_Y + 4.4, sz), box(w, 0.3, d, sx, BEAM_Y - 0.2, sz));
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) geos.push(box(0.3, 4.6, 0.3, sx + ox * (w / 2 - 0.4), BEAM_Y + 2.1, sz + oz * (d / 2 - 0.4)));
  }
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a5b5d, roughness: 0.7, emissive: 0x23201c, emissiveIntensity: 1.0 });
  const frame = new THREE.Mesh(merge(geos), concrete); frame.frustumCulled = false;
  group.add(frame);
  const strips = custom ? [box(0.1, 0.1, 0.1, 0, -60, 0)] : [box(8.4, 0.08, 0.25, X5, BEAM_Y + 4.18, 598), box(0.25, 0.08, 8.4, -545, BEAM_Y + 4.18, ZD)];
  group.add(new THREE.Mesh(merge(strips), hdr(5, 4.2, 3)));

  // the train: four cars riding the north/east beam
  const train = new THREE.Group();
  const prof = new THREE.Shape();
  const L = 5.2;
  prof.moveTo(-L, 0.2); prof.lineTo(-L - 0.25, 1.0); prof.quadraticCurveTo(-L - 0.1, 2.9, -L + 0.9, 3.0);
  prof.lineTo(L - 0.9, 3.0); prof.quadraticCurveTo(L + 0.1, 2.9, L + 0.25, 1.0); prof.lineTo(L, 0.2); prof.closePath();
  const carGeo = new THREE.ExtrudeGeometry(prof, { depth: 2.4, bevelEnabled: true, bevelSize: 0.14, bevelThickness: 0.14, bevelOffset: -0.14, bevelSegments: 3 }).translate(0, 0, -1.2);
  const white = new THREE.MeshPhysicalMaterial({ color: 0xe9e6df, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb01218, roughness: 0.4 });
  const winGeo = merge([box(L * 2 - 1.6, 1.0, 0.04, 0, 2.0, 1.345), box(L * 2 - 1.6, 1.0, 0.04, 0, 2.0, -1.345)]);
  const stripeGeo = merge([box(L * 2 + 0.3, 0.42, 0.05, 0, 1.05, 1.35), box(L * 2 + 0.3, 0.42, 0.05, 0, 1.05, -1.35), box(L * 2 + 0.2, 0.7, 2.2, 0, -0.1, 0)]);
  const cars = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Group();
    c.add(new THREE.Mesh(carGeo, white), new THREE.Mesh(winGeo, hdr(2.4, 2.0, 1.4)), new THREE.Mesh(stripeGeo, red));
    train.add(c); cars.push(c);
  }
  const nose = new THREE.Mesh(merge([box(0.06, 0.2, 1.5, L + 0.3, 1.3, 0)]), hdr(12, 11, 9));
  const tail = new THREE.Mesh(merge([box(0.06, 0.2, 1.5, -L - 0.3, 1.3, 0)]), hdr(6, 0.2, 0.15));
  cars[0].add(nose); cars[3].add(tail);
  group.add(train);

  const state = { s: 60, dir: 1, v: 0, wait: 3 };
  const update = (dt) => {
    if (state.wait > 0) { state.wait -= dt; state.v = 0; }
    else {
      const lead = state.dir > 0 ? total - 20 - state.s : state.s - 20;
      const target = Math.min(15, Math.sqrt(Math.max(0, 2 * 1.6 * lead)) + 0.3);
      state.v += THREE.MathUtils.clamp(target - state.v, -4 * dt, 2 * dt);
      state.s += state.dir * state.v * dt;
      if (lead < 0.5) { state.dir *= -1; state.wait = 7; }
    }
    cars.forEach((c, i) => {
      at(state.s - state.dir * i * 10.9, P);
      const h = state.dir > 0 ? P.h : P.h + Math.PI;
      c.position.set(P.x - Math.sin(P.h) * 1.55, gy(P.x, P.z) + BEAM_Y + 0.75, P.z + Math.cos(P.h) * 1.55);
      c.rotation.y = -h;
    });
  };
  update(0);
  return { group, update, state };
}

// ---------------------------------------------------------------- Pike Place Market, the bay and the Great Wheel
export function createMarket(obstacles, P = {}) {
  const group = new THREE.Group();
  const r = rng(1907);
  const Y = MARKET_Y + CURB;
  const geos = [];
  // the "PUBLIC MARKET CENTER" sign and clock, on a steel frame over the arcade at the foot of Pike St
  const sx = MARKET.x1 - 2.5, sz = 704, roof = MARKET_Y + 9.4;
  const tex = textTexture([['PUBLIC', 190, 130], ['MARKET', 190, 310], ['CENTER', 86, 446, '#ffd9a0']], '#ff2d22');
  group.add(signPlane(tex, 21, 10.5, sx + 0.3, roof + 7.2, sz, Math.PI / 2, 2.6));
  geos.push(box(0.5, 11.2, 21.6, sx, roof + 7.2, sz));
  for (const dz of [-9.5, -3.2, 3.2, 9.5]) geos.push(box(0.35, 2.2, 0.35, sx, roof + 1.0, sz + dz));
  // clock face beside the lettering
  const clock = new THREE.Mesh(new THREE.CircleGeometry(2.3, 40).rotateY(Math.PI / 2), hdr(2.6, 2.2, 1.5));
  clock.position.set(sx + 0.5, roof + 15.2, sz);
  const hands = new THREE.Mesh(merge([box(0.05, 1.5, 0.16, 0, 0.6, 0), box(0.05, 0.14, 1.9, 0, 0, 0.8)]), new THREE.MeshBasicMaterial({ color: 0x110806 }));
  hands.position.set(sx + 0.58, roof + 15.2, sz);
  geos.push(box(0.45, 5.4, 5.4, sx, roof + 15.2, sz));
  group.add(clock, hands);
  // awnings over the stalls and a railing along the bluff
  const awn = [];
  for (let z = P.core ? 1e9 : MARKET.z0 + 180; z < MARKET.z1 - 6; z += 6.2) awn.push(new THREE.BoxGeometry(2.6, 0.12, 5.4).rotateZ(-0.32).translate(MARKET.x1 - 1.4, MARKET_Y + 4.3, z));
  if (awn.length) group.add(new THREE.Mesh(merge(awn), new THREE.MeshStandardMaterial({ color: 0x1f5a36, roughness: 0.6, emissive: 0x0c2414, emissiveIntensity: 1.2 })));
  for (let z = P.core ? 1e9 : MARKET.z0; z <= MARKET.z1; z += 3) geos.push(box(0.1, 1.1, 0.1, MARKET.x0 + 0.6, Y + 0.55, z));
  if (!P.core) geos.push(box(0.12, 0.08, MARKET.z1 - MARKET.z0, MARKET.x0 + 0.6, Y + 1.12, (MARKET.z0 + MARKET.z1) / 2));
  if (!P.core) geos.push(box(3, 14, MARKET.z1 - MARKET.z0 + 40, MARKET.x0 - 1.5, MARKET_Y - 6.9, (MARKET.z0 + MARKET.z1) / 2));   // sea wall
  group.add(new THREE.Mesh(merge(geos), darkMetal));

  // Rachel, the market's bronze pig
  const bronze = new THREE.MeshStandardMaterial({ color: 0x7a5228, roughness: 0.32, metalness: 0.95 });
  const pig = merge([
    new THREE.SphereGeometry(0.7, 16, 12).scale(1.25, 0.8, 0.72).translate(0, 0.95, 0),
    new THREE.SphereGeometry(0.4, 14, 10).scale(1.1, 0.95, 0.9).translate(0.95, 1.05, 0),
    new THREE.CylinderGeometry(0.17, 0.17, 0.16, 12).rotateZ(Math.PI / 2).translate(1.36, 1.0, 0),
    ...[[0.5, 0.3], [0.5, -0.3], [-0.5, 0.3], [-0.5, -0.3]].map(([x, z]) => new THREE.CylinderGeometry(0.11, 0.09, 0.55, 8).translate(x, 0.28, z)),
    ...[0.2, -0.2].map(z => new THREE.ConeGeometry(0.14, 0.3, 6).rotateX(z > 0 ? 0.5 : -0.5).translate(0.85, 1.48, z)),
    box(1.9, 0.14, 1.1, 0.1, 0.07, 0),
  ]);
  const rachel = new THREE.Mesh(pig, bronze);
  rachel.position.set(MARKET.x1 - 5.5, Y, 712); rachel.rotation.y = -0.5;
  group.add(rachel);
  obstacles.push({ x: rachel.position.x, z: rachel.position.z, r: 1.0 });

  // festoon lights strung along the stalls and across the deck
  const p = [], c = [], s = [], ph = [];
  const pal = [[1.0, 0.72, 0.36], [1.0, 0.3, 0.25], [0.3, 1.0, 0.5], [0.35, 0.6, 1.0], [1.0, 0.8, 0.3]];
  for (let z = P.core ? 700 : MARKET.z0 + 4; z < (P.core ? 716 : MARKET.z1 - 4); z += 0.7) { const k = pal[Math.floor(r() * pal.length)]; p.push(MARKET.x1 - 2.6, MARKET_Y + 4.6 - Math.abs(Math.sin(z * 0.5)) * 0.35, z); c.push(k[0] * 2.4, k[1] * 2.4, k[2] * 2.4); s.push(0.12); ph.push(r()); }
  for (let z = P.core ? 1e9 : MARKET.z0 + 30; z < MARKET.z1; z += 44) for (let t = 0; t <= 1; t += 0.02) { p.push(MARKET.x1 - 20 - t * 50, MARKET_Y + 6.2 - Math.sin(t * Math.PI) * 1.4, z); c.push(2.4, 1.7, 0.85); s.push(0.11); ph.push(r()); }
  // deck lamps (the ground shader lights the deck from the same row)
  const lampGeo = [];
  for (let z = P.core ? 1e9 : Math.ceil(MARKET.z0 / 22) * 22; z < MARKET.z1; z += 22) { lampGeo.push(new THREE.CylinderGeometry(0.06, 0.08, 5, 8).translate(-512, Y + 2.5, z)); p.push(-512, Y + 5.1, z); c.push(1.0, 0.64, 0.32); s.push(2.4); ph.push(z); obstacles.push({ x: -512, z, r: 0.25 }); }
  if (lampGeo.length) group.add(new THREE.Mesh(merge(lampGeo), darkMetal));
  const lights = createGlowPoints(p, c, s, ph, { twinkle: 0.15 });
  group.add(lights.points);

  // the Great Wheel on its pier, out over Elliott Bay
  const wheel = new THREE.Group();
  const WR = 26, wy = MARKET_Y + 4 + WR;
  const spoke = [];
  for (let i = 0; i < 21; i++) { const a = (i / 21) * 6.283; spoke.push(0, 0, 0, Math.cos(a) * WR, Math.sin(a) * WR, 0); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(spoke, 3));
  wheel.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1.2), fog: false })));
  const wp = [], wc = [], ws = [], wph = [];
  for (let i = 0; i < 126; i++) { const a = (i / 126) * 6.283; wp.push(Math.cos(a) * WR, Math.sin(a) * WR, 0); const k = i % 6 === 0 ? [1.0, 0.4, 0.9] : [0.6, 0.9, 1.3]; wc.push(k[0] * 2.2, k[1] * 2.2, k[2] * 2.2); ws.push(i % 6 === 0 ? 1.5 : 0.7); wph.push(i / 126); }
  for (let i = 0; i < 21; i++) for (let t = 0.2; t < 1; t += 0.2) { const a = (i / 21) * 6.283; wp.push(Math.cos(a) * WR * t, Math.sin(a) * WR * t, 0); wc.push(1.2, 1.6, 2.2); ws.push(0.5); wph.push(t); }
  const wheelLights = createGlowPoints(wp, wc, ws, wph, { twinkle: 0.2, fogK: 0.45 });
  wheel.add(wheelLights.points);
  wheel.position.set(-700, wy, 772); wheel.rotation.y = 0.5;
  group.add(wheel);
  const pier = new THREE.Mesh(merge([box(150, 1.2, 16, -630, MARKET_Y + 2, 772), box(1.6, WR + 4, 1.6, -697, MARKET_Y + 4 + WR / 2, 770), box(1.6, WR + 4, 1.6, -703, MARKET_Y + 4 + WR / 2, 774)]), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.04, 0.06) }));
  group.add(pier);
  // lights on the far side of the bay
  const fp = [], fc = [], fs = [], fph = [];
  for (let i = 0; i < 700; i++) { fp.push(-1700 + r() * 200, MARKET_Y + 2 + Math.pow(r(), 2) * 60, 100 + r() * 1300); const k = 0.5 + r(); fc.push(k, 0.7 * k, 0.4 * k); fs.push(1.8 + r() * 1.6); fph.push(r()); }
  const far = createGlowPoints(fp, fc, fs, fph, { twinkle: 0.1, fogK: 0.12 });
  group.add(far.points);

  const update = (t) => { wheel.rotation.z = t * 0.05; hands.rotation.x = -t * 0.02; };
  return { group, update, glow: [lights, wheelLights, far], wheel, pier, far, wheelY: wy };
}

// ---------------------------------------------------------------- retail core: Westlake Park tree, the holiday star, store names
export function createRetailCore(obstacles, lots, P = {}) {
  const group = new THREE.Group();
  const r = rng(2512);
  const p = [], c = [], s = [], ph = [];
  // the Westlake Park tree
  const [tx, tz] = P.tree || [-132, 643], ty = heightAt(tx, tz) + CURB, TH = 17;
  const tree = new THREE.Mesh(merge([new THREE.ConeGeometry(5.2, TH, 20).translate(tx, ty + 1.5 + TH / 2, tz), new THREE.CylinderGeometry(0.5, 0.6, 1.6, 10).translate(tx, ty + 0.8, tz)]), new THREE.MeshStandardMaterial({ color: 0x06180c, roughness: 0.9 }));
  group.add(tree);
  obstacles.push({ x: tx, z: tz, r: 3.4 });
  const pal = [[1.0, 0.25, 0.2], [0.25, 1.0, 0.4], [0.3, 0.5, 1.0], [1.0, 0.8, 0.3], [1.0, 0.9, 0.8]];
  for (let i = 0; i < 1500; i++) {
    const t = Math.pow(r(), 0.75), a = r() * 6.283, rad = 5.3 * (1 - t) + 0.05;
    const k = pal[Math.floor(r() * pal.length)];
    p.push(tx + Math.cos(a) * rad, ty + 1.5 + t * TH, tz + Math.sin(a) * rad); c.push(k[0] * 3.0, k[1] * 3.0, k[2] * 3.0); s.push(0.2); ph.push(r());
  }
  p.push(tx, ty + 2.2 + TH, tz); c.push(8, 6.5, 3); s.push(2.6); ph.push(0);
  // the holiday star on the flagship store, facing 5th Ave
  const store = lots.find(l => l.name === 'Fifth Avenue Flagship Store');
  if (store) {
    const cx = store.x0 - 0.5, cz = (store.z0 + store.z1) / 2, cy = 24, R1 = 7.5, R2 = 3.1;
    const v = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283 - Math.PI / 2, rr = i % 2 ? R2 : R1; v.push([Math.cos(a) * rr, -Math.sin(a) * rr]); }
    for (let i = 0; i < 10; i++) { const A = v[i], B = v[(i + 1) % 10]; for (let t = 0; t < 1; t += 0.085) { p.push(cx, cy + A[1] + (B[1] - A[1]) * t, cz + A[0] + (B[0] - A[0]) * t); c.push(3.0, 2.3, 1.2); s.push(0.34); ph.push(r()); } }
  }
  const lights = createGlowPoints(p, c, s, ph, { twinkle: 0.35 });
  group.add(lights.points);
  // store names in lights
  const names = [['Westlake Center', 'WESTLAKE CENTER', '#7fd4ff', 1], ['Pacific Place', 'PACIFIC PLACE', '#ffd35a', -1], ['Fifth Avenue Flagship Store', 'FLAGSHIP', '#ffffff', 2]];
  const back = [];
  for (const [lotName, text, col, side] of names) {
    const L = lots.find(l => l.name === lotName); if (!L) continue;
    const tex = textTexture([[text, 150, 128]], col, 1024, 256);
    const w = Math.min(34, (L.z1 - L.z0) * 0.6), h = w / 4, y = L.base + 13;
    if (side === 2) { group.add(signPlane(tex, w, h, (L.x0 + L.x1) / 2, y, L.z1 + 0.3, 0)); back.push(box(w + 0.3, h + 0.3, 0.2, (L.x0 + L.x1) / 2, y, L.z1 + 0.15)); }
    else { const x = side > 0 ? L.x1 + 0.3 : L.x0 - 0.3; group.add(signPlane(tex, w, h, x, y, (L.z0 + L.z1) / 2, side > 0 ? Math.PI / 2 : -Math.PI / 2)); back.push(box(0.2, h + 0.3, w + 0.3, x - side * 0.15, y, (L.z0 + L.z1) / 2)); }
  }
  if (back.length) group.add(new THREE.Mesh(merge(back), darkMetal));
  return { group, glow: [lights] };
}

// ---------------------------------------------------------------- Seattle Center: Space Needle, glass garden, fountain
export const CAMPUS_LAMPS = { x0: -730, z0: 30, pitch: 44, nx: 5, nz: 6, h: 6 };

export function createCenter(colliders, obstacles, P = {}) {
  const group = new THREE.Group();
  const r = rng(1962);
  const fogC = new THREE.Color().fromArray(FOG_COLOR);
  const hazed = [];   // materials drawn without scene fog whose colour we fade by distance instead
  const far = (rr, gg, bb) => { const m = new THREE.MeshBasicMaterial({ fog: false }); m.userData.base = new THREE.Color(rr, gg, bb); hazed.push(m); return m; };
  // floodlit steel: lit from the ground, fading up the tower, hazed by distance
  const steel = (rr, gg, bb) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uBase: { value: new THREE.Color(rr, gg, bb) }, uFog: { value: fogC }, uHaze: { value: 0 } },
      vertexShader: /* glsl */`varying vec3 vN; varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`uniform vec3 uBase; uniform vec3 uFog; uniform float uHaze; varying vec3 vN; varying float vY;
        void main(){
          vec3 n = normalize(vN);
          float shade = 0.22 + 0.7 * max(dot(n, normalize(vec3(0.6, -0.5, 0.62))), 0.0) + 0.3 * max(dot(n, normalize(vec3(-0.7, -0.35, -0.6))), 0.0) + 0.12 * max(n.y, 0.0);
          shade *= mix(1.0, 0.5, smoothstep(0.0, 140.0, vY)) * mix(1.0, 1.35, smoothstep(140.0, 150.0, vY));
          gl_FragColor = vec4(mix(uBase * shade, uFog, uHaze), 1.0);
        }`,
    });
    hazed.push(m); return m;
  };

  // ---- Space Needle
  const [NX, NZ] = P.needle || [-640, 92], H = 184;
  const needle = new THREE.Group();
  const legGeos = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    for (const off of [-0.11, 0.11]) {
      const pts = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20, rad = 3.2 + 15 * Math.pow(1 - t, 2.4) + 9 * Math.pow(Math.max(0, t - 0.72) / 0.28, 2.0);
        pts.push(new THREE.Vector3(Math.cos(a + off * (1 - t * 0.5)) * rad, t * 150, Math.sin(a + off * (1 - t * 0.5)) * rad));
      }
      legGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 1.25, 7, false));
      obstacles.push({ x: NX + Math.cos(a + off) * 18.2, z: NZ + Math.sin(a + off) * 18.2, r: 1.7 });
    }
  }
  legGeos.push(new THREE.CylinderGeometry(2.6, 3.0, 150, 12, 1, true).translate(0, 75, 0), new THREE.CylinderGeometry(9, 7, 2, 24).translate(0, 30, 0));
  needle.add(new THREE.Mesh(mergeGeometries(legGeos.map(g => g.index ? g.toNonIndexed() : g)), steel(0.40, 0.37, 0.30)));
  const prof = [[0, 146], [6, 146.5], [14, 149], [19.5, 152.5], [21, 154.2], [20.2, 155.6], [17.5, 156.6], [16.8, 159.2], [20.6, 160.2], [20.2, 161.2], [12, 163.5], [6, 166], [2.2, 168], [1.2, 176], [0.5, H]].map(([x, y]) => new THREE.Vector2(x, y));
  needle.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), steel(0.46, 0.42, 0.33)));
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(17.3, 17.3, 2.3, 48, 1, true).translate(0, 157.9, 0), far(2.6, 1.85, 1.0)));
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(20.7, 20.7, 0.5, 48, 1, true).translate(0, 160.4, 0), far(1.7, 1.4, 1.0)));
  // base pavilion
  needle.add(new THREE.Mesh(merge([new THREE.CylinderGeometry(9.5, 9.5, 4.2, 32).translate(0, 2.1 + CURB, 0), new THREE.CylinderGeometry(11, 11, 0.4, 32).translate(0, 4.5 + CURB, 0)]), new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.4, metalness: 0.4 })));
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 2.2, 32, 1, true).translate(0, 2.2 + CURB, 0), hdr(2.2, 1.7, 1.0)));
  const np = [], nc = [], ns = [], nph = [];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * 6.283; np.push(Math.cos(a) * 21, 154.4, Math.sin(a) * 21); nc.push(2.2, 1.6, 0.9); ns.push(1.6); nph.push(i / 36); }
  const rim = createGlowPoints(np, nc, ns, nph, { twinkle: 0.1, fogK: 0.2 });
  const beacon = createGlowPoints([0, H + 1, 0], [9, 0.5, 0.3], [7], [0], { blink: 1, fogK: 0.2 });
  needle.add(rim.points, beacon.points);
  needle.position.set(NX, 0, NZ);
  group.add(needle);
  obstacles.push({ x: NX, z: NZ, r: 10 });

  // ---- pedestrian lamps on a grid (the ground shader lights the plaza from the same grid)
  const C = CAMPUS_LAMPS;
  const lp = [], lc = [], ls = [], lph = [], poles = [];
  for (let i = 0; i < (P.lamps === false ? 0 : C.nx); i++) for (let j = 0; j < C.nz; j++) {
    const x = C.x0 + i * C.pitch, z = C.z0 + j * C.pitch;
    if (Math.hypot(x - NX, z - NZ) < 14) continue;
    poles.push(new THREE.CylinderGeometry(0.07, 0.09, C.h, 8).translate(x, CURB + C.h / 2, z), new THREE.SphereGeometry(0.3, 10, 8).translate(x, CURB + C.h, z));
    lp.push(x, CURB + C.h, z); lc.push(1.0, 0.7, 0.4); ls.push(2.6); lph.push(i + j);
    obstacles.push({ x, z, r: 0.25 });
  }
  if (poles.length) group.add(new THREE.Mesh(merge(poles), darkMetal));

  // ---- glass garden: a ribbed glasshouse with a blaze of blown glass inside, and sculpture beds outside
  const [GX, GZ] = P.glass || [-590, 190];
  const ribs = [];
  for (let k = 0; k <= 16; k++) { const z = GZ - 16 + k * 2; ribs.push(new THREE.TorusGeometry(7.5, 0.09, 5, 20, Math.PI).rotateY(Math.PI / 2).translate(GX, CURB, z)); }
  for (const a of [0.35, 0.9, Math.PI / 2, Math.PI - 0.9, Math.PI - 0.35]) ribs.push(box(0.1, 0.1, 32, GX + Math.cos(a) * 7.5, CURB + Math.sin(a) * 7.5, GZ));
  group.add(new THREE.Mesh(merge(ribs), darkMetal));
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fd0d8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(7.45, 7.45, 32, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(GX, CURB, GZ), glassMat));
  colliders.push({ x0: GX - 7.6, x1: GX + 7.6, z0: GZ - 16.2, z1: GZ + 16.2 });
  const gp = [], gc = [], gs = [], gph = [];
  const glassGeo = { red: [], yellow: [], blue: [], violet: [], green: [] };
  const GC = { red: [3.2, 0.5, 0.15], yellow: [3.0, 2.2, 0.3], blue: [0.3, 1.2, 3.2], violet: [1.8, 0.5, 3.0], green: [0.5, 2.8, 0.9] };
  // the hanging sculpture: a 30 m garland of red, orange and yellow blooms under the ridge
  for (let i = 0; i < 260; i++) {
    const z = GZ - 14 + r() * 28, a = r() * 6.283, rad = 0.4 + r() * 1.6, y = CURB + 4.6 + Math.sin(a) * rad * 0.6;
    const key = r() < 0.55 ? 'red' : 'yellow';
    glassGeo[key].push(new THREE.SphereGeometry(0.22 + r() * 0.3, 7, 5).scale(1, 0.45, 1).translate(GX + Math.cos(a) * rad, y, z));
    if (i % 3 === 0) { gp.push(GX + Math.cos(a) * rad, y, z); gc.push(...GC[key].map(v => v * 0.8)); gs.push(1.3); gph.push(r()); }
  }
  // outdoor beds: glass reeds, floating spheres and a spiky sun
  const bed = (cx, cz, key, n) => { for (let i = 0; i < n; i++) { const a = r() * 6.283, d = r() * 3.2, hgt = 1.6 + r() * 2.6; glassGeo[key].push(new THREE.CylinderGeometry(0.02, 0.06, hgt, 5).rotateZ((r() - 0.5) * 0.3).translate(cx + Math.cos(a) * d, CURB + hgt / 2, cz + Math.sin(a) * d)); } gp.push(cx, CURB + 1.6, cz); gc.push(...GC[key].map(v => v * 0.5)); gs.push(4.5); gph.push(r()); };
  bed(GX + 14, GZ - 10, 'blue', 70); bed(GX + 16, GZ + 6, 'violet', 60); bed(GX - 14, GZ - 6, 'green', 60); bed(GX - 15, GZ + 11, 'red', 50); bed(GX + 3, GZ - 24, 'blue', 60);
  for (let i = 0; i < 22; i++) { const key = ['blue', 'violet', 'green', 'yellow', 'red'][i % 5]; const x = GX - 20 + r() * 40, z = GZ + 20 + r() * 12, rad = 0.3 + r() * 0.5; glassGeo[key].push(new THREE.SphereGeometry(rad, 12, 9).translate(x, CURB + rad, z)); }
  const SX = GX + 22, SZ = GZ + 20, SY = CURB + 5.2;
  for (let i = 0; i < 150; i++) { const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(); const len = 1.6 + r() * 1.5; const g = new THREE.ConeGeometry(0.11, len, 5).translate(0, len / 2 + 0.4, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)); glassGeo.yellow.push(g.translate(SX, SY, SZ)); }
  glassGeo.yellow.push(new THREE.CylinderGeometry(0.12, 0.2, SY - 1.5, 6).translate(SX, (SY - 1.5) / 2, SZ));
  gp.push(SX, SY, SZ); gc.push(3.0, 2.2, 0.4); gs.push(9); gph.push(0);
  obstacles.push({ x: SX, z: SZ, r: 1.2 });
  for (const [key, list] of Object.entries(glassGeo)) if (list.length) group.add(new THREE.Mesh(merge(list), hdr(...GC[key])));

  // ---- International Fountain: a steel dome ringed by lit jets
  const [FX, FZ] = P.fountain || [-700, 50];
  group.add(new THREE.Mesh(merge([new THREE.SphereGeometry(5.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).translate(FX, CURB, FZ), new THREE.TorusGeometry(15, 0.5, 6, 40).rotateX(Math.PI / 2).translate(FX, CURB + 0.25, FZ)]), new THREE.MeshStandardMaterial({ color: 0x8f9aa3, roughness: 0.22, metalness: 1 })));
  obstacles.push({ x: FX, z: FZ, r: 6 });
  const fp = [], fc = [], fs = [], fph = [];
  for (let j = 0; j < 22; j++) { const a = (j / 22) * 6.283; for (let t = 0.04; t < 1; t += 0.035) { const d = 5.3 + t * 8.5, y = CURB + 0.6 + Math.sin(t * Math.PI) * (6 + 3 * Math.sin(j * 1.7)); fp.push(FX + Math.cos(a) * d, y, FZ + Math.sin(a) * d); fc.push(0.9, 1.35, 2.0); fs.push(0.26); fph.push(t + j * 0.13); } }
  for (let j = 0; j < 40; j++) { const a = (j / 40) * 6.283; fp.push(FX + Math.cos(a) * 15, CURB + 0.7, FZ + Math.sin(a) * 15); fc.push(0.5, 1.2, 2.4); fs.push(0.8); fph.push(j); }

  // ---- the Armory food hall
  const fg = new FacadeGeo();
  const A = { x0: -735, x1: -690, z0: 208, z1: 246 };
  fg.box(A.x0, A.x1, A.z0, A.z1, CURB, CURB + 17, { style: STYLE.BRICK, seed: 6.2, floorH: 5.4, bayW: 4.4, groundH: 6, lit: 0.85, a: 0, tint: [0.33, 0.30, 0.26] });
  const fm = createFacadeMaterial();
  if (P.armory !== false) group.add(new THREE.Mesh(fg.build(), fm.material));
  if (P.armory !== false) colliders.push(A);
  if (P.armory !== false) group.add(signPlane(textTexture([['ARMORY', 150, 128]], '#ffb056', 1024, 256), 16, 4, A.x1 + 0.3, CURB + 10, (A.z0 + A.z1) / 2, Math.PI / 2));

  const lamps = createGlowPoints([...lp, ...gp], [...lc, ...gc], [...ls, ...gs], [...lph, ...gph], { twinkle: 0.06 });
  const jets = createGlowPoints(fp, fc, fs, fph, { twinkle: 0.6 });
  group.add(lamps.points, jets.points);

  const tmp = new THREE.Color();
  const update = (t, camPos) => {
    const d = Math.hypot(camPos.x - NX, camPos.z - NZ);
    const k = Math.min(0.62, 1 - Math.exp(-Math.pow(FOG_DENSITY * 0.42 * d, 2)));
    for (const m of hazed) { if (m.uniforms) m.uniforms.uHaze.value = k; else m.color.copy(tmp.copy(m.userData.base).lerp(fogC, k)); }
    fm.uniforms.uTime.value = t;
  };
  update(0, new THREE.Vector3(0, 0, 0));
  return { group, update, glow: [rim, beacon, lamps, jets] };
}
