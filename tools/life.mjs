// Checks street life: close-ups of a pedestrian group and a traffic car, then traffic flow statistics over time.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 400)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 300)); });
await page.goto('http://localhost:5173/?cam=0,3,0,0,3,-10', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
document: await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
await sleep(1500);
await page.evaluate(() => { const a = window.__app; const p = a.world.peds.peds.find(p => p.umbrella && Math.abs(p.x) < 80 && p.z > -200); a.camera.position.set(p.x + 3.2, 1.9, p.z + 3.4); a.camera.lookAt(p.x, 1.25, p.z); a.camera.fov = 45; a.camera.updateProjectionMatrix(); });
await sleep(300); await page.screenshot({ path: 'shots/ped.png' });
await page.evaluate(() => { const a = window.__app; const c = a.world.traffic.cars.find(c => c.v > 5) || a.world.traffic.cars[0]; const fx = Math.cos(c.h), fz = Math.sin(c.h); a.camera.position.set(c.x + fx * 9 - fz * 4, 1.7, c.z + fz * 9 + fx * 4); a.camera.lookAt(c.x, 0.9, c.z); });
await sleep(120); await page.screenshot({ path: 'shots/car.png' });
for (let t = 0; t <= 90; t += 15) {
  const s = await page.evaluate(() => { const cars = window.__app.world.traffic.cars; const moving = cars.filter(c => c.v > 1).length; const avg = cars.reduce((a, c) => a + c.v, 0) / cars.length; const overlaps = cars.reduce((n, a, i) => n + cars.slice(0, i).filter(b => Math.hypot(a.x - b.x, a.z - b.z) < 2.2).length, 0); return { moving, total: cars.length, avgMps: +avg.toFixed(1), overlaps, bad: cars.filter(c => !Number.isFinite(c.x + c.z + c.h)).length, fps: window.__info().fps }; });
  console.log(`t=${t}s`, JSON.stringify(s));
  if (t < 90) await sleep(15000);
}
await browser.close();
