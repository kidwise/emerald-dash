import * as THREE from 'three';
import { Van, groundHeight } from './van.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { CURB, heightAt, routeBetween, district, DISTRICT_LABEL } from '../config.js';

const SHIFT_TIME = 120, MAX_JOBS = 4, THROW_T = 0.8, GRAV = 18, RANGE = 36;
// job types: colour, HUD colour and tag
const KINDS = {
  parcel: { col: [0.25, 2.0, 2.4], css: '#55f0ff', tag: '', base: 100 },
  rush: { col: [2.8, 0.30, 0.95], css: '#ff5a9a', tag: 'RUSH', base: 100 },
  pickup: { col: [2.6, 1.5, 0.2], css: '#ffc247', tag: 'PICK UP', base: 0 },
  grocery: { col: [0.5, 2.4, 0.55], css: '#6dff8f', tag: 'GROCERIES', base: 320 },
  tram: { col: [1.7, 0.7, 2.8], css: '#c77dff', tag: 'STREETCAR', base: 350 },
  boat: { col: [0.6, 1.3, 2.9], css: '#7fb6ff', tag: 'DOCK', base: 300 },
  race: { col: [2.8, 2.2, 0.5], css: '#ffe066', tag: 'RACE THE MONORAIL', base: 0 },
};
const TRAM_ROOF = 3.55;

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
      cubeCam.position.set(van.pos.x, van.y + 1.7, van.pos.z);
      cubeCam.update(renderer, scene);
      cubeReady = true;
      for (const k of ['paint', 'glass', 'chrome', 'trim']) { van.model.mats[k].envMap = cubeRT.texture; van.model.mats[k].needsUpdate = true; }
      cubeRT.texture.needsPMREMUpdate = true;
    } else {
      if (cubeFace === 0) { cubeCam.position.set(van.pos.x, van.y + 1.7, van.pos.z); cubeCam.updateMatrixWorld(); }
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
      const fl = heightAt(p.x, p.z) + 0.02;
      if (p.y < fl) { p.y = fl; p.vy *= -0.3; }
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
  const doorOf = (lot) => lot.door;
  const doorY = (d) => heightAt(d.x, d.z) + CURB;
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
    if (t.kind === 'tram') { const ax = Math.cos(t.h || Math.PI / 2), az = Math.sin(t.h || Math.PI / 2), dx = x - px, dz = z - pz; return Math.max(Math.abs(-dx * az + dz * ax) * 2.0, Math.abs(dx * ax + dz * az) * 0.33); }
    return Math.hypot(x - px, z - pz);
  };
  const tramRoof = () => { const tr = world.streetcar.state; return heightAt(tr.x, tr.z) + TRAM_ROOF + 0.12; };
  // how far it is to drive from a to b along the streets
  const routeLen = (ax, az, bx, bz) => { const p = routeBetween(ax, az, bx, bz); let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return d; };
  const surfaceY = (x, z) => {
    const tr = world.streetcar.state, ax = Math.cos(tr.h ?? Math.PI / 2), az = Math.sin(tr.h ?? Math.PI / 2), dx = x - tr.x, dz = z - tr.z;
    if (Math.abs(-dx * az + dz * ax) < 1.5 && Math.abs(dx * ax + dz * az) < 9.9) return tramRoof();
    if (world.dock && Math.hypot(x - world.dock.x, z - world.dock.z) < 3.7) return world.dock.y;
    return world.inWater(x, z) ? world.waterLevel(x, z) - 0.1 : groundHeight(x, z);
  };
  const clearTargets = () => { for (const t of targets) scene.remove(t.g); targets.length = 0; };

  // landing marker
  const reticle = new THREE.Group();
  const retMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.78, 0.98, 40).rotateX(-Math.PI / 2), retMat), new THREE.Mesh(new THREE.CircleGeometry(0.16, 16).rotateX(-Math.PI / 2), retMat));
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.09).rotateX(-Math.PI / 2), retMat); m.rotation.y = i * Math.PI / 2; m.position.set(Math.cos(i * Math.PI / 2) * 1.3, 0, -Math.sin(i * Math.PI / 2) * 1.3); reticle.add(m); }
  reticle.traverse(o => o.layers.set(1)); reticle.visible = false;
  scene.add(reticle);

  // ---------------------------------------------------------------- route line to the selected job
  const RMAX = 700;
  const rGeo = new THREE.BufferGeometry();
  const rPos = new Float32Array(RMAX * 6), rDist = new Float32Array(RMAX * 2), rIdx = [];
  for (let i = 0; i < RMAX - 1; i++) { const a = i * 2; rIdx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3)); rGeo.setAttribute('aDist', new THREE.BufferAttribute(rDist, 1)); rGeo.setIndex(rIdx);
  const rUni = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 1.4, 1.7) } };
  const route = new THREE.Mesh(rGeo, new THREE.ShaderMaterial({
    uniforms: rUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`attribute float aDist; varying float vD; varying float vS; void main(){ vD = aDist; vS = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uColor; varying float vD;
      void main(){ float chev = smoothstep(0.35, 0.5, fract(vD / 5.0 - uTime * 1.2)) * smoothstep(1.0, 0.85, fract(vD / 5.0 - uTime * 1.2)); float fade = smoothstep(4.0, 12.0, vD) * (1.0 - smoothstep(170.0, 260.0, vD)); gl_FragColor = vec4(uColor * (0.10 + 0.5 * chev) * fade, 1.0); }`,
  }));
  route.frustumCulled = false; route.layers.set(1); route.visible = false;
  scene.add(route);
  const AMBER = new THREE.Color(2.4, 1.5, 0.3);
  const landmarks = () => [...POIS, ...STOPS].map(q => ({ x: q.x, z: q.z, name: q.name, found: album.has(q.name) }));
  const nearestLandmark = () => {
    let best = null, bd = 1e9;
    for (const q of landmarks()) { if (q.found) continue; const d = Math.hypot(q.x - van.pos.x, q.z - van.pos.z); if (d < bd) { bd = d; best = q; } }
    return best && { x: best.x, z: best.z, y: heightAt(best.x, best.z), name: best.name, col: AMBER, css: '#ffc247', tag: `★ ${best.name}`, landmark: true };
  };
  let routeT = 0;
  const nav = { target: null, pts: [] };
  const updateRoute = () => {
    const live = targets.filter(t => !t.done).sort((a, b) => Math.hypot(a.x - van.pos.x, a.z - van.pos.z) - Math.hypot(b.x - van.pos.x, b.z - van.pos.z));
    const carrying = live.find(t => t.kind === 'grocery');
    // in explore mode the nearest landmark you have not found yet leads the list
    const lm = S.explore ? nearestLandmark() : null;
    const list = lm ? [lm, ...live] : live;
    if (S.race) { nav.target = raceMarks[S.race.to]; } else
    nav.target = carrying || list[(S.navSkip || 0) % Math.max(1, list.length)] || null;
    route.visible = !!nav.target && S.mode === 'play';
    if (!nav.target) { nav.pts = []; return; }
    const corners = routeBetween(van.pos.x, van.pos.z, nav.target.x, nav.target.z);
    nav.pts = corners;
    rUni.uColor.value.copy(nav.target.col).multiplyScalar(0.7);
    let n = 0, dist = 0;
    for (let i = 1; i < corners.length && n < RMAX; i++) {
      const [ax, az] = corners[i - 1], [bx, bz] = corners[i];
      const len = Math.hypot(bx - ax, bz - az); if (len < 0.01) continue;
      const nx = -(bz - az) / len * 0.55, nz = (bx - ax) / len * 0.55;
      const steps = Math.max(1, Math.ceil(len / 4));
      for (let k = (i === 1 ? 0 : 1); k <= steps && n < RMAX; k++) {
        const t = k / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = groundHeight(x, z) + 0.07;
        rPos.set([x - nx, y, z - nz, x + nx, y, z + nz], n * 6); rDist[n * 2] = rDist[n * 2 + 1] = dist + len * t; n++;
      }
      dist += len;
    }
    rGeo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    rGeo.attributes.position.needsUpdate = true; rGeo.attributes.aDist.needsUpdate = true;
  };

  // ---------------------------------------------------------------- racing the monorail between its two ends
  const rail = world.monorail;
  const raceMarks = rail ? rail.gates.map((q) => { const t = makeTarget('race', q.x, q.z, heightAt(q.x, q.z) + 0.12, 'Monorail race'); t.g.scale.setScalar(1.5); return t; }) : [];
  function updateRace(dt) {
    if (!rail) return;
    const st = rail.state, R = S.race;
    S.raceCd = Math.max(0, (S.raceCd || 0) - dt);
    raceMarks.forEach((m, i) => {
      m.g.visible = R ? i === R.to : S.raceCd <= 0;
      m.bm.uniforms.uTime.value = app.time; m.icon.rotation.y += dt * 2;
      const pulse = 0.75 + 0.25 * Math.sin(app.time * 5 + i); m.ring.material.color.copy(m.col).multiplyScalar(pulse); m.disc.material.color.copy(m.col).multiplyScalar(0.12);
    });
    if (!R) {
      if (S.raceCd > 0 || S.cargo || S.toss) return;
      const i = raceMarks.findIndex(m => Math.hypot(m.x - van.pos.x, m.z - van.pos.z) < 5.5);
      if (i < 0) return;
      // the train comes to this end, waits for the count, then leaves at racing speed
      st.s = i === 0 ? 20 : rail.total - 20; st.dir = i === 0 ? 1 : -1; st.v = 0; st.wait = 3; st.max = 19;
      S.race = { to: 1 - i, t: 0, info: 0, route: routeLen(van.pos.x, van.pos.z, raceMarks[1 - i].x, raceMarks[1 - i].z) };
      hud.banner('Race the monorail'); hud.toast('First to the other end of the line', 'The train leaves in 3 seconds', 'rush'); audio.play('bell');
      return;
    }
    R.t += dt; R.info -= dt;
    const fin = raceMarks[R.to], trainLeft = st.dir > 0 ? rail.total - 20 - st.s : st.s - 20, arrived = R.t > 4 && (trainLeft < 1 || st.wait > 0);
    if (R.info <= 0) { R.info = 0.4; R.route = routeLen(van.pos.x, van.pos.z, fin.x, fin.z); hud.prompt(`YOU ${Math.round(R.route)} m  ·  TRAIN ${Math.max(0, Math.round(trainLeft))} m`, true); }
    const won = Math.hypot(fin.x - van.pos.x, fin.z - van.pos.z) < 9;
    if (won || arrived || R.t > 240) {
      S.race = null; S.raceCd = 25; st.max = 15; hud.prompt(null);
      const sp = project(van.pos.x, van.y + 3.4, van.pos.z);
      if (won) { const pts = 1500 + Math.min(600, Math.round(Math.max(0, trainLeft) / 5) * 5); S.score += pts; if (!S.explore) S.time = Math.min(240, S.time + 30); hud.pop(sp.x, sp.y, `BEAT THE TRAIN +${pts}`, 'perfect'); hud.setScore(S.score, S.streak); hud.toast('You beat the monorail', `${R.t.toFixed(0)} s · +30 s`, 'place'); audio.play('win'); S.racesWon = (S.racesWon || 0) + 1; }
      else { hud.toast('The monorail won', 'Drive back to a gold ring to try again', 'rush'); audio.play('lose'); }
    }
  }

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
  const pickups = world.coffeeSpots.map(([x, z]) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cupGeo, cupMat), new THREE.Mesh(sleeveGeo, sleeveMat));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(1.6, 0.8, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: haloTex() }));
    halo.scale.setScalar(3.2); halo.position.y = 0.4; g.add(halo);
    g.scale.setScalar(1.7); g.position.set(x, heightAt(x, z) + 1.0, z);
    scene.add(g);
    return { x, z, y: heightAt(x, z), g, active: true, respawn: 0 };
  });

  // ---------------------------------------------------------------- state
  const input = { throttle: 0, steer: 0, drift: false };
  const keys = new Set();
  const S = { explore: false, district: 'slu', spawnCd: 0, mode: 'title', time: SHIFT_TIME, score: 0, streak: 0, lastDelivery: -99, delivered: 0, perfect: 0, bestCombo: 0, topSpeed: 0, throwCd: 0, camHeading: van.heading, shake: 0, titleT: 0, seen: new Set(), bellCd: 0, elapsed: 0 };
  let best = 0;
  try { best = Number(localStorage.getItem('emerald-dash-best') || 0); } catch { /* storage unavailable */ }

  // ---------------------------------------------------------------- dispatch: one continuous city, jobs appear near the van
  const POIS = world.pois, SOURCES = world.sources, STOPS = world.stops, START = world.start;
  const PLACES = POIS.length + STOPS.length;
  const inSlow = world.inSlow;
  const allLots = () => world.buildings.lots.filter(l => l.name && l.door);
  const busy = (l) => targets.some(t => !t.done && (t.name === l.name || t.dest === l));
  const pickLot = (cx, cz, dMin, dMax) => {
    const d = (l) => Math.hypot(l.door.x - cx, l.door.z - cz);
    const free = allLots().filter(l => !busy(l));
    const inRange = free.filter(l => { const k = d(l); return k > dMin && k < dMax; });
    if (inRange.length) return inRange[Math.floor(Math.random() * inRange.length)];
    return free.filter(l => d(l) > dMin).sort((p, q) => d(p) - d(q))[0];
  };
  const spawnJob = (force) => {
    const vx = van.pos.x, vz = van.pos.z, tr = world.streetcar.state;
    const live = targets.filter(t => !t.done);
    let kind = force;
    if (!kind) {
      const r = Math.random();
      const hasPick = !!S.cargo || live.some(t => t.kind === 'pickup' || t.kind === 'grocery');
      const tramOk = Math.hypot(tr.x - vx, tr.z - vz) < 230 && !live.some(t => t.kind === 'tram');
      const dockAt = world.dock && world.dock.stand;
      const lakeOk = dockAt && Math.hypot(vx - dockAt.x, vz - dockAt.z) < 480 && !live.some(t => t.kind === 'boat');
      kind = r < 0.15 && !hasPick && S.delivered >= 1 && SOURCES.length ? 'pickup' : r < 0.30 && !live.some(t => t.kind === 'rush') && S.delivered >= 1 ? 'rush' : r < 0.40 && tramOk ? 'tram' : r < 0.48 && lakeOk ? 'boat' : 'parcel';
    }
    let t;
    if (kind === 'tram') { t = makeTarget('tram', tr.x, tr.z, tramRoof(), 'Streetcar roof'); t.far = 60 + routeLen(vx, vz, tr.x, tr.z); hud.toast('Streetcar drop', 'Land one on the roof as it moves'); }
    else if (kind === 'boat') {
      if (!world.dock) return null;
      t = makeTarget('boat', world.dock.x, world.dock.z, world.dock.y, 'Floating dock'); t.far = routeLen(vx, vz, world.dock.stand.x, world.dock.stand.z);
      hud.toast('Dock drop', 'Throw from the waterfront, out over the water');
    }
    else if (kind === 'pickup') {
      const src = SOURCES.reduce((b, c) => Math.hypot(c.x - vx, c.z - vz) < Math.hypot(b.x - vx, b.z - vz) ? c : b);
      const dest = pickLot(src.x, src.z, 280, 950); if (!dest) return null;
      t = makeTarget('pickup', src.x, src.z, heightAt(src.x, src.z), src.name); t.dest = dest; t.cargo = src.cargo; t.rule = src.rule || {}; t.from = src.from;
      t.far = routeLen(src.x, src.z, dest.door.x, dest.door.z);
      hud.toast('Cross-town run', `Collect ${src.cargo.toLowerCase()} at ${src.name}`, 'place');
    } else {
      const lot = pickLot(vx, vz, kind === 'rush' ? 140 : 75, kind === 'rush' ? 400 : 420); if (!lot) return null;
      t = makeTarget(kind, lot.door.x, lot.door.z, doorY(lot.door), lot.name);
      t.far = routeLen(vx, vz, lot.door.x, lot.door.z);
      if (kind === 'rush') { t.expire = Math.round(12 + t.far / 9); hud.toast('Rush order!', `${t.name} · ${t.expire} s · triple pay`, 'rush'); audio.play('bell'); }
    }
    targets.push(t);
    return t;
  };
  const startShift = (explore = false) => {
    audio.start(); audio.play('start');
    clearTargets();
    if (S.mode !== 'end' || !S.keepPos) van.reset(START[0], START[1], START[2]);
    Object.assign(S, { mode: 'play', explore: !!explore, time: SHIFT_TIME, score: 0, streak: 0, lastDelivery: -99, delivered: 0, resolved: 0, perfect: 0, bestCombo: 0, topSpeed: 0, throwCd: 0,
      camHeading: van.heading, elapsed: 0, cargo: null, airBest: 0, spawnCd: 0, post: null, toss: null, race: null, raceCd: 0, lastStop: null, stillT: 0, slowK: 0, coffeeCd: 0, wasSlow: false, district: district(van.pos.x, van.pos.z), seen: new Set() });
    for (const p of pickups) { p.active = true; p.g.visible = true; }
    for (const p of parcels) { p.active = false; p.m.visible = false; p.ride = false; }
    van.heavy = false; van.limit = 0;
    hud.hideOverlay(); hud.setPlaying(true); hud.setScore(0, 0); hud.setCargo(null);
    for (let i = 0; i < 3; i++) spawnJob('parcel');
    hud.toast(explore ? 'Explore' : 'Shift started', explore ? 'No clock. Follow the amber line to the nearest landmark; stars on the map show the rest.' : 'Every delivery adds time. Jobs keep coming.');
  };
  const resolve = () => { S.resolved++; S.spawnCd = 1.0; };
  const fishMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.6, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.5), new THREE.MeshStandardMaterial({ color: 0xc8cfd4, roughness: 0.25, emissive: 0x8a8478, emissiveIntensity: 1 }));
  fishMesh.visible = false; scene.add(fishMesh);
  function loadCargo(t, bonus = 0) {
    const rule = t.rule || {};
    const d = doorOf(t.dest); const far = routeLen(t.x, t.z, d.x, d.z);
    t.x = d.x; t.z = d.z; t.y = doorY(d); t.name = t.dest.name; t.dest = null; t.g.position.set(t.x, t.y, t.z);
    setKind(t, 'grocery'); t.tag = t.cargo;
    S.cargo = { cond: 100, label: t.cargo, rule, bonus }; hud.setCargo(100, t.cargo);
    van.heavy = !!rule.heavy;
    if (rule.chilled) t.expire = Math.round(20 + far / 9);
    const how = rule.chilled ? `Keep it cold: ${t.expire} s to deliver` : rule.heavy ? 'Heavy load: the van is slower. Hand over below 20 mph' : rule.fragile ? 'Corner gently, hand over below 20 mph' : 'Throw it like any parcel';
    hud.toast(`${t.cargo.charAt(0)}${t.cargo.slice(1).toLowerCase()} on board`, `For ${t.name} · ${how}`, 'place'); audio.play('place');
  }
  function catchToss() {
    const T = S.toss; if (!T) return;
    const off = Math.abs(T.t - T.dur);
    if (off < 0.28) {
      const bonus = off < 0.1 ? 150 : 60;
      S.toss = null; fishMesh.visible = false; hud.prompt(null);
      const sp = project(van.pos.x, van.y + 3.4, van.pos.z);
      hud.pop(sp.x, sp.y, off < 0.1 ? 'PERFECT CATCH' : 'CAUGHT', off < 0.1 ? 'perfect' : ''); audio.play(off < 0.1 ? 'perfect' : 'good');
      loadCargo(T.job, bonus);
    } else if (T.t < T.dur) { S.toss = null; fishMesh.visible = false; T.job.tossCd = 1.6; hud.prompt(null); hud.toast('Too early!', 'Wait for it to reach you'); audio.play('miss'); }
  }
  const endShift = (won) => {
    S.mode = 'end';
    const sc = S.score;
    const grade = sc >= 9000 ? 'S' : sc >= 6000 ? 'A' : sc >= 3500 ? 'B' : sc >= 1500 ? 'C' : 'D';
    const bkey = 'emerald-dash-best-city';
    let best = 0; try { best = Number(localStorage.getItem(bkey) || 0); } catch { /* ignore */ }
    const isBest = sc > best;
    if (isBest) { best = sc; try { localStorage.setItem(bkey, String(Math.round(best))); } catch { /* ignore */ } }
    audio.play(won ? 'win' : 'lose');
    hud.setPlaying(false);
    S.post = null; S.toss = null; S.race = null; if (rail) rail.state.max = 15; fishMesh.visible = false; hud.postcard(null); hud.prompt(null); van.limit = 0; van.heavy = false;
    hud.showResults({ won, explore: S.explore, grade, score: sc, delivered: S.delivered, perfect: S.perfect, bestCombo: S.bestCombo, topSpeed: S.topSpeed, best: isBest, bestScore: best, album: album.size, places: PLACES, minutes: S.elapsed / 60 }, () => startShift(S.explore), () => { S.mode = 'title'; S.titleT = 0; showTitle(); });
  };

  // sound on/off: the M key or the speaker button; the choice is remembered
  const toggleSound = () => { const muted = audio.toggleMute(); hud.setSound(!muted); try { localStorage.setItem('emerald-dash-muted', muted ? '1' : ''); } catch { /* ignore */ } hud.toast(muted ? 'Sound off' : 'Sound on'); };
  try { if (localStorage.getItem('emerald-dash-muted')) audio.muted = true; } catch { /* ignore */ }
  hud.soundButton(toggleSound, !audio.muted);
  hud.touch.onThrow = () => { if (S.mode !== 'play') return; if (S.toss) { if (S.post) { S.post = null; hud.postcard(null); } catchToss(); } else if (S.post) { S.post = null; hud.postcard(null); } else throwParcel(); };
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Enter' && S.mode !== 'play') startShift(false);
    if (e.code === 'KeyE' && S.mode !== 'play') startShift(true);
    if (e.code === 'Escape' && S.mode === 'play') endShift(false);
    if (e.code === 'Tab' && S.mode === 'play') { e.preventDefault(); S.navSkip = (S.navSkip || 0) + 1; }
    if (e.code === 'Space' && S.mode === 'play') { if (S.toss) { if (S.post) { S.post = null; hud.postcard(null); } catchToss(); } else if (S.post) { S.post = null; hud.postcard(null); } else throwParcel(); }
    if (e.code === 'KeyR' && S.mode === 'play') { const a = nearestRoadPoint(van.pos.x, van.pos.z); van.reset(a.x, a.z, a.h); }
    if (e.code === 'KeyM') toggleSound();
    if (e.code === 'KeyT') setWeather(!S.clear);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('pointerdown', () => audio.start());

  // rain, or a clear evening with the afterglow still in the sky
  function setWeather(clear) {
    S.clear = clear;
    world.rain.lines.visible = !clear;
    ground.uniforms.uRain.value = clear ? 0 : 1;
    const dens = clear ? 0.0024 : 0.0036;
    scene.fog.density = dens; ground.uniforms.uFogDensity.value = dens;
    app.sky.uniforms.uClear.value = clear ? 1 : 0;
    app.rebakeEnvironment();
    audio.setRain(!clear);
    hud.toast(clear ? 'Clear evening' : 'Rain', clear ? 'Dry air, long afterglow' : 'Back to Seattle weather');
  }

  const nearestRoadPoint = (x, z) => world.nearestRoad(x, z);

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
    aim.land.y = bestT && (bestT.kind === 'tram' || bestT.kind === 'boat') ? bestT.y : groundHeight(aim.land.x, aim.land.z);
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
    p.vel.set(rx * aim.side * hs + van.vel.x, (0.5 * GRAV * THROW_T * THROW_T - (van.y + y0 - aim.land.y)) / THROW_T, rz * aim.side * hs + van.vel.y);
    p.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    p.active = true; p.landed = false; p.rest = 0; p.m.visible = true; p.speedAtThrow = van.speed;
    audio.play('throw');
  }

  function land(p) {
    p.landed = true;
    const px = p.m.position.x, pz = p.m.position.z;
    const wet = world.inWater(px, pz) && !(world.dock && Math.hypot(px - world.dock.x, pz - world.dock.z) < 3.7);
    if (wet) {       // into the water
      for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28; emit(px, p.m.position.y + 0.1, pz, Math.cos(a) * 2.5, 3 + Math.random() * 4, Math.sin(a) * 2.5, 0.6, 0.2, 0.5, 0.7, 0.9, 12, 1); }
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
      let base = K.base + Math.min(140, mph * 2.2) + Math.round((hit.far || 0) * 0.2), note = perfect ? 'Perfect drop' : 'Delivered', bonus = 5;
      if (hit.kind === 'rush') { base *= 3; bonus = 10; note = 'Rush delivered · triple pay'; }
      if (hit.kind === 'tram') { p.ride = true; note = 'Landed on the streetcar'; }
      if (hit.kind === 'boat') note = 'Dock drop';
      if (hit.kind === 'grocery') {
        const rule = S.cargo.rule || {};
        if (rule.gentle && mph > 20) { S.cargo.cond = Math.max(5, S.cargo.cond - 40); hud.pop(sp.x, sp.y - 34, 'THROWN TOO HARD', 'miss'); }
        base = K.base * S.cargo.cond / 100 + (rule.gentle ? 0 : Math.min(140, mph * 2.2)) + (S.cargo.bonus || 0);
        const what = S.cargo.label.charAt(0) + S.cargo.label.slice(1).toLowerCase();
        note = rule.fragile ? `${what} ${Math.round(S.cargo.cond)}% intact` : `${what} delivered`;
        S.cargo = null; hud.setCargo(null); van.heavy = false;
      }
      const pts = Math.round(base * (perfect ? 2 : 1) * (1 + 0.5 * (S.streak - 1)) / 5) * 5;
      bonus += Math.round((hit.far || 0) / 13);
      S.score += pts; S.delivered++; S.time = Math.min(240, S.time + bonus); if (perfect) S.perfect++;
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

  const streetName = () => world.streetName(van.pos.x, van.pos.z);

  // ---------------------------------------------------------------- camera
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookSm = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const prevCam = new THREE.Vector3(), camVel = new THREE.Vector3();
  function chaseCamera(dt, snap) {
    const sp = van.speed;
    S.camHeading = angleLerp(S.camHeading, van.heading, Math.min(1, dt * (2.6 + sp * 0.06)));
    const dist = (8.4 + sp * 0.085) * (1 - 0.16 * S.slowK), height = (3.5 + sp * 0.03) * (1 - 0.22 * S.slowK);
    camPos.set(van.pos.x - Math.cos(S.camHeading) * dist, van.y + height, van.pos.z - Math.sin(S.camHeading) * dist);
    // keep the camera out of buildings
    for (const b of world.colliders) {
      if (b.low || b.moving) continue;
      if (camPos.x > b.x0 - 0.8 && camPos.x < b.x1 + 0.8 && camPos.z > b.z0 - 0.8 && camPos.z < b.z1 + 0.8) {
        const l = camPos.x - (b.x0 - 0.8), r = (b.x1 + 0.8) - camPos.x, t = camPos.z - (b.z0 - 0.8), bt = (b.z1 + 0.8) - camPos.z, m = Math.min(l, r, t, bt);
        if (m === l) camPos.x = b.x0 - 0.8; else if (m === r) camPos.x = b.x1 + 0.8; else if (m === t) camPos.z = b.z0 - 0.8; else camPos.z = b.z1 + 0.8;
      }
    }
    if (world.camClip) world.camClip(tmp2.set(van.pos.x, van.y + 2.2, van.pos.z), camPos);
    camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 1.4);
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
  // stop beside a landmark and the camera drifts in for a look
  const baseFog = () => (S.clear ? 0.0024 : 0.0036);
  const setFog = (d) => { scene.fog.density = d; ground.uniforms.uFogDensity.value = d; };
  // the ride to the top of the Space Needle: the camera climbs the tower, then circles the deck looking out over the city
  function ascentCamera(dt) {
    const P = S.post, A = P.stop.ascent; P.t += dt;
    const k = Math.min(1, P.t / 9), e = k * k * (3 - 2 * k), ang = 0.6 + P.t * 0.24, rad = 30 - 5 * e, y = A.base + 3 + (A.top - A.base - 3) * e;
    camPos.set(A.x + Math.cos(ang) * rad, y, A.z + Math.sin(ang) * rad);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 5));
    lookSm.lerp(camLook.set(A.x + Math.cos(ang) * 420, y - 25 - 95 * e, A.z + Math.sin(ang) * 420), 1 - Math.exp(-dt * 4));
    camera.lookAt(lookSm);
    camera.fov += (64 - camera.fov) * Math.min(1, dt * 2); camera.updateProjectionMatrix();
    setFog(baseFog() * (1 - 0.62 * e)); S.fogCut = true;      // the air clears as you rise above the street
    if (k >= 1 && !P.top) {
      P.top = true; hud.postcard('Top of the Needle', '520 feet up: Lake Union, downtown and the bay below');
      if (!S.seen.has('Top of the Needle')) { S.seen.add('Top of the Needle'); S.score += 500; hud.setScore(S.score, S.streak); audio.play('perfect'); }
    }
    if (P.t > 30 || keys.has('KeyW') || keys.has('ArrowUp') || keys.has('KeyS') || keys.has('ArrowDown') || hud.touch.gas) { S.post = null; hud.postcard(null); }
  }
  function postcardCamera(dt) {
    if (S.post.stop.ascent) return ascentCamera(dt);
    const P = S.post, s = P.stop; P.t += dt;
    const ly = s.relY ? heightAt(s.look[0], s.look[2]) + s.look[1] + 6 : s.look[1];
    const base = Math.atan2(s.z - s.look[2], s.x - s.look[0]);
    const a = base + Math.sin(P.t * 0.42) * 0.42, d = s.dist * (1 - 0.12 * Math.min(1, P.t / 5));
    camPos.set(s.look[0] + Math.cos(a) * d, Math.max(groundHeight(s.look[0] + Math.cos(a) * d, s.look[2] + Math.sin(a) * d) + 1.5, ly + (s.lift ?? 0.9)), s.look[2] + Math.sin(a) * d);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 2.2));
    lookSm.lerp(camLook.set(s.look[0], ly, s.look[2]), 1 - Math.exp(-dt * 3));
    camera.lookAt(lookSm);
    camera.fov += ((s.dist > 60 ? 50 : 42) - camera.fov) * Math.min(1, dt * 2); camera.updateProjectionMatrix();
    if (P.t > 8 || keys.has('KeyW') || keys.has('ArrowUp') || keys.has('KeyS') || keys.has('ArrowDown')) { S.post = null; hud.postcard(null); }
  }
  function titleCamera(dt) {
    S.titleT += dt;
    const a = -0.9 + Math.sin(S.titleT * 0.11) * 0.55;
    camera.position.set(van.pos.x + Math.cos(a) * 7.6 + 1.6, van.y + 1.5 + Math.sin(S.titleT * 0.17) * 0.3, van.pos.z + Math.sin(a) * 7.6 - 1.5);
    lookSm.set(van.pos.x + 2.4, van.y + 1.7, van.pos.z - 1.5);
    camera.lookAt(lookSm);
    camera.fov = 40; camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- frame update
  const headWorld = new THREE.Vector3(), tmp = new THREE.Vector3();
  let frameN = 0;
  const album = new Set();
  try { for (const n of JSON.parse(localStorage.getItem('emerald-dash-album') || '[]')) if (POIS.some(p => p.name === n) || STOPS.some(p => p.name === n)) album.add(n); } catch { /* ignore */ }
  const showTitle = () => hud.showTitle(() => startShift(false), () => startShift(true), album.size, POIS.length + STOPS.length, world.credit);
  showTitle();
  hud.setClock(SHIFT_TIME, []);
  van.reset(START[0], START[1], START[2]); van.sync();
  if (params.get('autostart')) startShift(params.get('autostart') === 'explore');

  app.update = (dt) => {
    frameN++;
    app.updateWorld(dt);
    const playing = S.mode === 'play';

    input.throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    input.steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    input.drift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    // gamepad: left stick steers, triggers drive and brake, A throws, B or RB drifts, Start begins a shift
    const tc = hud.touch;
    if (tc.left || tc.right) input.steer = (tc.right ? 1 : 0) - (tc.left ? 1 : 0);
    if (tc.gas || tc.brake) input.throttle = (tc.gas ? 1 : 0) - (tc.brake ? 1 : 0);
    if (tc.drift) input.drift = true;
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
    if (pad) {
      const ax = pad.axes[0] || 0, rt = pad.buttons[7] ? pad.buttons[7].value : 0, lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (Math.abs(ax) > 0.12) input.steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      if (rt > 0.05 || lt > 0.05) input.throttle = rt - lt;
      if ((pad.buttons[1] && pad.buttons[1].pressed) || (pad.buttons[5] && pad.buttons[5].pressed)) input.drift = true;
      const a = !!(pad.buttons[0] && pad.buttons[0].pressed), st = !!(pad.buttons[9] && pad.buttons[9].pressed);
      if (a && !S.padA && playing) throwParcel();
      if ((st && !S.padStart || a && !S.padA) && S.mode !== 'play') startShift();
      S.padA = a; S.padStart = st;
    }
    if (app.autoDrive) Object.assign(input, app.autoDrive);
    if (!playing) { input.throttle = 0; input.steer = 0; input.drift = false; }
    const slow = playing && inSlow(van.pos.x, van.pos.z);
    van.limit = slow ? 6.2 : 0;
    S.slowK += ((slow ? 1 : 0) - S.slowK) * Math.min(1, dt * 2.2);
    S.wasSlow = slow;
    if (S.post) { input.throttle = 0; input.steer = 0; }
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
        for (let i = 0; i < 16; i++) emit(van.pos.x + fx * 2.6, van.y + 0.8, van.pos.z + fz * 2.6, (Math.random() - 0.5) * 10, 2 + Math.random() * 5, (Math.random() - 0.5) * 10, 0.35 + Math.random() * 0.3, 0.12, 3.0, 1.6, 0.4, 14, 1);
        if (playing && S.streak > 1) { S.streak = 0; hud.setScore(S.score, 0); hud.toast('Streak lost', 'Mind the paintwork'); }
      }
    }
    for (const e of van.events) {
      if (e.type === 'land' && playing) {
        const pts = Math.round(e.t * 120 / 5) * 5; S.score += pts; S.airBest = Math.max(S.airBest, e.t);
        const sp = project(van.pos.x, van.y + 3.2, van.pos.z);
        hud.pop(sp.x, sp.y, `AIR ${e.t.toFixed(1)} s +${pts}`, 'near'); hud.setScore(S.score, S.streak); audio.play('thud'); S.shake = Math.max(S.shake, 0.18);
      }
    }
    van.events.length = 0;
    S.shake = Math.max(0, S.shake - dt * 1.6) + (van.boost > 0 ? 0.02 : 0);

    // tyre spray and drift mist
    if (van.speed > 7 && !van.air) {
      const fx = Math.cos(van.heading), fz = Math.sin(van.heading), rx = -fz, rz = fx;
      const n = van.drifting ? 4 : (van.speed > 14 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const k = van.drifting ? 1.6 : 1;
        emit(van.pos.x - fx * 2.0 + rx * s * 0.9, van.y + 0.25, van.pos.z - fz * 2.0 + rz * s * 0.9,
          van.vel.x * 0.35 + (Math.random() - 0.5) * 2 * k + rx * s * 1.2, 1.2 + Math.random() * 1.8 * k, van.vel.y * 0.35 + (Math.random() - 0.5) * 2 * k + rz * s * 1.2,
          0.45 + Math.random() * 0.35, 0.42 * k, 0.014 * k, 0.019 * k, 0.026 * k, 2.5, 1.6, 2.6);
      }
    }
    updateParticles(dt);

    if (playing) {
      S.elapsed += dt; if (!S.explore) S.time -= dt; S.throwCd -= dt;
      S.topSpeed = Math.max(S.topSpeed, van.speed * 2.237);
      if (!S.explore && S.time <= 10 && Math.floor(S.time) !== Math.floor(S.time + dt)) audio.play('tick');
      if (!S.explore && S.time <= 0) endShift(false);
      // stopping beside a landmark opens its postcard
      S.stillT = van.speed < 0.6 && !S.toss ? S.stillT + dt : 0;
      const collecting = targets.some(t => !t.done && t.kind === 'pickup' && Math.hypot(t.x - van.pos.x, t.z - van.pos.z) < 7);
      if (!S.post && S.stillT > 0.7 && !collecting) {
        // the nearest stop wins; where two face each other across a street, one you have not seen yet goes first
        const dq = (q) => Math.hypot(q.x - van.pos.x, q.z - van.pos.z);
        const st = STOPS.filter(q => dq(q) < 6.5 && q !== S.lastStop).sort((p1, p2) => (S.seen.has(p1.name) - S.seen.has(p2.name)) || dq(p1) - dq(p2))[0];
        if (st && st !== S.lastStop) {
          S.post = { stop: st, t: 0 }; S.lastStop = st; hud.postcard(st.name, st.sub); audio.play('place');
          if (!S.seen.has(st.name)) { S.seen.add(st.name); S.score += 200; hud.setScore(S.score, S.streak); }
          if (!album.has(st.name)) { album.add(st.name); try { localStorage.setItem('emerald-dash-album', JSON.stringify([...album])); } catch { /* ignore */ } }
        }
      }
      if (S.lastStop && Math.hypot(S.lastStop.x - van.pos.x, S.lastStop.z - van.pos.z) > 14) S.lastStop = null;
      if (S.post || S.race) { if (!S.explore) S.time += dt; }      // the clock waits while you look, and during a race
      if (!S.post && S.fogCut) { S.fogCut = false; setFog(baseFog()); }
      updateRace(dt);
      // coffee from the first store: a longer turbo
      S.coffeeCd -= dt;
      const cf = world.pike.coffee;
      if (S.coffeeCd <= 0 && Math.hypot(cf.x - van.pos.x, cf.z - van.pos.z) < 4.5) { S.coffeeCd = 30; S.boostBank = 6; hud.toast('Coffee from the first store', 'A long turbo is waiting when you leave the market'); audio.play('boost'); }
      if (S.boostBank && !slow) { van.boost = S.boostBank; S.boostBank = 0; }
      const dk = district(van.pos.x, van.pos.z);
      if (dk !== S.district && dk !== 'none') { S.district = dk; hud.banner(DISTRICT_LABEL[dk]); }
      if (S.streak > 0 && S.elapsed - S.lastDelivery > 16) { S.streak = 0; hud.setScore(S.score, 0); }

      for (const p of POIS) {
        if (S.seen.has(p.name)) continue;
        if (Math.hypot(van.pos.x - p.x, van.pos.z - p.z) < p.r) { S.seen.add(p.name); if (!album.has(p.name)) { album.add(p.name); try { localStorage.setItem('emerald-dash-album', JSON.stringify([...album])); } catch { /* ignore */ } } S.score += 150; hud.toast(p.name, `${p.sub} · +150`, 'place'); hud.setScore(S.score, S.streak); audio.play('place'); }
      }
      for (const p of pickups) {
        if (!p.active) { p.respawn -= dt; if (p.respawn <= 0) { p.active = true; p.g.visible = true; } continue; }
        if (Math.hypot(van.pos.x - p.x, van.pos.z - p.z) < 2.6) {
          p.active = false; p.g.visible = false; p.respawn = 20;
          van.boost = 3.6; S.score += 50; hud.setScore(S.score, S.streak); hud.toast('Coffee!', 'Turbo engaged'); audio.play('boost');
          for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28; emit(p.x, p.y + 1.2, p.z, Math.cos(a) * 5, 2 + Math.random() * 5, Math.sin(a) * 5, 0.6, 0.2, 3.0, 1.4, 0.3, 8, 1.5); }
        }
      }
      const tram = world.streetcar.state;
      S.bellCd -= dt;
      if (S.bellCd <= 0 && Math.hypot(van.pos.x - tram.x, van.pos.z - tram.z) < 26 && tram.v > 1) { audio.play('bell'); S.bellCd = 7; }
    }
    for (const p of pickups) { p.g.rotation.y += dt * 1.6; p.g.position.y = p.y + 1.0 + Math.sin(app.time * 2.2 + p.x) * 0.16; }

    // jobs that change over time: the grocery pick-up, the rush order, the moving streetcar
    if (playing) {
      const tr = world.streetcar.state;
      // retire finished jobs and keep the board topped up
      for (let i = targets.length - 1; i >= 0; i--) if (targets[i].done && targets[i].fade <= 0) { scene.remove(targets[i].g); targets.splice(i, 1); }
      S.spawnCd -= dt;
      if (S.spawnCd <= 0 && targets.filter(t => !t.done).length < MAX_JOBS) { spawnJob(); S.spawnCd = 2.5; }
      for (const t of targets) {
        if (t.done) continue;
        if (t.kind === 'tram') { t.x = tr.x; t.z = tr.z; t.y = tramRoof(); t.h = tr.h ?? Math.PI / 2; t.vx = tr.vx ?? 0; t.vz = tr.vz ?? tr.dir * tr.v; t.g.position.set(t.x, t.y, t.z); }
        if (t.kind === 'pickup' && !S.toss && Math.hypot(van.pos.x - t.x, van.pos.z - t.z) < 4.6) {
          if (t.rule.toss) {
            // the fishmonger throws it: stop, then catch
            if (van.speed < 2.5 && (t.tossCd || 0) <= 0) { S.toss = { t: 0, dur: 1.15, job: t, from: new THREE.Vector3(...(t.from || [t.x - 8, t.y + 1.6, t.z])) }; fishMesh.visible = true; hud.prompt('CATCH IT — SPACE'); audio.play('throw'); }
            else if (van.speed >= 2.5 && !t.hinted) { t.hinted = true; hud.toast('Stop by the fish stall', 'They throw, you catch'); }
          } else loadCargo(t);
        }
        if (t.tossCd > 0) t.tossCd -= dt;
        if (t.expire !== undefined) {
          t.expire -= dt;
          if (t.expire <= 0) {
            const melted = t.kind === 'grocery';
            t.done = true; t.failed = true; t.fade = 1; S.streak = 0; hud.setScore(S.score, 0);
            hud.toast(melted ? 'Too slow: it melted' : 'Rush order expired', t.name, 'rush'); audio.play('miss'); resolve();
            if (melted) { S.cargo = null; hud.setCargo(null); van.heavy = false; }
          }
        }
      }
      // a fish in the air
      if (S.toss) {
        const T = S.toss; T.t += dt;
        const k = Math.min(1, T.t / T.dur);
        fishMesh.position.lerpVectors(T.from, tmp.set(van.pos.x, van.y + 2.9, van.pos.z), k); fishMesh.position.y += Math.sin(k * Math.PI) * 3.2;
        fishMesh.rotation.set(T.t * 9, T.t * 5, 0.5);
        if (T.t > T.dur + 0.28) { S.toss = null; fishMesh.visible = false; T.job.tossCd = 1.6; hud.prompt(null); hud.toast('Dropped it!', 'Stay put, they will throw another'); audio.play('thud'); }
      }
      if (S.cargo) {
        const g = Math.abs(van.yawRate * (van.vf || 0)), lim = (S.cargo.rule || {}).fragile;
        if (lim && g > lim) S.cargo.cond = Math.max(5, S.cargo.cond - (g - lim) * dt * 2.4);
        if (lim && van.impact > 0.9 * (S.cargo.lastImpact ?? 9) + 0.15) S.cargo.cond = Math.max(5, S.cargo.cond - van.impact * 30);
        S.cargo.lastImpact = van.impact;
        hud.setCargo(S.cargo.cond, S.cargo.label);
      }
    }

    // parcels in flight
    for (const p of parcels) {
      if (!p.active) continue;
      if (p.ride) { const tr = world.streetcar.state; p.m.position.x += (tr.vx ?? 0) * dt; p.m.position.z += (tr.vz ?? tr.dir * tr.v) * dt; p.m.position.y = tramRoof() + 0.24; p.rest += dt; if (p.rest > 12) { p.active = false; p.m.visible = false; p.ride = false; } continue; }
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
      if (t && t.kind !== 'tram' && t.kind !== 'boat') { gl[i].set(t.x, t.y + 0.3, t.z, 6.5); const k = 0.72 * (1.1 + 0.4 * Math.sin(app.time * 4 + t.x)); gc[i].setRGB(t.col.r * k, t.col.g * k, t.col.b * k); }
      else { gl[i].set(0, -100, 0, 1); gc[i].setRGB(0, 0, 0); }
    }

    // camera
    prevCam.copy(camera.position);
    if (app.freeCam) { /* debug camera fixed by URL */ }
    else if (S.mode === 'title') titleCamera(dt);
    else if (S.post) postcardCamera(dt);
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
      if (c) { const cx = Math.cos(c.h), cz = Math.sin(c.h); hp[i].set(c.x + cx * 2.3, (c.y || 0) + 0.75, c.z + cz * 2.3, 1.5); tmp.set(cx, -0.09, cz).normalize(); hd[i].set(tmp.x, tmp.y, tmp.z, 0); }
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
    // the wet-street mirror sits at whatever level the van is on
    const R = app.reflection, gyv = heightAt(van.pos.x, van.pos.z);
    // lay the mirror along the street the van is on
    const e = 6, nx = -(heightAt(van.pos.x + e, van.pos.z) - heightAt(van.pos.x - e, van.pos.z)) / (2 * e), nz = -(heightAt(van.pos.x, van.pos.z + e) - heightAt(van.pos.x, van.pos.z - e)) / (2 * e);
    tmp.set(nx, 1, nz).normalize();
    R.tilted = true; R.normal.lerp(tmp, Math.min(1, dt * 4)).normalize(); R.point.set(van.pos.x, gyv + 0.08, van.pos.z);
    ground.uniforms.uPlane.value.set(R.normal.x, R.normal.y, R.normal.z, -R.normal.dot(R.point));
    updateCube();

    rUni.uTime.value = app.time; routeT -= dt;
    if (routeT <= 0) { routeT = 0.35; if (playing) updateRoute(); else route.visible = false; }

    // HUD
    if (playing) {
      const chips = targets.map(t => ({ css: t.css, state: t.failed ? 'fail' : t.done ? 'done' : 'todo' }));
      hud.setClock(S.time, chips, S.explore ? `LANDMARKS ${album.size}/${PLACES}` : null, S.delivered);
      hud.setSpeed(van.speed * 2.237, Math.max(0, van.boost) / 3.6);
      if (frameN % 6 === 0) hud.setStreet(streetName());
      if (frameN % 2 === 0) hud.drawMap(van, targets, pickups, world.streetcar.state, world.traffic.cars, nav, world.drawMap, landmarks());
      const W = innerWidth, H = innerHeight, m = 46;
      const dv = (t) => (t.x - van.pos.x) ** 2 + (t.z - van.pos.z) ** 2;
      const pinned = targets.filter(t => !t.done).sort((a, b) => dv(a) - dv(b)).slice(0, 3);
      const lmPin = S.explore ? nearestLandmark() : null; if (lmPin) pinned.push(lmPin);
      hud.setPins(pinned.map(t => {
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

  app.game = { van, state: S, input, startShift, throwParcel, targets, aim, cubeRT, spawnJob };
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
