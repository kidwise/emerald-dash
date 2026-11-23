import * as THREE from 'three';
import './style.css';
import { FOG_COLOR, FOG_DENSITY } from './config.js';
import { createSky, bakeEnvironment } from './world/sky.js';
import { PlanarReflection } from './gfx/planar.js';
import { createGround } from './world/ground.js';
import { createPost } from './gfx/post.js';

// Headlight glints on glossy paint and glass can exceed what a half-float colour buffer can hold.
// An overflowed pixel becomes infinity, and the bloom blur then spreads it into a fully black frame,
// so every built-in material clamps its output here before it is written.
THREE.ShaderChunk.opaque_fragment = 'outgoingLight = clamp(outgoingLight, vec3(0.0), vec3(48.0));\n' + THREE.ShaderChunk.opaque_fragment;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(params.get('dpr') || 1.5)));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color().fromArray(FOG_COLOR), FOG_DENSITY);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 2400);
camera.layers.enable(1);
camera.layers.enable(2);
camera.position.set(6, 3, 60);
camera.lookAt(0, 3, 0);

const sky = createSky();
scene.add(sky.mesh);
scene.environment = bakeEnvironment(renderer, sky);
scene.environmentIntensity = 1.0;

const reflection = new PlanarReflection(renderer, 0.5);
const ground = createGround(reflection);

scene.add(new THREE.HemisphereLight(0x6d8fd0, 0x1a1512, 0.55));

const post = createPost(renderer, scene, camera);

const app = { renderer, scene, camera, sky, ground, reflection, post, params, time: 0 };
app.rebakeEnvironment = () => { const old = scene.environment; scene.environment = bakeEnvironment(renderer, sky); scene.add(sky.mesh); if (old) old.dispose(); };
window.__app = app;

const { initRealWorld } = await import('./real/world.js');
await initRealWorld(app, 'city');
const { initGame } = await import('./game/game.js');
initGame(app);
if (params.get('auto')) { const [t, st, dr] = params.get('auto').split(',').map(Number); app.autoDrive = { throttle: t || 0, steer: st || 0, drift: !!dr }; }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  reflection.setSize(renderer);
  post.composer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

if (params.get('cam')) {
  const c = params.get('cam').split(',').map(Number);
  camera.position.set(c[0], c[1], c[2]);
  camera.lookAt(c[3], c[4], c[5]);
  app.freeCam = true;
  document.getElementById('hud').style.display = 'none';
}

const clock = new THREE.Clock();
let frames = 0, fpsT = 0, fps = 0, slow = 0, pixelRatio = renderer.getPixelRatio();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  app.time += dt;
  renderer.info.reset();
  if (app.update) app.update(dt);
  sky.uniforms.uTime.value = app.time;
  ground.uniforms.uTime.value = app.time;
  camera.updateMatrixWorld();
  reflection.update(renderer, scene, camera);
  post.composer.render(dt);
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    // adaptive resolution: trade pixels for frame rate on slower GPUs
    if (!params.get('dpr') && app.time > 4) {
      slow = fps < 44 ? slow + 1 : 0;
      if (slow >= 4 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.2); renderer.setPixelRatio(pixelRatio); resize(); slow = 0; }
    }
  }
  if (frames === 3 || app.time > 0.3) window.__ready = true;
  requestAnimationFrame(frame);
}
window.__info = () => ({ fps: Math.round(fps), calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
requestAnimationFrame(frame);
