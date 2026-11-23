// World layout. Units are metres. +x = east, -z = north, +y = up.
export const AVENUES = [
  { name: '9th Ave N', x: -88, hw: 8 },
  { name: 'Westlake Ave N', x: 0, hw: 11 },
  { name: 'Terry Ave N', x: 88, hw: 8 },
];
export const STREETS = [
  { name: 'Denny Way', z: 264, hw: 10 },
  { name: 'John St', z: 176, hw: 7 },
  { name: 'Thomas St', z: 88, hw: 7 },
  { name: 'Harrison St', z: 0, hw: 7 },
  { name: 'Republican St', z: -88, hw: 7 },
  { name: 'Mercer St', z: -176, hw: 12 },
  { name: 'Valley St', z: -264, hw: 8 },
];
export const Z_SOUTH = 274;   // south kerb of Denny Way
export const Z_NORTH = -272;  // north kerb of Valley St (park begins)
export const X_WEST = -96;    // west kerb of 9th
export const X_EAST = 96;     // east kerb of Terry
export const CURB = 0.16;
export const LAKE_Z = -372;   // shoreline
export const LAMP_PITCH = 22;
export const LAMP_H = 8.2;

export const FOG_COLOR = [0.045, 0.07, 0.115];
export const FOG_DENSITY = 0.0036;

const f = (v) => Number(v).toFixed(2);
const arr = (name, a) => `const float ${name}[${a.length}] = float[${a.length}](${a.map(f).join(',')});`;

// GLSL constants shared by every shader that needs to know the street grid.
export const GLSL_LAYOUT = /* glsl */`
#define N_AV ${AVENUES.length}
#define N_ST ${STREETS.length}
${arr('AVX', AVENUES.map(a => a.x))}
${arr('AVHW', AVENUES.map(a => a.hw))}
${arr('STZ', STREETS.map(s => s.z))}
${arr('STHW', STREETS.map(s => s.hw))}
const float Z_SOUTH = ${f(Z_SOUTH)};
const float Z_NORTH = ${f(Z_NORTH)};
const float LAMP_PITCH = ${f(LAMP_PITCH)};
const float LAMP_H = ${f(LAMP_H)};
`;

// Lamp lattice: every LAMP_PITCH metres, skipping the intersections (multiples of 88).
export function lampSites() {
  const out = [];
  for (const a of AVENUES) {
    for (let k = -11; k <= 15; k++) {
      if (((k % 4) + 4) % 4 === 0) continue;
      const z = k * LAMP_PITCH;
      for (const s of [-1, 1]) out.push({ x: a.x + s * (a.hw + 0.7), z, hx: a.x + s * (a.hw - 1.4), hz: z, dirX: -s, dirZ: 0 });
    }
  }
  for (const st of STREETS) {
    for (let k = -6; k <= 6; k++) {
      if (((k % 4) + 4) % 4 === 0) continue;
      const x = k * LAMP_PITCH;
      for (const s of [-1, 1]) {
        if (st.z + s * st.hw < Z_NORTH - 1) continue; // no lamps inside the park edge
        out.push({ x, z: st.z + s * (st.hw + 0.7), hx: x, hz: st.z + s * (st.hw - 1.4), dirX: 0, dirZ: -s });
      }
    }
  }
  return out;
}

// City blocks (kerbed slabs). Inner blocks are the ones you can drive around.
export function cityBlocks() {
  const blocks = [];
  const xs = [[-420, X_WEST, 'outerW']];
  for (let i = 0; i < AVENUES.length - 1; i++) xs.push([AVENUES[i].x + AVENUES[i].hw, AVENUES[i + 1].x - AVENUES[i + 1].hw, 'inner']);
  xs.push([X_EAST, 420, 'outerE']);
  const zs = [[Z_SOUTH, 640, 'outerS']];
  for (let j = 0; j < STREETS.length - 1; j++) zs.push([STREETS[j + 1].z + STREETS[j + 1].hw, STREETS[j].z - STREETS[j].hw, 'inner']);
  let row = -1;
  for (const [z0, z1, zk] of zs) {
    let col = -1;
    for (const [x0, x1, xk] of xs) {
      const kind = zk === 'outerS' ? (xk === 'inner' ? 'outerS' : 'corner') : xk;
      blocks.push({ x0, x1, z0, z1, kind, col, row });
      col++;
    }
    row++;
  }
  return blocks;
}
