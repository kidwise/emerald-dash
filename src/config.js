// World layout. Units are metres. +x = east, -z = north, +y = up.
//
// Three districts share one street grid (88 m pitch):
//   South Lake Union  - flat, north of Denny Way, down to Lake Union Park
//   Downtown          - south of Denny; west of 5th Ave the streets step downhill to Pike Place Market
//   Seattle Center    - west along Denny Way: the Space Needle campus
//
// Every road has an extent, so avenues and streets can start and stop (T-junctions, stubs).

export const AVENUES = [
  { name: '5th Ave N', x: -528, hw: 8, z0: -7, z1: 274 },
  { name: '1st Ave', x: -440, hw: 8, z0: 345, z1: 800, brick: true },
  { name: '2nd Ave', x: -352, hw: 8, z0: 345, z1: 800 },
  { name: '3rd Ave', x: -264, hw: 8, z0: 345, z1: 800 },
  { name: '4th Ave', x: -176, hw: 8, z0: 345, z1: 800 },
  { name: '9th Ave N', nameS: '5th Ave', x: -88, hw: 8, z0: -272, z1: 800 },
  { name: 'Westlake Ave N', nameS: '6th Ave', x: 0, hw: 11, z0: -272, z1: 800 },
  { name: 'Terry Ave N', nameS: '7th Ave', x: 88, hw: 8, z0: -272, z1: 800 },
];
export const STREETS = [
  { name: 'Valley St', z: -264, hw: 8, x0: -420, x1: 420 },
  { name: 'Mercer St', z: -176, hw: 12, x0: -150, x1: 150 },
  { name: 'Republican St', z: -88, hw: 7, x0: -150, x1: 150 },
  { name: 'Harrison St', z: 0, hw: 7, x0: -536, x1: 150 },
  { name: 'Thomas St', z: 88, hw: 7, x0: -150, x1: 150 },
  { name: 'John St', z: 176, hw: 7, x0: -150, x1: 150 },
  { name: 'Denny Way', z: 264, hw: 10, x0: -536, x1: 150 },
  { name: 'Lenora St', z: 352, hw: 7, x0: -448, x1: 150 },
  { name: 'Virginia St', z: 440, hw: 7, x0: -448, x1: 150 },
  { name: 'Stewart St', z: 528, hw: 7, x0: -448, x1: 150 },
  { name: 'Pine St', z: 616, hw: 7, x0: -448, x1: 150 },
  { name: 'Pike St', z: 704, hw: 7, x0: -448, x1: 150 },
  { name: 'Union St', z: 792, hw: 8, x0: -448, x1: 150 },
];
export const DENNY = STREETS.find(s => s.name === 'Denny Way');

export const Z_NORTH = -272;    // north kerb of Valley St (the park begins)
export const Z_DENNY = 274;     // south kerb of Denny Way
export const Z_SOUTH = 800;     // south kerb of Union St
export const X_WEST = -96;      // west kerb of 9th / 5th Ave
export const X_EAST = 96;       // east kerb of Terry / 7th Ave
export const CURB = 0.16;
export const LAKE_Z = -372;     // Lake Union shoreline
export const LAMP_PITCH = 22;
export const LAMP_H = 8.2;
export const SIDEWALK = 4.6;

export const FOG_COLOR = [0.045, 0.07, 0.115];
export const FOG_DENSITY = 0.0036;

// ---------------------------------------------------------------- terrain
// West of 5th Ave, downtown steps down toward the waterfront: each avenue is a level terrace,
// each block between them a steady slope. North of Lenora St the land is level.
export const HILL_Z = 345 - SIDEWALK;
export const HILL_DROP = 8;                    // metres per block
export const MARKET_Y = -4 * HILL_DROP;
export function hillF(x) {
  if (x >= -96) return 0;
  if (x <= -448) return MARKET_Y;
  const k = Math.min(3, Math.max(0, Math.floor((x + 440) / 88)));
  const t = Math.min(1, Math.max(0, (x - (-440 + 88 * k) - 8) / 72));
  return MARKET_Y + HILL_DROP * (k + t);
}
// A different map (the real-data one) can replace these answers wholesale.
let OVERRIDE = null;
export function setMapOverride(o) { OVERRIDE = o; }
export const heightAt = (x, z) => (OVERRIDE ? 0 : z > HILL_Z ? hillF(x) : 0);

export const avenueAt = (a, z) => z > a.z0 && z < a.z1;
export const streetAt = (s, x) => x > s.x0 && x < s.x1;
// does this avenue actually cross this street?
export const isNode = (a, s) => s.z >= a.z0 - 1 && s.z <= a.z1 + 1 && a.x >= s.x0 - 1 && a.x <= s.x1 + 1;
export const avenueName = (a, z) => (z > Z_DENNY && a.nameS ? a.nameS : a.name);

// kerb height above the terrain: 0 on a road surface, CURB elsewhere
export function onRoad(x, z) {
  if (OVERRIDE) return true;
  for (const a of AVENUES) if (Math.abs(x - a.x) < a.hw && avenueAt(a, z)) return true;
  for (const s of STREETS) if (Math.abs(z - s.z) < s.hw && streetAt(s, x)) return true;
  return false;
}
export const groundHeight = (x, z) => heightAt(x, z) + (onRoad(x, z) ? 0 : CURB);

// places you may drive that are not streets
export const CAMPUS = { x0: -752, x1: -536, z0: 7, z1: 254 };              // Seattle Center
export const MARKET = { x0: -520, x1: -448, z0: 352, z1: 800 };            // Pike Place
export const PARK = { x0: -205, x1: 205, z0: LAKE_Z + 4, z1: Z_NORTH };    // Lake Union Park
const inRect = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
export function inBounds(x, z) {
  if (OVERRIDE) return OVERRIDE.inBounds(x, z);
  if (inRect(CAMPUS, x, z) || inRect(MARKET, x, z) || inRect(PARK, x, z)) return true;
  for (const a of AVENUES) if (Math.abs(x - a.x) < a.hw + 12 && z > a.z0 - 4 && z < a.z1 + 4) return true;
  for (const s of STREETS) if (Math.abs(z - s.z) < s.hw + 12 && x > Math.max(s.x0, -540) - 4 && x < Math.min(s.x1, 104)) return true;
  return false;
}

export function district(x, z) {
  if (OVERRIDE) return OVERRIDE.district ? OVERRIDE.district(x, z) : 'slu';
  if (x < -104 && z < Z_DENNY + 4) return z > -20 ? 'center' : 'none';
  if (z > Z_DENNY - 4) return 'downtown';
  return 'slu';
}

// ---------------------------------------------------------------- shader constants
const f = (v) => Number(v).toFixed(2);
const arr = (name, a) => `const float ${name}[${a.length}] = float[${a.length}](${a.map(f).join(',')});`;
export const WESTLAKE_INDEX = AVENUES.findIndex(a => a.x === 0);
export const BRICK_INDEX = AVENUES.findIndex(a => a.brick);

export const GLSL_LAYOUT = /* glsl */`
#define N_AV ${AVENUES.length}
#define N_ST ${STREETS.length}
${arr('AVX', AVENUES.map(a => a.x))}
${arr('AVHW', AVENUES.map(a => a.hw))}
${arr('AVZ0', AVENUES.map(a => a.z0))}
${arr('AVZ1', AVENUES.map(a => a.z1))}
${arr('STZ', STREETS.map(s => s.z))}
${arr('STHW', STREETS.map(s => s.hw))}
${arr('STX0', STREETS.map(s => s.x0))}
${arr('STX1', STREETS.map(s => s.x1))}
const float Z_NORTH = ${f(Z_NORTH)};
const float Z_DENNY = ${f(Z_DENNY)};
const float LAMP_PITCH = ${f(LAMP_PITCH)};
const float LAMP_H = ${f(LAMP_H)};
const float HILL_Z = ${f(HILL_Z)};
float hillF(float x){
  if (x >= -96.0) return 0.0;
  if (x <= -448.0) return ${f(MARKET_Y)};
  float k = clamp(floor((x + 440.0) / 88.0), 0.0, 3.0);
  float t = clamp((x - (-440.0 + 88.0 * k) - 8.0) / 72.0, 0.0, 1.0);
  return ${f(MARKET_Y)} + ${f(HILL_DROP)} * (k + t);
}
float terrainH(vec2 p){ return p.y > HILL_Z ? hillF(p.x) : 0.0; }
`;

// ---------------------------------------------------------------- street lamps
// Lamps sit every LAMP_PITCH metres along each kerb, skipping the junction lines (multiples of 88).
const offGrid = (k) => ((k % 4) + 4) % 4 !== 0;
export function lampSites() {
  const out = [];
  for (const a of AVENUES) {
    for (let k = Math.ceil((a.z0 + 2) / LAMP_PITCH); k * LAMP_PITCH < a.z1 - 2; k++) {
      if (!offGrid(k)) continue;
      const z = k * LAMP_PITCH;
      for (const s of [-1, 1]) out.push({ x: a.x + s * (a.hw + 0.7), z, dirX: -s, dirZ: 0 });
    }
  }
  for (const st of STREETS) {
    for (let k = Math.ceil((st.x0 + 2) / LAMP_PITCH); k * LAMP_PITCH < st.x1 - 2; k++) {
      if (!offGrid(k)) continue;
      const x = k * LAMP_PITCH;
      for (const s of [-1, 1]) out.push({ x, z: st.z + s * (st.hw + 0.7), dirX: 0, dirZ: -s });
    }
  }
  for (const l of out) l.y = heightAt(l.x, l.z);
  return out;
}

// ---------------------------------------------------------------- city cells (blocks)
// The grid lines cut the map into cells. An edge is a kerb where a road actually runs along it;
// otherwise neighbouring cells simply touch.
export function cityCells() {
  const xs = [-760, ...AVENUES.map(a => a.x).sort((p, q) => p - q), 420];
  const zs = [...STREETS.map(s => s.z).sort((p, q) => p - q), 1010];
  const avAt = (x) => AVENUES.find(a => a.x === x), stAt = (z) => STREETS.find(s => s.z === z);
  const cells = [];
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2, zm = (zs[j] + zs[j + 1]) / 2;
    const aw = avAt(xs[i]), ae = avAt(xs[i + 1]), sn = stAt(zs[j]), ss = stAt(zs[j + 1]);
    const roads = {
      w: !!aw && avenueAt(aw, zm), e: !!ae && avenueAt(ae, zm),
      n: !!sn && streetAt(sn, xm), s: !!ss && streetAt(ss, xm),
    };
    const c = {
      x0: xs[i] + (roads.w ? aw.hw : 0), x1: xs[i + 1] - (roads.e ? ae.hw : 0),
      z0: zs[j] + (roads.n ? sn.hw : 0), z1: zs[j + 1] - (roads.s ? ss.hw : 0),
      roads, xm, zm, hill: false, cliff: false,
      street: (ss || sn || {}).name, avenue: avenueName(ae || aw || { name: '' }, zm),
    };
    const any = roads.w || roads.e || roads.n || roads.s;
    if (xs[i + 1] <= -528) c.kind = zm > 0 && zm < 264 ? 'campus' : zm > 345 ? 'bay' : 'backdrop';
    else if (xs[i] === -528 && zm > 345) c.kind = 'market';
    else if (xs[i] >= 88) c.kind = 'outerE';
    else if (zm > 792) c.kind = 'outerS';
    else if (!any) c.kind = 'backdrop';
    else if (xm > -88 && xm < 88 && zm < 264) { c.kind = 'slu'; c.col = xm < 0 ? 0 : 1; c.row = Math.floor((264 - zm) / 88); }
    else if (zm > 264) { c.kind = 'downtown'; c.hill = xm < -96 && zm > 345; c.cliff = xm < -96 && zm < 345; }
    else c.kind = 'sluW';
    if (c.cliff) c.z1 = HILL_Z;
    if (c.kind === 'market') { c.x0 = MARKET.x0; c.hill = true; }
    cells.push(c);
  }
  return cells;
}

// ---------------------------------------------------------------- routing along the street network
const NODES = [];
for (const a of AVENUES) for (const st of STREETS) if (isNode(a, st)) NODES.push({ x: a.x, z: st.z, a, st, edges: [] });
for (const a of AVENUES) { const on = NODES.filter(n => n.a === a).sort((p, q) => p.z - q.z); for (let i = 1; i < on.length; i++) { const d = on[i].z - on[i - 1].z; on[i].edges.push([on[i - 1], d]); on[i - 1].edges.push([on[i], d]); } }
for (const st of STREETS) { const on = NODES.filter(n => n.st === st).sort((p, q) => p.x - q.x); for (let i = 1; i < on.length; i++) { const d = on[i].x - on[i - 1].x; on[i].edges.push([on[i - 1], d]); on[i - 1].edges.push([on[i], d]); } }

// nearest point on any road, and the junctions either side of it
function snap(x, z) {
  let best = null, bd = 1e9;
  for (const a of AVENUES) { const zz = Math.max(a.z0 + 2, Math.min(a.z1 - 2, z)); const d = Math.hypot(x - a.x, z - zz); if (d < bd) { bd = d; best = { x: a.x, z: zz, a }; } }
  for (const st of STREETS) { const xx = Math.max(Math.max(st.x0, -536) + 2, Math.min(Math.min(st.x1, 100) - 2, x)); const d = Math.hypot(x - xx, z - st.z); if (d < bd) { bd = d; best = { x: xx, z: st.z, st }; } }
  best.near = NODES.filter(n => (best.a ? n.a === best.a : n.st === best.st)).map(n => [n, Math.abs(best.a ? n.z - best.z : n.x - best.x)]).sort((p, q) => p[1] - q[1]).slice(0, 2);
  return best;
}
// shortest drive from (ax, az) to (bx, bz): a list of [x, z] corner points
export function routeBetween(ax, az, bx, bz) {
  if (OVERRIDE) return OVERRIDE.route(ax, az, bx, bz);
  const A = snap(ax, az), B = snap(bx, bz);
  const out = [[ax, az], [A.x, A.z]];
  const sameRoad = (A.a && A.a === B.a) || (A.st && A.st === B.st);
  if (!sameRoad || Math.hypot(A.x - B.x, A.z - B.z) > 400) {
    const dist = new Map(), prev = new Map(), open = new Set();
    for (const [n, d] of A.near) { dist.set(n, d); open.add(n); }
    while (open.size) {
      let u = null; for (const n of open) if (!u || dist.get(n) < dist.get(u)) u = n;
      open.delete(u);
      for (const [v, w] of u.edges) { const nd = dist.get(u) + w; if (nd < (dist.get(v) ?? 1e9)) { dist.set(v, nd); prev.set(v, u); open.add(v); } }
    }
    let end = null, bestD = 1e9;
    for (const [n, d] of B.near) { const t = (dist.get(n) ?? 1e9) + d; if (t < bestD) { bestD = t; end = n; } }
    const chain = []; for (let n = end; n; n = prev.get(n)) chain.unshift(n);
    for (const n of chain) out.push([n.x, n.z]);
  }
  out.push([B.x, B.z], [bx, bz]);
  return out;
}
export const DISTRICT_LABEL = { slu: 'South Lake Union', downtown: 'Downtown', center: 'Seattle Center', belltown: 'Belltown', pike: 'Pike Place Market', none: '' };
