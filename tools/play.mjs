// Drives the real game through the keyboard and reports state, to verify gameplay end to end.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 600)); });
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 600)));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const st = () => page.evaluate(() => { const g = window.__app.game, v = g.van; return { mode: g.state.mode, x: +v.pos.x.toFixed(1), z: +v.pos.z.toFixed(1), mph: +(v.speed * 2.237).toFixed(1), heading: +v.heading.toFixed(2), score: g.state.score, delivered: g.state.delivered, time: +g.state.time.toFixed(1), fps: window.__info().fps }; });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
console.log('title', await st());
await page.keyboard.press('Enter'); await sleep(400);
console.log('started', await st());
await page.keyboard.down('KeyW'); await sleep(3500);
console.log('after 3.5s throttle', await st());
await page.keyboard.down('KeyD'); await sleep(700); await page.keyboard.up('KeyD');
console.log('after right turn', await st());
await page.screenshot({ path: 'shots/play1.png' });
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyA'); await sleep(900); await page.keyboard.up('KeyA'); await page.keyboard.up('ShiftLeft');
console.log('after drift left', await st());
await page.screenshot({ path: 'shots/play2.png' });
await page.keyboard.up('KeyW'); await sleep(300);
// put the van beside a live target, roll past it and throw when the marker lines up
const info = await page.evaluate(() => { const t = window.__app.game.targets.find(t => !t.done); return { tx: t.x, tz: t.z, name: t.name }; });
// place on the road next to the target's kerb
await page.evaluate(() => { const g = window.__app.game; const t = g.targets.find(t => !t.done); const avs = [-88, 0, 88]; const av = avs.reduce((b, a) => Math.abs(a - t.x) < Math.abs(b - t.x) ? a : b); const lane = av + Math.sign(t.x - av) * 2.5; g.van.reset(lane, t.z + 45, -Math.PI / 2); });
console.log('target', info, await st());
await page.keyboard.down('KeyW');
let thrown = false;
for (let i = 0; i < 400 && !thrown; i++) {
  const ok = await page.evaluate(() => window.__app.game.aim.ok);
  if (ok < 1.2) { await page.keyboard.press('Space'); thrown = true; console.log('threw at aim error', ok.toFixed(2)); }
  await sleep(16);
}
await page.screenshot({ path: 'shots/play3.png' });
await sleep(1300);
await page.keyboard.up('KeyW');
console.log('after throw', await st());
await page.screenshot({ path: 'shots/play4.png' });
await browser.close();
