// Turns raw OpenStreetMap data into the compact map file the game loads.
//   1. fetch:  curl --data-urlencode "data@tools/mapdata/slu.overpassql" https://overpass-api.de/api/interpreter -o tools/mapdata/slu-raw.json
//   2. bake:   node tools/bake-map.mjs slu
// Map data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
import { readFile, writeFile } from 'node:fs/promises';
const name = process.argv[2] || 'slu';
const raw = JSON.parse(await readFile(`tools/mapdata/${name}-raw.json`, 'utf8'));

// local metres: +x east, +z south, origin at Westlake Ave & Denny Way
const LAT0 = 47.61853, LON0 = -122.33825;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KZ = 110574;
const P = (g) => [+((g.lon - LON0) * KX).toFixed(2), +(-(g.lat - LAT0) * KZ).toFixed(2)];
const BOUNDS = { x0: -520, x1: 640, z0: -1260, z1: 270 };
const inB = ([x, z], m = 0) => x > BOUNDS.x0 - m && x < BOUNDS.x1 + m && z > BOUNDS.z0 - m && z < BOUNDS.z1 + m;

// Douglas-Peucker
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = -1, fd = tol;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len; if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// closed rings: split at the point farthest from the start so each half has a real baseline
function simplifyRing(pts, tol) {
  const closed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5;
  if (!closed) return simplify(pts, tol);
  let k = 0, fd = 0;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; k = i; } });
  return simplify(pts.slice(0, k + 1), tol).concat(simplify(pts.slice(k), tol).slice(1, -1));
}
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]; a += x1 * z2 - x2 * z1; } return a / 2; };

const WIDTH = { trunk: 15, primary: 14.5, secondary: 12.5, tertiary: 11, residential: 9.5, unclassified: 9.5, living_street: 7.5, pedestrian: 5, primary_link: 8, secondary_link: 7.5, tertiary_link: 7, trunk_link: 8 };
const roads = [], buildings = [], water = [], parks = [], tram = [];
const nodeUse = new Map();

for (const e of raw.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && t.highway && WIDTH[t.highway] && e.geometry) {
    if (t.tunnel === 'yes' || t.area === 'yes' || t.access === 'private') continue;
    const pts = e.geometry.map(P);
    if (!pts.some(p => inB(p))) continue;
    const lanes = Number(t.lanes) || 0;
    const w = Math.max(WIDTH[t.highway], lanes ? lanes * 3.25 + (t.highway === 'pedestrian' ? 0 : 2.4) : 0);
    roads.push({ n: t.name || '', k: t.highway, w: +Math.min(w, 24).toFixed(1), l: lanes || (w > 12 ? 4 : 2), o: t.oneway === 'yes' ? 1 : 0, br: t.bridge === 'yes' ? 1 : 0, p: pts, ids: e.nodes });
    for (const id of e.nodes) nodeUse.set(id, (nodeUse.get(id) || 0) + 1);
  } else if (t.building && e.type === 'way' && e.geometry) {
    let ring = simplify(e.geometry.map(P).slice(0, -1), 0.6);
    if (ring.length < 3 || !inB(ring[0])) continue;
    if (area(ring) > 0) ring.reverse();                 // negative area = outward-facing walls
    const a = Math.abs(area(ring)); if (a < 25) continue;
    const lv = Number(t['building:levels']) || 0;
    let h = parseFloat(t.height) || (lv ? lv * 3.6 + 3 : 0);
    buildings.push({ n: (t.name || '').replace(/^Amazon\.com /, 'Amazon '), h: +h.toFixed(1), lv, t: t.building, a: Math.round(a), p: ring });
  } else if (t.natural === 'water' && e.type === 'way' && e.geometry) {
    water.push(simplifyRing(e.geometry.map(P), 1.5));
  } else if (t.natural === 'water' && e.type === 'relation') {
    // stitch the outer ways of the lake into rings
    const segs = e.members.filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(P));
    while (segs.length) {
      let ring = segs.pop();
      for (let grew = true; grew;) {
        grew = false;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i], end = ring[ring.length - 1], eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
          if (eq(s[0], end)) { ring = ring.concat(s.slice(1)); segs.splice(i, 1); grew = true; break; }
          if (eq(s[s.length - 1], end)) { ring = ring.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); grew = true; break; }
        }
      }
      water.push(simplifyRing(ring, 1.5));
    }
  } else if (t.leisure === 'park' && e.geometry) parks.push({ n: t.name || '', p: simplifyRing(e.geometry.map(P), 1) });
  else if (t.railway === 'tram' && e.geometry) tram.push(simplify(e.geometry.map(P), 0.5));
}

// junctions: nodes shared by two or more roads, or where a road ends on another
for (const r of roads) {
  r.j = r.ids.map((id, i) => (nodeUse.get(id) > 1 ? 1 : 0));
  delete r.ids;
}
const out = { name, origin: { lat: LAT0, lon: LON0 }, bounds: BOUNDS, roads, buildings, water, parks, tram, credit: 'Map data © OpenStreetMap contributors (ODbL)' };
await writeFile(`public/assets/map/${name}.json`, JSON.stringify(out));
const kb = Math.round(JSON.stringify(out).length / 1024);
console.log(`${name}: ${roads.length} roads, ${buildings.length} buildings (${buildings.filter(b => b.n).length} named, ${buildings.filter(b => b.h).length} with height), ${water.length} water rings, ${parks.length} parks, ${tram.length} tram ways, ${kb} kB`);
console.log('water ring sizes:', water.map(w => w.length).join(' '));
const ext = (list) => { let a = [1e9, -1e9, 1e9, -1e9]; for (const p of list) { a = [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])]; } return a.map(Math.round).join(' '); };
console.log('road extent x0 x1 z0 z1:', ext(roads.flatMap(r => r.p)), '| building extent:', ext(buildings.flatMap(b => b.p)));
const wl = roads.filter(r => /Westlake/.test(r.n)); console.log('Westlake pieces:', wl.length, wl.slice(0, 3).map(r => r.p[0] + '->' + r.p[r.p.length - 1] + ' w' + r.w).join(' | '));
