import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, heightAt, inBounds } from '../config.js';
export { groundHeight };
import { shadowTex } from '../world/props.js';

const W = 2.12;            // body width
const WHEEL_R = 0.41;
const AXLE_F = 1.95, AXLE_R = -1.75;

function profile(top) {
  // side silhouette, x = forward, y = up
  const s = new THREE.Shape();
  s.moveTo(-2.88, 0.50);
  if (top) {
    s.lineTo(-2.92, top); s.lineTo(2.94, top); s.lineTo(2.93, 0.62);
  } else {
    s.lineTo(-2.94, 1.1); s.lineTo(-2.90, 2.40);
    s.quadraticCurveTo(-2.88, 2.72, -2.55, 2.74);
    s.lineTo(0.95, 2.74);
    s.quadraticCurveTo(1.45, 2.74, 1.72, 2.52);
    s.lineTo(2.56, 1.58);
    s.quadraticCurveTo(2.86, 1.34, 2.93, 1.12);
    s.lineTo(2.95, 0.62);
  }
  s.quadraticCurveTo(2.94, 0.44, 2.80, 0.42);
  s.lineTo(AXLE_F + 0.53, 0.42); s.absarc(AXLE_F, 0.40, 0.53, 0, Math.PI, false);
  s.lineTo(AXLE_R + 0.53, 0.42); s.absarc(AXLE_R, 0.40, 0.53, 0, Math.PI, false);
  s.lineTo(-2.80, 0.42);
  s.quadraticCurveTo(-2.88, 0.43, -2.88, 0.50);
  return s;
}
function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelOffset: -bevel, bevelSegments: 4, curveSegments: 14 });
  return g.translate(0, 0, -(width - bevel * 2) / 2);
}
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function liveryTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 512);
  // sweeping orange band
  const grad = x.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#ff7a00'); grad.addColorStop(1, '#ffb000');
  x.fillStyle = grad;
  x.beginPath(); x.moveTo(0, 372); x.lineTo(1024, 330); x.lineTo(1024, 372); x.lineTo(0, 428); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.beginPath(); x.moveTo(0, 436); x.lineTo(1024, 380); x.lineTo(1024, 388); x.lineTo(0, 446); x.closePath(); x.fill();
  // wordmark
  x.fillStyle = '#f4f7fa';
  x.font = 'italic 800 150px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
  x.textBaseline = 'alphabetic';
  x.fillText('DASH', 150, 270);
  x.font = '600 34px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
  x.fillStyle = '#ffb000';
  x.fillText('EMERALD CITY PARCEL  ·  SLU 07', 158, 318);
  // parcel icon
  x.strokeStyle = '#ffb000'; x.lineWidth = 9; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(50, 190); x.lineTo(95, 165); x.lineTo(140, 190); x.lineTo(140, 245); x.lineTo(95, 270); x.lineTo(50, 245); x.closePath(); x.stroke();
  x.beginPath(); x.moveTo(50, 190); x.lineTo(95, 215); x.lineTo(140, 190); x.moveTo(95, 215); x.lineTo(95, 270); x.stroke();
  // door seams + handle
  x.strokeStyle = 'rgba(0,0,0,0.75)'; x.lineWidth = 4;
  x.strokeRect(690, 40, 250, 440);
  x.beginPath(); x.moveTo(60, 30); x.lineTo(60, 470); x.stroke();
  x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillRect(712, 250, 46, 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function createVanModel() {
  const root = new THREE.Group();          // world placement
  const body = new THREE.Group();          // rolls / pitches on its suspension
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color: 0x0d2c52, roughness: 0.30, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.55, metalness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x04070a, roughness: 0.04, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.02, ior: 1.9, envMapIntensity: 0.9 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.3, metalness: 1.0 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.8 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11.5) });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.12, 0.08) });
  const amberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 3.2, 0.3) });
  const mats = { paint, trim, glass, chrome, tyre, headMat, tailMat, amberMat };

  const shell = new THREE.Mesh(extrude(profile(0), W, 0.11), paint);
  body.add(shell);
  const clad = new THREE.Mesh(extrude(profile(0.80), W + 0.05, 0.05), trim);
  body.add(clad);

  // glazing: windscreen + cab side windows + rear door windows
  const hw = W / 2;
  const glassGeos = [
    quad([1.80, 2.455, 0.86], [2.535, 1.635, 0.90], [2.535, 1.635, -0.90], [1.80, 2.455, -0.86]),
  ];
  for (const s of [-1, 1]) {
    const z = s * (hw + 0.006);
    const pts = [[0.95, 1.62], [2.34, 1.62], [1.72, 2.36], [0.95, 2.36]];
    const p = pts.map(([px, py]) => [px, py, z]);
    glassGeos.push(s > 0 ? quad(p[0], p[1], p[2], p[3]) : quad(p[1], p[0], p[3], p[2]));
  }
  glassGeos.push(quad([-2.955, 1.7, -0.8], [-2.955, 1.7, 0.8], [-2.935, 2.3, 0.8], [-2.935, 2.3, -0.8]));
  body.add(new THREE.Mesh(mergeGeometries(glassGeos), glass));

  // black screen surround / A-pillars to visually join the glass
  const blk = [];
  blk.push(new THREE.BoxGeometry(0.5, 0.05, W - 0.3).translate(1.5, 2.745, 0));
  body.add(new THREE.Mesh(mergeGeometries(blk), trim));

  // livery decals on both sides
  const liv = liveryTexture();
  const decalMat = new THREE.MeshPhysicalMaterial({ map: liv, transparent: true, roughness: 0.4, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(3.7, 1.85);
    const m = new THREE.Mesh(g, decalMat);
    m.position.set(-0.98, 1.62, s * (hw + 0.004));
    if (s < 0) m.rotation.y = Math.PI;
    body.add(m);
  }

  // lights
  const front = [];
  front.push(new THREE.BoxGeometry(0.04, 0.045, 1.62).translate(2.925, 1.17, 0));                    // light bar
  for (const s of [-1, 1]) front.push(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 18).rotateZ(Math.PI / 2).translate(2.945, 0.94, s * 0.76));
  const headMesh = new THREE.Mesh(mergeGeometries(front), headMat);
  body.add(headMesh);
  const rear = [];
  for (const s of [-1, 1]) rear.push(new THREE.BoxGeometry(0.04, 1.25, 0.075).translate(-2.94, 1.62, s * (hw - 0.09)));
  rear.push(new THREE.BoxGeometry(0.04, 0.05, 0.9).translate(-2.9, 2.62, 0));
  const tailMesh = new THREE.Mesh(mergeGeometries(rear), tailMat);
  body.add(tailMesh);
  const amb = [];
  for (const z of [-0.5, 0, 0.5]) amb.push(new THREE.BoxGeometry(0.06, 0.035, 0.1).translate(1.25, 2.765, z));
  body.add(new THREE.Mesh(mergeGeometries(amb), amberMat));

  // mirrors, roof vent, bumpers
  const bits = [];
  for (const s of [-1, 1]) { bits.push(new THREE.BoxGeometry(0.1, 0.34, 0.2).translate(1.98, 1.86, s * (hw + 0.16))); bits.push(new THREE.BoxGeometry(0.06, 0.05, 0.2).translate(1.98, 1.72, s * (hw + 0.07))); }
  bits.push(new THREE.BoxGeometry(1.0, 0.1, 0.9).translate(-0.9, 2.78, 0));
  bits.push(new THREE.BoxGeometry(0.14, 0.2, W - 0.1).translate(-2.94, 0.62, 0));
  body.add(new THREE.Mesh(mergeGeometries(bits), trim));

  // exterior detail: arch flares, grille and bumper, wipers, rub strips, handles, roof ribs
  const det = [], bright = [], ribs = [];
  for (const ax of [AXLE_F, AXLE_R]) for (const s of [-1, 1]) det.push(new THREE.TorusGeometry(0.535, 0.05, 6, 18, Math.PI).translate(ax, 0.40, s * (hw + 0.012)));
  det.push(new THREE.BoxGeometry(0.05, 0.30, 1.56).translate(2.935, 0.70, 0));                         // grille panel
  det.push(new THREE.BoxGeometry(0.2, 0.2, W - 0.02).translate(2.88, 0.50, 0));                        // front bumper
  det.push(new THREE.BoxGeometry(0.3, 0.07, W - 0.3).translate(-2.98, 0.46, 0));                       // rear step
  for (const s of [-1, 1]) {
    det.push(new THREE.BoxGeometry(3.9, 0.065, 0.03).translate(-0.9, 0.93, s * (hw + 0.012)));        // rub strip
    det.push(new THREE.BoxGeometry(0.7, 0.05, 0.16).translate(1.55, 0.50, s * (hw + 0.04)));          // cab step
    det.push(quad([1.84, 2.47, s * 0.9], [2.56, 1.66, s * 0.94], [2.60, 1.62, s * 1.0], [1.80, 2.52, s * 0.96]));   // A-pillar
    bright.push(new THREE.BoxGeometry(0.16, 0.035, 0.03).translate(1.02, 1.42, s * (hw + 0.02)));     // door handles
    bright.push(new THREE.BoxGeometry(0.16, 0.035, 0.03).translate(-0.35, 1.42, s * (hw + 0.02)));
  }
  for (const z of [0.42, -0.30]) det.push(new THREE.BoxGeometry(0.03, 0.03, 0.62).rotateX(0.25).translate(2.44, 1.78, z));   // wipers
  for (let i = 0; i < 4; i++) bright.push(new THREE.BoxGeometry(0.012, 0.022, 1.40).translate(2.965, 0.60 + i * 0.065, 0));    // grille slats
  for (let i = 0; i < 7; i++) ribs.push(new THREE.BoxGeometry(0.07, 0.025, W - 0.5).translate(-2.3 + i * 0.5, 2.752, 0));
  ribs.push(new THREE.CylinderGeometry(0.012, 0.018, 0.55, 5).translate(0.6, 3.0, 0.6));
  const nonIdx = (l) => mergeGeometries(l.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); if (!n.attributes.normal) n.computeVertexNormals(); return n; }));
  body.add(new THREE.Mesh(nonIdx(det), trim), new THREE.Mesh(nonIdx(bright), chrome), new THREE.Mesh(nonIdx(ribs), paint));

  // number plates, side markers, indicators and reversing lamps
  const plateMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.86) });
  body.add(new THREE.Mesh(nonIdx([new THREE.BoxGeometry(0.02, 0.13, 0.44).translate(2.99, 0.50, 0), new THREE.BoxGeometry(0.02, 0.13, 0.44).translate(-2.965, 0.86, 0)]), plateMat));
  const mk = [];
  for (const s of [-1, 1]) for (const x of [-2.4, -0.9, 0.6]) mk.push(new THREE.BoxGeometry(0.1, 0.035, 0.02).translate(x, 0.86, s * (hw + 0.03)));
  body.add(new THREE.Mesh(nonIdx(mk), amberMat));
  const indGeo = (s) => nonIdx([
    new THREE.BoxGeometry(0.04, 0.07, 0.2).translate(2.955, 0.94, s * 0.96), new THREE.BoxGeometry(0.04, 0.2, 0.075).translate(-2.945, 0.86, s * (hw - 0.09)),
    new THREE.BoxGeometry(0.07, 0.05, 0.03).translate(2.0, 1.56, s * (hw + 0.02)),
  ]);
  const indMats = { L: new THREE.MeshBasicMaterial({ color: 0x1a0c00 }), R: new THREE.MeshBasicMaterial({ color: 0x1a0c00 }) };
  body.add(new THREE.Mesh(indGeo(-1), indMats.L), new THREE.Mesh(indGeo(1), indMats.R));
  const revMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
  body.add(new THREE.Mesh(nonIdx([-1, 1].map(s => new THREE.BoxGeometry(0.03, 0.06, 0.16).translate(-2.948, 0.70, s * 0.62))), revMat));

  // wheels
  const wheels = [];
  const tyrePts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; tyrePts.push(new THREE.Vector2(WHEEL_R - 0.07 + Math.cos(a) * 0.07, Math.sin(a) * 0.14)); }
  const tyreGeo = mergeGeometries([
    new THREE.LatheGeometry([new THREE.Vector2(0.26, -0.14), ...tyrePts, new THREE.Vector2(0.26, 0.14)], 28).toNonIndexed(),
  ]);
  const rimParts = [new THREE.CylinderGeometry(0.275, 0.275, 0.2, 28).toNonIndexed()];
  const spokeParts = [];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; spokeParts.push(new THREE.BoxGeometry(0.05, 0.022, 0.19).rotateY(a).translate(Math.sin(a) * 0.145, 0.104, Math.cos(a) * 0.145)); }
  spokeParts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14).translate(0, 0.108, 0));
  spokeParts.push(new THREE.TorusGeometry(0.262, 0.014, 6, 32).rotateX(Math.PI / 2).translate(0, 0.102, 0));
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45, metalness: 0.7 });
  for (const [x, s] of [[AXLE_F, 1], [AXLE_F, -1], [AXLE_R, 1], [AXLE_R, -1]]) {
    const pivot = new THREE.Group();           // steering
    const spin = new THREE.Group();            // rolling
    pivot.position.set(x, WHEEL_R, s * (hw - 0.17));
    const t = new THREE.Mesh(tyreGeo, tyre); const rim = new THREE.Mesh(rimParts[0], rimDark);
    const sp = new THREE.Mesh(mergeGeometries(spokeParts.map(g => g.index ? g.toNonIndexed() : g)), chrome);
    const wheel = new THREE.Group(); wheel.add(t, rim, sp);
    wheel.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2;   // lathe axis (y) -> axle (z), hub cap outward
    spin.add(wheel); pivot.add(spin); root.add(pivot);
    wheels.push({ pivot, spin, front: x > 0, side: s });
  }

  // contact shadow
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 3.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.9 }));
  shadow.position.y = 0.03; shadow.layers.set(1); shadow.renderOrder = 2;
  root.add(shadow);

  // headlight beams: two real spot lights plus visible cones in the rain
  const lights = [];
  for (const s of [-1, 1]) {
    const sl = new THREE.SpotLight(0xfff0d8, 900, 70, 0.62, 0.7, 1.7);
    sl.position.set(2.7, 0.95, s * 0.76);
    sl.target.position.set(22, -0.6, s * 1.6);
    body.add(sl, sl.target);
    lights.push(sl);
  }
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uK: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vT = uv.y; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform float uK; varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ float rim = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float a = rim * pow(clamp(vT, 0.0, 1.0), 2.2) * 0.34 * uK; gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, 1.0); }`,
  });
  const beams = [];
  for (const s of [-1, 1]) {
    const len = 17;
    const g = new THREE.ConeGeometry(3.4, len, 20, 1, true).translate(0, -len / 2, 0).rotateZ(Math.PI / 2 - 0.04);   // apex at the lamp, opening forward
    const m = new THREE.Mesh(g, beamMat);
    m.position.set(2.9, 0.95, s * 0.76); m.layers.set(1);
    body.add(m); beams.push(m);
  }

  return { root, body, wheels, mats, lights, beams, shadow, headMesh, tailMesh, indMats, revMat };
}

// ------------------------------------------------------------------------------------------- physics
const P = {
  accel: 13.5, brake: 26, vmax: 27, vmaxBoost: 40, reverse: 9,
  grip: 7.5, driftGrip: 1.9, wheelbase: AXLE_F - AXLE_R,
};

export class Van {
  constructor(world) {
    this.model = createVanModel();
    this.world = world;          // { colliders, obstacles }
    this.pos = new THREE.Vector3(5.2, 0, 236);
    this.heading = -Math.PI / 2;   // facing north (-z)
    this.vel = new THREE.Vector2(0, 0);
    this.yawRate = 0; this.steer = 0;
    this.speed = 0; this.slip = 0; this.drifting = false; this.boost = 0;
    this.y = 0; this.vy = 0; this.roll = 0; this.pitch = 0; this.bounce = 0; this.bounceV = 0;
    this.impact = 0; this.onKerb = false; this.braking = false; this.wheelSpin = 0;
    this.air = false; this.airT = 0; this.vyGround = 0; this.gyPrev = undefined; this.kerbY = 0; this.slopePitch = 0; this.lastOk = new THREE.Vector3(5.2, 0, 236);
    this.events = [];
    this.sync(0);
  }
  reset(x, z, heading) {
    this.pos.set(x, 0, z); this.heading = heading; this.vel.set(0, 0); this.yawRate = 0; this.steer = 0; this.boost = 0;
    this.air = false; this.vy = 0; this.vyGround = 0; this.gyPrev = undefined; this.kerbY = 0; this.y = heightAt(x, z); this.lastOk.set(x, 0, z);
  }
  get forward() { return new THREE.Vector2(Math.cos(this.heading), Math.sin(this.heading)); }

  update(dt, input) {
    if (this.air) input = { throttle: 0, steer: 0, drift: false };
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vr = this.vel.x * rx + this.vel.y * rz;
    const boosting = this.boost > 0;
    if (boosting) this.boost -= dt;
    let vmax = boosting ? P.vmaxBoost : P.vmax;
    if (this.heavy) vmax *= 0.9;
    if (this.limit) vmax = Math.min(vmax, this.limit);
    const kerbDrag = this.onKerb ? 0.9 : 0;

    // drive / brake / reverse
    this.braking = false;
    let acc = 0;
    if (input.throttle > 0) acc = input.throttle * P.accel * (boosting ? 1.9 : 1) * (this.heavy ? 0.78 : 1) * Math.max(0, 1 - vf / vmax) + (vf < 0 ? P.brake * 0.6 : 0);
    if (this.limit && vf > this.limit) acc -= (vf - this.limit) * 2.5;
    else if (input.throttle < 0) {
      if (vf > 0.8) { acc = -P.brake; this.braking = true; }
      else acc = -P.accel * 0.6 * Math.max(0, 1 + vf / P.reverse);
    }
    if (boosting && input.throttle >= 0) acc = Math.max(acc, P.accel * 1.2 * Math.max(0, 1 - vf / vmax));
    vf += acc * dt;
    vf -= vf * (0.16 + kerbDrag) * dt + Math.sign(vf) * Math.min(Math.abs(vf), (input.throttle === 0 ? 2.2 : 0.4) * dt);

    // steering: quick at low speed, calmer at high speed
    const sp = Math.abs(vf);
    const maxSteer = 0.62 / (1 + sp * 0.085);
    const target = input.steer * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, dt * (input.steer === 0 ? 9 : 6.5));
    const handbrake = input.drift && sp > 4;
    let yawTarget = (vf / P.wheelbase) * Math.tan(this.steer) * (handbrake ? 1.55 : 1.0);
    if (!this.air) this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * (handbrake ? 5 : 9));
    this.heading += this.yawRate * dt;

    // lateral grip: tyres let go progressively on the wet road
    const grip = this.air ? 0 : (handbrake ? P.driftGrip : P.grip) / (1 + Math.abs(vr) * 0.10);
    vr -= vr * Math.min(1, grip * dt);
    if (handbrake) vf -= vf * 0.35 * dt;
    this.slip = Math.abs(vr);
    this.drifting = this.slip > 2.6 && sp > 5;

    // rebuild world velocity using the new heading: lateral velocity is what makes the slide
    const nfx = Math.cos(this.heading), nfz = Math.sin(this.heading);
    // keep the lateral component in the OLD right-vector frame so momentum carries through the turn
    this.vel.set(nfx * vf + rx * vr, nfz * vf + rz * vr);
    const sub = Math.max(1, Math.ceil(this.vel.length() * dt / 0.5));
    for (let i = 0; i < sub; i++) {
      this.pos.x += this.vel.x * dt / sub; this.pos.z += this.vel.y * dt / sub;
      this.collide();
    }
    this.speed = this.vel.length();
    this.vf = this.vel.x * nfx + this.vel.y * nfz;

    // kerbs + suspension
    const terr = heightAt(this.pos.x, this.pos.z);
    const kerb = groundHeight(this.pos.x, this.pos.z) - terr;
    this.onKerb = kerb > 0.01;
    if (Math.abs(kerb - this.kerbY) > 0.02 && !this.air) this.bounceV += (kerb > this.kerbY ? 1 : -0.6) * Math.min(2.2, 0.5 + this.speed * 0.09);
    this.kerbY += (kerb - this.kerbY) * Math.min(1, dt * 14);
    const gy = terr + this.kerbY;
    // hills: when the road falls away (or levels off) faster than the van can follow, it flies
    const slope = (heightAt(this.pos.x + nfx * 1.5, this.pos.z + nfz * 1.5) - heightAt(this.pos.x - nfx * 1.5, this.pos.z - nfz * 1.5)) / 3;
    let pitchGround = Math.atan(slope);
    if (this.air) {
      this.vy -= 15 * dt; this.y += this.vy * dt; this.airT += dt;
      pitchGround = THREE.MathUtils.clamp(Math.atan2(this.vy, Math.max(6, this.speed)) * 0.6, -0.3, 0.3);
      if (this.y <= gy) {
        this.y = gy; this.air = false;
        this.bounceV -= Math.min(4.5, -this.vy * 0.5);
        if (this.airT > 0.22) this.events.push({ type: 'land', t: this.airT });
        this.vy = 0; this.justLanded = true;
      }
    } else {
      const groundVy = this.gyPrev === undefined || dt <= 0 ? 0 : (terr - this.gyPrev) / dt;
      if (this.justLanded) { this.vyGround = groundVy; this.justLanded = false; }
      // vyGround is the vertical speed the body has settled into; a sudden change in the road's is a crest
      if (this.vyGround - groundVy > 1.4 && this.speed > 8 && Math.abs(groundVy) < 12) { this.air = true; this.airT = 0; this.vy = this.vyGround; }
      else { this.y = gy; this.vyGround += (groundVy - this.vyGround) * Math.min(1, dt * 6); }
    }
    this.gyPrev = terr;
    this.slopePitch += (pitchGround - this.slopePitch) * Math.min(1, dt * (this.air ? 3 : 12));
    this.bounceV += (-this.bounce * 120 - this.bounceV * 11) * dt;
    this.bounce += this.bounceV * dt;
    const latAcc = this.yawRate * vf;
    const rollT = THREE.MathUtils.clamp(-latAcc * 0.0085 - vr * 0.006, -0.11, 0.11);
    const pitchT = THREE.MathUtils.clamp(-acc * 0.0032, -0.05, 0.06);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 6);
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 5);
    this.wheelSpin += (vf / WHEEL_R) * dt;
    // indicators follow the steering at town speeds; hazards flash after a knock
    this.clock = (this.clock || 0) + dt;
    if (this.impact > 0.25) this.hazard = 2.2;
    this.hazard = Math.max(0, (this.hazard || 0) - dt);
    const blink = (this.clock * 2.6) % 1 < 0.55;
    this.indL = blink && (this.hazard > 0 || (input.steer < -0.3 && this.speed < 16 && this.speed > 0.5));
    this.indR = blink && (this.hazard > 0 || (input.steer > 0.3 && this.speed < 16 && this.speed > 0.5));
    this.reversing = vf < -0.4;
    this.impact = Math.max(0, this.impact - dt * 2.5);
    this.sync(dt);
  }

  collide() {
    const { colliders, obstacles } = this.world;
    const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    const R = 1.18;
    for (const off of [1.75, 0, -1.75]) {
      let cx = this.pos.x + fx * off, cz = this.pos.z + fz * off;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        const px = Math.max(b.x0, Math.min(cx, b.x1)), pz = Math.max(b.z0, Math.min(cz, b.z1));
        let dx = cx - px, dz = cz - pz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        let d = Math.sqrt(d2), nx, nz, pen;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; pen = R - d; }
        else {
          // centre is inside the box: push out through the nearest face
          const l = cx - b.x0, r = b.x1 - cx, t = cz - b.z0, bt = b.z1 - cz; const m = Math.min(l, r, t, bt);
          if (m === l) { nx = -1; nz = 0; pen = l + R; } else if (m === r) { nx = 1; nz = 0; pen = r + R; }
          else if (m === t) { nx = 0; nz = -1; pen = t + R; } else { nx = 0; nz = 1; pen = bt + R; }
        }
        this.resolve(nx, nz, pen, off);
        cx = this.pos.x + fx * off; cz = this.pos.z + fz * off;
      }
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        const dx = cx - o.x, dz = cz - o.z, rr = R - 0.25 + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        this.resolve(dx / d, dz / d, rr - d, off);
        cx = this.pos.x + fx * off; cz = this.pos.z + fz * off;
      }
    }
    // hard limits: lake railing and the edge of the map
    // edge of the drivable world: railings, cliffs, the backs of blocks
    if (inBounds(this.pos.x, this.pos.z)) this.lastOk.copy(this.pos);
    else { this.pos.x = this.lastOk.x; this.pos.z = this.lastOk.z; this.vel.multiplyScalar(-0.15); }
  }

  resolve(nx, nz, pen, off) {
    this.pos.x += nx * pen; this.pos.z += nz * pen;
    const vn = this.vel.x * nx + this.vel.y * nz;
    if (vn < 0) {
      const hit = -vn;
      this.vel.x -= nx * vn * 1.22; this.vel.y -= nz * vn * 1.22;
      this.vel.multiplyScalar(1 - Math.min(0.35, hit * 0.012));
      // glancing blows turn the van along the wall instead of stopping it dead
      const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
      const cross = fx * nz - fz * nx;
      this.heading += cross * Math.min(0.06, hit * 0.004) * (off >= 0 ? 1 : -1);
      if (hit > 3 && this.impact < 0.2) { this.events.push({ type: 'crash', force: hit }); }
      this.impact = Math.max(this.impact, Math.min(1, hit / 14));
    }
  }

  sync() {
    const m = this.model;
    m.root.position.set(this.pos.x, this.y, this.pos.z);
    m.root.rotation.y = -this.heading;
    m.root.rotation.z = this.slopePitch;
    m.body.position.y = this.bounce * 0.05;
    m.body.rotation.x = this.roll;
    m.body.rotation.z = this.pitch;
    for (const w of m.wheels) {
      if (w.front) w.pivot.rotation.y = -this.steer;
      w.spin.rotation.z = -this.wheelSpin;
    }
    m.indMats.L.color.setRGB(this.indL ? 9 : 0.1, this.indL ? 4.2 : 0.05, this.indL ? 0.3 : 0);
    m.indMats.R.color.setRGB(this.indR ? 9 : 0.1, this.indR ? 4.2 : 0.05, this.indR ? 0.3 : 0);
    m.revMat.color.setScalar(this.reversing ? 7 : 0.08);
    m.tailMesh.material.color.setRGB(this.braking ? 16 : 5, this.braking ? 0.4 : 0.12, this.braking ? 0.25 : 0.08);
  }
}
