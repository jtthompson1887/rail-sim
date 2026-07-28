import {
  Scene,
  Camera,
  DirectionalLight,
  AbstractMesh,
  CascadedShadowGenerator,
  ShadowGenerator,
} from '@babylonjs/core';
import { CabConfig } from '../CabConfig';

/** Settings used to configure (or reconfigure) the shadow generator. */
export interface CabShadowSettings {
  /** Shadow map resolution in pixels. */
  readonly size: number;
  /** Number of cascades. A value of 0 disables shadow generation. */
  readonly cascades: number;
  /** Maximum shadow-casting distance in metres. */
  readonly maxZ: number;
  /** Cascade split lambda. */
  readonly lambda: number;
}

const DEFAULT_SETTINGS: CabShadowSettings = Object.freeze({
  size: CabConfig.SHADOW_MAP_SIZE,
  cascades: CabConfig.SHADOW_CASCADES,
  maxZ: CabConfig.SHADOW_MAX_Z_M,
  lambda: CabConfig.SHADOW_LAMBDA,
});

function settingsEqual(
  a: CabShadowSettings,
  b: CabShadowSettings,
): boolean {
  return (
    a.size === b.size &&
    a.cascades === b.cascades &&
    a.maxZ === b.maxZ &&
    a.lambda === b.lambda
  );
}

/**
 * Owns the cascaded shadow generator for the 3-D cab view.
 *
 * Only rails, sleepers and the current near-ring scenery prototypes are added as
 * shadow casters. The cab interior is never registered and has
 * `receiveShadows = false` on all of its meshes.
 */
export class CabShadowManager {
  private generator: CascadedShadowGenerator | null = null;
  private currentSettings: CabShadowSettings | null = null;
  private casters = new Set<AbstractMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  /** Create or reconfigure a CascadedShadowGenerator on the directional sun light. */
  attach(sunLight: DirectionalLight, settings?: Partial<CabShadowSettings>): void {
    const next: CabShadowSettings = { ...DEFAULT_SETTINGS, ...settings };

    if (this.generator && this.currentSettings && settingsEqual(this.currentSettings, next)) {
      return;
    }

    this.disposeGenerator();
    this.currentSettings = next;

    if (next.cascades <= 0) {
      return;
    }

    const generator = new CascadedShadowGenerator(
      next.size,
      sunLight,
      false,
      this.camera,
      true,
    );

    generator.numCascades = next.cascades;
    generator.shadowMaxZ = next.maxZ;
    generator.lambda = next.lambda;
    generator.usePercentageCloserFiltering = true;
    generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;

    this.generator = generator;
  }

  /** Reconfigure shadow settings without changing the light or camera. */
  configure(sunLight: DirectionalLight, settings: Partial<CabShadowSettings>): void {
    this.attach(sunLight, settings);
  }

  /**
   * Reconcile the current shadow caster list with the supplied track and scenery
   * meshes. Meshes that have disappeared are removed; new meshes are added.
   */
  sync(
    trackCasters: ReadonlyArray<AbstractMesh>,
    sceneryCasters: ReadonlyArray<AbstractMesh>,
  ): void {
    if (!this.generator) return;

    const next = new Set<AbstractMesh>([...trackCasters, ...sceneryCasters]);

    for (const mesh of this.casters) {
      if (!next.has(mesh)) {
        this.generator.removeShadowCaster(mesh);
      }
    }

    for (const mesh of next) {
      if (!this.casters.has(mesh)) {
        this.generator.addShadowCaster(mesh, true);
        mesh.receiveShadows = true;
      }
    }

    this.casters = next;
  }

  /** Release the shadow generator and all tracked casters. */
  dispose(): void {
    this.disposeGenerator();
    this.casters.clear();
    this.currentSettings = null;
  }

  private disposeGenerator(): void {
    if (this.generator) {
      for (const mesh of this.casters) {
        this.generator.removeShadowCaster(mesh);
      }
      this.generator.dispose();
      this.generator = null;
    }
  }
}
