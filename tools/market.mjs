// Pike Place: walking-pace zone, landmark postcards, and each shop's cargo (catch the fish, flowers, cheese, yogurt).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 400)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (f, ...a) => page.evaluate(f, ...a);
await page.keyboard.press('Enter'); await sleep(400);
await ev(() => { window.__app.game.state.time = 999; });
const shops = await ev(() => window.__app.world.sources.filter(s => s.name !== 'Whole Foods Market').map(s => [s.name, s.x, s.z, s.cargo]));
const stops = await ev(() => window.__app.world.stops.map(s => [s.name, s.x, s.z]));

// 1. walking pace inside the market
await ev((s) => { const a = window.__app, p = a.world.nearestRoad(s[1], s[2]); a.game.state.lastStop = { x: s[1], z: s[2] }; a.game.van.reset(p.x, p.z, p.h); }, shops[1]);
await page.keyboard.down('KeyW'); await sleep(3500);
console.log('speed in the market (mph):', await ev(() => Math.round(window.__app.game.van.speed * 2.237)));
await page.keyboard.up('KeyW');

// 2. stopping beside a landmark opens its postcard
for (const pick of [1, 4, 5]) {
  await ev((s) => { const g = window.__app.game; g.state.lastStop = null; g.state.post = null; g.van.reset(s[1], s[2], 0); }, stops[pick]);
  await sleep(4000);
  console.log('postcard:', await ev(() => window.__app.game.state.post && window.__app.game.state.post.stop.name));
  await page.keyboard.press('Space'); await sleep(300);
}

// 3. each shop's cargo: park on the pick-up spot, then ask for its job
for (const s of shops) {
  await ev((q) => { const g = window.__app.game; g.targets.forEach(t => { t.done = true; t.fade = 0; }); g.state.cargo = null; g.van.heavy = false; g.state.lastStop = { x: q[1], z: q[2] }; g.van.reset(q[1], q[2], 0); }, s);
  await sleep(200);
  await ev(() => window.__app.game.spawnJob('pickup'));
  if (s[3] === 'FRESH FISH') {
    await page.waitForFunction('!!window.__app.game.state.toss', { timeout: 6000 }).catch(() => console.log('no toss started'));
    await page.waitForFunction('window.__app.game.state.toss && window.__app.game.state.toss.t > 1.1', { timeout: 4000 }).catch(() => {});
    await page.screenshot({ path: 'shots/fish-toss.png' });
    await page.keyboard.press('Space'); await sleep(300);
  } else await sleep(900);
  console.log(s[3], '->', JSON.stringify(await ev(() => { const g = window.__app.game, c = g.state.cargo, t = g.targets.find(t => t.kind === 'grocery'); return { loaded: c && c.label, rule: c && c.rule, heavy: !!g.van.heavy, expire: t && t.expire && Math.round(t.expire), bonus: c && c.bonus }; })));
}
await browser.close();
