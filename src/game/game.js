import * as THREE from 'three';
import { Van, groundHeight } from './van.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { AVENUES, STREETS, CURB, Z_SOUTH, Z_NORTH, LAKE_Z } from '../config.js';

const SHIFT_TIME = 150, ORDERS = 10, THROW_T = 0.8, GRAV = 18, RANGE = 36;
// job types: colour, HUD colour and tag
const KINDS = {
  parcel: { col: [0.25, 2.0, 2.4], css: '#55f0ff', tag: '', base: 100 },
  rush: { col: [2.8, 0.30, 0.95], css: '#ff5a9a', tag: 'RUSH', base: 100 },
  pickup: { col: [2.6, 1.5, 0.2], css: '#ffc247', tag: 'PICK UP', base: 0 },
  grocery: { col: [0.5, 2.4, 0.55], css: '#6dff8f', tag: 'GROCERIES', base: 320 },
  tram: { col: [1.7, 0.7, 2.8], css: '#c77dff', tag: 'STREETCAR', base: 350 },
  boat: { col: [0.6, 1.3, 2.9], css: '#7fb6ff', tag: 'DOCK', base: 300 },
};
const TRAM_ROOF = 3.55, DOCK_Y = -0.07;
const DOCKS = [[30, LAKE_Z - 28, 5, 56], [78, LAKE_Z - 34, 5, 68], [126, LAKE_Z - 24, 4, 48], [54, LAKE_Z - 54, 52, 3.5]];
const onDock = (x, z) => (x > -112 && x < -22 && z > LAKE_Z - 78) || DOCKS.some(([dx, dz, w, d]) => Math.abs(x - dx) < w / 2 && Math.abs(z - dz) < d / 2);

const POIS = [
  { name: 'Whole Foods Market', sub: 'Westlake Ave & Denny Way', x: -30, z: 258, r: 34 },
  { name: 'Lake Union Park', sub: 'Twelve acres on the south shore', x: 0, z: -286, r: 30 },
  { name: 'MOHAI', sub: 'Museum of History & Industry', x: -60, z: -345, r: 44 },
  { name: 'Center for Wooden Boats', sub: 'Historic boats on the water', x: 70, z: -360, r: 42 },
  { name: 'Mercer Street', sub: 'The famous Mercer Mess', x: 0, z: -176, r: 16 },
  { name: 'Amazon Campus', sub: 'Terry Ave N', x: 88, z: 40, r: 30 },
  { name: 'Space Needle View', sub: 'Look west along Thomas St', x: -66, z: 88, r: 20 },
  { name: 'Streetcar Line', sub: 'The South Lake Union Trolley', x: 5, z: 44, r: 14 },
];

function angleLerp(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }

export function initGame(app) {
  const { scene, camera, renderer, world, ground, params } = app;
  const hud = createHud();
  const audio = createAudio();
  const van = new Van(world);
  scene.add(van.model.root);

  // ---------------------------------------------------------------- live reflections on the van
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.5, 500, cubeRT);
  cubeCam.children.forEach(c => c.layers.enable(1));
  scene.add(cubeCam);
  let cubeFace = 0, cubeReady = false;
  const updateCube = () => {
    van.model.root.visible = false;
    if (!cubeReady) {
      cubeCam.position.set(van.pos.x, 1.7, van.pos.z);
      cubeCam.update(renderer, scene);
      cubeReady = true;
      for (const k of ['paint', 'glass', 'chrome', 'trim']) { van.model.mats[k].envMap = cubeRT.texture; van.model.mats[k].needsUpdate = true; }
      cubeRT.texture.needsPMREMUpdate = true;
    } else {
      if (cubeFace === 0) { cubeCam.position.set(van.pos.x, 1.7, van.pos.z); cubeCam.updateMatrixWorld(); }
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(cubeRT, cubeFace);
      renderer.render(scene, cubeCam.children[cubeFace]);
      renderer.setRenderTarget(prev);
      cubeFace = (cubeFace + 1) % 6;
      if (cubeFace === 0) cubeRT.texture.needsPMREMUpdate = true;
    }
    van.model.root.visible = true;
  };

  // ---------------------------------------------------------------- particles (sparks, spray, bursts)
  const PMAX = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pUni = { uScale: { value: 700 } };
  const pMat = new THREE.ShaderMaterial({
    uniforms: pUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = aColor; gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 220.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC * a * a, 1.0); }`,
  });
  const pPts = new THREE.Points(pGeo, pMat); pPts.frustumCulled = false; pPts.layers.set(2);
  scene.add(pPts);
  const parts = Array.from({ length: PMAX }, () => ({ life: 0 }));
  let pNext = 0;
  const emit = (x, y, z, vx, vy, vz, life, size, r, g, b, grav = 9, drag = 1, grow = 0) => {
    const p = parts[pNext]; pNext = (pNext + 1) % PMAX;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, r, g, b, grav, drag, grow });
  };
  const updateParticles = (dt) => {
    for (let i = 0; i < PMAX; i++) {
      const p = parts[i];
      if (p.life <= 0) { pSize[i] = 0; continue; }
      p.life -= dt;
      p.vy -= p.grav * dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; }
      const f = Math.max(0, p.life / p.max);
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
      pCol[i * 3] = p.r * f; pCol[i * 3 + 1] = p.g * f; pCol[i * 3 + 2] = p.b * f;
      pSize[i] = p.size * (1 + p.grow * (1 - f));
    }
    pGeo.attributes.position.needsUpdate = pGeo.attributes.aColor.needsUpdate = pGeo.attributes.aSize.needsUpdate = true;
  };

  // ---------------------------------------------------------------- delivery targets
  const ringGeo = new THREE.RingGeometry(2.05, 2.4, 56).rotateX(-Math.PI / 2);
  const discGeo = new THREE.CircleGeometry(2.05, 40).rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(1.25, 1.25, 30, 28, 1, true).translate(0, 15, 0);
  const iconGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.9, 0.9));
  const beamMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uK: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 0.95, 1.15) } },
    vertexShader: /* glsl */`varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vH = position.y / 30.0; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`uniform float uK; uniform float uTime; uniform vec3 uColor; varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = rim * pow(clamp(1.0 - vH, 0.0, 1.0), 1.8) * (0.85 + 0.3 * sin(uTime * 4.0 - vH * 22.0)) * uK; gl_FragColor = vec4(uColor * a, 1.0); }`,
  });
  const targets = [];
  const doorOf = (lot) => {
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const av = AVENUES.reduce((b, a) => Math.abs(a.x - cx) < Math.abs(b.x - cx) ? a : b);
    const nx = av.x > cx ? 1 : -1;
    return { x: (nx > 0 ? lot.x1 : lot.x0) + nx * 2.4, z: cz };
  };
  const setKind = (t, kind) => {
    t.kind = kind; t.col.setRGB(...KINDS[kind].col); t.css = KINDS[kind].css; t.tag = KINDS[kind].tag;
    t.bm.uniforms.uColor.value.copy(t.col).multiplyScalar(0.48);
    t.icon.material.color.copy(t.col).multiplyScalar(1.25);
  };
  const makeTarget = (kind, x, z, y, name) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = disc.position.y = 0.03; ring.layers.set(1); disc.layers.set(1);
    const bm = beamMat();
    const beam = new THREE.Mesh(beamGeo, bm);
    const icon = new THREE.LineSegments(iconGeo, new THREE.LineBasicMaterial());
    icon.position.y = 3.4;
    g.add(ring, disc, beam, icon);
    g.position.set(x, y, z);
    scene.add(g);
    const t = { x, z, y, vx: 0, vz: 0, name, g, ring, disc, beam, bm, icon, col: new THREE.Color(), done: false, failed: false, fade: 0 };
    setKind(t, kind);
    return t;
  };
  // how far a landing point is from a job's sweet spot (below 1.3 is perfect, below 3.4 counts)
  const missOf = (t, x, z, lead) => {
    const px = t.x + t.vx * lead, pz = t.z + t.vz * lead;
    if (t.kind === 'tram') return Math.max(Math.abs(x - px) * 2.0, Math.abs(z - pz) * 0.33);
    return Math.hypot(x - px, z - pz);
  };
  const surfaceY = (x, z) => {
    const tr = world.streetcar.state;
    if (Math.abs(x - tr.x) < 1.5 && Math.abs(z - tr.z) < 9.9) return TRAM_ROOF;
    if (z < LAKE_Z - 0.6) return onDock(x, z) ? DOCK_Y : -0.62;
    return groundHeight(x, z);
  };
  const clearTargets = () => { for (const t of targets) scene.remove(t.g); targets.length = 0; };

  // landing marker
  const reticle = new THREE.Group();
  const retMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.78, 0.98, 40).rotateX(-Math.PI / 2), retMat), new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(-Math.PI / 2), retMat));
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.09).rotateX(-Math.PI / 2), retMat); m.rotation.y = i * Math.PI / 2; m.position.set(Math.cos(i * Math.PI / 2) * 1.3, 0, -Math.sin(i * Math.PI / 2) * 1.3); reticle.add(m); }
  reticle.traverse(o => o.layers.set(1)); reticle.visible = false;
  scene.add(reticle);

  // ---------------------------------------------------------------- parcels
  const boxTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#b07a44'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${60 + Math.random() * 40},${40 + Math.random() * 20},20,0.08)`; x.fillRect(Math.random() * 128, Math.random() * 128, 14, 1.5); }
    x.fillStyle = '#e9dfc9'; x.fillRect(52, 0, 24, 128);
    x.fillStyle = '#14324f'; x.fillRect(84, 84, 30, 22);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const parcelMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.75, emissive: 0x3a2814, emissiveIntensity: 0.6 });
  const parcelGeo = new THREE.BoxGeometry(0.62, 0.46, 0.5);
  const parcels = [];
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(parcelGeo, parcelMat); m.visible = false; scene.add(m); parcels.push({ m, active: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), rest: 0, landed: false }); }
  let parcelNext = 0;

  // ---------------------------------------------------------------- coffee turbo pickups
  const cupGeo = new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.285, 0.7], [0.3, 0.71], [0.3, 0.76], [0.25, 0.8], [0, 0.82]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5, emissive: 0xffa040, emissiveIntensity: 0.9 });
  const sleeveGeo = new THREE.CylinderGeometry(0.262, 0.232, 0.3, 20, 1, true).translate(0, 0.36, 0);
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x6a3d1c, roughness: 0.8, emissive: 0x4a2408, emissiveIntensity: 1 });
  const pickups = [[1.8, 150], [-1.8, -40], [-44, 91.5], [44, -84.5], [-84.5, 30], [84.5, -130], [30, -260.5], [-40, 172.5], [1.8, -215], [60, 3.5]].map(([x, z]) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cupGeo, cupMat), new THREE.Mesh(sleeveGeo, sleeveMat));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(1.6, 0.8, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: haloTex() }));
    halo.scale.setScalar(3.2); halo.position.y = 0.4; g.add(halo);
    g.scale.setScalar(1.7); g.position.set(x, 1.0, z);
    scene.add(g);
    return { x, z, g, active: true, respawn: 0 };
  });

  // ---------------------------------------------------------------- state
  const input = { throttle: 0, steer: 0, drift: false };
  const keys = new Set();
  const S = { mode: 'title', time: SHIFT_TIME, score: 0, streak: 0, lastDelivery: -99, delivered: 0, perfect: 0, bestCombo: 0, topSpeed: 0, throwCd: 0, camHeading: van.heading, shake: 0, titleT: 0, seen: new Set(), bellCd: 0, elapsed: 0 };
  let best = 0;
  try { best = Number(localStorage.getItem('emerald-dash-best') || 0); } catch { /* storage unavailable */ }

  const startShift = () => {
    audio.start(); audio.play('start');
    clearTargets();
    const lots = world.buildings.lots.filter(l => l.name && l.type !== 'grocery' && (l.z0 + l.z1) / 2 < Z_SOUTH);
    for (let i = lots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lots[i], lots[j]] = [lots[j], lots[i]]; }
    const atDoor = (kind, lot) => { const d = doorOf(lot); return makeTarget(kind, d.x, d.z, CURB, lot.name); };
    lots.slice(0, 6).forEach(l => targets.push(atDoor('parcel', l)));
    const pick = makeTarget('pickup', -40, STREETS[0].z + 5.3, 0, 'Whole Foods Market'); pick.dest = lots[6];
    const tr = world.streetcar.state;
    targets.push(pick, makeTarget('tram', tr.x, tr.z, TRAM_ROOF, 'Streetcar roof'), makeTarget('boat', 30, LAKE_Z - 9, DOCK_Y, 'Houseboat dock'));
    van.reset(1.9, 238, -Math.PI / 2);
    Object.assign(S, { mode: 'play', time: SHIFT_TIME, score: 0, streak: 0, lastDelivery: -99, delivered: 0, resolved: 0, perfect: 0, bestCombo: 0, topSpeed: 0, throwCd: 0,
      camHeading: van.heading, elapsed: 0, rush: null, rushLot: lots[7], rushAt: 18 + Math.random() * 12, cargo: null });
    for (const p of pickups) { p.active = true; p.g.visible = true; }
    for (const p of parcels) { p.active = false; p.m.visible = false; p.ride = false; }
    hud.hideOverlay(); hud.setPlaying(true); hud.setScore(0, 0); hud.setCargo(null);
    hud.toast('Shift started', 'Parcels, a grocery run, the streetcar and a dock drop');
  };
  const spawnRush = () => {
    const t = (() => { const d = doorOf(S.rushLot); return makeTarget('rush', d.x, d.z, CURB, S.rushLot.name); })();
    t.expire = 36; targets.push(t); S.rush = t;
    hud.toast('Rush order!', `${t.name} · 36 s · triple pay`, 'rush'); audio.play('bell');
  };
  const resolve = () => {
    S.resolved++;
    if (!S.rush && S.resolved >= ORDERS - 1 && S.mode === 'play') spawnRush();
    if (S.resolved >= ORDERS) setTimeout(() => S.mode === 'play' && endShift(true), 900);
  };
  const endShift = (won) => {
    S.mode = 'end';
    if (won) S.score += Math.ceil(S.time) * 20;
    const sc = S.score;
    const grade = sc >= 6000 ? 'S' : sc >= 4500 ? 'A' : sc >= 3000 ? 'B' : sc >= 1500 ? 'C' : 'D';
    const isBest = sc > best;
    if (isBest) { best = sc; try { localStorage.setItem('emerald-dash-best', String(Math.round(best))); } catch { /* ignore */ } }
    audio.play(won ? 'win' : 'lose');
    hud.setPlaying(false);
    hud.showResults({ won, grade, score: sc, delivered: S.delivered, total: ORDERS, perfect: S.perfect, bestCombo: S.bestCombo, topSpeed: S.topSpeed, best: isBest, bestScore: best }, startShift);
  };

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Enter' && S.mode !== 'play') startShift();
    if (e.code === 'Space' && S.mode === 'play') throwParcel();
    if (e.code === 'KeyR' && S.mode === 'play') { const a = nearestRoadPoint(van.pos.x, van.pos.z); van.reset(a.x, a.z, a.h); }
    if (e.code === 'KeyM') hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('pointerdown', () => audio.start());

  function nearestRoadPoint(x, z) {
    const a = AVENUES.reduce((b, c) => Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b);
    return { x: a.x + 1.9, z: THREE.MathUtils.clamp(z, Z_NORTH + 12, Z_SOUTH - 12), h: -Math.PI / 2 };
  }

  // nearest live target and where a parcel thrown right now would land
  const aim = { target: null, side: 1, L: 7, land: new THREE.Vector3(), ok: 0 };
  function computeAim() {
    const fx = Math.cos(van.heading), fz = Math.sin(van.heading), rx = -fz, rz = fx;
    let bestT = null, bd = RANGE * RANGE;
    for (const t of targets) { if (t.done || t.kind === 'pickup') continue; const d = (t.x - van.pos.x) ** 2 + (t.z - van.pos.z) ** 2; if (d < bd) { bd = d; bestT = t; } }
    aim.target = bestT;
    if (bestT) {
      const lat = (bestT.x + bestT.vx * THROW_T - van.pos.x) * rx + (bestT.z + bestT.vz * THROW_T - van.pos.z) * rz;
      aim.side = lat >= 0 ? 1 : -1; aim.L = THREE.MathUtils.clamp(Math.abs(lat), 3.2, 17);
    } else { aim.side = 1; aim.L = 7; }
    aim.land.set(van.pos.x + rx * aim.side * aim.L + van.vel.x * THROW_T, 0, van.pos.z + rz * aim.side * aim.L + van.vel.y * THROW_T);
    aim.land.y = bestT && bestT.kind === 'tram' ? TRAM_ROOF : bestT && bestT.kind === 'boat' ? DOCK_Y : groundHeight(aim.land.x, aim.land.z);
    aim.ok = bestT ? missOf(bestT, aim.land.x, aim.land.z, THROW_T) : 99;
  }

  function throwParcel() {
    if (S.throwCd > 0) return;
    S.throwCd = 0.32;
    computeAim();
    const fx = Math.cos(van.heading), fz = Math.sin(van.heading), rx = -fz, rz = fx;
    const p = parcels[parcelNext]; parcelNext = (parcelNext + 1) % parcels.length;
    const y0 = 1.75;
    p.m.position.set(van.pos.x + rx * aim.side * 1.15 - fx * 0.4, van.y + y0, van.pos.z + rz * aim.side * 1.15 - fz * 0.4);
    const hs = (aim.L - 1.15) / THROW_T;
    p.vel.set(rx * aim.side * hs + van.vel.x, (0.5 * GRAV * THROW_T * THROW_T - (y0 - aim.land.y + van.y * 0)) / THROW_T, rz * aim.side * hs + van.vel.y);
    p.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    p.active = true; p.landed = false; p.rest = 0; p.m.visible = true; p.speedAtThrow = van.speed;
    audio.play('throw');
  }

  function land(p) {
    p.landed = true;
    const px = p.m.position.x, pz = p.m.position.z;
    if (pz < LAKE_Z - 0.6 && !onDock(px, pz)) {       // into the lake
      for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28; emit(px, -0.4, pz, Math.cos(a) * 2.5, 3 + Math.random() * 4, Math.sin(a) * 2.5, 0.6, 0.2, 0.5, 0.7, 0.9, 12, 1); }
      p.active = false; p.m.visible = false;
    }
    let hit = null, hd = 1e9;
    for (const t of targets) { if (t.done || t.kind === 'pickup') continue; const d = missOf(t, px, pz, 0); if (d < hd) { hd = d; hit = t; } }
    const sp = project(px, p.m.position.y + 1.2, pz);
    if (hit && hd < 3.4) {
      const perfect = hd < 1.3, K = KINDS[hit.kind];
      hit.done = true; hit.fade = 1;
      S.streak = (S.elapsed - S.lastDelivery < 16) ? S.streak + 1 : 1;
      S.lastDelivery = S.elapsed; S.bestCombo = Math.max(S.bestCombo, S.streak);
      const mph = p.speedAtThrow * 2.237;
      let base = K.base + Math.min(140, mph * 2.2), note = perfect ? 'Perfect drop' : 'Delivered', bonus = 6;
      if (hit.kind === 'rush') { base *= 3; bonus = 10; note = 'Rush delivered · triple pay'; }
      if (hit.kind === 'tram') { p.ride = true; note = 'Landed on the streetcar'; }
      if (hit.kind === 'boat') note = 'Dock drop';
      if (hit.kind === 'grocery') {
        if (mph > 20) { S.cargo.cond = Math.max(5, S.cargo.cond - 40); hud.pop(sp.x, sp.y - 34, 'THROWN TOO HARD', 'miss'); }
        base = K.base * S.cargo.cond / 100; note = `Groceries ${Math.round(S.cargo.cond)}% intact`;
        S.cargo = null; hud.setCargo(null);
      }
      const pts = Math.round(base * (perfect ? 2 : 1) * (1 + 0.5 * (S.streak - 1)) / 5) * 5;
      S.score += pts; S.delivered++; S.time += bonus; if (perfect) S.perfect++;
      hud.pop(sp.x, sp.y, `${perfect ? 'PERFECT ' : ''}+${pts}`, perfect ? 'perfect' : '');
      hud.setScore(S.score, S.streak); hud.bumpScore();
      hud.toast(hit.name, `${note} · +${bonus} s`);
      audio.play(perfect ? 'perfect' : 'good');
      for (let i = 0; i < 46; i++) { const a = Math.random() * 6.28, v = 3 + Math.random() * 7; emit(hit.x, hit.y + 0.3, hit.z, Math.cos(a) * v, 4 + Math.random() * 9, Math.sin(a) * v, 0.7 + Math.random() * 0.6, 0.22, hit.col.r * 1.2, hit.col.g * 1.2, hit.col.b * 1.2, 12, 1.2); }
      resolve();
    } else {
      audio.play('thud');
      if (hit && hd < 9) { hud.pop(sp.x, sp.y, 'MISSED', 'miss'); S.streak = 0; hud.setScore(S.score, 0); }
    }
  }

  const v3 = new THREE.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight, behind: v3.z > 1 };
  }

  function streetName() {
    const { x, z } = van.pos;
    if (z < Z_NORTH) return z < LAKE_Z + 30 ? 'Lake Union Waterfront' : 'Lake Union Park';
    const a = AVENUES.find(a => Math.abs(x - a.x) < a.hw + 1), s = STREETS.find(s => Math.abs(z - s.z) < s.hw + 1);
    if (a && s) return `${a.name} & ${s.name}`;
    if (a) return a.name; if (s) return s.name;
    const na = AVENUES.reduce((b, c) => Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b);
    return `${na.name} sidewalk`;
  }

  // ---------------------------------------------------------------- camera
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookSm = new THREE.Vector3();
  const prevCam = new THREE.Vector3(), camVel = new THREE.Vector3();
  function chaseCamera(dt, snap) {
    const sp = van.speed;
    S.camHeading = angleLerp(S.camHeading, van.heading, Math.min(1, dt * (2.6 + sp * 0.06)));
    const dist = 8.4 + sp * 0.085, height = 3.5 + sp * 0.03;
    camPos.set(van.pos.x - Math.cos(S.camHeading) * dist, van.y + height, van.pos.z - Math.sin(S.camHeading) * dist);
    // keep the camera out of buildings
    for (const b of world.colliders) {
      if (b.low || b.moving) continue;
      if (camPos.x > b.x0 - 0.8 && camPos.x < b.x1 + 0.8 && camPos.z > b.z0 - 0.8 && camPos.z < b.z1 + 0.8) {
        const l = camPos.x - (b.x0 - 0.8), r = (b.x1 + 0.8) - camPos.x, t = camPos.z - (b.z0 - 0.8), bt = (b.z1 + 0.8) - camPos.z, m = Math.min(l, r, t, bt);
        if (m === l) camPos.x = b.x0 - 0.8; else if (m === r) camPos.x = b.x1 + 0.8; else if (m === t) camPos.z = b.z0 - 0.8; else camPos.z = b.z1 + 0.8;
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 9);
    camera.position.lerp(camPos, k);
    camLook.set(van.pos.x + Math.cos(van.heading) * (4.5 + sp * 0.12), van.y + 1.7, van.pos.z + Math.sin(van.heading) * (4.5 + sp * 0.12));
    lookSm.lerp(camLook, snap ? 1 : 1 - Math.exp(-dt * 10));
    const sh = S.shake;
    camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh * 0.6;
    camera.lookAt(lookSm);
    const fov = 58 + 17 * THREE.MathUtils.smoothstep(sp, 6, 40) + (van.boost > 0 ? 5 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  function titleCamera(dt) {
    S.titleT += dt;
    const a = -0.9 + Math.sin(S.titleT * 0.11) * 0.55;
    camera.position.set(van.pos.x + Math.cos(a) * 7.6 + 1.6, 1.5 + Math.sin(S.titleT * 0.17) * 0.3, van.pos.z + Math.sin(a) * 7.6 - 1.5);
    lookSm.set(van.pos.x + 2.4, 1.7, van.pos.z - 1.5);
    camera.lookAt(lookSm);
    camera.fov = 40; camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- frame update
  const headWorld = new THREE.Vector3(), tmp = new THREE.Vector3();
  let frameN = 0;
  hud.showTitle(startShift);
  hud.setClock(SHIFT_TIME, []);
  van.reset(1.9, 238, -Math.PI / 2); van.sync();
  if (params.get('autostart')) startShift();

  app.update = (dt) => {
    frameN++;
    app.updateWorld(dt);
    const playing = S.mode === 'play';

    input.throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    input.steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    input.drift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (app.autoDrive) Object.assign(input, app.autoDrive);
    if (!playing) { input.throttle = 0; input.steer = 0; input.drift = false; }
    van.update(dt, input);

    const fxv = Math.cos(van.heading), fzv = Math.sin(van.heading);
    for (const e of world.traffic.update(dt, van)) {
      const dc = Math.hypot(e.car.x - van.pos.x, e.car.z - van.pos.z);
      if (e.type === 'honk' && playing && dc < 40) audio.play('horn', Math.max(0.3, 1 - dc / 40));
      if (e.type === 'nearmiss' && playing) {
        const pts = e.min < 3.2 ? 100 : 60;
        S.score += pts; S.nearMisses = (S.nearMisses || 0) + 1;
        const sp = project(van.pos.x, 3.2, van.pos.z);
        hud.pop(sp.x, sp.y, `NEAR MISS +${pts}`, 'near'); hud.setScore(S.score, S.streak); audio.play('near');
      }
    }
    for (const e of world.peds.update(dt, van, app.time)) {
      if (e.type === 'scare' && playing) {
        audio.play('yelp');
        S.score = Math.max(0, S.score - 50); S.streak = 0; hud.setScore(S.score, 0);
        const sp = project(e.x, 2.6, e.z);
        hud.pop(sp.x, sp.y, 'WATCH IT!  −50', 'miss');
      }
    }
    for (const e of van.events) {
      if (e.type === 'crash') {
        const hitCar = world.traffic.bump(van.pos.x + fxv * 2, van.pos.z + fzv * 2);
        if (hitCar && playing) audio.play('horn', 1);
        audio.play('crash', e.force); S.shake = Math.min(0.7, 0.12 + e.force * 0.03);
        const fx = Math.cos(van.heading), fz = Math.sin(van.heading);
        for (let i = 0; i < 16; i++) emit(van.pos.x + fx * 2.6, 0.8, van.pos.z + fz * 2.6, (Math.random() - 0.5) * 10, 2 + Math.random() * 5, (Math.random() - 0.5) * 10, 0.35 + Math.random() * 0.3, 0.12, 3.0, 1.6, 0.4, 14, 1);
        if (playing && S.streak > 1) { S.streak = 0; hud.setScore(S.score, 0); hud.toast('Streak lost', 'Mind the paintwork'); }
      }
    }
    van.events.length = 0;
    S.shake = Math.max(0, S.shake - dt * 1.6) + (van.boost > 0 ? 0.02 : 0);

    // tyre spray and drift mist
    if (van.speed > 7) {
      const fx = Math.cos(van.heading), fz = Math.sin(van.heading), rx = -fz, rz = fx;
      const n = van.drifting ? 4 : (van.speed > 14 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const k = van.drifting ? 1.6 : 1;
        emit(van.pos.x - fx * 2.0 + rx * s * 0.9, 0.25, van.pos.z - fz * 2.0 + rz * s * 0.9,
          van.vel.x * 0.35 + (Math.random() - 0.5) * 2 * k + rx * s * 1.2, 1.2 + Math.random() * 1.8 * k, van.vel.y * 0.35 + (Math.random() - 0.5) * 2 * k + rz * s * 1.2,
          0.45 + Math.random() * 0.35, 0.42 * k, 0.014 * k, 0.019 * k, 0.026 * k, 2.5, 1.6, 2.6);
      }
    }
    updateParticles(dt);

    if (playing) {
      S.elapsed += dt; S.time -= dt; S.throwCd -= dt;
      S.topSpeed = Math.max(S.topSpeed, van.speed * 2.237);
      if (S.time <= 10 && Math.floor(S.time) !== Math.floor(S.time + dt)) audio.play('tick');
      if (S.time <= 0) endShift(false);
      if (S.streak > 0 && S.elapsed - S.lastDelivery > 16) { S.streak = 0; hud.setScore(S.score, 0); }

      for (const p of POIS) {
        if (S.seen.has(p.name)) continue;
        if (Math.hypot(van.pos.x - p.x, van.pos.z - p.z) < p.r) { S.seen.add(p.name); S.score += 150; hud.toast(p.name, `${p.sub} · +150`, 'place'); hud.setScore(S.score, S.streak); audio.play('place'); }
      }
      for (const p of pickups) {
        if (!p.active) { p.respawn -= dt; if (p.respawn <= 0) { p.active = true; p.g.visible = true; } continue; }
        if (Math.hypot(van.pos.x - p.x, van.pos.z - p.z) < 2.6) {
          p.active = false; p.g.visible = false; p.respawn = 20;
          van.boost = 3.6; S.score += 50; hud.setScore(S.score, S.streak); hud.toast('Coffee!', 'Turbo engaged'); audio.play('boost');
          for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28; emit(p.x, 1.2, p.z, Math.cos(a) * 5, 2 + Math.random() * 5, Math.sin(a) * 5, 0.6, 0.2, 3.0, 1.4, 0.3, 8, 1.5); }
        }
      }
      const tram = world.streetcar.state;
      S.bellCd -= dt;
      if (S.bellCd <= 0 && Math.hypot(van.pos.x - tram.x, van.pos.z - tram.z) < 26 && tram.v > 1) { audio.play('bell'); S.bellCd = 7; }
    }
    for (const p of pickups) { p.g.rotation.y += dt * 1.6; p.g.position.y = 1.0 + Math.sin(app.time * 2.2 + p.x) * 0.16; }

    // jobs that change over time: the grocery pick-up, the rush order, the moving streetcar
    if (playing) {
      const tr = world.streetcar.state;
      if (!S.rush && S.elapsed > S.rushAt) spawnRush();
      for (const t of targets) {
        if (t.done) continue;
        if (t.kind === 'tram') { t.x = tr.x; t.z = tr.z; t.vz = tr.dir * tr.v; t.g.position.set(t.x, TRAM_ROOF, t.z); }
        if (t.kind === 'pickup' && Math.hypot(van.pos.x - t.x, van.pos.z - t.z) < 4.6) {
          const d = doorOf(t.dest); t.x = d.x; t.z = d.z; t.y = CURB; t.name = t.dest.name; t.g.position.set(t.x, CURB, t.z);
          setKind(t, 'grocery'); S.cargo = { cond: 100 }; hud.setCargo(100);
          hud.toast('Groceries loaded', `For ${t.name} · drive gently, hand over below 20 mph`, 'place'); audio.play('place');
        }
        if (t.expire !== undefined) {
          t.expire -= dt;
          if (t.expire <= 0) { t.done = true; t.failed = true; t.fade = 1; S.streak = 0; hud.setScore(S.score, 0); hud.toast('Rush order expired', t.name, 'rush'); audio.play('miss'); resolve(); }
        }
      }
      if (S.cargo) {
        const g = Math.abs(van.yawRate * (van.vf || 0));
        if (g > 8.5) S.cargo.cond = Math.max(5, S.cargo.cond - (g - 8.5) * dt * 2.4);
        if (van.impact > 0.9 * (S.cargo.lastImpact ?? 9) + 0.15) S.cargo.cond = Math.max(5, S.cargo.cond - van.impact * 30);
        S.cargo.lastImpact = van.impact;
        hud.setCargo(S.cargo.cond);
      }
    }

    // parcels in flight
    for (const p of parcels) {
      if (!p.active) continue;
      if (p.ride) { const tr = world.streetcar.state; p.m.position.z += tr.dir * tr.v * dt; p.rest += dt; if (p.rest > 12) { p.active = false; p.m.visible = false; p.ride = false; } continue; }
      if (!p.landed || p.vel.lengthSq() > 0.05) {
        p.vel.y -= GRAV * dt;
        p.m.position.addScaledVector(p.vel, dt);
        p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
        const gy = surfaceY(p.m.position.x, p.m.position.z) + 0.24;
        if (p.m.position.y < gy && p.vel.y < 0) {
          p.m.position.y = gy;
          if (!p.landed) land(p);
          if (p.ride) { p.vel.set(0, 0, 0); p.m.rotation.x = 0; p.m.rotation.z = 0; p.rest = 0; continue; }
          p.vel.y = Math.abs(p.vel.y) > 2 ? -p.vel.y * 0.28 : 0; p.vel.x *= 0.35; p.vel.z *= 0.35; p.spin.multiplyScalar(0.3);
          if (p.vel.y === 0) { p.vel.set(0, 0, 0); p.m.rotation.x = 0; p.m.rotation.z = 0; }
        }
      } else { p.rest += dt; if (p.rest > 9) { p.active = false; p.m.visible = false; } }
    }

    // targets: pulse, fade out when delivered
    computeAim();
    for (const t of targets) {
      t.bm.uniforms.uTime.value = app.time;
      if (t.done) {
        t.fade -= dt * 1.8;
        const f = Math.max(0, t.fade);
        t.g.scale.setScalar(1 + (1 - f) * 1.6); t.bm.uniforms.uK.value = f; t.ring.material.color.copy(t.col).multiplyScalar(f * 2); t.disc.material.color.copy(t.col).multiplyScalar(0.11 * f); t.icon.visible = false;
        if (f <= 0) t.g.visible = false;
        continue;
      }
      const pulse = 0.75 + 0.25 * Math.sin(app.time * 4 + t.x);
      t.ring.material.color.copy(t.col).multiplyScalar(pulse); t.disc.material.color.copy(t.col).multiplyScalar(0.11);
      t.ring.scale.setScalar(1 + 0.04 * Math.sin(app.time * 4 + t.x));
      t.icon.rotation.y += dt * 1.4; t.icon.rotation.x = 0.5; t.icon.position.y = 3.4 + Math.sin(app.time * 2 + t.z) * 0.25;
    }
    const showRet = playing && aim.target;
    if (aim.target && aim.target.kind === 'grocery') { /* gentle hand-over: the marker warns when too fast */ }
    reticle.visible = !!showRet;
    if (showRet) {
      reticle.position.set(aim.land.x, aim.land.y + 0.05, aim.land.z);
      reticle.rotation.y += dt * 1.5;
      const good = aim.ok < 3.3, perf = aim.ok < 1.3;
      retMat.color.setRGB(perf ? 3.2 : good ? 0.6 : 2.2, perf ? 2.6 : good ? 3.0 : 2.2, perf ? 0.6 : good ? 1.0 : 2.2);
      reticle.scale.setScalar(perf ? 1.25 : 1);
    }

    // ground glow slots: nearest live targets
    const gl = ground.uniforms.uGlow.value, gc = ground.uniforms.uGlowCol.value;
    const live = targets.filter(t => !t.done).sort((a, b) => ((a.x - van.pos.x) ** 2 + (a.z - van.pos.z) ** 2) - ((b.x - van.pos.x) ** 2 + (b.z - van.pos.z) ** 2));
    for (let i = 0; i < 8; i++) {
      const t = live[i];
      if (t && t.kind !== 'tram' && t.kind !== 'boat') { gl[i].set(t.x, 0.4, t.z, 6.5); const k = 0.72 * (1.1 + 0.4 * Math.sin(app.time * 4 + t.x)); gc[i].setRGB(t.col.r * k, t.col.g * k, t.col.b * k); }
      else { gl[i].set(0, -100, 0, 1); gc[i].setRGB(0, 0, 0); }
    }

    // camera
    prevCam.copy(camera.position);
    if (app.freeCam) { /* debug camera fixed by URL */ }
    else if (S.mode === 'title') titleCamera(dt);
    else chaseCamera(dt, false);
    camVel.subVectors(camera.position, prevCam).divideScalar(Math.max(dt, 1e-3));
    if (camVel.length() > 80) camVel.set(0, 0, 0);

    // headlights for the road shader, rain and the lamp-light pool
    const hp = ground.uniforms.uHeadPos.value, hd = ground.uniforms.uHeadDir.value;
    const fx = Math.cos(van.heading), fz = Math.sin(van.heading), rx = -fz, rz = fx;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      hp[i].set(van.pos.x + fx * 2.9 + rx * s * 0.76, van.y + 0.95, van.pos.z + fz * 2.9 + rz * s * 0.76, 2.6);
      tmp.set(fx, -0.075, fz).normalize(); hd[i].set(tmp.x, tmp.y, tmp.z, 0);
    }
    hp[2].set(van.pos.x - fx * 2.9, van.y + 1.3, van.pos.z - fz * 2.9, van.braking ? 1.7 : 0.55);
    tmp.set(-fx, -0.16, -fz).normalize(); hd[2].set(tmp.x, tmp.y, tmp.z, 1);
    const tr = world.streetcar.state, td = tr.dir;
    hp[3].set(tr.x, 1.2, tr.z + td * 10, 2.2); tmp.set(0, -0.08, td).normalize(); hd[3].set(tmp.x, tmp.y, tmp.z, 0);
    hp[4].set(tr.x, 1.2, tr.z - td * 10, 0.7); tmp.set(0, -0.16, -td).normalize(); hd[4].set(tmp.x, tmp.y, tmp.z, 1);
    // headlight pools for the traffic nearest the camera
    const near = world.traffic.cars.map(c => [(c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2, c]).sort((a, b) => a[0] - b[0]);
    for (let i = 5; i < 12; i++) {
      const c = near[i - 5] && near[i - 5][1];
      if (c) { const cx = Math.cos(c.h), cz = Math.sin(c.h); hp[i].set(c.x + cx * 2.3, 0.75, c.z + cz * 2.3, 1.5); tmp.set(cx, -0.09, cz).normalize(); hd[i].set(tmp.x, tmp.y, tmp.z, 0); }
      else hp[i].set(0, -100, 0, 0);
    }

    const ru = world.rain.uniforms;
    camera.getWorldDirection(tmp);
    ru.uCenter.value.copy(camera.position).addScaledVector(tmp, 15);
    ru.uCamVel.value.copy(camVel);
    headWorld.set(van.pos.x + fx * 2.9, van.y + 0.95, van.pos.z + fz * 2.9);
    ru.uHeadPos.value.copy(headWorld); ru.uHeadDir.value.set(fx, -0.03, fz).normalize();
    pUni.uScale.value = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.5;
    world.updateLampPool(van.pos);
    updateCube();

    // HUD
    if (playing) {
      const chips = targets.map(t => ({ css: t.css, state: t.failed ? 'fail' : t.done ? 'done' : 'todo' }));
      if (!S.rush) chips.push({ css: KINDS.rush.css, state: 'pending' });
      hud.setClock(S.time, chips);
      hud.setSpeed(van.speed * 2.237, Math.max(0, van.boost) / 3.6);
      if (frameN % 6 === 0) hud.setStreet(streetName());
      if (frameN % 2 === 0) hud.drawMap(van, targets, pickups, world.streetcar.state, world.traffic.cars);
      const W = innerWidth, H = innerHeight, m = 46;
      const dv = (t) => (t.x - van.pos.x) ** 2 + (t.z - van.pos.z) ** 2;
      hud.setPins(targets.filter(t => !t.done).sort((a, b) => dv(a) - dv(b)).slice(0, 3).map(t => {
        const p = project(t.x, t.y + 6.5, t.z);
        let x = p.x, y = p.y;
        if (p.behind) { x = W - x; y = H + 200; }
        const edge = x < m || x > W - m || y < m + 60 || y > H - m - 110 || p.behind;
        const cx = Math.max(m, Math.min(W - m, x)), cy = Math.max(m + 60, Math.min(H - m - 110, y));
        const dist = Math.hypot(t.x - van.pos.x, t.z - van.pos.z);
        const label = `${t.tag ? t.tag + ' · ' : ''}${t.expire !== undefined ? Math.ceil(t.expire) + ' s · ' : ''}${Math.round(dist)} m`;
        return { x: cx, y: cy, edge, near: dist < 22 && !edge && !t.tag, dist, css: t.css, label, angle: edge ? Math.atan2(y - cy, x - cx) - Math.PI / 2 : 0 };
      }));
    }
    audio.update({ speed: van.speed, throttle: input.throttle, slip: van.slip, boost: van.boost > 0, active: playing });
  };

  app.game = { van, state: S, input, startShift, throwParcel, targets, aim, cubeRT };
}

let _halo = null;
function haloTex() {
  if (_halo) return _halo;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(c); return _halo;
}
