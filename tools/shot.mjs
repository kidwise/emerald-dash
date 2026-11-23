// Headless screenshot helper for checking visuals.
// usage: node tools/shot.mjs name "query-string" [name2 "query2" ...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:5173/';
const W = Number(process.env.W || 1440), H = Number(process.env.H || 810);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
for (let i = 0; i < args.length; i += 2) {
  const name = args[i], q = args[i + 1] || '';
  const page = await browser.newPage();
  page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning' || m.text().startsWith('[dbg]')) console.log(`[${name}] ${t}: ${m.text().slice(0, 1500)}`); });
  page.on('pageerror', e => console.log(`[${name}] pageerror: ${String(e).slice(0, 1500)}`));
  await page.goto(base + '?' + q, { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    const wait = Number(new URLSearchParams(q).get('wait') || 1500);
    await new Promise(r => setTimeout(r, wait));
    const info = await page.evaluate('window.__info ? window.__info() : null');
    if (info) console.log(`[${name}] ${JSON.stringify(info)}`);
  } catch (e) { console.log(`[${name}] not ready: ${e.message}`); }
  await page.screenshot({ path: `shots/${name}.png` });
  await page.close();
}
await browser.close();
