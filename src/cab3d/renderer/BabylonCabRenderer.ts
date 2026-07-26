import {
  Engine,
  Scene,
  UniversalCamera,
  DirectionalLight,
  HemisphericLight,
  PointLight,
  TransformNode,
  MeshBuilder,
  Mesh,
  Vector3,
  Color3,
  ReflectionProbe,
  ImageProcessingConfiguration,
} from '@babylonjs/core';
import { SkyMaterial } from '@babylonjs/materials';
import { CabCanvasMount } from './CabCanvasMount';
import { TrackMeshBuilder } from './TrackMeshBuilder';
import { TerrainMeshBuilder } from './TerrainMeshBuilder';
import { SceneryInstanceBuilder } from './SceneryInstanceBuilder';
import { CabInteriorBuilder } from './CabInteriorBuilder';
import { CabInstrumentBuilder } from './CabInstrumentBuilder';
import { CabShadowManager } from './CabShadowManager';
import { CabPostFxManager } from './CabPostFxManager';
import type { ICabRenderer } from '../contracts/ICabRenderer';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import { CabCameraRig, type CabEyeTransform } from '../camera/CabCameraRig';
import { CabConfig } from '../CabConfig';
import { getSimHours, getSunVector } from '../atmosphere/CabTimeOfDay';
import { getBandColourRgb } from '../world/TerrainColour';

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
  private terrainMeshBuilder: TerrainMeshBuilder | null = null;
  private sceneryInstanceBuilder: SceneryInstanceBuilder | null = null;
  private cabInteriorBuilder: CabInteriorBuilder | null = null;
  private cabInstrumentBuilder: CabInstrumentBuilder | null = null;
  private cabBody: TransformNode | null = null;
  private skyBox: Mesh | null = null;
  private skyMaterial: SkyMaterial | null = null;
  private sunLight: DirectionalLight | null = null;
  private fillLight: HemisphericLight | null = null;
  private interiorLight: PointLight | null = null;
  private reflectionProbe: ReflectionProbe | null = null;
  private shadowManager: CabShadowManager | null = null;
  private postFxManager: CabPostFxManager | null = null;
  private lastSnapshot: CabWorldSnapshot | null = null;
  private lastEye: CabEyeTransform | null = null;
  private lastSunAltitudeDeg: number | null = null;

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

      if (this.cabBody && this.lastEye.body) {
        this.cabBody.position.set(this.lastEye.body.position.x, this.lastEye.body.position.y, this.lastEye.body.position.z);
        this.cabBody.rotation.set(this.lastEye.body.rotation.x, this.lastEye.body.rotation.y, this.lastEye.body.rotation.z);
      }
    }

    this.updateAtmosphere(snapshot);

    this.trackMeshBuilder?.build(snapshot, this.lastEye?.position ?? null);
    this.terrainMeshBuilder?.build(snapshot, this.lastEye?.position ?? null);
    this.sceneryInstanceBuilder?.build(snapshot, this.lastEye?.position ?? null);
    this.terrainMeshBuilder?.update(snapshot.elapsedSecs);
    this.cabInstrumentBuilder?.update(snapshot);

    this.shadowManager?.sync(
      this.trackMeshBuilder?.getShadowCasters() ?? [],
      this.sceneryInstanceBuilder?.getShadowCasters() ?? [],
    );
    this.postFxManager?.update(snapshot);

    this.scene?.render();
  }

  destroy(): void {
    this.reflectionProbe?.dispose();
    this.reflectionProbe = null;
    this.interiorLight?.dispose();
    this.interiorLight = null;
    this.fillLight?.dispose();
    this.fillLight = null;
    this.sunLight?.dispose();
    this.sunLight = null;
    this.skyBox?.dispose();
    this.skyBox = null;
    this.skyMaterial?.dispose();
    this.skyMaterial = null;
    this.postFxManager?.dispose();
    this.postFxManager = null;
    this.shadowManager?.dispose();
    this.shadowManager = null;
    this.trackMeshBuilder?.dispose();
    this.trackMeshBuilder = null;
    this.terrainMeshBuilder?.dispose();
    this.terrainMeshBuilder = null;
    this.sceneryInstanceBuilder?.dispose();
    this.sceneryInstanceBuilder = null;
    this.cabInstrumentBuilder = null;
    this.cabInteriorBuilder?.dispose();
    this.cabInteriorBuilder = null;
    this.cabBody?.dispose();
    this.cabBody = null;
    this.engine?.dispose();
    this.mount.destroy();
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.lastSunAltitudeDeg = null;
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

    this.createAtmosphere();

    this.cabBody = new TransformNode('cabBody', this.scene);
    this.cabInteriorBuilder = new CabInteriorBuilder(this.scene);
    this.cabInteriorBuilder.build(this.cabBody);
    this.cabInstrumentBuilder = new CabInstrumentBuilder(this.scene, this.cabInteriorBuilder);
    this.cabInstrumentBuilder.build();

    this.trackMeshBuilder = new TrackMeshBuilder(this.scene);
    this.terrainMeshBuilder = new TerrainMeshBuilder(this.scene);
    this.sceneryInstanceBuilder = new SceneryInstanceBuilder(this.scene);

    this.shadowManager = new CabShadowManager(this.scene, this.camera);
    this.shadowManager.attach(this.sunLight!);
    this.postFxManager = new CabPostFxManager(this.scene, this.camera);
    this.postFxManager.attach();

    window.__railSimCab3d = { snapshot: () => this.snapshot() };
  }

  private createAtmosphere(): void {
    if (!this.scene || !this.camera) return;

    this.skyMaterial = new SkyMaterial('skyMat', this.scene);
    this.skyMaterial.luminance = CabConfig.SKY_LUMINANCE;
    this.skyMaterial.turbidity = CabConfig.SKY_TURBIDITY;
    this.skyMaterial.rayleigh = CabConfig.SKY_RAYLEIGH;
    this.skyMaterial.mieCoefficient = CabConfig.SKY_MIE_COEFFICIENT;
    this.skyMaterial.mieDirectionalG = CabConfig.SKY_MIE_G;
    this.skyMaterial.useSunPosition = true;
    this.skyMaterial.backFaceCulling = false;

    this.skyBox = MeshBuilder.CreateBox(
      'skyBox',
      {
        size: CabConfig.SKY_BOX_SIZE_M,
        sideOrientation: Mesh.BACKSIDE,
      },
      this.scene,
    );
    this.skyBox.infiniteDistance = true;
    this.skyBox.isPickable = false;
    this.skyBox.applyFog = false;
    this.skyBox.material = this.skyMaterial;

    this.sunLight = new DirectionalLight('cabSun', Vector3.Down(), this.scene);
    this.sunLight.intensity = CabConfig.SUN_INTENSITY;

    this.fillLight = new HemisphericLight('cabFill', Vector3.Up(), this.scene);
    this.fillLight.intensity = CabConfig.FILL_LIGHT_INTENSITY;

    this.interiorLight = new PointLight('cabInterior', Vector3.Zero(), this.scene);
    this.interiorLight.intensity = CabConfig.CAB_INTERIOR_LIGHT_INTENSITY;
    this.interiorLight.range = CabConfig.CAB_INTERIOR_LIGHT_RANGE_M;
    this.interiorLight.parent = this.camera;
    this.interiorLight.position = new Vector3(
      CabConfig.CAB_INTERIOR_LIGHT_LOCAL_X_M,
      CabConfig.CAB_INTERIOR_LIGHT_LOCAL_Y_M - CabConfig.EYE_HEIGHT_M,
      CabConfig.CAB_INTERIOR_LIGHT_LOCAL_Z_M,
    );

    this.reflectionProbe = new ReflectionProbe(
      'skyProbe',
      CabConfig.SKY_IBL_RESOLUTION,
      this.scene,
      true,
      false,
      false,
    );
    this.reflectionProbe.renderList = [this.skyBox];
    this.reflectionProbe.cubeTexture.refreshRate = 0;
    this.scene.environmentTexture = this.reflectionProbe.cubeTexture;

    const ipc = this.scene.imageProcessingConfiguration;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = CabConfig.TONEMAPPING_EXPOSURE;
    ipc.contrast = CabConfig.TONEMAPPING_CONTRAST;

    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = CabConfig.FOG_DENSITY;
    this.scene.fogColor = new Color3(
      CabConfig.FOG_COLOR.r,
      CabConfig.FOG_COLOR.g,
      CabConfig.FOG_COLOR.b,
    );
  }

  private updateAtmosphere(snapshot: CabWorldSnapshot): void {
    if (
      !this.scene
      || !this.camera
      || !this.skyMaterial
      || !this.sunLight
      || !this.fillLight
    ) {
      return;
    }

    const simHours = getSimHours(snapshot.elapsedSecs);
    const sun = getSunVector(simHours);

    this.skyMaterial.sunPosition = new Vector3(sun.x, sun.y, sun.z);
    this.skyMaterial.cameraOffset.y = this.camera.position.y;

    this.sunLight.direction = new Vector3(-sun.x, -sun.y, -sun.z);

    const ground = getBandColourRgb(snapshot.biome, 'LOWLAND');
    this.fillLight.groundColor = new Color3(
      ground.r * 0.5,
      ground.g * 0.5,
      ground.b * 0.5,
    );

    if (this.reflectionProbe) {
      const altitude = sun.altitudeDeg;
      if (
        this.lastSunAltitudeDeg === null
        || Math.abs(altitude - this.lastSunAltitudeDeg) > CabConfig.SKY_IBL_ALTITUDE_THRESHOLD_DEG
      ) {
        this.reflectionProbe.cubeTexture.resetRefreshCounter();
        this.lastSunAltitudeDeg = altitude;
      }
    }
  }
}
