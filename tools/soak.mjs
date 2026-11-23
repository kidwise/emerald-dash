// Long random-input session at a retina-sized viewport; flags the moment the picture goes black.
import puppeteer from 'puppeteer-core';
const W = 2000, H = 760;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H, deviceScaleFactor: 2 } });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 400)); });
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 400)));
await page.goto('http://localhost:5173/?' + (process.argv[2] || ''), { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const district = process.argv[4] || 'slu';
await page.evaluate((d) => window.__app.game.startShift(d), district);
const keys = ['KeyW', 'KeyW', 'KeyW', 'KeyA', 'KeyD', 'ShiftLeft', 'KeyS'];
await page.evaluate((d) => { window.__soakDistrict = d; }, district);
let held = new Set(['KeyW']); await page.keyboard.down('KeyW');
for (let t = 0; t < Number(process.argv[3] || 70); t++) {
  for (let k = 0; k < 2; k++) { const key = keys[Math.floor(Math.random() * keys.length)]; if (held.has(key) && key !== 'KeyW') { await page.keyboard.up(key); held.delete(key); } else { await page.keyboard.down(key); held.add(key); } }
  if (Math.random() < 0.5) await page.keyboard.press('Space');
  // keep it moving: if stuck, drop the van somewhere new at a random angle (often straight at parked cars)
  await page.evaluate(() => { const v = window.__app.game.van; if (v.speed < 2) { const D = window.__soakDistrict; const spots = D === 'downtown' ? [[-440, 360, 780], [-352, 360, 780], [-264, 360, 780], [-176, 360, 780], [-88, 290, 780], [0, 290, 780], [88, 290, 780]] : D === 'center' ? [[-528, 10, 250], [-640, 40, 230], [-300, 255, 270], [-400, -5, 5]] : [[-88, -230, 230], [0, -230, 230], [88, -230, 230]]; const sp = spots[Math.floor(Math.random() * spots.length)]; v.reset(sp[0] + (Math.random() - 0.5) * 8, sp[1] + Math.random() * (sp[2] - sp[1]), Math.random() * 6.28); v.vel.set(Math.cos(v.heading) * 15, Math.sin(v.heading) * 15); } });
  await sleep(1000);
  const shot = await page.screenshot({ clip: { x: 300, y: 150, width: 1200, height: 450 }, encoding: 'binary' });
  const s = await page.evaluate(() => { const g = window.__app.game, v = g.van; return { x: +v.pos.x.toFixed(1), z: +v.pos.z.toFixed(1), y: v.y, mph: Math.round(v.speed * 2.237), h: +v.heading.toFixed(2), bounce: v.bounce, roll: v.roll, score: g.state.score, fps: window.__info().fps, pr: window.__app.renderer.getPixelRatio() }; });
  const black = shot.length < 60000;
  if (black || t % 10 === 0) console.log(t, 'png bytes', shot.length, JSON.stringify(s));
  if (black) {
    await page.screenshot({ path: 'shots/black.png' });
    const rep = await page.evaluate(() => {
      const a = window.__app, r = a.renderer, out = {};
      const scan = (rt, w, h, face) => { const buf = new Float32Array(w * h * 4); try { r.readRenderTargetPixels(rt, 0, 0, w, h, buf, face); } catch (e) { return 'read failed ' + e.message; } let bad = 0, max = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (!Number.isFinite(v)) bad++; else if (v > max) max = v; } return { bad, max: +max.toFixed(1) }; };
      for (let f = 0; f < 6; f++) out['cube' + f] = scan(a.game.cubeRT, 128, 128, f);
      out.reflect = scan(a.reflection.rt, a.reflection.rt.width, a.reflection.rt.height);
      return out;
    });
    console.log('buffers', JSON.stringify(rep));
    for (const [k, code] of Object.entries({ noEnv: "for (const m of Object.values(a.game.van.model.mats)) { if ('envMap' in m) { m.envMap = null; m.needsUpdate = true; } }", vanHidden: "a.game.van.model.root.visible=false" })) {
      await page.evaluate(`{const a=window.__app; ${code}}`); await sleep(600);
      console.log('after', k, (await page.screenshot({ clip: { x: 300, y: 150, width: 1200, height: 450 }, encoding: 'binary' })).length);
    }
    break;
  }
}
await browser.close();
