import { AVENUES, STREETS, Z_NORTH, LAKE_Z, CAMPUS, MARKET } from '../config.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export function createHud() {
  const root = document.getElementById('hud');
  root.innerHTML = '';
  const top = el('div', 'hud-top');
  const score = el('div', 'hud-score', '<span class="lbl">SCORE</span><span class="val">0</span><span class="combo"></span>');
  const clock = el('div', 'hud-clock', '<span class="time">2:30</span><span class="orders"></span>');
  const mapWrap = el('div', 'hud-map');
  const map = el('canvas'); map.width = 300; map.height = 440; mapWrap.append(map);
  top.append(score, clock, mapWrap);

  const bottom = el('div', 'hud-bottom');
  const speed = el('div', 'hud-speed', '<span class="val">0</span><span class="unit">MPH</span><div class="boost"><i></i></div>');
  const street = el('div', 'hud-street', '<span>Westlake Ave N</span>');
  const hint = el('div', 'hud-hint', '<b>W A S D</b> drive &nbsp;·&nbsp; <b>SPACE</b> throw parcel &nbsp;·&nbsp; <b>SHIFT</b> drift &nbsp;·&nbsp; <b>R</b> reset &nbsp;·&nbsp; <b>T</b> weather &nbsp;·&nbsp; <b>M</b> mute');
  const cargo = el('div', 'hud-cargo', '<span>GROCERIES</span><div><i></i></div><b>100%</b>');
  cargo.style.display = 'none';
  bottom.append(speed, street, hint, cargo);

  const pins = el('div', 'hud-pins');
  const toasts = el('div', 'hud-toasts');
  const pops = el('div', 'hud-pops');
  const overlay = el('div', 'hud-overlay');
  root.append(top, bottom, pins, pops, toasts, overlay);

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
    setClock(t, chips) {
      const s = Math.max(0, Math.ceil(t));
      q(clock, '.time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clock.classList.toggle('low', t < 20);
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
    showTitle(onStart, districts, selected, onSelect) {
      overlay.className = 'hud-overlay title show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">SEATTLE · EVENING SHIFT</div>
          <h1>EMERALD <em>DASH</em></h1>
          <p class="sub">Ten jobs. One rainy night. Fling parcels onto doorsteps without lifting off the throttle.</p>
          <div class="districts">${Object.entries(districts).map(([k, d], i) => `<button class="district ${k === selected ? 'on' : ''}" data-k="${k}"><small>${i + 1}</small><b>${d.label}</b><span>${d.sub}</span></button>`).join('')}</div>
          <div class="keys">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Drive</span></div>
            <div><kbd class="wide">SPACE</kbd><span>Throw</span></div>
            <div><kbd class="wide">SHIFT</kbd><span>Drift</span></div>
          </div>
          <button class="go">START SHIFT <small>ENTER</small></button>
          <p class="tip">Line the landing marker up with the glowing doorstep, then release. Faster throws and unbroken streaks score more.
          <b>Pink</b> rush orders pay triple but expire. <b>Amber</b> is a pick-up: drive gently and hand over slowly.
          <b>Purple</b> rides the streetcar roof. <b>Blue</b> is on a dock at the lake. Coffee cups give a turbo. A gamepad works too.</p>
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = () => onStart(selected);
      overlay.querySelectorAll('.district').forEach(b => { b.onclick = () => onSelect(b.dataset.k); });
    },
    showResults(r, onAgain, onMenu) {
      overlay.className = 'hud-overlay results show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">${r.district.toUpperCase()} · ${r.won ? 'SHIFT COMPLETE' : 'OUT OF TIME'}</div>
          <h1 class="grade">${r.grade}</h1>
          <div class="stats">
            <div><b>${Math.round(r.score).toLocaleString()}</b><span>Score</span></div>
            <div><b>${r.delivered}/${r.total}</b><span>Delivered</span></div>
            <div><b>${r.perfect}</b><span>Perfect drops</span></div>
            <div><b>×${r.bestCombo}</b><span>Best streak</span></div>
            <div><b>${Math.round(r.topSpeed)}</b><span>Top mph</span></div>
          </div>
          ${r.best ? `<p class="sub">New personal best!</p>` : `<p class="sub">Best: ${Math.round(r.bestScore).toLocaleString()}</p>`}
          <button class="go">DRIVE AGAIN <small>ENTER</small></button>
          <button class="ghost">CHANGE DISTRICT</button>
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = onAgain;
      q(overlay, '.ghost').onclick = onMenu;
    },
    hideOverlay() { overlay.classList.remove('show'); overlay.style.pointerEvents = 'none'; },

    // north-up minimap that scrolls with the van
    drawMap(van, targets, pickups, tram, cars = []) {
      const c = map.getContext('2d');
      const w = map.width, h = map.height, k = 0.86;
      const X = (x) => w / 2 + (x - van.pos.x) * k, Z = (z) => h / 2 + (z - van.pos.z) * k;
      c.clearRect(0, 0, w, h);
      const rect = (r, col) => { c.fillStyle = col; c.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); };
      rect({ x0: -900, x1: 900, z0: -900, z1: LAKE_Z }, 'rgba(40,110,150,0.55)');
      rect({ x0: -900, x1: MARKET.x0, z0: 345, z1: 1200 }, 'rgba(40,110,150,0.55)');
      rect({ x0: -420, x1: 420, z0: LAKE_Z, z1: Z_NORTH }, 'rgba(40,110,70,0.45)');
      rect(CAMPUS, 'rgba(40,110,70,0.45)'); rect(MARKET, 'rgba(150,90,60,0.4)');
      c.fillStyle = 'rgba(190,210,230,0.5)';
      for (const a of AVENUES) c.fillRect(X(a.x - a.hw), Z(a.z0), a.hw * 2 * k, (a.z1 - a.z0) * k);
      for (const s of STREETS) { const x0 = Math.max(s.x0, -540), x1 = Math.min(s.x1, 104); c.fillRect(X(x0), Z(s.z - s.hw), (x1 - x0) * k, s.hw * 2 * k); }
      c.fillStyle = 'rgba(255,235,200,0.75)'; for (const q2 of cars) c.fillRect(X(q2.x) - 2, Z(q2.z) - 2, 4, 4);
      if (tram) { c.fillStyle = '#c77dff'; c.fillRect(X(tram.x) - 3, Z(tram.z) - 9, 6, 18); }
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
