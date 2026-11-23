// Drives down the Pike St hill at speed (air time expected) and reports heights, bounds and frame rate per district.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 400)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 40000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const st = () => page.evaluate(() => { const g = window.__app.game, v = g.van; return { x: +v.pos.x.toFixed(0), z: +v.pos.z.toFixed(0), y: +v.y.toFixed(1), mph: Math.round(v.speed * 2.237), air: v.air, score: g.state.score, jobs: g.targets.length, fps: window.__info().fps, calls: window.__info().calls }; });
const spots = { downtown: [-90.9, 300, Math.PI / 2], center: [-150, 262, Math.PI], slu: [1.9, 238, -Math.PI / 2] };
await page.evaluate(() => window.__app.game.startShift(false)); await sleep(600);
for (const d of ['downtown', 'center', 'slu']) {
  await page.evaluate((p) => window.__app.game.van.reset(p[0], p[1], p[2]), spots[d]); await sleep(1500);
  console.log(d, 'start', JSON.stringify(await st()), await page.evaluate(() => window.__app.game.targets.map(t => t.kind[0] + ':' + Math.round(t.x) + ',' + Math.round(t.z)).join(' ')));
  await page.screenshot({ path: `shots/start-${d}.png` });
}
await page.evaluate(() => { const v = window.__app.game.van; v.reset(-70, 701.6, Math.PI); v.vel.set(-24, 0); window.__air = 0; window.__maxAir = 0; const tick = () => { if (v.air) window.__air++; requestAnimationFrame(tick); }; tick(); });
await page.keyboard.down('KeyW');
for (let i = 0; i < 9; i++) { await sleep(900); console.log('hill', JSON.stringify(await st())); if (i === 1) await page.screenshot({ path: 'shots/hill1.png' }); if (i === 5) await page.screenshot({ path: 'shots/hill2.png' }); }
await page.keyboard.up('KeyW');
console.log('frames airborne:', await page.evaluate(() => window.__air));
await browser.close();
