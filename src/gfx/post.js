import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, Effect, SMAAPreset, NoiseEffect, BlendFunction, ChromaticAberrationEffect,
  BrightnessContrastEffect, HueSaturationEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));

  // Safety net: one invalid (NaN / infinite) pixel would be smeared over the whole frame by the bloom blur,
  // so sanitise the rendered image before anything filters it.
  const sanitize = new Effect('Sanitize', /* glsl */`
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      vec3 c = inputColor.rgb;
      if (isnan(c.r) || isnan(c.g) || isnan(c.b) || isinf(c.r) || isinf(c.g) || isinf(c.b)) c = vec3(0.0);
      outputColor = vec4(clamp(c, vec3(0.0), vec3(64.0)), inputColor.a);
    }`);
  composer.addPass(new EffectPass(camera, sanitize));

  const ao = new N8AOPostPass(scene, camera, 1, 1);
  ao.configuration.aoRadius = 2.2;
  ao.configuration.distanceFalloff = 1.2;
  ao.configuration.intensity = 3.2;
  ao.configuration.halfRes = true;
  ao.configuration.depthAwareUpsampling = true;
  ao.configuration.color = new THREE.Color(0.0, 0.004, 0.012);
  ao.setQualityMode('Medium');
  composer.addPass(ao);

  const bloom = new BloomEffect({
    mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.35, intensity: 1.05, radius: 0.78, levels: 8,
  });
  const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.35 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
  const sat = new HueSaturationEffect({ saturation: 0.12 });
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = 0.11;

  composer.addPass(new EffectPass(camera, bloom));
  composer.addPass(new EffectPass(camera, chroma));
  composer.addPass(new EffectPass(camera, tone, grade, sat, vignette, grain));
  const smaa = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
  composer.addPass(smaa);

  return { composer, bloom, ao, chroma };
}
