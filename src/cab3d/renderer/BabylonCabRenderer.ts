import {
  Engine,
  Scene,
  UniversalCamera,
  HemisphericLight,
  Vector3,
  Color3,
} from '@babylonjs/core';
import { CabCanvasMount } from './CabCanvasMount';
import { TrackMeshBuilder } from './TrackMeshBuilder';
import type { ICabRenderer } from '../contracts/ICabRenderer';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import { CabCameraRig, type CabEyeTransform } from '../camera/CabCameraRig';
import { CabConfig } from '../CabConfig';

declare global {
  interface Window {
    __railSimCab3d?: {
      snapshot: () => { eye: CabEyeTransform | null; snapshot: CabWorldSnapshot | null };
    };
  }
}

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
  private cameraRig: CabCameraRig | null = null;
  private trackMeshBuilder: TrackMeshBuilder | null = null;
  private lastSnapshot: CabWorldSnapshot | null = null;
  private lastEye: CabEyeTransform | null = null;

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

  render(snapshot: CabWorldSnapshot, deltaMs: number): void {
    if (!this.isReady()) return;
    this.lastSnapshot = snapshot;

    if (snapshot.vehicle) {
      if (!this.cameraRig) {
        this.cameraRig = new CabCameraRig();
      }
      this.lastEye = this.cameraRig.update(deltaMs, snapshot);
      this.camera?.position.set(this.lastEye.position.x, this.lastEye.position.y, this.lastEye.position.z);
      this.camera?.rotation.set(this.lastEye.rotation.x, this.lastEye.rotation.y, this.lastEye.rotation.z);
    }

    this.trackMeshBuilder?.build(snapshot, this.lastEye?.position ?? null);

    this.scene?.render();
  }

  destroy(): void {
    this.trackMeshBuilder?.dispose();
    this.trackMeshBuilder = null;
    this.engine?.dispose();
    this.mount.destroy();
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
  }

  private snapshot() {
    return { eye: this.lastEye, snapshot: this.lastSnapshot };
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

    this.trackMeshBuilder = new TrackMeshBuilder(this.scene);

    window.__railSimCab3d = { snapshot: () => this.snapshot() };
  }
}
