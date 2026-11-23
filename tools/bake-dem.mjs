// Bakes a ground-height grid for the real map from public elevation tiles.
// Source: Mapzen/AWS Terrain Tiles ("terrarium" encoding), built from USGS 3DEP and other open data.
//   node tools/bake-dem.mjs city
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const name = process.argv[2] || 'city';
const map = JSON.parse(await readFile(`public/assets/map/${name}.json`, 'utf8'));
const { lat: LAT0, lon: LON0 } = map.origin, B = map.bounds;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KZ = 110574;
const toLL = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];
const Z = 14, N = 2 ** Z;
const tileXY = (lat, lon) => [(lon + 180) / 360 * N, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * N];

function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ctype = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ctype = d[9]; if (d[8] !== 8 || d[12] !== 0) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : (() => { throw new Error('colour type ' + ctype); })();
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = y && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

await mkdir('tools/mapdata/dem', { recursive: true });
const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}_${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = `tools/mapdata/dem/${Z}_${key}.png`;
  if (!existsSync(file)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`, { headers: { 'User-Agent': 'map-fetch' } });
    if (!res.ok) throw new Error(`tile ${key}: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log('fetched tile', key);
  }
  const t = decodePNG(await readFile(file)); tiles.set(key, t); return t;
}
async function elev(lat, lon) {
  const [fx, fy] = tileXY(lat, lon);
  const px = fx * 256 - 0.5, py = fy * 256 - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), u = px - x0, v = py - y0;
  const at = async (x, y) => { const t = await tile(Math.floor(x / 256), Math.floor(y / 256)); const i = ((y % 256) * t.w + (x % 256)) * t.bpp; return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768; };
  return (await at(x0, y0)) * (1 - u) * (1 - v) + (await at(x0 + 1, y0)) * u * (1 - v) + (await at(x0, y0 + 1)) * (1 - u) * v + (await at(x0 + 1, y0 + 1)) * u * v;
}

const STEP = 10, PAD = 60;
const x0 = B.x0 - PAD, z0 = B.z0 - PAD, nx = Math.ceil((B.x1 - B.x0 + PAD * 2) / STEP) + 1, nz = Math.ceil((B.z1 - B.z0 + PAD * 2) / STEP) + 1;
let h = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const [lat, lon] = toLL(x0 + i * STEP, z0 + j * STEP); const v = await elev(lat, lon); h[j * nx + i] = v < -2 ? 0 : v; }   // sea floor and missing samples count as sea level
// the source has building-scale noise: two passes of a 5x5 blur leave the hills and remove the lumps
for (let pass = 0; pass < 2; pass++) {
  const o = new Float32Array(h.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0, n = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; s += h[jj * nx + ii]; n++; } o[j * nx + i] = s / n; }
  h = o;
}
let lo = 1e9, hi = -1e9; for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
const data = Array.from(h, v => Math.round(Math.max(0, v) * 10));
await writeFile(`public/assets/map/${name}-height.json`, JSON.stringify({ x0, z0, step: STEP, nx, nz, unit: 0.1, data, credit: 'Elevation: Mapzen/AWS Terrain Tiles (USGS 3DEP and other open sources)' }));
const at = (x, z) => h[Math.round((z - z0) / STEP) * nx + Math.round((x - x0) / STEP)].toFixed(1);
console.log(`${name}: ${nx}x${nz} samples, ${lo.toFixed(1)}..${hi.toFixed(1)} m`);
console.log('Westlake & Denny', at(0, 0), '| Lake Union Park', at(30, -930), '| lake', at(100, -1150), '| Space Needle', at(-830, -218), '| Westlake Center', at(49, 719), '| Pike Place (Pike St end)', at(-172, 1090), '| Pike Place (north end)', at(-390, 897), '| 5th & Pike-ish', at(60, 900), '| bay', at(-600, 1200));
