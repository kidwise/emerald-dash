// Starts a shift, switches to the clear-evening weather with T, and takes a screenshot.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 400)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 40000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await page.evaluate(() => window.__app.game.startShift(process?.x || 'center')).catch(() => page.evaluate(() => window.__app.game.startShift('center')));
await page.keyboard.down('KeyW'); await sleep(2500);
await page.keyboard.press('KeyT'); await sleep(2500);
await page.screenshot({ path: 'shots/clear.png' });
await page.keyboard.up('KeyW');
console.log(JSON.stringify(await page.evaluate(() => ({ clear: window.__app.game.state.clear, fps: window.__info().fps, x: Math.round(window.__app.game.van.pos.x) }))));
await browser.close();
