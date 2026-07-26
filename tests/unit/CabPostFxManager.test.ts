import {
  DefaultRenderingPipeline,
  MotionBlurPostProcess,
  DepthOfFieldEffectBlurLevel,
} from '@babylonjs/core';
import { CabPostFxManager } from '../../src/cab3d/renderer/CabPostFxManager';
import { CabConfig } from '../../src/cab3d/CabConfig';

describe('CabPostFxManager', () => {
  let scene: any;
  let camera: any;
  let manager: CabPostFxManager;

  beforeEach(() => {
    scene = {};
    camera = {};
    manager = new CabPostFxManager(scene, camera);
  });

  afterEach(() => {
    manager.dispose();
  });

  it('can be constructed without creating a pipeline', () => {
    expect(manager).toBeDefined();
  });

  it('builds a DefaultRenderingPipeline with the required settings', () => {
    manager.attach();

    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;
    expect(pipeline).toBeDefined();
    expect(pipeline).toBeInstanceOf(DefaultRenderingPipeline);

    expect(pipeline.samples).toBe(CabConfig.POSTFX_SAMPLES);
    expect(pipeline.fxaaEnabled).toBe(true);

    expect(pipeline.bloomEnabled).toBe(true);
    expect(pipeline.bloomThreshold).toBe(CabConfig.POSTFX_BLOOM_THRESHOLD);
    expect(pipeline.bloomWeight).toBe(CabConfig.POSTFX_BLOOM_WEIGHT);
    expect(pipeline.bloomKernel).toBe(CabConfig.POSTFX_BLOOM_KERNEL);
    expect(pipeline.bloomScale).toBe(CabConfig.POSTFX_BLOOM_SCALE);

    expect(pipeline.depthOfFieldEnabled).toBe(true);
    expect(pipeline.depthOfFieldBlurLevel).toBe(DepthOfFieldEffectBlurLevel.Medium);
    expect(pipeline.depthOfField.focusDistance).toBe(CabConfig.POSTFX_DOF_FOCUS_DISTANCE_MM);
    expect(pipeline.depthOfField.fStop).toBe(CabConfig.POSTFX_DOF_FSTOP);
    expect(pipeline.depthOfField.focalLength).toBe(CabConfig.POSTFX_DOF_FOCAL_LENGTH_MM);

    expect(pipeline.chromaticAberrationEnabled).toBe(true);
    expect(pipeline.chromaticAberration.aberrationAmount).toBe(CabConfig.POSTFX_CHROMATIC_ABERRATION);

    expect(pipeline.grainEnabled).toBe(true);
    expect(pipeline.grain.intensity).toBe(CabConfig.POSTFX_GRAIN_INTENSITY);
    expect(pipeline.grain.animated).toBe(true);

    expect(pipeline.imageProcessingEnabled).toBe(false);
  });

  it('disables grain animation and motion blur in deterministic mode', () => {
    manager.attach();
    manager.setMotionBlurEnabled(true);

    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;
    const blur = (manager as any).motionBlur as MotionBlurPostProcess;

    expect(blur).toBeDefined();
    expect(blur.motionStrength).toBe(CabConfig.POSTFX_MOTION_BLUR_STRENGTH);
    expect(blur.motionBlurSamples).toBe(CabConfig.POSTFX_MOTION_BLUR_SAMPLES);
    expect(blur.isObjectBased).toBe(false);

    manager.update({ deterministic: true } as any);

    expect(pipeline.grain.animated).toBe(false);
    expect((manager as any).motionBlur).toBeNull();
  });

  it('keeps grain animated when not deterministic', () => {
    manager.attach();
    manager.update({ deterministic: false } as any);

    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;
    expect(pipeline.grain.animated).toBe(true);
  });

  it('disables grain, DoF and motion blur when reduced motion is active', () => {
    manager.attach();
    manager.setMotionBlurEnabled(true);

    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;

    manager.update({ reducedMotion: true } as any);

    expect(pipeline.grainEnabled).toBe(false);
    expect(pipeline.depthOfFieldEnabled).toBe(false);
    expect((manager as any).motionBlur).toBeNull();
  });

  it('re-enables grain and DoF when reduced motion is cleared', () => {
    manager.attach();

    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;

    manager.update({ reducedMotion: true } as any);
    expect(pipeline.grainEnabled).toBe(false);

    manager.update({ reducedMotion: false, deterministic: false } as any);
    expect(pipeline.grainEnabled).toBe(true);
    expect(pipeline.depthOfFieldEnabled).toBe(true);
    expect(pipeline.grain.animated).toBe(true);
  });

  it('is safe to dispose without attach', () => {
    expect(() => manager.dispose()).not.toThrow();
  });

  it('disposes the pipeline and motion blur on dispose', () => {
    manager.attach();
    manager.setMotionBlurEnabled(true);
    const pipeline = (manager as any).pipeline as DefaultRenderingPipeline;
    const blur = (manager as any).motionBlur as MotionBlurPostProcess;

    manager.dispose();

    expect(blur.dispose).toHaveBeenCalled();
    expect(pipeline.dispose).toHaveBeenCalled();
  });
});
