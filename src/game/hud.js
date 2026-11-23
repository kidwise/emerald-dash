import { AVENUES, STREETS, X_WEST, X_EAST, Z_SOUTH, Z_NORTH, LAKE_Z } from '../config.js';

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
  const hint = el('div', 'hud-hint', '<b>W A S D</b> drive &nbsp;·&nbsp; <b>SPACE</b> throw parcel &nbsp;·&nbsp; <b>SHIFT</b> drift &nbsp;·&nbsp; <b>R</b> reset &nbsp;·&nbsp; <b>M</b> mute');
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
    setCargo(v) {
      cargo.style.display = v === null ? 'none' : '';
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
    showTitle(onStart) {
      overlay.className = 'hud-overlay title show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">SOUTH LAKE UNION · EVENING SHIFT</div>
          <h1>EMERALD <em>DASH</em></h1>
          <p class="sub">Ten jobs. One rainy night. Fling parcels onto doorsteps without lifting off the throttle.</p>
          <div class="keys">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Drive</span></div>
            <div><kbd class="wide">SPACE</kbd><span>Throw parcel</span></div>
            <div><kbd class="wide">SHIFT</kbd><span>Handbrake drift</span></div>
          </div>
          <button class="go">START SHIFT <small>ENTER</small></button>
          <p class="tip">Line the landing marker up with the glowing doorstep, then release. Faster throws and unbroken streaks score more.
          <b>Pink</b> rush orders pay triple but expire. <b>Amber</b> is a grocery pick-up: drive gently and hand over slowly.
          <b>Purple</b> rides the streetcar roof. <b>Blue</b> is on a dock at the lake. Coffee cups give a turbo.</p>
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = onStart;
    },
    showResults(r, onAgain) {
      overlay.className = 'hud-overlay results show';
      overlay.innerHTML = `
        <div class="panel">
          <div class="kicker">${r.won ? 'SHIFT COMPLETE' : 'OUT OF TIME'}</div>
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
        </div>`;
      overlay.style.pointerEvents = 'auto';
      q(overlay, '.go').onclick = onAgain;
    },
    hideOverlay() { overlay.classList.remove('show'); overlay.style.pointerEvents = 'none'; },

    // north-up minimap
    drawMap(van, targets, pickups, tram, cars = []) {
      const c = map.getContext('2d');
      const w = map.width, h = map.height;
      const zTop = LAKE_Z - 30, zBot = Z_SOUTH + 16, xL = X_WEST - 14, xR = X_EAST + 14;
      const sx = w / (xR - xL), sz = h / (zBot - zTop);
      const X = (x) => (x - xL) * sx, Z = (z) => (z - zTop) * sz;
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(8,14,22,0.0)'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(40,110,150,0.55)'; c.fillRect(0, 0, w, Z(LAKE_Z));
      c.fillStyle = 'rgba(40,110,70,0.45)'; c.fillRect(0, Z(LAKE_Z), w, Z(Z_NORTH) - Z(LAKE_Z));
      c.strokeStyle = 'rgba(190,210,230,0.5)'; c.lineCap = 'butt';
      for (const a of AVENUES) { c.lineWidth = a.hw * 2 * sx; c.beginPath(); c.moveTo(X(a.x), Z(Z_NORTH)); c.lineTo(X(a.x), Z(Z_SOUTH)); c.stroke(); }
      for (const s of STREETS) { c.lineWidth = s.hw * 2 * sz; c.beginPath(); c.moveTo(X(X_WEST), Z(s.z)); c.lineTo(X(X_EAST), Z(s.z)); c.stroke(); }
      c.fillStyle = 'rgba(255,235,200,0.75)'; for (const k of cars) c.fillRect(X(k.x) - 2, Z(k.z) - 2, 4, 4);
      if (tram) { c.fillStyle = '#c77dff'; c.fillRect(X(tram.x) - 3, Z(tram.z) - 9, 6, 18); }
      for (const p of pickups) if (p.active) { c.fillStyle = '#ffb347'; c.beginPath(); c.arc(X(p.x), Z(p.z), 4, 0, 7); c.fill(); }
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
      for (const t of targets) {
        if (t.done) continue;
        c.globalAlpha = 0.25 + 0.2 * pulse; c.fillStyle = t.css; c.beginPath(); c.arc(X(t.x), Z(t.z), 11 + pulse * 4, 0, 7); c.fill();
        c.globalAlpha = 1; c.beginPath(); c.arc(X(t.x), Z(t.z), 5.5, 0, 7); c.fill();
      }
      c.save(); c.translate(X(van.pos.x), Z(van.pos.z)); c.rotate(van.heading + Math.PI / 2);
      c.fillStyle = '#fff'; c.strokeStyle = '#0a1420'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.stroke(); c.fill();
      c.restore();
    },
  };
  return api;
}
