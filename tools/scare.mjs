// Charges the van at a pedestrian on the sidewalk: they must jump clear and never end up inside the van.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 400)));
await page.goto('http://localhost:5173/?map=grid', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await page.keyboard.press('Enter'); await sleep(500);
await page.evaluate(() => {
  const a = window.__app, g = a.game;
  g.state.score = 500;
  const p = a.world.peds.peds.find(p => Math.abs(p.x) < 70 && p.z > -150 && p.z < 150 && Math.abs(Math.cos(p.h)) < 0.3);   // walking north/south beside an avenue
  window.__ped = p;
  const dz = Math.sin(p.h) > 0 ? -14 : 14;     // come up behind them
  g.van.reset(p.x, p.z + dz, dz < 0 ? Math.PI / 2 : -Math.PI / 2);
  g.van.vel.set(0, dz < 0 ? 13 : -13);
  window.__min = 99;
  const tick = () => { const v = g.van; window.__min = Math.min(window.__min, Math.hypot(p.x - v.pos.x, p.z - v.pos.z)); requestAnimationFrame(tick); };
  tick();
});
await page.keyboard.down('KeyW');
await sleep(700); await page.screenshot({ path: 'shots/scare.png' });
await sleep(1500);
await page.keyboard.up('KeyW');
console.log(JSON.stringify(await page.evaluate(() => ({ minDistanceToPed: +window.__min.toFixed(2), scoreAfter: window.__app.game.state.score, streak: window.__app.game.state.streak }))));
await browser.close();
