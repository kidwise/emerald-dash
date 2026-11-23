
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export function createHud() {
  const root = document.getElementById('hud');
  root.innerHTML = '';
  const top = el('div', 'hud-top');
  const score = el('div', 'hud-score', '<span class="lbl">SCORE</span><span class="val">0</span><span class="combo"></span>');
  const clock = el('div', 'hud-clock', '<span class="time">2:30</span><span class="orders"></span><span class="count"></span>');
  const mapWrap = el('div', 'hud-map');
  const map = el('canvas'); map.width = 300; map.height = 440; mapWrap.append(map);
  top.append(score, clock, mapWrap);

  const bottom = el('div', 'hud-bottom');
  const speed = el('div', 'hud-speed', '<span class="val">0</span><span class="unit">MPH</span><div class="boost"><i></i></div>');
  const street = el('div', 'hud-street', '<span>Westlake Ave N</span>');
  const hint = el('div', 'hud-hint', '<b>SPACE</b> throw &nbsp;·&nbsp; <b>SHIFT</b> drift &nbsp;·&nbsp; <b>TAB</b> next job &nbsp;·&nbsp; <b>T</b> weather &nbsp;·&nbsp; <b>ESC</b> end');
  const cargo = el('div', 'hud-cargo', '<span>GROCERIES</span><div><i></i></div><b>100%</b>');
  cargo.style.display = 'none';
  bottom.append(speed, street, hint, cargo);

  const pins = el('div', 'hud-pins');
  const toasts = el('div', 'hud-toasts');
  const pops = el('div', 'hud-pops');
  const overlay = el('div', 'hud-overlay');
  const card = el('div', 'postcard');
  const promptEl = el('div', 'hud-prompt');
  root.append(top, bottom, pins, pops, toasts, card, promptEl, overlay);

  const q = (p, s) => p.querySelector(s);
  const state = { pinEls: [] };

  const api = {
    root,
    setPlaying(on) { root.classList.toggle('playing', on); },
    setScore(v, combo) {
      q(score, '.val').textContent = Math.round(v).toLocaleString();
      const c = q(score, '.combo');
      c.textContent = combo > 1 ? `×${combo} COMBO` : '';
      c.classList.toggle('on', combo > 1);
    },
    bumpScore() { score.classList.remove('bump'); void score.offsetWidth; score.classList.add('bump'); },
    setClock(t, chips, label, delivered) {
      const s = Math.max(0, Math.ceil(t));
      q(clock, '.time').textContent = label || `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clock.classList.toggle('low', !label && t < 20); clock.classList.toggle('label', !!label);
      if (delivered !== undefined) q(clock, '.count').textContent = delivered ? `${delivered} DELIVERED` : '';
      const html = chips.map(c => `<i class="${c.state}" style="--c:${c.css}"></i>`).join('');
      if (html !== state.chips) { state.chips = html; q(clock, '.orders').innerHTML = html; }
    },
    setSpeed(mph, boost) {
      q(speed, '.val').textContent = Math.round(mph);
      q(speed, '.boost i').style.width = `${Math.round(boost * 100)}%`;
      speed.classList.toggle('boosting', boost > 0);
    },
    setCargo(v, label) {
      cargo.style.display = v === null ? 'none' : '';
      if (label) q(cargo, 'span').textContent = label;
      if (v !== null) { q(cargo, 'i').style.width = `${Math.round(v)}%`; q(cargo, 'b').textContent = `${Math.round(v)}%`; cargo.classList.toggle('bad', v < 55); }
    },
    setStreet(name) { const s = q(street, 'span'); if (s.textContent !== name) s.textContent = name; },
    postcard(name, sub) {
      card.classList.toggle('show', !!name);
      root.classList.toggle('looking', !!name);
      if (name) card.innerHTML = `<small>LANDMARK</small><b>${name}</b><span>${sub}</span><i>W to drive on</i>`;
    },
    prompt(text) { promptEl.classList.toggle('show', !!text); if (text) promptEl.textContent = text; },
    banner(text) {
      const b = el('div', 'banner', text); root.append(b);
      setTimeout(() => b.remove(), 3200);
    },
    toast(title, sub, cls = '') {
      const t = el('div', 'toast ' + cls, `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`);
      toasts.append(t);
      setTimeout(() => t.classList.add('out'), 2600);
      setTimeout(() => t.remove(), 3300);
    },
    pop(x, y, text, cls = '') {
      const p = el('div', 'pop ' + cls, text);
      p.style.left = x + 'px'; p.style.top = y + 'px';
      pops.append(p);
      setTimeout(() => p.remove(), 1300);
    },
    // world-anchored delivery pins; list = [{x,y,visible,dist,label,behind}]
    setPins(list) {
      while (state.pinEls.length < list.length) { const p = el('div', 'pin', '<i></i><span></span>'); pins.append(p); state.pinEls.push(p); }
      state.pinEls.forEach((p, i) => {
        const d = list[i];
        if (!d) { p.style.display = 'none'; return; }
        p.style.display = '';
        p.style.transform = `translate(${d.x}px, ${d.y}px)`;
        p.classList.toggle('edge', d.edge);
        p.classList.toggle('near', d.near);
        q(p, 'span').textContent = d.label; p.style.setProperty('--c', d.css);
        q(p, 'i').style.transform = `rotate(${d.angle}rad)`;
      });
    },
    showTitle(onStart, onExplore, found, places, credit) {
      overlay.className = 'hud-overlay title show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">SEATTLE · ONE RAINY EVENING</div>
          <h1>EMERALD <em>DASH</em></h1>
          <p class="sub">One city, from Lake Union to Pike Place to the Space Needle. Jobs come to you wherever you drive.</p>
          <div class="keys">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Drive</span></div>
            <div><kbd class="wide">SPACE</kbd><span>Throw</span></div>
            <div><kbd class="wide">SHIFT</kbd><span>Drift</span></div>
            <div><kbd class="wide">TAB</kbd><span>Next job</span></div>
          </div>
          <div class="modes">
            <button class="go">START SHIFT <small>ENTER</small></button>
            <button class="go alt">EXPLORE <small>E</small></button>
          </div>
          <p class="tip">${credit}.</p>
          <p class="tip"><b>Shift:</b> the clock runs down and every delivery adds time, more for longer trips. Follow the glowing line to the selected job.
          <b>Pink</b> rush orders pay triple but expire. <b>Amber</b> is a pick-up for a cross-town run: drive gently and hand over slowly.
          <b>Purple</b> rides the streetcar roof. <b>Blue</b> is on a dock at the lake.<br><b>Explore:</b> no clock. Stars on the map mark the landmarks and an amber line leads to the nearest one you have not found. Found so far: ${found} of ${places}.</p>
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = onStart;
      q(overlay, '.go.alt').onclick = onExplore;
    },
    showResults(r, onAgain, onMenu) {
      overlay.className = 'hud-overlay results show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">${r.explore ? 'EXPLORE' : 'SHIFT OVER'} · ${r.minutes.toFixed(1)} MIN ON THE ROAD</div>
          <h1 class="grade">${r.grade}</h1>
          <div class="stats">
            <div><b>${Math.round(r.score).toLocaleString()}</b><span>Score</span></div>
            <div><b>${r.delivered}</b><span>Delivered</span></div>
            <div><b>${r.album}/${r.places}</b><span>Landmarks</span></div>
            <div><b>${r.perfect}</b><span>Perfect drops</span></div>
            <div><b>×${r.bestCombo}</b><span>Best streak</span></div>
            <div><b>${Math.round(r.topSpeed)}</b><span>Top mph</span></div>
          </div>
          ${r.best ? `<p class="sub">New personal best!</p>` : `<p class="sub">Best: ${Math.round(r.bestScore).toLocaleString()}</p>`}
          <button class="go">DRIVE AGAIN <small>ENTER</small></button>
          <button class="ghost">TITLE SCREEN</button>
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = onAgain;
      q(overlay, '.ghost').onclick = onMenu;
    },
    hideOverlay() { overlay.classList.remove('show'); overlay.style.pointerEvents = 'none'; },

    // north-up minimap that scrolls with the van
    drawMap(van, targets, pickups, tram, cars = [], nav = null, painter = null, marks = []) {
      const c = map.getContext('2d');
      const w = map.width, h = map.height, k = 0.86;
      const X = (x) => w / 2 + (x - van.pos.x) * k, Z = (z) => h / 2 + (z - van.pos.z) * k;
      c.clearRect(0, 0, w, h);
      painter(c, X, Z, k);
      // landmarks: a filled star once found, a pulsing outline until then; the nearest unfound one sticks to the edge
      const star = (x, y, rad) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? rad * 0.45 : rad; c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); };
      let nearest = null, nd = 1e9;
      for (const m of marks) { if (m.found) continue; const d = Math.hypot(m.x - van.pos.x, m.z - van.pos.z); if (d < nd) { nd = d; nearest = m; } }
      const beat = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
      for (const m of marks) {
        let mx = X(m.x), mz = Z(m.z);
        if (m === nearest) { mx = Math.max(12, Math.min(w - 12, mx)); mz = Math.max(12, Math.min(h - 12, mz)); }
        if (mx < -10 || mx > w + 10 || mz < -10 || mz > h + 10) continue;
        star(mx, mz, m.found ? 11 : 13 + beat * 3);
        if (m.found) { c.fillStyle = 'rgba(157,255,207,0.6)'; c.fill(); }
        else { c.fillStyle = 'rgba(10,16,24,0.7)'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = '#ffc247'; c.stroke(); }
      }
      if (nav && nav.pts.length > 1) { c.strokeStyle = nav.target.css; c.lineWidth = 3.5; c.globalAlpha = 0.85; c.lineJoin = 'round'; c.beginPath(); nav.pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.stroke(); c.globalAlpha = 1; }
      c.fillStyle = 'rgba(255,235,200,0.75)'; for (const q2 of cars) c.fillRect(X(q2.x) - 2, Z(q2.z) - 2, 4, 4);
      if (tram) { c.fillStyle = '#c77dff'; c.beginPath(); c.arc(X(tram.x), Z(tram.z), 5, 0, 7); c.fill(); }
      for (const p of pickups) if (p.active) { c.fillStyle = '#ffb347'; c.beginPath(); c.arc(X(p.x), Z(p.z), 4, 0, 7); c.fill(); }
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
      for (const t of targets) {
        if (t.done) continue;
        // jobs off the edge of the map are pinned to its border
        const tx = Math.max(10, Math.min(w - 10, X(t.x))), tz = Math.max(10, Math.min(h - 10, Z(t.z)));
        c.globalAlpha = 0.25 + 0.2 * pulse; c.fillStyle = t.css; c.beginPath(); c.arc(tx, tz, 11 + pulse * 4, 0, 7); c.fill();
        c.globalAlpha = 1; c.beginPath(); c.arc(tx, tz, 5.5, 0, 7); c.fill();
      }
      c.save(); c.translate(w / 2, h / 2); c.rotate(van.heading + Math.PI / 2);
      c.fillStyle = '#fff'; c.strokeStyle = '#0a1420'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.stroke(); c.fill();
      c.restore();
    },
  };
  return api;
}
