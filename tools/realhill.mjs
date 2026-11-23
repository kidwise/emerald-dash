// Real map: find the steepest street in the map, drive down it and report height, air time and frame rate.
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
const hill = await page.evaluate(async () => {
  const a = window.__app, H = a.world.heightAt, d = await (await fetch('/assets/map/city.json')).json();
  let best = null;
  for (const rd of d.roads) { if (!rd.n || rd.br) continue; for (let i = 1; i < rd.p.length; i++) { const p = rd.p[i - 1], q = rd.p[i], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len < 55 || Math.abs(p[0]) > 1300 || Math.abs(q[1]) > 1200 || (p[1] > 820 && p[0] < -100)) continue; const drop = H(p[0], p[1]) - H(q[0], q[1]), g = Math.abs(drop) / len; if (!best || g > best.g) best = { g, name: rd.n, top: drop > 0 ? p : q, bottom: drop > 0 ? q : p, len, drop: Math.abs(drop) }; } }
  const h = Math.atan2(best.bottom[1] - best.top[1], best.bottom[0] - best.top[0]);
  const sx = best.top[0] - Math.cos(h) * 45, sz = best.top[1] - Math.sin(h) * 45;
  a.game.van.reset(sx, sz, h); a.game.van.vel.set(Math.cos(h) * 20, Math.sin(h) * 20);
  window.__air = 0; const tick = () => { if (a.game.van.air) window.__air++; requestAnimationFrame(tick); }; tick();
  return { street: best.name, grade: (best.g * 100).toFixed(1) + '%', drop: best.drop.toFixed(1), len: Math.round(best.len) };
});
console.log('steepest street', JSON.stringify(hill));
await page.keyboard.down('KeyW');
for (let i = 0; i < 5; i++) { await sleep(1000); console.log(await page.evaluate(() => { const v = window.__app.game.van; return JSON.stringify({ y: +v.y.toFixed(1), mph: Math.round(v.speed * 2.237), air: v.air, pitch: +v.slopePitch.toFixed(2), fps: window.__info().fps }); })); if (i === 1) await page.screenshot({ path: 'shots/realhill.png' }); }
await page.keyboard.up('KeyW');
console.log('frames airborne', await page.evaluate(() => window.__air));
await browser.close();
