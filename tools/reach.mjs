// Flood-fills the space the van can actually occupy, starting from the start position, and reports
// every landmark stop, drive-by landmark, job doorstep, gate and cup that the fill cannot get to.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
await page.goto(process.env.BASE || 'http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const rep = await page.evaluate(() => {
  const w = window.__app.world, B = w.debug.bounds, G = 1.5, R = 1.25;
  const nx = Math.ceil((B.x1 - B.x0) / G), nz = Math.ceil((B.z1 - B.z0) / G);
  const OC = 20, og = new Map();
  for (const o of w.obstacles) { if (o.moving) continue; const k = `${Math.floor(o.x / OC)},${Math.floor(o.z / OC)}`; if (!og.has(k)) og.set(k, []); og.get(k).push(o); }
  const SC = w.segCell;
  const free = (x, z) => {
    if (x < B.x0 + 4 || x > B.x1 - 4 || z < B.z0 + 4 || z > B.z1 - 4 || w.inWater(x, z)) return false;
    let cx = Math.floor(x / OC), cz = Math.floor(z / OC);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of og.get(`${cx + a},${cz + b}`) || []) if (Math.hypot(o.x - x, o.z - z) < R - 0.25 + o.r) return false;
    cx = Math.floor(x / SC); cz = Math.floor(z / SC);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of w.segHash.get(`${cx + a},${cz + b}`) || []) { const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1))); if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < R) return false; }
    return true;
  };
  const seen = new Uint8Array(nx * nz);     // 0 unknown, 1 reachable, 2 blocked
  const ci = (x) => Math.floor((x - B.x0) / G), cj = (z) => Math.floor((z - B.z0) / G);
  const stack = [[ci(w.start[0]), cj(w.start[1])]];
  seen[stack[0][1] * nx + stack[0][0]] = 1;
  let count = 0;
  while (stack.length) {
    const [i, j] = stack.pop(); count++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const k = b * nx + a; if (seen[k]) continue;
      if (free(B.x0 + (a + 0.5) * G, B.z0 + (b + 0.5) * G)) { seen[k] = 1; stack.push([a, b]); } else seen[k] = 2;
    }
  }
  // is any reachable cell within `rad` of (x, z)?
  const near = (x, z, rad) => { const n = Math.ceil(rad / G); const i0 = ci(x), j0 = cj(z); for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) { const i = i0 + a, j = j0 + b; if (i < 0 || j < 0 || i >= nx || j >= nz) continue; if (seen[j * nx + i] === 1 && Math.hypot(B.x0 + (i + 0.5) * G - x, B.z0 + (j + 0.5) * G - z) <= rad) return true; } return false; };
  const bad = [];
  for (const s of w.stops) if (!near(s.x, s.z, 5)) bad.push('stop: ' + s.name + ' @' + Math.round(s.x) + ',' + Math.round(s.z));
  for (const s of w.stops) if (s.near && !near(s.look[0], s.look[2], s.near - 4)) bad.push('cannot drive up to: ' + s.name);
  for (const p of w.pois) if (!near(p.x, p.z, p.r - 3)) bad.push('landmark: ' + p.name);
  for (const l of w.buildings.lots) if (!l.noJob && !near(l.door.x, l.door.z, 15)) bad.push('doorstep: ' + l.name);
  for (const s of w.sources) if (!near(s.x, s.z, 3.5)) bad.push('pick-up: ' + s.name);
  w.coffeeSpots.forEach(([x, z], i) => { if (!near(x, z, 2)) bad.push('coffee cup ' + i); });
  if (w.monorail) w.monorail.gates.forEach((g, i) => { if (!near(g.x, g.z, 4)) bad.push('race gate ' + i); });
  if (w.dock && !near(w.dock.stand.x, w.dock.stand.z, 3)) bad.push('dock stand');
  if (!near(w.pike.coffee.x, w.pike.coffee.z, 3.5)) bad.push('coffee shop');
  return { cells: count, squareKm: +(count * G * G / 1e6).toFixed(2), bad };
});
console.log(JSON.stringify(rep, null, 1));
console.log(rep.bad.length ? `\n${rep.bad.length} unreachable` : '\neverything reachable');
await browser.close();
process.exit(rep.bad.length ? 1 : 0);
