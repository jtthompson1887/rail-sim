/**
 * Minimal hand-rolled mock of `@babylonjs/core` for unit tests.
 *
 * Real Babylon cannot run in jsdom, so the two manager tests use this mock to
 * verify construction, configuration wiring, and lifecycle without a WebGL
 * context.
 */

export class Camera {
  name = 'Camera';
}

export class AbstractMesh {
  name = 'AbstractMesh';
  receiveShadows = false;
  isEnabled(): boolean {
    return true;
  }
}

export class Mesh extends AbstractMesh {
  name = 'Mesh';
}

export class Scene {
  name = 'Scene';
  cameras: Camera[] = [];
}

export class DirectionalLight {
  name = 'DirectionalLight';
}

export class ShadowGenerator {
  static readonly FILTER_PCF = 6;
  static readonly QUALITY_MEDIUM = 1;

  addShadowCaster = jest.fn().mockReturnValue(this);
  removeShadowCaster = jest.fn().mockReturnValue(this);
  getShadowMap = jest.fn().mockReturnValue({ renderList: [] });
  dispose = jest.fn();

  numCascades = 0;
  shadowMaxZ = 0;
  lambda = 0;
  usePercentageCloserFiltering = false;
  filteringQuality = 0;
}

export class CascadedShadowGenerator extends ShadowGenerator {
  name = 'CascadedShadowGenerator';
}

export class PostProcess {
  name = 'PostProcess';
  dispose = jest.fn();
}

export class MotionBlurPostProcess extends PostProcess {
  motionStrength = 0;
  motionBlurSamples = 0;
  isObjectBased = true;
}

export class FxaaPostProcess {}
export class SharpenPostProcess {}
export class ImageProcessingPostProcess {}
export class ChromaticAberrationPostProcess {
  aberrationAmount = 0;
}
export class GrainPostProcess {
  intensity = 0;
  animated = false;
}

export class DepthOfFieldEffect {
  focusDistance = 0;
  fStop = 0;
  focalLength = 0;
}

export enum DepthOfFieldEffectBlurLevel {
  Low = 0,
  Medium = 1,
  High = 2,
}

export class GlowLayer {}

export class DefaultRenderingPipeline {
  name = 'DefaultRenderingPipeline';

  samples = 0;
  fxaaEnabled = false;
  bloomEnabled = false;
  bloomThreshold = 0;
  bloomWeight = 0;
  bloomKernel = 0;
  bloomScale = 0;
  depthOfFieldEnabled = false;
  depthOfFieldBlurLevel: DepthOfFieldEffectBlurLevel = DepthOfFieldEffectBlurLevel.Low;
  chromaticAberrationEnabled = false;
  grainEnabled = false;
  imageProcessingEnabled = true;

  depthOfField = new DepthOfFieldEffect();
  chromaticAberration = new ChromaticAberrationPostProcess();
  grain = new GrainPostProcess();
  fxaa = new FxaaPostProcess();
  imageProcessing = new ImageProcessingPostProcess();
  sharpen = new SharpenPostProcess();

  dispose = jest.fn();
}

export class Engine {
  constructor(canvas: any) {}
  dispose = jest.fn();
}

export class UniversalCamera extends Camera {}
export class HemisphericLight {}
export class PointLight {}
export class TransformNode {}
export class Vector3 {
  static Up() {
    return new Vector3(0, 1, 0);
  }
  static Down() {
    return new Vector3(0, -1, 0);
  }
  static Zero() {
    return new Vector3(0, 0, 0);
  }
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class Color3 {
  constructor(public r = 0, public g = 0, public b = 0) {}
  toColor4(alpha = 1) {
    return new Color4(this.r, this.g, this.b, alpha);
  }
  static FromHexString(hex: string) {
    return new Color3();
  }
}

export class Color4 {
  constructor(public r = 0, public g = 0, public b = 0, public a = 0) {}
}

export class ReflectionProbe {
  renderList: any[] = [];
  cubeTexture = { refreshRate: 0, resetRefreshCounter: jest.fn() };
  dispose = jest.fn();
}

export class ImageProcessingConfiguration {
  static readonly TONEMAPPING_ACES = 1;
  toneMappingEnabled = false;
  toneMappingType = 0;
  exposure = 0;
  contrast = 0;
}

export class MeshBuilder {
  static CreateBox() {
    return new Mesh();
  }
  static CreateGround() {
    return new Mesh();
  }
  static ExtrudeShape() {
    return new Mesh();
  }
  static CreateCylinder() {
    return new Mesh();
  }
  static CreateSphere() {
    return new Mesh();
  }
  static CreateTube() {
    return new Mesh();
  }
  static CreateTorus() {
    return new Mesh();
  }
  static CreatePlane() {
    return new Mesh();
  }
}

export const Constants = {
  TEXTUREFORMAT_RGBA: 0,
};

export class RawTexture {
  uOffset = 0;
  vOffset = 0;
}

export class Texture {
  static readonly TRILINEAR_SAMPLINGMODE = 0;
}

export class PBRMaterial {}

export class DynamicTexture {
  getContext = jest.fn().mockReturnValue({
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    fillText: jest.fn(),
    strokeText: jest.fn(),
    measureText: jest.fn().mockReturnValue({ width: 0 }),
    set transform(value: any) {},
  });
  update = jest.fn();
  dispose = jest.fn();
}

export class Space {
  static readonly LOCAL = 0;
}
