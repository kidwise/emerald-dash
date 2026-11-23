import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
await page.goto(process.env.BASE || 'http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 30000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await page.keyboard.press('Enter');
await page.keyboard.down('KeyW'); await sleep(12000);   // straight up Westlake: through intersections, past the streetcar, into the park
const mid = await page.evaluate(() => { const g = window.__app.game; return { x: +g.van.pos.x.toFixed(1), z: +g.van.pos.z.toFixed(1), score: g.state.score, seen: [...g.state.seen], fps: window.__info().fps }; });
console.log('after 12 s of driving north', JSON.stringify(mid));
await page.screenshot({ path: 'shots/drive-north.png' });
await page.keyboard.up('KeyW');
await page.evaluate(() => { window.__app.game.state.time = 0.4; });
await sleep(1500);
console.log('mode', await page.evaluate(() => window.__app.game.state.mode));
await page.screenshot({ path: 'shots/results.png' });
await page.keyboard.press('Enter'); await sleep(600);
console.log('restart mode', await page.evaluate(() => window.__app.game.state.mode), 'errors:', JSON.stringify(errs));
await browser.close();
