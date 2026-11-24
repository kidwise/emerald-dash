// Drives up to every landmark stop along its street and checks the postcard opens.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const p = await browser.newPage();
p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 300)));
await p.goto('http://localhost:5173/', { waitUntil: 'load' });
await p.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await p.keyboard.press('KeyE'); await sleep(500);
const names = await p.evaluate(() => window.__app.world.stops.map(s => s.name));
let bad = 0;
for (const n of names) {
  let best = null;
  for (const dir of [1, -1]) {
    const road = await p.evaluate((n, dir) => { const a = window.__app, w = a.world, s = w.stops.find(q => q.name === n), r = w.nearestRoad(s.x, s.z), g = a.game; g.state.post = null; g.state.lastStop = null; const h = r.h + (dir < 0 ? Math.PI : 0); g.van.reset(s.x - Math.cos(h) * 40, s.z - Math.sin(h) * 40, h); return Math.hypot(r.x - s.x, r.z - s.z); }, n, dir);
    await p.keyboard.down('KeyW');
    let reached = false;
    for (let i = 0; i < 300 && !reached; i++) { reached = (await p.evaluate((n) => { const a = window.__app, s = a.world.stops.find(q => q.name === n), v = a.game.van; return Math.hypot(v.pos.x - s.x, v.pos.z - s.z); }, n)) < 5.5; if (!reached) await sleep(30); }
    await p.keyboard.up('KeyW');
    // brake to a halt, then wait for the postcard
    for (let i = 0; i < 40; i++) { const sp = await p.evaluate(() => window.__app.game.van.vf); if (sp < 0.8) break; await p.keyboard.down('KeyS'); await sleep(50); await p.keyboard.up('KeyS'); }
    await sleep(1800);
    const post = (await p.evaluate(() => { const s = window.__app.game.state; return (s.post && s.post.stop.name) || (s.lastStop && s.lastStop.name); })) === n;
    if (!best || (post && !best.post)) best = { road, reached, post, dir };
    await p.keyboard.press('Space'); await sleep(300);
    if (post) break;
  }
  if (!best.post) bad++;
  console.log(n.padEnd(28), 'from road', best.road.toFixed(1) + ' m', '| reached', best.reached, '| postcard', best.post);
}
console.log(bad ? `${bad} stop(s) FAILED` : 'all stops reachable');
await browser.close();
