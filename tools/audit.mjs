// Static audit of the built city, run inside the page: is anything standing in a street, and can every
// job, landmark, gate and pick-up actually be reached? Prints problems; exits 1 if there are any.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const report = await page.evaluate(() => {
  const w = window.__app.world, D = w.debug, B = D.bounds, VAN = 1.2, out = {};
  const inB = (x, z) => x > B.x0 + 6 && x < B.x1 - 6 && z > B.z0 + 6 && z < B.z1 - 6;
  // spatial index of fixed obstacles
  const OC = 20, og = new Map();
  for (const o of w.obstacles) { if (o.moving) continue; const k = `${Math.floor(o.x / OC)},${Math.floor(o.z / OC)}`; if (!og.has(k)) og.set(k, []); og.get(k).push(o); }
  const hitObstacle = (x, z, rad) => { const cx = Math.floor(x / OC), cz = Math.floor(z / OC); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of og.get(`${cx + a},${cz + b}`) || []) if (Math.hypot(o.x - x, o.z - z) < rad + o.r) return o; return null; };
  const SC = w.segCell;
  const hitWall = (x, z, rad, lowToo = true) => { const cx = Math.floor(x / SC), cz = Math.floor(z / SC); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of w.segHash.get(`${cx + a},${cz + b}`) || []) { if (s.low && !lowToo) continue; const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1))); if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < rad) return s; } return null; };
  const blocked = (x, z) => { const o = hitObstacle(x, z, VAN); if (o) return 'obstacle r=' + o.r; const s = hitWall(x, z, VAN); return s ? (s.low ? 'parked car' : 'wall') : null; };

  // ---- 1. every street passable: at each station some lane position must be free
  const bad = [];
  let stations = 0;
  for (const rd of D.roads) {
    for (let i = 1; i < rd.pts.length; i++) {
      const a = rd.pts[i - 1], b = rd.pts[i], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (!inB(mx, mz) || w.inWater(mx, mz)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      stations++;
      const why = [];
      let free = false;
      for (const f of [0, 0.4, -0.4, 0.2, -0.2]) { const q = blocked(mx + nx * rd.hw * f, mz + nz * rd.hw * f); if (!q) { free = true; break; } why.push(q); }
      if (!free) bad.push({ road: rd.name || rd.kind, at: [Math.round(mx), Math.round(mz)], why: [...new Set(why)].join('+') });
    }
  }
  out.streets = { stations, blocked: bad.length, byCause: bad.reduce((m, q) => (m[q.why] = (m[q.why] || 0) + 1, m), {}), examples: bad.slice(0, 14) };

  // ---- 2. fixed obstacles standing in a carriageway (even where a lane is still free)
  const inRoad = [];
  for (const o of w.obstacles) { if (o.moving) continue; const nr = D.nearRoad(o.x, o.z, 1); if (nr && nr.rd.kind !== 'pedestrian' && nr.d + o.r * 0.5 < nr.rd.hw - 0.6 && inB(o.x, o.z)) inRoad.push({ r: o.r, at: [Math.round(o.x), Math.round(o.z)], road: nr.rd.name, off: +(nr.d).toFixed(1), hw: nr.rd.hw }); }
  out.obstaclesInRoad = { count: inRoad.length, byRadius: inRoad.reduce((m, q) => (m[q.r] = (m[q.r] || 0) + 1, m), {}), examples: inRoad.slice(0, 12) };

  // ---- 3. job doorsteps: on open ground, and within throwing reach of a street
  const doors = [];
  for (const l of w.buildings.lots) {
    if (l.noJob) continue;
    const d = l.door, nr = D.nearRoad(d.x, d.z, 2), probs = [];
    if (D.inBuilding(d.x, d.z)) probs.push('inside a building');
    if (w.inWater(d.x, d.z)) probs.push('in water');
    if (!inB(d.x, d.z)) probs.push('outside the map');
    if (!nr) probs.push('no street nearby'); else if (nr.d > 15.5) probs.push(`street ${nr.d.toFixed(0)} m away`);
    if (probs.length) doors.push({ name: l.name, at: [Math.round(d.x), Math.round(d.z)], probs: probs.join(', ') });
  }
  out.doors = { total: w.buildings.lots.filter(l => !l.noJob).length, bad: doors.length, examples: doors.slice(0, 14) };

  // ---- 4. drive-by landmarks, coffee cups, race gates, the dock, the start
  const pts = [];
  for (const p of w.pois) { const nr = D.nearRoad(p.x, p.z, 4); if (!nr || nr.d > p.r - 4 || !inB(nr.x, nr.z)) pts.push({ what: 'landmark ' + p.name, note: nr ? `street ${nr.d.toFixed(0)} m away, radius ${Math.round(p.r)}, street point in map: ${inB(nr.x, nr.z)}` : 'no street' }); }
  w.coffeeSpots.forEach(([x, z], i) => { const q = blocked(x, z); if (q || !inB(x, z) || w.inWater(x, z)) pts.push({ what: `coffee cup ${i}`, at: [Math.round(x), Math.round(z)], note: q || 'outside map or in water' }); });
  if (w.monorail) w.monorail.gates.forEach((g, i) => { const q = blocked(g.x, g.z); if (q || !inB(g.x, g.z)) pts.push({ what: `race gate ${i}`, note: q || 'outside the map' }); });
  if (w.dock) { const s = w.dock.stand, nr = D.nearRoad(s.x, s.z, 3); let clear = !!nr; if (nr) for (let t = 0; t <= 1; t += 0.05) { const x = nr.x + (s.x - nr.x) * t, z = nr.z + (s.z - nr.z) * t; if (hitObstacle(x, z, VAN) || hitWall(x, z, VAN, false)) clear = false; } if (!clear) pts.push({ what: 'dock stand', note: 'no clear straight line from the street' }); if (Math.hypot(s.x - w.dock.x, s.z - w.dock.z) > 17) pts.push({ what: 'dock', note: 'too far to throw' }); }
  { const q = blocked(w.start[0], w.start[1]); if (q) pts.push({ what: 'start position', note: q }); }
  out.points = { bad: pts.length, list: pts };
  return out;
});
console.log(JSON.stringify(report, null, 1));
const problems = report.streets.blocked + report.doors.bad + report.points.bad;
console.log(problems ? `\n${problems} problem(s)` : '\nno problems');
await browser.close();
process.exit(problems ? 1 : 0);
