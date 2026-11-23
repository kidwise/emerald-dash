// Drives to landmark stops the way a player would: start on a street a few blocks away, follow the
// game's own route line with real steering and physics (traffic and all), stop, and check the view opens.
//   node tools/routedrive.mjs [name filter]
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const p = await browser.newPage();
p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
await p.goto('http://localhost:5173/', { waitUntil: 'load' });
await p.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await p.keyboard.press('KeyE'); await sleep(500);
const filter = (process.argv[2] || '').toLowerCase();
const names = (await p.evaluate(() => window.__app.world.stops.map(s => s.name))).filter(n => n.toLowerCase().includes(filter));
let fails = 0;
for (const n of names) {
  const res = [];
  for (const ang of [0.6, 2.7, 4.6]) {
    // install an autopilot that follows the route polyline
    await p.evaluate((n, ang) => {
      const a = window.__app, w = a.world, g = a.game, s = w.stops.find(q => q.name === n);
      const st = w.nearestRoad(s.x + Math.cos(ang) * 260, s.z + Math.sin(ang) * 260);
      g.state.post = null; g.state.lastStop = null; g.van.reset(st.x, st.z, st.h);
      const route = w.debug.route(st.x, st.z, s.x, s.z);
      let leg = 1, t0 = performance.now(), stuckT = 0, lastX = st.x, lastZ = st.z;
      window.__pilot = { done: false, why: '', start: [Math.round(st.x), Math.round(st.z)] };
      const tick = () => {
        const v = g.van, P = window.__pilot; if (P.done) return;
        const dGoal = Math.hypot(s.x - v.pos.x, s.z - v.pos.z);
        while (leg < route.length - 1 && Math.hypot(route[leg][0] - v.pos.x, route[leg][1] - v.pos.z) < 9) leg++;
        const tx = route[leg][0], tz = route[leg][1];
        let e = Math.atan2(tz - v.pos.z, tx - v.pos.x) - v.heading; e = Math.atan2(Math.sin(e), Math.cos(e));
        const want = dGoal < 30 ? 4 : Math.abs(e) > 0.5 ? 6 : 14;
        if (dGoal < 4.5) { a.autoDrive = { throttle: v.vf > 0.7 ? -1 : 0, steer: 0, drift: false }; if (v.speed < 0.5) { P.done = true; P.why = 'arrived'; } }
        else a.autoDrive = { throttle: Math.abs(e) > 2.2 ? -0.6 : v.vf < want ? 1 : v.vf > want + 2 ? -1 : 0, steer: Math.max(-1, Math.min(1, e * 2.2)) * (Math.abs(e) > 2.2 ? -1 : 1), drift: false };
        const now = performance.now();
        if (now - t0 > 1000) { stuckT = Math.hypot(v.pos.x - lastX, v.pos.z - lastZ) < 0.6 ? stuckT + 1 : 0; lastX = v.pos.x; lastZ = v.pos.z; t0 = now; P.elapsed = (P.elapsed || 0) + 1; }
        if (stuckT > 9) { P.done = true; P.why = `stuck ${Math.round(dGoal)} m short at ${Math.round(v.pos.x)},${Math.round(v.pos.z)}`; }
        if ((P.elapsed || 0) > 170) { P.done = true; P.why = `timed out ${Math.round(dGoal)} m short at ${Math.round(v.pos.x)},${Math.round(v.pos.z)}`; }
        requestAnimationFrame(tick);
      };
      tick();
    }, n, ang);
    await p.waitForFunction('window.__pilot.done', { timeout: 220000 });
    const why = await p.evaluate(() => { window.__app.autoDrive = null; return window.__pilot.why; });
    await sleep(1900);
    const opened = await p.evaluate(() => window.__app.game.state.post && window.__app.game.state.post.stop.name);
    const ok = why === 'arrived' && !!opened;
    if (!ok) { fails++; await p.screenshot({ path: `shots/fail-${n.replace(/[^a-z]/gi, '').slice(0, 12)}-${ang}.png` }); }
    res.push(ok ? (opened === n ? 'ok' : 'ok (opened ' + opened.split(' ')[0] + ' across the street)') : why === 'arrived' ? 'ARRIVED, NOTHING OPENED' : why.toUpperCase());
    await p.keyboard.press('Space'); await sleep(300);
  }
  console.log(n.padEnd(27), res.join(' | '));
}
console.log(fails ? `${fails} drive(s) FAILED` : 'every drive arrived and opened its landmark');
await browser.close();
