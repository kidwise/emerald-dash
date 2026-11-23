// Drives straight at each drive-up landmark from four sides, stops, and checks its view opens.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const p = await browser.newPage();
p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
await p.goto('http://localhost:5173/', { waitUntil: 'load' });
await p.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await p.keyboard.press('KeyE'); await sleep(500);
const names = await p.evaluate(() => window.__app.world.stops.filter(s => s.near).map(s => s.name));
let fails = 0;
for (const n of names) {
  const res = []; let oks = 0;
  for (let k = 0; k < 4; k++) {
    // start on the nearest street to a point 120 m out on this side, then drive straight at the landmark
    await p.evaluate((n, k) => { const a = window.__app, w = a.world, s = w.stops.find(q => q.name === n), g = a.game, ang = k * Math.PI / 2 + 0.4; const r = w.nearestRoad(s.look[0] + Math.cos(ang) * 120, s.look[2] + Math.sin(ang) * 120); g.state.post = null; g.state.lastStop = null; g.van.reset(r.x, r.z, Math.atan2(s.look[2] - r.z, s.look[0] - r.x)); }, n, k);
    let d = 1e9, stuck = 0, last = 1e9;
    await p.keyboard.down('KeyW');
    for (let i = 0; i < 500; i++) {
      d = await p.evaluate((n) => { const a = window.__app, s = a.world.stops.find(q => q.name === n), v = a.game.van; a.game.input.steer = 0; const want = Math.atan2(s.look[2] - v.pos.z, s.look[0] - v.pos.x); let e = want - v.heading; e = Math.atan2(Math.sin(e), Math.cos(e)); a.autoDrive = { throttle: 1, steer: Math.max(-1, Math.min(1, e * 2)), drift: false }; return Math.hypot(s.look[0] - v.pos.x, s.look[2] - v.pos.z) - s.near; }, n);
      if (d < -3) break;
      if (Math.abs(last - d) < 0.02) { if (++stuck > 40) break; } else stuck = 0; last = d;
      await sleep(30);
    }
    await p.keyboard.up('KeyW');
    // brake to a halt (without rolling into reverse), then wait for the view to open
    for (let i = 0; i < 80; i++) { const vf = await p.evaluate(() => { const a = window.__app, v = a.game.van.vf; a.autoDrive = { throttle: v > 0.8 ? -1 : 0, steer: 0, drift: false }; return v; }); if (vf < 0.5) break; await sleep(40); }
    await p.evaluate(() => { window.__app.autoDrive = null; }); await sleep(1900);
    const post = (await p.evaluate(() => window.__app.game.state.post && window.__app.game.state.post.stop.name)) === n;
    const arrived = d < -3;
    res.push(post ? 'ok' : arrived ? 'ARRIVED BUT NOTHING OPENED' : 'buildings in the way'); if (arrived && !post) fails++; if (post) oks++;
    await p.keyboard.press('Space'); await sleep(300);
  }
  if (!oks) fails++;
  console.log(n.padEnd(26), res.join(' | '));
}
console.log(fails ? `${fails} FAILED` : 'every landmark opens when you drive up to it');
await browser.close();
