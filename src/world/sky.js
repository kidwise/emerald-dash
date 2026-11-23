import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY } from '../gfx/glsl.js';

// Camera-centred sky dome. Also baked into the image-based lighting environment.
export function createSky() {
  const uniforms = { uTime: { value: 0 }, uCityLights: { value: 0 }, uClear: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 100.0, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uCityLights;
      uniform float uClear;
      varying vec3 vDir;
      ${GLSL_NOISE}
      ${GLSL_SKY}
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d, uTime);
        if (uClear > 0.0) {
          // clear evening: no cloud deck, a long band of afterglow in the west
          float h = max(d.y, 0.0);
          float az = max(dot(normalize(d.xz + 1e-5), SUN_XZ), 0.0);
          vec3 clr = mix(vec3(0.10, 0.16, 0.30), vec3(0.012, 0.03, 0.10), pow(h, 0.5));
          clr += vec3(1.25, 0.50, 0.16) * pow(az, 2.5) * exp(-h * 5.0) * 0.9 + vec3(0.9, 0.3, 0.45) * pow(az, 1.2) * exp(-h * 2.6) * 0.22;
          float wisps = smoothstep(0.55, 0.8, fbm(d.xz / (h + 0.2) * vec2(0.5, 2.2) + 4.0)) * exp(-h * 3.0);
          clr += vec3(1.0, 0.45, 0.25) * wisps * 0.25 * (0.3 + az);
          float stars = step(0.9985, hash12(floor(d.xz / (h + 0.3) * 260.0))) * smoothstep(0.15, 0.5, h);
          clr += stars * 0.9;
          if (d.y < 0.0) clr = mix(clr, vec3(0.012, 0.016, 0.026), smoothstep(0.0, -0.12, d.y));
          col = mix(col, clr, uClear);
        }
        // Only in the lighting bake: a ring of fake city lights so glossy things sparkle.
        if (uCityLights > 0.5) {
          float az = atan(d.z, d.x);
          vec2 g = vec2(az * 28.0, d.y * 60.0);
          vec2 id = floor(g);
          float r = hash12(id);
          float band = smoothstep(0.26, 0.02, abs(d.y - 0.07));
          vec2 f = fract(g) - 0.5;
          float dotm = smoothstep(0.42, 0.1, length(f)) * step(0.62, r) * band;
          vec3 lc = mix(vec3(1.0, 0.72, 0.42), vec3(0.55, 0.8, 1.0), step(0.86, r));
          lc = mix(lc, vec3(1.0, 0.2, 0.45), step(0.95, r));
          col += lc * dotm * 2.2;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

// Bake the sky into a prefiltered environment map for reflections and ambient light.
export function bakeEnvironment(renderer, sky) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const parent = sky.mesh.parent;
  scene.add(sky.mesh);
  sky.uniforms.uCityLights.value = 1;
  const rt = pmrem.fromScene(scene, 0, 0.1, 1000);
  sky.uniforms.uCityLights.value = 0;
  if (parent) parent.add(sky.mesh);
  pmrem.dispose();
  return rt.texture;
}
