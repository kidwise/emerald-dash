import * as THREE from 'three';
import { createBuildings } from './buildings.js';
import { createLamps, createTrees, createSignals, createParkedCars, createSigns, createBarriers, createGlowPoints, chunks } from './props.js';
import { createRain, createSteam } from './rain.js';
import { createLake, createPark, createStreetcar } from './landmarks.js';
import { createMonorail, createMarket, createRetailCore, createCenter } from './districts.js';
import { MARKET_Y } from '../config.js';
import { AVENUES, STREETS } from '../config.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';

export async function initWorld(app) {
  const { scene, renderer } = app;
  const colliders = [];   // axis-aligned boxes
  const obstacles = [];   // thin round things: poles, trees
  const glow = [];        // point-sprite systems that need the viewport scale
  const updaters = [];

  const buildings = createBuildings();
  scene.add(buildings.mesh);
  colliders.push(...buildings.colliders);
  updaters.push(() => { buildings.uniforms.uTime.value = app.time; });

  const lamps = createLamps(obstacles); scene.add(lamps.group); glow.push(lamps.halo);
  const trees = createTrees(obstacles); scene.add(trees.group); glow.push(trees.lights);
  const signals = createSignals(); scene.add(signals.group);
  const parked = createParkedCars(colliders); scene.add(parked.group);
  const signs = createSigns(buildings.lots); scene.add(signs.group);
  const barriers = createBarriers(colliders); scene.add(barriers.group); glow.push(barriers.lights);

  const lake = createLake(app.reflection); scene.add(lake.mesh);
  const park = createPark(colliders); scene.add(park.group); glow.push(...park.glow);
  const bay = createLake(app.reflection, { planar: 0, x: -1170, w: 1300, z: 700, d: 1500, y: MARKET_Y - 3 }); scene.add(bay.mesh);
  const monorail = createMonorail(obstacles); scene.add(monorail.group);
  const market = createMarket(obstacles); scene.add(market.group); glow.push(...market.glow);
  const retail = createRetailCore(obstacles, buildings.lots); scene.add(retail.group); glow.push(...retail.glow);
  const center = createCenter(colliders, obstacles); scene.add(center.group); glow.push(...center.glow);
  const streetcar = createStreetcar(); scene.add(streetcar.group); colliders.push(streetcar.collider);

  const traffic = createTraffic(signals, streetcar, colliders); scene.add(traffic.group);
  const peds = createPedestrians(); scene.add(peds.group);

  // aircraft warning beacons on the tall towers
  if (buildings.beacons.length) {
    const p = [], c = [], s = [], ph = [];
    buildings.beacons.forEach((b, i) => { p.push(...b); c.push(8, 0.4, 0.25); s.push(1.4); ph.push(i * 0.21); });
    const beacons = createGlowPoints(p, c, s, ph, { blink: 1, fogK: 0.4 });
    scene.add(beacons.points); glow.push(beacons);
  }

  // steam: rooftop stacks plus a few street vents
  const vents = [[-3.5, 0.1, 132, 0.55], [3.5, 0.1, -44, 0.55], [-60, 0.1, 3, 0.5], [60, 0.1, -91, 0.5], [-91, 0.1, -130, 0.5], [3, 0.1, -200, 0.55], [85, 0.1, 150, 0.5]];
  const steam = createSteam([...buildings.stacks.map(s => [...s, 1.5]), ...vents]);
  scene.add(steam.points);

  const rain = createRain();
  scene.add(rain.lines);

  // a small pool of real lights that hop to the street lamps nearest the action,
  // so the van and nearby props get true lamp highlights
  const pool = [];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffb066, 0, 26, 1.6); scene.add(l); pool.push(l); }
  const lampHeads = lamps.sites.map(s => new THREE.Vector3(s.x + s.dirX * 2.15, s.y + 8.1, s.z + s.dirZ * 2.15));
  const tmp = [];
  const updateLampPool = (focus) => {
    tmp.length = 0;
    for (const h of lampHeads) { const dx = h.x - focus.x, dz = h.z - focus.z; if (dx > 30 || dx < -30 || dz > 30 || dz < -30) continue; tmp.push([dx * dx + dz * dz, h]); }
    tmp.sort((a, b) => a[0] - b[0]);
    pool.forEach((l, i) => { if (tmp[i]) { l.position.copy(tmp[i][1]); l.intensity = 260; } else l.intensity = 0; });
  };

  updaters.push((dt) => {
    const t = app.time;
    signals.update(t);
    streetcar.update(dt);
    park.update(t);
    park.facadeUniforms.uTime.value = t;
    lake.uniforms.uTime.value = t; bay.uniforms.uTime.value = t;
    monorail.update(dt); market.update(t); center.update(t, app.camera.position);
    steam.uniforms.uTime.value = t;
    rain.uniforms.uTime.value = t;
    // skip prop tiles that are lost in the rain anyway
    const cp = app.camera.position;
    for (const c of chunks) { const vis = (c.x - cp.x) ** 2 + (c.z - cp.z) ** 2 < 440 * 440; for (const o of c.objs) o.visible = vis; }
    const sc = renderer.domElement.height * app.camera.projectionMatrix.elements[5] * 0.5;
    for (const g of glow) { g.uniforms.uTime.value = t; g.uniforms.uScale.value = sc; }
    steam.uniforms.uScale.value = sc;
  });

  app.world = { monorail, colliders, obstacles, buildings, lamps, trees, signals, parked, streetcar, traffic, peds, rain, steam, lake, park, updateLampPool };
  app.updateWorld = (dt) => { for (const u of updaters) u(dt); };
  app.update = (dt) => app.updateWorld(dt);
  void AVENUES; void STREETS;
}
