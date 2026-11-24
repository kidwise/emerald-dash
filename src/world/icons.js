import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGlowPoints } from './props.js';
import { asset } from '../config.js';
import { textTexture, signPlane } from './districts.js';

// Recognisable shapes for famous buildings and artworks, built on their real footprints or positions:
// MoPOP's crumpled metal, the Central Library's faceted glass, the arena's saddle roof, the Aquarium's
// Ocean Pavilion and pier sheds, the Pacific Science Center arches, the Eagle, Hammering Man and the Gum Wall.

// oriented bounding box of a footprint: centre, axes and half sizes
function obb(ring) {
  let ux = 1, uz = 0, best = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d > best) { best = d; ux = (q[0] - p[0]) / d; uz = (q[1] - p[1]) / d; } }
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const [x, z] of ring) { const a = x * ux + z * uz, b = -x * uz + z * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  const o = { ux, uz, ha: (a1 - a0) / 2, hb: (b1 - b0) / 2, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, angle: Math.atan2(uz, ux) };
  o.at = (la, lb) => [o.cx + la * ux - lb * uz, o.cz + la * uz + lb * ux];
  return o;
}

// a tiling texture drawn on a canvas
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
// Floodlights at the foot of a building: a warm wash of the surface's own colour that fades with height.
function uplit(mat, y0, reach, k) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uUp = { value: new THREE.Vector3(y0, reach, k) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpY;').replace('#include <project_vertex>', '#include <project_vertex>\n vUpY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uUp; varying float vUpY;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.66) * uUp.z * exp(-max(vUpY - uUp.x, 0.0) / uUp.y);');
  };
  mat.customProgramCacheKey = () => 'uplit';
  return mat;
}
// collects quads and triangles (each flat-shaded) into one geometry
function builder() {
  const pos = [], uv = [], idx = [];
  return {
    quad(a, b, c, d, ua, ub, uc, ud) { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...d); uv.push(...ua, ...ub, ...uc, ...ud); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); },
    tri(a, b, c, ua, ub, uc) { const n = pos.length / 3; pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); idx.push(n, n + 1, n + 2); },
    build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; },
  };
}
// a box-section beam between two points
function beam(a, b, w, h) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), g = new THREE.BoxGeometry(w, h, A.distanceTo(Bv));
  return g.applyMatrix4(new THREE.Matrix4().lookAt(A, Bv, new THREE.Vector3(0, 1, 0)).setPosition(A.clone().add(Bv).multiplyScalar(0.5)));
}

export function createIcons({ H, r, mopop, library, arena, aquarium, science, eagle, hammer, gum }) {
  const group = new THREE.Group();
  const glow = [], updaters = [], spots = {};
  // standing-seam metal roofing, shared by the arena and the pier sheds
  const seams = canvasTex(64, 64, (x) => { x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 3, 64); x.fillStyle = '#7a7a7a'; x.fillRect(3, 0, 2, 64); x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, 30, 64, 1); });
  seams.colorSpace = THREE.SRGBColorSpace;
  const zinc = (em) => new THREE.MeshStandardMaterial({ color: 0x8b939e, metalness: 0.65, roughness: 0.42, map: seams, bumpMap: seams, bumpScale: 0.8, emissive: em, side: THREE.DoubleSide });
  const groundAt = (ring) => Math.min(...ring.map(([x, z]) => H(x, z)));

  // ---------------------------------------------------------------- MoPOP: crumpled sheet metal in six colours
  if (mopop) {
    const B = obb(mopop), y0 = groundAt(mopop) - 0.4;
    // the skin is thousands of shingled panels: every sheet a slightly different shade, with a seam between
    const panels = canvasTex(512, 512, (x) => {
      x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 512, 512);
      // rows of shingles of uneven width, so the skin never reads as brickwork
      for (let j = 0; j < 16; j++) { let px = -r() * 60; while (px < 512) { const w = 46 + r() * 70, v = 196 + Math.floor(r() * 59); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(px + 1, j * 32 + 1, w - 2, 30); px += w; } }
    }, [7, 5]);
    panels.colorSpace = THREE.SRGBColorSpace;
    const sp = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.6), fold = (v) => 1 - Math.abs(Math.sin(v));
    // a rounded slab, folded along sharp creases, with a rolling roofline
    const crumple = (n, sx, sy, sz) => {
      const WS = 96, HS = 56, g = new THREE.SphereGeometry(1, WS, HS), p = g.attributes.position, s1 = n * 1.7 + 0.3, s2 = n * 2.9 + 1.1;
      for (let i = 0; i < p.count; i++) {
        const x = sp(p.getX(i)), y = sp(p.getY(i)), z = sp(p.getZ(i)), a = Math.atan2(z, x);
        const k = 0.9 + 0.17 * fold(1.5 * a + 1.3 * y + s1) + 0.11 * fold(2.5 * a - 2.1 * y + s2) + 0.13 * Math.sin(2 * a + s2) * Math.cos(1.7 * y + s1);
        const roof = 1 + 0.24 * Math.sin(2.3 * x + s1) * Math.cos(1.9 * z + s2);
        p.setXYZ(i, x * k * sx, Math.max(y, -0.08) * (y > 0 ? roof : 1) * sy, z * k * sz);
      }
      g.computeVertexNormals();
      const nm = g.attributes.normal;      // close the sphere's seam: both edges share one normal
      for (let j = 0; j <= HS; j++) { const a = j * (WS + 1), b = a + WS, nx = nm.getX(a) + nm.getX(b), ny = nm.getY(a) + nm.getY(b), nz = nm.getZ(a) + nm.getZ(b), l = Math.hypot(nx, ny, nz) || 1; nm.setXYZ(a, nx / l, ny / l, nz / l); nm.setXYZ(b, nx / l, ny / l, nz / l); }
      return g;
    };
    // fuchsia, gold stainless, brushed aluminium, red, sky blue, and a purple that shifts colour as you pass
    const skins = [{ color: 0xb5176e, metalness: 0.9, roughness: 0.26 }, { color: 0xb8872a, metalness: 1, roughness: 0.22 }, { color: 0xc9ced4, metalness: 1, roughness: 0.3 },
      { color: 0xa5121f, metalness: 0.75, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }, { color: 0x77a9e0, metalness: 0.85, roughness: 0.3 },
      { color: 0x6a2f9a, metalness: 1, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [200, 600] }];
    [[-0.55, -0.2, 0.5, 21, 0.6], [0.05, 0.25, 0.48, 17, 0.62], [0.55, -0.15, 0.46, 23, 0.6], [-0.15, -0.45, 0.4, 15, 0.5], [0.5, 0.45, 0.4, 14, 0.5], [-0.6, 0.45, 0.42, 16, 0.5]].forEach(([la, lb, ra, hgt, rb], n) => {
      const g = crumple(n, B.ha * ra, hgt, B.hb * rb * 1.5).rotateY(-B.angle + (n % 2 ? 0.3 : -0.2));
      const mat = uplit(new THREE.MeshPhysicalMaterial({ ...skins[n], map: panels, bumpMap: panels, bumpScale: 0.45, envMapIntensity: 2.2 }), y0, 11, 0.6);
      const [x, z] = B.at(la * B.ha, lb * B.hb), m = new THREE.Mesh(g, mat);
      m.position.set(x, y0, z); group.add(m);
    });
  }

  // ---------------------------------------------------------------- Central Library: stacked, shifted platforms in a diamond-grid glass skin
  if (library) {
    const B = obb(library), y0 = groundAt(library) - 0.5;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#10283a'); gr.addColorStop(0.5, '#183a4e'); gr.addColorStop(1, '#10283a');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(255,200,130,0.16)'; x.fillRect(0, 52, 128, 20);
    x.strokeStyle = 'rgba(190,225,245,0.95)'; x.lineWidth = 5;
    for (const [a, b, cc, d] of [[0, 0, 128, 128], [128, 0, 0, 128], [-64, 64, 64, 192], [64, -64, 192, 64], [64, 192, 192, 64], [-64, 64, 64, -64]]) { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    // [height, shift along, shift across, scale along, scale across]
    const L = [[0, 0, 0, 1, 1], [10, 0, 0, 1, 1], [19, 0.14, -0.1, 0.86, 0.9], [31, -0.1, 0.14, 1.1, 1.02], [41, 0.1, 0.04, 0.8, 0.86], [52, -0.05, -0.08, 0.96, 0.92], [57, -0.05, -0.08, 0.7, 0.7]];
    const corners = (l) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => { const [wx, wz] = B.at((l[1] + sa * l[3]) * B.ha, (l[2] + sb * l[4]) * B.hb); return [wx, y0 + l[0], wz]; });
    const pos = [], uv = [], idx = [];
    for (let k = 0; k < L.length - 1; k++) {
      const lo = corners(L[k]), hi = corners(L[k + 1]);
      for (let e = 0; e < 4; e++) {
        const a = lo[e], b = lo[(e + 1) % 4], cq = hi[(e + 1) % 4], d = hi[e], n = pos.length / 3, w = Math.hypot(b[0] - a[0], b[2] - a[2]);
        pos.push(...a, ...b, ...cq, ...d);
        uv.push(0, a[1] / 3.2, w / 3.2, b[1] / 3.2, w / 3.2, cq[1] / 3.2, 0, d[1] / 3.2);
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      }
    }
    const top = corners(L[L.length - 1]), n = pos.length / 3;
    pos.push(...top.flat()); uv.push(0.5, 0.2, 0.5, 0.2, 0.5, 0.2, 0.5, 0.2); idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.25, 1.25, 1.25), side: THREE.DoubleSide })));
  }

  // ---------------------------------------------------------------- Climate Pledge Arena: the 1962 saddle roof over a glass concourse
  if (arena) {
    const B = obb(arena), g0 = Math.max(...arena.map(([x, z]) => H(x, z))), yb = g0 + 2.5, Ec = yb + 4.5, Em = yb + 16, A = yb + 33, ha = B.ha * 1.03, hb = B.hb * 1.03;
    const P = (la, lb, y) => { const [x, z] = B.at(la, lb); return [x, y, z]; };
    // four hyperbolic-paraboloid panels: high at the centre, lower at the middle of each side, lowest at the corners
    const N = 14, pos = [], uv = [], idx = [];
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const base = pos.length / 3;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const u = i / N, v = j / N; pos.push(...P(sa * ha * u, sb * hb * v, A * (1 - u) * (1 - v) + Em * u * (1 - v) + Em * (1 - u) * v + Ec * u * v)); uv.push(u * ha / 0.9, v * hb / 6); }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = base + j * (N + 1) + i; idx.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1); }
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    group.add(new THREE.Mesh(rg, zinc(0x222a36)));
    // concrete: ridge trusses from the centre, edge beams falling to the corners, and a buttress at each corner
    const beams = [];
    for (const s of [1, -1]) { beams.push(beam(P(0, 0, A + 0.6), P(s * ha, 0, Em + 0.6), 1.8, 2.4), beam(P(0, 0, A + 0.6), P(0, s * hb, Em + 0.6), 1.8, 2.4)); }
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      beams.push(beam(P(sa * ha, 0, Em + 0.2), P(sa * ha, sb * hb, Ec + 0.2), 1.3, 1.9), beam(P(0, sb * hb, Em + 0.2), P(sa * ha, sb * hb, Ec + 0.2), 1.3, 1.9));
      beams.push(beam(P(sa * ha * 0.97, sb * hb * 0.97, Ec + 1.2), P(sa * ha * 1.13, sb * hb * 1.13, g0 - 1.5), 3.4, 3.8));
      beams.push(beam(P(sa * ha * 0.9, sb * hb, Ec + 0.6), P(sa * ha * 1.13, sb * hb * 1.13, g0 - 1.5), 1.6, 2.2), beam(P(sa * ha, sb * hb * 0.9, Ec + 0.6), P(sa * ha * 1.13, sb * hb * 1.13, g0 - 1.5), 1.6, 2.2));
    }
    group.add(new THREE.Mesh(mergeGeometries(beams), uplit(new THREE.MeshStandardMaterial({ color: 0xd9d6cd, roughness: 0.85, emissive: 0x201f1c }), g0, 9, 0.42)));
    // the glass wall under the eaves, taller toward the middle of each side, with the concourse lit inside
    const glass = canvasTex(128, 256, (x) => {
      const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0b1c26'); gr.addColorStop(0.4, '#1d3840'); gr.addColorStop(0.66, '#a8703a'); gr.addColorStop(0.82, '#e9a85c'); gr.addColorStop(1, '#f4c98a');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 256);
      x.fillStyle = 'rgba(255,214,150,0.35)'; x.fillRect(0, 96, 128, 10);
      x.fillStyle = '#0a0d10'; x.fillRect(0, 0, 4, 256); x.fillRect(62, 0, 3, 256); x.fillRect(0, 92, 128, 3); x.fillRect(0, 176, 128, 3);
      x.fillStyle = 'rgba(10,12,16,0.8)'; for (let i = 0; i < 5; i++) { const px = 8 + r() * 108; x.fillRect(px, 226, 5, 30); x.beginPath(); x.arc(px + 2.5, 222, 4, 0, 7); x.fill(); }
    });
    glass.colorSpace = THREE.SRGBColorSpace; glass.wrapT = THREE.ClampToEdgeWrapping;
    const gb = builder(), yg = g0 - 1.2, ia = B.ha * 0.995, ib = B.hb * 0.995, span = Em - yg;
    for (const s of [1, -1]) for (const t of [1, -1]) {
      gb.quad(P(s * ia, 0, yg), P(s * ia, t * ib, yg), P(s * ia, t * ib, Ec), P(s * ia, 0, Em), [0, 0], [ib / 5, 0], [ib / 5, (Ec - yg) / span], [0, 1]);
      gb.quad(P(0, s * ib, yg), P(t * ia, s * ib, yg), P(t * ia, s * ib, Ec), P(0, s * ib, Em), [0, 0], [ia / 5, 0], [ia / 5, (Ec - yg) / span], [0, 1]);
    }
    group.add(new THREE.Mesh(gb.build(), new THREE.MeshBasicMaterial({ map: glass, color: new THREE.Color(0.95, 0.95, 0.95), side: THREE.DoubleSide })));
    const gp = [], gc = [], gs = [], gph = [];
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) { const q = P(sa * ha * 1.2, sb * hb * 1.2, g0 + 0.5); gp.push(...q); gc.push(2.6, 2.2, 1.6); gs.push(1.8); gph.push(sa + sb); }
    gp.push(...P(0, 0, A + 2.4)); gc.push(3.2, 2.8, 2.2); gs.push(1.6); gph.push(0);
    const lights = createGlowPoints(gp, gc, gs, gph, { twinkle: 0 }); group.add(lights.points); glow.push(lights);
  }

  // ---------------------------------------------------------------- Seattle Aquarium: the Ocean Pavilion's tank window, and the pier sheds
  if (aquarium) {
    const { pavilion, piers, street } = aquarium;
    const y0 = groundAt(pavilion) - 0.3, PH = 13.8;
    let pcx = 0, pcz = 0; for (const q of pavilion) { pcx += q[0] / pavilion.length; pcz += q[1] / pavilion.length; }
    // curved walls in cedar slats
    const cedar = canvasTex(256, 256, (x) => {
      for (let i = 0; i < 32; i++) { const v = r(); x.fillStyle = `rgb(${150 + v * 55 | 0},${104 + v * 42 | 0},${56 + v * 28 | 0})`; x.fillRect(i * 8, 0, 7, 256); x.fillStyle = '#2a1c10'; x.fillRect(i * 8 + 7, 0, 1, 256); }
      x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, 84, 256, 2); x.fillRect(0, 170, 256, 2);
    });
    cedar.colorSpace = THREE.SRGBColorSpace;
    const wb = builder(), gp = [], gc = [], gs = [], gph = [];
    let run = 0;
    for (let i = 0; i < pavilion.length; i++) {
      const a = pavilion[i], b = pavilion[(i + 1) % pavilion.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      wb.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + PH, b[1]], [a[0], y0 + PH, a[1]], [run / 4, 0], [(run + len) / 4, 0], [(run + len) / 4, PH / 4.6], [run / 4, PH / 4.6]);
      // the roof terrace's rail lights
      for (let d = 0; d < len; d += 3) { gp.push(a[0] + (b[0] - a[0]) * d / len, y0 + PH + 1.0, a[1] + (b[1] - a[1]) * d / len); gc.push(2.2, 1.7, 1.0); gs.push(0.16); gph.push(r()); }
      run += len;
    }
    group.add(new THREE.Mesh(wb.build(), uplit(new THREE.MeshStandardMaterial({ map: cedar, roughness: 0.75, side: THREE.DoubleSide }), y0, 9, 0.5)));
    const cap = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pavilion.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c3a26, roughness: 0.95, emissive: 0x0b1a10, side: THREE.DoubleSide }));
    cap.position.y = y0 + PH; group.add(cap);
    // the tank: a bay window on the street side, alive with fish
    let nx = street[0] - pcx, nz = street[1] - pcz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const dmax = Math.max(...pavilion.map(([x, z]) => (x - pcx) * nx + (z - pcz) * nz)), TW = 24, TH = 8, ty = y0 + 1.3 + TH / 2, rot = Math.atan2(nx, nz);
    const tankMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAspect: { value: TW / TH } }]),
      vertexShader: /* glsl */`
varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */`
uniform float uTime; uniform float uAspect;
varying vec2 vUv;
#include <fog_pars_fragment>
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
// a fish facing +x: a body and a tail, flexing as it swims
float fish(vec2 p, float wag){
  p.y += sin(p.x * 3.0 + wag) * 0.07;
  float body = 1.0 - smoothstep(0.8, 1.0, length(p * vec2(1.0, 2.7)));
  float tx = -p.x - 0.75;
  float tail = smoothstep(0.0, 0.06, tx) * (1.0 - smoothstep(0.7, 0.78, tx)) * (1.0 - smoothstep(0.0, 0.04, abs(p.y) - tx * 0.6));
  return max(body, tail);
}
void main(){
  vec2 uv = vUv; vec2 p = vec2(uv.x * uAspect, uv.y);
  vec3 col = mix(vec3(0.0, 0.035, 0.12), vec3(0.0, 0.26, 0.42), smoothstep(0.0, 0.75, uv.y));
  col = mix(col, vec3(0.30, 0.78, 0.82), smoothstep(0.55, 1.05, uv.y) * 0.75);
  // shafts of light from the surface
  float sh = 0.0;
  for (int i = 0; i < 4; i++) { float f = float(i); sh += smoothstep(0.55, 1.0, sin((p.x + uv.y * 0.3) * (2.1 + f * 1.3) + uTime * (0.15 + f * 0.06) + f * 2.0)); }
  col += vec3(0.20, 0.42, 0.40) * sh * 0.16 * uv.y * uv.y;
  // a distant school
  for (int i = 0; i < 14; i++) {
    float f = float(i); float dir = h1(f) > 0.5 ? 1.0 : -1.0; float spd = 0.03 + h1(f + 3.0) * 0.05;
    float y = 0.25 + h1(f + 7.0) * 0.65 + sin(uTime * 0.5 + f) * 0.02; float s = 0.018 + h1(f + 11.0) * 0.02;
    float x = fract(h1(f + 5.0) + uTime * spd) * (uAspect + 0.4) - 0.2; if (dir < 0.0) x = uAspect - x;
    vec2 q = (p - vec2(x, y)) / s; q.x *= dir;
    col = mix(col, vec3(0.0, 0.07, 0.14), fish(q, uTime * 6.0 + f) * 0.7);
  }
  // kelp, swaying
  for (int i = 0; i < 9; i++) {
    float f = float(i); float x0 = (h1(f + 20.0) * 0.98 + 0.01) * uAspect; float hgt = 0.35 + h1(f + 31.0) * 0.5;
    float sway = sin(uTime * 0.7 + f * 1.7 + uv.y * 5.0) * 0.035 * uv.y;
    float d = abs(p.x - x0 - sway) - 0.012 - 0.012 * sin(uv.y * 40.0 + f);
    float k = (1.0 - smoothstep(0.0, 0.008, d)) * (1.0 - smoothstep(hgt - 0.05, hgt, uv.y));
    col = mix(col, vec3(0.03, 0.16, 0.07) + vec3(0.05, 0.12, 0.0) * uv.y, k * 0.9);
  }
  // nearer fish, in colour
  for (int i = 0; i < 7; i++) {
    float f = float(i) + 40.0; float dir = h1(f) > 0.5 ? 1.0 : -1.0; float spd = 0.05 + h1(f + 3.0) * 0.05;
    float y = 0.2 + h1(f + 7.0) * 0.6 + sin(uTime * 0.8 + f) * 0.03; float s = 0.055 + h1(f + 11.0) * 0.045;
    float x = fract(h1(f + 5.0) + uTime * spd) * (uAspect + 0.6) - 0.3; if (dir < 0.0) x = uAspect - x;
    vec2 q = (p - vec2(x, y)) / s; q.x *= dir;
    vec3 fc = mix(vec3(1.0, 0.5, 0.12), vec3(0.75, 0.85, 0.9), step(0.5, h1(f + 13.0))) * (1.0 + 0.3 * q.y);
    col = mix(col, fc, fish(q, uTime * 5.0 + f));
  }
  // one slow shark
  {
    float x = fract(uTime * 0.022) * (uAspect + 1.6) - 0.8;
    vec2 q = (p - vec2(x, 0.62 + sin(uTime * 0.3) * 0.05)) / 0.21;
    float body = fish(q * vec2(1.0, 1.5), uTime * 2.0);
    float fin = step(0.2, q.y) * step(q.y, 0.7) * step(abs(q.x + 0.1 + (q.y - 0.2) * 0.5), (0.7 - q.y) * 0.45);
    col = mix(col, vec3(0.02, 0.09, 0.15), max(body, fin) * 0.92);
  }
  // mullions
  col *= 1.0 - 0.85 * smoothstep(0.488, 0.496, abs(fract(uv.x * 4.0) - 0.5));
  gl_FragColor = vec4(clamp(col * 1.9, vec3(0.0), vec3(8.0)), 1.0);
  #include <fog_fragment>
}`,
    });
    const tank = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), tankMat);
    tank.position.set(pcx + nx * (dmax + 0.5), ty, pcz + nz * (dmax + 0.5)); tank.rotation.y = rot; group.add(tank);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(TW + 1.4, TH + 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.5, metalness: 0.6 }));
    frame.position.set(pcx + nx * (dmax - 2.55), ty, pcz + nz * (dmax - 2.55)); frame.rotation.y = rot; group.add(frame);
    updaters.push((t) => { tankMat.uniforms.uTime.value = t; });
    spots.aquarium = [tank.position.x, ty, tank.position.z];
    // the tank's glow spills onto the pavement
    for (let k = -3; k <= 3; k++) { gp.push(tank.position.x + nz * k * 3.2 + nx * 2.5, y0 + 0.5, tank.position.z - nx * k * 3.2 + nz * 2.5); gc.push(0.25, 1.1, 1.5); gs.push(2.4); gph.push(k); }
    const sy = y0 + PH - 2.0, sx = pcx + nx * (dmax + 0.75), sz = pcz + nz * (dmax + 0.75);
    group.add(signPlane(textTexture([['SEATTLE AQUARIUM', 104, 128]], '#9fe8ff', 1024, 256), 16, 4, sx, sy, sz, rot));
    const board = new THREE.Mesh(new THREE.BoxGeometry(16.6, 4.3, 3), frame.material); board.position.set(sx - nx * 1.6, sy, sz - nz * 1.6); board.rotation.y = rot; group.add(board);

    // the pier sheds: long gabled timber sheds with a row of lit windows
    const siding = canvasTex(128, 128, (x) => {
      x.fillStyle = '#4f6b70'; x.fillRect(0, 0, 128, 128);
      x.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 6; y < 128; y += 7) x.fillRect(0, y, 128, 1);
      x.fillStyle = '#e9e6dc'; x.fillRect(0, 0, 128, 5); x.fillRect(0, 122, 128, 6); x.fillRect(36, 34, 56, 58);
      x.fillStyle = '#ffd9a0'; x.fillRect(40, 38, 48, 50); x.fillStyle = '#e9e6dc'; x.fillRect(63, 38, 2, 50); x.fillRect(40, 62, 48, 2);
    });
    siding.colorSpace = THREE.SRGBColorSpace; siding.wrapT = THREE.ClampToEdgeWrapping;
    const sidingGlow = canvasTex(128, 128, (x) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
      const gr = x.createLinearGradient(0, 38, 0, 88); gr.addColorStop(0, '#ffe2b0'); gr.addColorStop(1, '#c98a4a'); x.fillStyle = gr; x.fillRect(40, 38, 48, 50);
      x.fillStyle = '#000'; x.fillRect(63, 38, 2, 50); x.fillRect(40, 62, 48, 2);
    });
    sidingGlow.colorSpace = THREE.SRGBColorSpace; sidingGlow.wrapT = THREE.ClampToEdgeWrapping;
    const sb = builder(), rb = builder();
    for (const ring of piers) {
      const Bp = obb(ring), long = Bp.ha >= Bp.hb, L = long ? Bp.ha : Bp.hb, Wd = long ? Bp.hb : Bp.ha, yp = groundAt(ring) - 0.3, wh = 6.5, rh = Math.min(5, Wd * 0.45);
      const P = (l, w, y) => { const [x, z] = long ? Bp.at(l, w) : Bp.at(w, l); return [x, yp + y, z]; };
      for (const s of [1, -1]) {
        sb.quad(P(-L, s * Wd, 0), P(L, s * Wd, 0), P(L, s * Wd, wh), P(-L, s * Wd, wh), [0, 0], [L / 2.2, 0], [L / 2.2, 1], [0, 1]);
        sb.quad(P(s * L, -Wd, 0), P(s * L, Wd, 0), P(s * L, Wd, wh), P(s * L, -Wd, wh), [0, 0], [Wd / 2.2, 0], [Wd / 2.2, 1], [0, 1]);
        sb.tri(P(s * L, -Wd, wh), P(s * L, Wd, wh), P(s * L, 0, wh + rh), [0, 0.9], [0.2, 0.9], [0.1, 0.9]);
        rb.quad(P(-L - 0.9, s * (Wd + 0.8), wh - 0.3), P(L + 0.9, s * (Wd + 0.8), wh - 0.3), P(L + 0.9, 0, wh + rh + 0.12), P(-L - 0.9, 0, wh + rh + 0.12), [0, 0], [2 * L / 0.9, 0], [2 * L / 0.9, 1.5], [0, 1.5]);
        for (let l = -L; l <= L; l += 2.6) { gp.push(...P(l, s * (Wd + 0.9), wh - 0.5)); gc.push(2.3, 1.7, 0.95); gs.push(0.17); gph.push(r()); }
      }
    }
    group.add(new THREE.Mesh(sb.build(), uplit(new THREE.MeshStandardMaterial({ map: siding, emissiveMap: sidingGlow, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.85, side: THREE.DoubleSide }), y0, 6, 0.55)));
    group.add(new THREE.Mesh(rb.build(), zinc(0x1c2430)));
    const lights = createGlowPoints(gp, gc, gs, gph, { twinkle: 0.06 }); group.add(lights.points); glow.push(lights);
  }

  // ---------------------------------------------------------------- Pacific Science Center: five white gothic arches
  if (science) {
    const [sx, sz] = science, y0 = H(sx, sz), ribs = [];
    for (const [ox, oz, hgt] of [[0, 0, 34], [10, 7, 30], [-10, 7, 30], [10, -7, 30], [-10, -7, 30]]) {
      for (const [ca, cb] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
        const pts = [[2.4, 0], [3.3, 0.3], [3.0, 0.62], [1.7, 0.86], [0.35, 1]].map(([w, t]) => new THREE.Vector3(sx + ox + ca * w, y0 + t * hgt, sz + oz + cb * w));
        ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.24, 5, false));
      }
      for (const t of [0.3, 0.62, 0.86]) { const w = t < 0.4 ? 3.3 : t < 0.7 ? 3.0 : 1.7; ribs.push(new THREE.TorusGeometry(w * 1.41, 0.1, 4, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4).translate(sx + ox, y0 + t * hgt, sz + oz)); }
    }
    group.add(new THREE.Mesh(mergeGeometries(ribs.map(q => q.index ? q.toNonIndexed() : q)), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.45) })));
  }

  // ---------------------------------------------------------------- the Eagle: red steel plates at the sculpture park
  if (eagle) {
    const [ex, ez] = eagle, y0 = H(ex, ez), parts = [];
    const plate = (pts, ry, dz) => { const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))); parts.push(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).translate(0, 0, dz).rotateY(ry)); };
    plate([[-5.5, 0], [-2.2, 0], [0.5, 9.5]], 0.25, 0);
    plate([[5.5, 0], [2.6, 0], [-0.5, 9.5]], -0.35, 0.4);
    plate([[-1, 0], [1.2, 0], [0.2, 8]], 1.4, -2.2);
    plate([[-7.5, 6], [6.5, 7.5], [0, 12]], 0.1, 0.2);
    plate([[0.5, 8.5], [8.5, 3], [9.4, 4.2]], -0.5, 0.3);
    const m = new THREE.Mesh(mergeGeometries(parts.map(q => q.index ? q.toNonIndexed() : q)), new THREE.MeshStandardMaterial({ color: 0xd2281e, roughness: 0.45, emissive: 0x8a140e, emissiveIntensity: 0.9, side: THREE.DoubleSide }));
    m.position.set(ex, y0, ez); group.add(m);
    const lights = createGlowPoints([ex - 6, y0 + 0.5, ez + 5, ex + 6, y0 + 0.5, ez + 5, ex, y0 + 0.5, ez - 6], [2.5, 1.8, 1.2, 2.5, 1.8, 1.2, 2.5, 1.8, 1.2], [1.6, 1.6, 1.6], [0, 1, 2], { twinkle: 0 });
    group.add(lights.points); glow.push(lights);
  }

  // ---------------------------------------------------------------- Hammering Man: a tall flat silhouette whose arm never stops
  if (hammer) {
    const [hx, hz, face] = hammer, y0 = H(hx, hz), black = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.5, metalness: 0.4, emissive: 0x2c333c, emissiveIntensity: 1 });
    const up = createGlowPoints([hx - 2.5, y0 + 0.4, hz, hx + 2.5, y0 + 0.4, hz, hx, y0 + 0.4, hz + 2.5, hx, y0 + 0.4, hz - 2.5], [2.6, 2.2, 1.6, 2.6, 2.2, 1.6, 2.6, 2.2, 1.6, 2.6, 2.2, 1.6], [1.5, 1.5, 1.5, 1.5], [0, 1, 2, 3], { twinkle: 0 }); group.add(up.points); glow.push(up);
    const fig = new THREE.Group();
    const bx = (w, hgt, x, y) => new THREE.BoxGeometry(w, hgt, 0.35).translate(x, y, 0);
    fig.add(new THREE.Mesh(mergeGeometries([bx(0.95, 6.2, -0.75, 3.1), bx(0.95, 6.2, 0.75, 3.1), bx(2.7, 4.6, 0, 8.4), new THREE.CylinderGeometry(0.95, 0.95, 0.35, 20).rotateX(Math.PI / 2).translate(0, 11.8, 0), bx(0.6, 4.2, -1.6, 8.3)]), black));
    const arm = new THREE.Group(); arm.position.set(1.45, 10.2, 0.2);
    arm.add(new THREE.Mesh(mergeGeometries([bx(0.6, 4.4, 0, -2.2), bx(0.28, 2.4, 0, -5.4), bx(1.5, 0.85, 0, -6.9)]), black));
    fig.add(arm); fig.position.set(hx, y0, hz); fig.rotation.y = face; group.add(fig);
    updaters.push((t) => { arm.rotation.z = 1.0 + 0.55 * Math.sin(t * 1.6); });
  }

  // ---------------------------------------------------------------- the Gum Wall: a brick wall freckled with colour
  if (gum) {
    const [gx, gz] = gum.at, y0 = H(gx, gz), a = gum.th, W = 16, Hh = 3.8;
    const map = new THREE.TextureLoader().load(asset('assets/tex/red_brick_03_diff.jpg')); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(W / 2.4, Hh / 2.4); map.colorSpace = THREE.SRGBColorSpace;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, Hh, W), new THREE.MeshStandardMaterial({ map, roughness: 0.8, emissiveMap: map, emissive: 0xffd2a0, emissiveIntensity: 0.6 }));
    wall.position.set(gx, y0 + Hh / 2, gz); wall.rotation.y = a; group.add(wall);
    const gp = [], gc = [], gs = [], gph = [], pal = [[1, 0.3, 0.6], [0.4, 0.9, 1], [1, 0.9, 0.3], [0.5, 1, 0.5], [1, 0.5, 0.2], [0.8, 0.5, 1], [1, 1, 1]];
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < 1400; i++) for (const side of [-1, 1]) { if (r() < 0.5) continue; const lz = (r() - 0.5) * W, y = 0.3 + r() * (Hh - 0.5), lx = side * 0.24, k = pal[Math.floor(r() * pal.length)]; gp.push(gx + lx * c + lz * s, y0 + y, gz - lx * s + lz * c); gc.push(k[0] * 1.3, k[1] * 1.3, k[2] * 1.3); gs.push(0.07 + r() * 0.05); gph.push(r()); }
    const dots = createGlowPoints(gp, gc, gs, gph, { twinkle: 0 }); group.add(dots.points); glow.push(dots);
  }

  group.traverse(o => { o.frustumCulled = false; });
  return { group, glow, spots, update: (t) => { for (const u of updaters) u(t); } };
}
