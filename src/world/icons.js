import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGlowPoints } from './props.js';
import { asset } from '../config.js';

// Recognisable shapes for famous buildings and artworks, built on their real footprints or positions:
// MoPOP's crumpled metal, the Central Library's faceted glass, the arena's pyramid roof,
// the Pacific Science Center arches, the Eagle, Hammering Man and the Gum Wall.

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

export function createIcons({ H, r, mopop, library, arena, science, eagle, hammer, gum }) {
  const group = new THREE.Group();
  const glow = [], updaters = [];
  const groundAt = (ring) => Math.min(...ring.map(([x, z]) => H(x, z)));

  // ---------------------------------------------------------------- MoPOP: crumpled, coloured sheet metal
  if (mopop) {
    const B = obb(mopop), y0 = groundAt(mopop) - 0.5;
    const blobs = [[-0.55, -0.2, 0.5, 20, 0.6, 0xa8145a], [0.05, 0.25, 0.48, 17, 0.62, 0xc9a227], [0.55, -0.15, 0.46, 22, 0.6, 0xb9bec5], [-0.15, -0.45, 0.4, 15, 0.5, 0x9a1a1a], [0.5, 0.45, 0.4, 14, 0.5, 0x5a8ad6], [-0.6, 0.45, 0.42, 16, 0.5, 0x6a2a8a]];
    blobs.forEach(([la, lb, ra, hgt, rb, color], n) => {
      const g = new THREE.SphereGeometry(1, 30, 20), p = g.attributes.position, s1 = n * 1.7, s2 = n * 2.9;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + 0.2 * Math.sin(3.1 * x + s1) * Math.sin(2.6 * z + s2) + 0.12 * Math.sin(5 * y + s1 * 2) * Math.cos(4 * x + s2);
        p.setXYZ(i, x * k, Math.max(y, -0.15) * k, z * k);
      }
      g.scale(B.ha * ra, hgt, B.hb * rb * 1.5).rotateY(-B.angle + (n % 2 ? 0.3 : -0.2));
      g.computeVertexNormals();
      const [x, z] = B.at(la * B.ha, lb * B.hb);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness: 0.88, roughness: 0.26, emissive: color, emissiveIntensity: 0.22 }));
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

  // ---------------------------------------------------------------- Climate Pledge Arena: the 1962 pyramid roof with lit ridges
  if (arena) {
    const B = obb(arena), y0 = Math.max(...arena.map(([x, z]) => H(x, z))) + 10.6, apex = y0 + 26, [ax, az] = B.at(0, 0);
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => B.at(sa * B.ha * 1.04, sb * B.hb * 1.04));
    const pos = [], idx = [];
    for (let e = 0; e < 4; e++) { const a = cs[e], b = cs[(e + 1) % 4], n = pos.length / 3; pos.push(a[0], y0, a[1], b[0], y0, b[1], ax, apex, az); idx.push(n, n + 2, n + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.55, metalness: 0.4, emissive: 0x2c3038, emissiveIntensity: 1, side: THREE.DoubleSide })));
    const gp = [], gc = [], gs = [], gph = [];
    for (let e = 0; e < 4; e++) {
      const a = cs[e], b = cs[(e + 1) % 4];
      for (let t = 0.02; t < 1; t += 0.035) { gp.push(a[0] + (ax - a[0]) * t, y0 + (apex - y0) * t + 0.3, a[1] + (az - a[1]) * t); gc.push(2.6, 2.1, 1.4); gs.push(0.7); gph.push(t); }
      for (let t = 0; t < 1; t += 0.03) { gp.push(a[0] + (b[0] - a[0]) * t, y0 + 0.2, a[1] + (b[1] - a[1]) * t); gc.push(0.6, 1.6, 2.4); gs.push(0.6); gph.push(t); }
    }
    gp.push(ax, apex + 1, az); gc.push(4, 3.4, 2.4); gs.push(4); gph.push(0);
    const lights = createGlowPoints(gp, gc, gs, gph, { twinkle: 0.05, fogK: 0.6 }); group.add(lights.points); glow.push(lights);
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
  return { group, glow, update: (t) => { for (const u of updaters) u(t); } };
}
