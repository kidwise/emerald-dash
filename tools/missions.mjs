// Exercises each special job type: grocery pick-up and hand-over, streetcar roof drop, dock drop, rush order.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 300)); });
await page.goto('http://localhost:5173/?map=grid', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (f, ...a) => page.evaluate(f, ...a);
await page.keyboard.press('Enter'); await sleep(400);
await ev(() => { const a = window.__app, g = a.game; g.state.time = 999; const p = g.spawnJob('pickup'); p.dest = a.world.buildings.lots.find(l => l.name === 'Kumo Building'); g.spawnJob('tram'); g.spawnJob('boat'); });
const kinds = () => ev(() => window.__app.game.targets.map(t => `${t.kind}${t.done ? (t.failed ? ':failed' : ':done') : ''}`).join(' '));
console.log('jobs:', await kinds());
// throw at a given kind once the landing marker lines up; the van is placed and driven by the caller
const throwAt = async (kind, ms = 9000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await ev((k) => { const g = window.__app.game; return g.aim.target && g.aim.target.kind === k ? g.aim.ok : 99; }, kind);
    if (ok < 1.25) { await page.keyboard.press('Space'); return ok; }
    await sleep(16);
  }
  return null;
};
const state = () => ev(() => { const s = window.__app.game.state; return { score: Math.round(s.score), delivered: s.delivered, resolved: s.resolved, cargo: s.cargo && Math.round(s.cargo.cond) }; });

// 1. grocery: drive through the pick-up ring, then hand over slowly
await ev(() => { const g = window.__app.game; const t = g.targets.find(t => t.kind === 'pickup'); g.van.reset(t.x - 14, t.z, 0); });
await page.keyboard.down('KeyW'); await sleep(2200); await page.keyboard.up('KeyW');
console.log('after pick-up:', await kinds(), JSON.stringify(await state()));
await ev(() => { const g = window.__app.game; const t = g.targets.find(t => t.kind === 'grocery'); const avs = [-88, 0, 88]; const av = avs.reduce((b, a) => Math.abs(a - t.x) < Math.abs(b - t.x) ? a : b); g.van.reset(av + Math.sign(t.x - av) * 2.5, t.z + 8, -Math.PI / 2); g.van.vel.set(0, -8.5); g.targets.forEach(o => { if (o.kind === 'parcel') o.done = true; }); });
console.log('grocery throw aim error:', await throwAt('grocery')); await sleep(1500);
console.log('after grocery:', JSON.stringify(await state()));

// 2. streetcar: pull alongside and drop one on the roof
await ev(() => { const a = window.__app, tr = a.world.streetcar.state, g = a.game; g.van.reset(tr.x > 0 ? 1.6 : -1.6, tr.z + (tr.dir < 0 ? 30 : -30), tr.dir < 0 ? -Math.PI / 2 : Math.PI / 2); });
await page.keyboard.down('KeyW');
console.log('streetcar throw aim error:', await throwAt('tram', 14000)); await sleep(400);
await page.screenshot({ path: 'shots/tram-drop.png' });
await sleep(1200); await page.keyboard.up('KeyW');
console.log('after streetcar:', JSON.stringify(await state()));

// 3. dock: roll along the waterfront and throw over the railing
await ev(() => { const g = window.__app.game; const t = g.targets.find(t => t.kind === 'boat'); g.van.reset(t.x - 26, -372 + 5, 0); g.van.vel.set(7, 0); });
await page.keyboard.down('KeyW');
console.log('dock throw aim error:', await throwAt('boat')); await sleep(500);
await page.screenshot({ path: 'shots/dock-drop.png' });
await sleep(1200); await page.keyboard.up('KeyW');
console.log('after dock:', JSON.stringify(await state()));

// 4. rush order appears on its own and expires if ignored
await ev(() => { const g = window.__app.game; g.van.reset(1.9, 100, -Math.PI / 2); g.spawnJob('rush'); }); await sleep(500);
console.log('rush spawned:', await kinds());
await ev(() => { const t = window.__app.game.targets.find(t => t.kind === 'rush'); t.expire = 0.3; }); await sleep(900);
console.log('rush expired:', await kinds(), JSON.stringify(await state()));
await browser.close();
