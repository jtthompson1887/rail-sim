import {
  Scene,
  Camera,
  DirectionalLight,
  AbstractMesh,
  CascadedShadowGenerator,
  ShadowGenerator,
} from '@babylonjs/core';
import { CabConfig } from '../CabConfig';

/**
 * Owns the cascaded shadow generator for the 3-D cab view.
 *
 * Only rails, sleepers and the current near-ring scenery prototypes are added as
 * shadow casters. The cab interior is never registered and has
 * `receiveShadows = false` on all of its meshes.
 */
export class CabShadowManager {
  private generator: CascadedShadowGenerator | null = null;
  private casters = new Set<AbstractMesh>();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  /** Create and configure a CascadedShadowGenerator on the directional sun light. */
  attach(sunLight: DirectionalLight): void {
    if (this.generator) return;

    const generator = new CascadedShadowGenerator(
      CabConfig.SHADOW_MAP_SIZE,
      sunLight,
      false,
      this.camera,
      true,
    );

    generator.numCascades = CabConfig.SHADOW_CASCADES;
    generator.shadowMaxZ = CabConfig.SHADOW_MAX_Z_M;
    generator.lambda = CabConfig.SHADOW_LAMBDA;
    generator.usePercentageCloserFiltering = true;
    generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;

    this.generator = generator;
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
    if (this.generator) {
      for (const mesh of this.casters) {
        this.generator.removeShadowCaster(mesh);
      }
      this.generator.dispose();
      this.generator = null;
    }
    this.casters.clear();
  }
}
