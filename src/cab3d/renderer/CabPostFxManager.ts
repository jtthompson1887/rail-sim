import {
  Scene,
  Camera,
  DefaultRenderingPipeline,
  MotionBlurPostProcess,
  DepthOfFieldEffectBlurLevel,
} from '@babylonjs/core';
import { CabConfig } from '../CabConfig';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';

/**
 * Owns the post-processing pipeline for the 3-D cab view.
 *
 * Uses a DefaultRenderingPipeline for bloom, DoF, FXAA, chromatic aberration
 * and film grain. Motion blur is constructed on demand and is disabled by
 * default (ultra tier only).
 */
export class CabPostFxManager {
  private pipeline: DefaultRenderingPipeline | null = null;
  private motionBlur: MotionBlurPostProcess | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  /** Build the DefaultRenderingPipeline and configure its effects. */
  attach(): void {
    if (this.pipeline) return;

    const pipeline = new DefaultRenderingPipeline(
      'cabPostFx',
      true,
      this.scene,
      [this.camera],
      true,
    );

    pipeline.samples = CabConfig.POSTFX_SAMPLES;
    pipeline.fxaaEnabled = true;

    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = CabConfig.POSTFX_BLOOM_THRESHOLD;
    pipeline.bloomWeight = CabConfig.POSTFX_BLOOM_WEIGHT;
    pipeline.bloomKernel = CabConfig.POSTFX_BLOOM_KERNEL;
    pipeline.bloomScale = CabConfig.POSTFX_BLOOM_SCALE;

    pipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Medium;
    pipeline.depthOfFieldEnabled = true;
    pipeline.depthOfField.focusDistance = CabConfig.POSTFX_DOF_FOCUS_DISTANCE_MM;
    pipeline.depthOfField.fStop = CabConfig.POSTFX_DOF_FSTOP;
    pipeline.depthOfField.focalLength = CabConfig.POSTFX_DOF_FOCAL_LENGTH_MM;

    pipeline.chromaticAberrationEnabled = true;
    pipeline.chromaticAberration.aberrationAmount = CabConfig.POSTFX_CHROMATIC_ABERRATION;

    pipeline.grainEnabled = true;
    pipeline.grain.intensity = CabConfig.POSTFX_GRAIN_INTENSITY;
    pipeline.grain.animated = true;

    pipeline.imageProcessingEnabled = false;

    this.pipeline = pipeline;
  }

  /** Update post-FX settings from the current snapshot. */
  update(snapshot: CabWorldSnapshot): void {
    if (!this.pipeline) return;

    const deterministic = snapshot.deterministic === true;
    this.pipeline.grain.animated = !deterministic;

    if (deterministic) {
      this.setMotionBlurEnabled(false);
    }
  }

  /** Enable or disable the optional motion blur post-process (ultra tier). */
  setMotionBlurEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.motionBlur) return;

      const blur = new MotionBlurPostProcess(
        'cabMotionBlur',
        this.scene,
        1.0,
        this.camera,
      );
      blur.motionStrength = CabConfig.POSTFX_MOTION_BLUR_STRENGTH;
      blur.motionBlurSamples = CabConfig.POSTFX_MOTION_BLUR_SAMPLES;
      blur.isObjectBased = false;
      this.motionBlur = blur;
    } else if (this.motionBlur) {
      this.motionBlur.dispose(this.camera);
      this.motionBlur = null;
    }
  }

  /** Dispose the pipeline and any optional post-processes. */
  dispose(): void {
    this.setMotionBlurEnabled(false);
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
