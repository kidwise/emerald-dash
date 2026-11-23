// Real-map preview: start a shift, drive, check collisions, jobs, routing and the frame rate.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 400)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 40000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const st = () => page.evaluate(() => { const g = window.__app.game, v = g.van; return { x: +v.pos.x.toFixed(0), z: +v.pos.z.toFixed(0), mph: Math.round(v.speed * 2.237), street: document.querySelector('.hud-street span').textContent, jobs: g.targets.filter(t => !t.done).map(t => t.name).join(' | '), cars: window.__app.world.traffic.cars.filter(c => Math.hypot(c.x - v.pos.x, c.z - v.pos.z) < 300).length, fps: window.__info().fps, calls: window.__info().calls }; });
await page.screenshot({ path: 'shots/real-title.png' });
await page.keyboard.press('Enter'); await sleep(600);
console.log('start', JSON.stringify(await st()));
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) { await sleep(2500); console.log('drive', JSON.stringify(await st())); if (i === 1) await page.screenshot({ path: 'shots/real-drive.png' }); }
// steer hard into the buildings: the walls must hold
await page.keyboard.down('KeyD'); await sleep(2500); await page.keyboard.up('KeyD');
const inside = await page.evaluate(() => { const a = window.__app, v = a.game.van; const hash = a.world.segHash; let n = 0; for (const l of hash.values()) n += l.length; return { x: +v.pos.x.toFixed(0), z: +v.pos.z.toFixed(0), wallSegments: n }; });
console.log('after steering into buildings', JSON.stringify(inside), JSON.stringify(await st()));
await page.screenshot({ path: 'shots/real-wall.png' });
// deliver: park beside a job and throw
const ok = await page.evaluate(() => { const g = window.__app.game, t = g.targets.find(t => !t.done && t.kind === 'parcel'); const p = window.__app.world.nearestRoad(t.x, t.z); g.van.reset(p.x, p.z, p.h); return { job: t.name, dist: Math.hypot(t.x - p.x, t.z - p.z).toFixed(1) }; });
await page.keyboard.up('KeyW'); await sleep(400);
console.log('parked by', JSON.stringify(ok), 'aim error', await page.evaluate(() => window.__app.game.aim.ok.toFixed(2)));
await page.keyboard.press('Space'); await sleep(1500);
console.log('after throw', await page.evaluate(() => JSON.stringify({ delivered: window.__app.game.state.delivered, score: window.__app.game.state.score })));
// streetcar and dock jobs on the real map
await page.evaluate(() => { const g = window.__app.game; g.state.time = 999; g.targets.forEach(t => { t.done = true; t.fade = 0; }); });
const tramJob = await page.evaluate(() => { const a = window.__app, g = a.game, tr = a.world.streetcar.state; const fx = Math.cos(tr.h), fz = Math.sin(tr.h); g.van.reset(tr.x - fx * 26 + fz * 3.6, tr.z - fz * 26 - fx * 3.6, tr.h); g.spawnJob('tram'); return { tramSpeed: +tr.v.toFixed(1), heading: +tr.h.toFixed(2) }; });
await page.keyboard.down('KeyW');
let threw = null; for (let i = 0; i < 700 && threw === null; i++) { const ok = await page.evaluate(() => { const g = window.__app.game; return g.aim.target && g.aim.target.kind === 'tram' ? g.aim.ok : 99; }); if (ok < 1.25) { await page.keyboard.press('Space'); threw = ok; } await sleep(16); }
await sleep(1600); await page.keyboard.up('KeyW');
console.log('streetcar job', JSON.stringify(tramJob), 'threw at', threw, await page.evaluate(() => JSON.stringify({ delivered: window.__app.game.state.delivered })));
const dockJob = await page.evaluate(() => { const a = window.__app, g = a.game, d = a.world.dock; if (!d) return null; g.targets.forEach(t => { t.done = true; t.fade = 0; }); const h = Math.atan2(d.z - d.stand.z, d.x - d.stand.x) + Math.PI / 2; g.van.reset(d.stand.x, d.stand.z, h); g.spawnJob('boat'); return { dock: [Math.round(d.x), Math.round(d.z)], stand: [Math.round(d.stand.x), Math.round(d.stand.z)] }; });
await sleep(700);
console.log('dock job', JSON.stringify(dockJob), 'aim error', await page.evaluate(() => window.__app.game.aim.ok.toFixed(2)));
await page.keyboard.press('Space'); await sleep(1600);
await page.screenshot({ path: 'shots/real-dock.png' });
console.log('after dock throw', await page.evaluate(() => JSON.stringify({ delivered: window.__app.game.state.delivered, score: window.__app.game.state.score })));
await browser.close();
