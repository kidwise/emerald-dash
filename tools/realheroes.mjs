// Real map: park at each hand-built landmark's postcard spot and photograph it.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 400)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await page.keyboard.press('KeyE'); await sleep(500);
const stops = await page.evaluate(() => window.__app.world.stops.map(s => [s.name, Math.round(s.x), Math.round(s.z)]));
console.log(JSON.stringify(stops));
const want = (process.argv[2] || '0,1,4,5,7').split(',').map(Number);
for (const i of want) {
  if (!stops[i]) continue;
  await page.evaluate((s) => { const g = window.__app.game; g.state.lastStop = null; g.state.post = null; g.van.reset(s[1], s[2], 0); }, stops[i]);
  await sleep(4800);
  console.log(stops[i][0], '->', await page.evaluate(() => { const g = window.__app.game; return JSON.stringify({ post: g.state.post && g.state.post.stop.name, street: document.querySelector('.hud-street span').textContent, slow: !!g.van.limit, fps: window.__info().fps }); }));
  await page.screenshot({ path: `shots/realhero-${i}.png` });
  await page.keyboard.press('Space'); await sleep(250);
}
// drive along the real Pike Place at walking pace
await page.evaluate((s) => { const a = window.__app; const p = a.world.nearestRoad(s[1], s[2]); a.game.state.lastStop = { x: s[1], z: s[2] }; a.game.van.reset(p.x, p.z, p.h); }, stops[1]);
await page.keyboard.down('KeyW'); await sleep(3500);
await page.screenshot({ path: 'shots/realhero-drive.png' });
console.log('market drive', await page.evaluate(() => JSON.stringify({ mph: Math.round(window.__app.game.van.speed * 2.237), street: document.querySelector('.hud-street span').textContent })));
await browser.close();
