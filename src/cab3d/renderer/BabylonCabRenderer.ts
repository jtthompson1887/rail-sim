import {
  Engine,
  Scene,
  UniversalCamera,
  HemisphericLight,
  Vector3,
  Color3,
  MeshBuilder,
  PBRMaterial,
} from '@babylonjs/core';
import { CabCanvasMount } from './CabCanvasMount';
import type { ICabRenderer } from '../contracts/ICabRenderer';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import { worldToBabylon } from '../model/CabCoordinate';
import { CabConfig } from '../CabConfig';

/**
 * Babylon.js cab renderer.
 *
 * This module is the only place in `src/cab3d` that imports `@babylonjs/*`.
 * It is lazy-loaded by {@link CabViewHost} into a separate webpack chunk.
 */
export default class BabylonCabRenderer implements ICabRenderer {
  private mount: CabCanvasMount;
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: UniversalCamera | null = null;

  constructor() {
    this.mount = new CabCanvasMount();
  }

  isReady(): boolean {
    return this.engine !== null && this.scene !== null;
  }

  show(): void {
    if (!this.engine) {
      this.createEngine();
    }
    this.mount.show();
  }

  hide(): void {
    this.mount.hide();
  }

  render(snapshot: CabWorldSnapshot): void {
    if (!this.isReady() || !snapshot.vehicle) return;

    const { x, y, z } = worldToBabylon(
      snapshot.vehicle.x,
      snapshot.vehicle.y,
      this.terrainHeightAt(snapshot.vehicle.x, snapshot.vehicle.y) + CabConfig.EYE_HEIGHT_M,
    );

    this.camera?.position.set(x, y, z);
    this.camera?.rotation.set(0, snapshot.vehicle.headingRad, 0);

    this.scene?.render();
  }

  destroy(): void {
    this.engine?.dispose();
    this.mount.destroy();
    this.engine = null;
    this.scene = null;
    this.camera = null;
  }

  private createEngine(): void {
    this.engine = new Engine(this.mount.canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color3(0.5, 0.7, 0.9).toColor4(1);

    this.camera = new UniversalCamera(
      'cabCamera',
      new Vector3(0, CabConfig.EYE_HEIGHT_M, 0),
      this.scene,
    );
    this.camera.fov = (CabConfig.FOV_DEG * Math.PI) / 180;
    this.camera.minZ = CabConfig.MIN_Z;
    this.camera.maxZ = CabConfig.MAX_Z;
    this.camera.attachControl(this.mount.canvas, true);

    new HemisphericLight(
      'cabAmbient',
      new Vector3(0, 1, 0),
      this.scene,
    );

    // Minimal placeholder mesh so the first frame has something to draw.
    const ground = MeshBuilder.CreateGround(
      'placeholderGround',
      { width: 1000, height: 1000 },
      this.scene,
    );
    const material = new PBRMaterial('placeholderMaterial', this.scene);
    material.albedoColor = new Color3(0.3, 0.35, 0.25);
    material.roughness = 0.8;
    ground.material = material;
  }

  private terrainHeightAt(_worldX: number, _worldY: number): number {
    // Phase 1: flat placeholder. Phase 2 will query TerrainGenerator.
    return 0;
  }
}
