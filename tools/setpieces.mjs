// The two set pieces: race the monorail (win and lose), and ride to the top of the Space Needle.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--mute-audio'], defaultViewport: { width: 1440, height: 810 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 500)));
page.on('console', m => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 300)); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__app.game', { timeout: 60000 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = (f, ...a) => page.evaluate(f, ...a);
await page.keyboard.press('Enter'); await sleep(500);
const st = () => ev(() => { const g = window.__app.game, m = window.__app.world.monorail; return { race: g.state.race && { to: g.state.race.to, t: +g.state.race.t.toFixed(1) }, score: g.state.score, train: Math.round(m.state.s), trainV: +m.state.v.toFixed(1), prompt: document.querySelector('.hud-prompt').textContent }; });
const gates = await ev(() => window.__app.world.monorail.gates.map(g => [Math.round(g.x), Math.round(g.z)]));
console.log('gates', JSON.stringify(gates), 'line length', await ev(() => Math.round(window.__app.world.monorail.total)));
// win: enter the gate, then arrive first
await ev(() => { const g = window.__app.game, q = window.__app.world.monorail.gates[1]; g.state.time = 999; g.van.reset(q.x, q.z, 0); });
await sleep(600); console.log('started', JSON.stringify(await st()));
await sleep(6000); console.log('under way', JSON.stringify(await st()));
await page.screenshot({ path: 'shots/race.png' });
await ev(() => { const g = window.__app.game, q = window.__app.world.monorail.gates[0]; g.van.reset(q.x + 3, q.z + 3, 0); });
await sleep(600); console.log('after reaching the finish', JSON.stringify(await st()));
// lose: start again from the other end and let the train get there (sped up for the test)
await ev(() => { const g = window.__app.game, q = window.__app.world.monorail.gates[0]; g.state.raceCd = 0; g.van.reset(q.x, q.z, 0); });
await sleep(600);
await ev(() => { const m = window.__app.world.monorail.state; m.wait = 0; m.s = window.__app.world.monorail.total - 40; });
await sleep(9000); console.log('after the train arrives', JSON.stringify(await st()));
// the ride up the Needle
await ev(() => { const a = window.__app, g = a.game, s = a.world.stops.find(q => q.name === 'Space Needle'); g.state.lastStop = null; g.state.post = null; g.van.reset(s.x, s.z, 0); });
await sleep(6000); await page.screenshot({ path: 'shots/ascent1.png' });
await sleep(7000); await page.screenshot({ path: 'shots/ascent2.png' });
console.log('ascent', JSON.stringify(await ev(() => { const g = window.__app.game; return { post: g.state.post && g.state.post.stop.name, top: g.state.post && !!g.state.post.top, camY: Math.round(window.__app.camera.position.y), fog: window.__app.scene.fog.density, score: g.state.score, fps: window.__info().fps }; })));
await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
console.log('after leaving', JSON.stringify(await ev(() => ({ post: !!window.__app.game.state.post, fog: window.__app.scene.fog.density }))));
await browser.close();
