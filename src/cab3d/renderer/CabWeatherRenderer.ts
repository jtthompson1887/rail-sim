import {
  Scene,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PBRMaterial,
  Color3,
  Color4,
  Vector3,
  Texture,
} from '@babylonjs/core';
import { CabConfig } from '../CabConfig';
import type { CabWorldSnapshot } from '../model/CabWorldSnapshot';
import type { CabWeatherState, CabWeatherType } from '../atmosphere/CabWeatherModel';
import { lerpWeather, DEFAULT_WEATHER } from '../atmosphere/CabWeatherModel';
import { getSimHours, getSunVector } from '../atmosphere/CabTimeOfDay';
import type { CabInteriorBuilder } from './CabInteriorBuilder';

/**
 * Applies weather and time-of-day effects to the Babylon scene.
 *
 * - Fog density and colour.
 * - Sun intensity and environment intensity.
 * - Rain/snow particle system in a camera-parented box.
 * - Windscreen droplet planes in front of the cab glass.
 */
export class CabWeatherRenderer {
  private particleSystem: ParticleSystem | null = null;
  private emitterMesh: Mesh | null = null;
  private dropletL: Mesh | null = null;
  private dropletR: Mesh | null = null;
  private dropletMaterialL: PBRMaterial | null = null;
  private dropletMaterialR: PBRMaterial | null = null;
  private particlesStarted = false;

  private previousTarget: Readonly<CabWeatherState> = DEFAULT_WEATHER;
  private targetWeather: Readonly<CabWeatherState> | null = null;
  private transitionStartS = 0;
  private currentWeather: Readonly<CabWeatherState> = DEFAULT_WEATHER;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly sunLight: { direction: any; intensity: number },
    private readonly fillLight: { intensity: number },
    private readonly interiorBuilder: CabInteriorBuilder,
  ) {
    this.createEmitter();
    this.createParticleSystem();
    this.createDroplets();
  }

  /** Update scene effects from the snapshot and time of day. */
  apply(
    snapshot: CabWorldSnapshot,
    eyeNode: { position: Vector3 },
    elapsedSecs: number,
  ): void {
    if (this.disposed) return;

    const target = snapshot.weather ?? DEFAULT_WEATHER;

    if (!this.targetWeather || this.targetWeather.key !== target.key) {
      this.previousTarget = this.targetWeather ? this.currentWeather : target;
      this.targetWeather = target;
      this.transitionStartS = elapsedSecs;
    }

    const transitionS = CabConfig.WEATHER_TRANSITION_S;
    const t = Math.max(0, Math.min(1, (elapsedSecs - this.transitionStartS) / transitionS));
    this.currentWeather = lerpWeather(this.previousTarget, this.targetWeather, t);

    this.parentEmitter(eyeNode);
    this.applyAtmosphere(this.currentWeather, elapsedSecs);
    this.applyParticles(this.currentWeather, this.targetWeather, this.previousTarget);
    this.applyDroplets(this.currentWeather, elapsedSecs);
  }

  /** Release all Babylon resources owned by this renderer. */
  dispose(): void {
    this.disposed = true;
    this.particleSystem?.stop();
    this.particleSystem?.dispose();
    this.particleSystem = null;

    this.emitterMesh?.dispose();
    this.emitterMesh = null;

    this.dropletL?.dispose();
    this.dropletR?.dispose();
    this.dropletL = null;
    this.dropletR = null;

    this.dropletMaterialL?.dispose();
    this.dropletMaterialR?.dispose();
    this.dropletMaterialL = null;
    this.dropletMaterialR = null;
  }

  private createEmitter(): void {
    this.emitterMesh = MeshBuilder.CreateBox(
      'weatherEmitter',
      { size: 0.01 },
      this.scene,
    );
    this.emitterMesh.isVisible = false;
    this.emitterMesh.isPickable = false;
  }

  private parentEmitter(eyeNode: { position: Vector3 }): void {
    if (!this.emitterMesh) return;
    this.emitterMesh.position = eyeNode.position;
    this.emitterMesh.rotation = (eyeNode as any).rotation ?? Vector3.Zero();
  }

  private createParticleSystem(): void {
    this.particleSystem = new ParticleSystem(
      'cabPrecipitation',
      CabConfig.PRECIPITATION_PARTICLE_COUNT,
      this.scene,
    );

    const half = CabConfig.PRECIPITATION_BOX_HALF_M;
    this.particleSystem.minEmitBox = new Vector3(-half.x, -half.y, -half.z);
    this.particleSystem.maxEmitBox = new Vector3(half.x, half.y, half.z);
    this.particleSystem.emitter = this.emitterMesh;

    this.particleSystem.particleTexture = new Texture(
      'assets/cab/precipitation.png',
      this.scene,
    );

    this.particleSystem.minLifeTime = 0.4;
    this.particleSystem.maxLifeTime = 1.2;
    this.particleSystem.updateSpeed = 0.01;
    this.particleSystem.emitRate = 0;
    this.particleSystem.stop();
  }

  private createDroplets(): void {
    const glassL = this.interiorBuilder.getNode('glassL');
    const glassR = this.interiorBuilder.getNode('glassR');

    if (glassL) {
      this.dropletL = this.createDropletPlane('dropletL', glassL);
    }
    if (glassR) {
      this.dropletR = this.createDropletPlane('dropletR', glassR);
    }
  }

  private createDropletPlane(name: string, parent: any): Mesh {
    const size = CabConfig.WINDSCREEN_DROPLET_SIZE_M;
    const mesh = MeshBuilder.CreatePlane(
      name,
      {
        width: size.width,
        height: size.height,
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    mesh.parent = parent;
    mesh.position = new Vector3(0, 0, 0.01);
    mesh.isPickable = false;

    const material = new PBRMaterial(`${name}Mat`, this.scene);
    material.albedoColor = new Color3(0.75, 0.78, 0.82);
    material.alpha = 0;
    material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.metallic = 0;
    material.roughness = 0.1;

    mesh.material = material;

    if (name === 'dropletL') {
      this.dropletMaterialL = material;
    } else {
      this.dropletMaterialR = material;
    }

    return mesh;
  }

  private applyAtmosphere(weather: Readonly<CabWeatherState>, elapsedSecs: number): void {
    const simHours = getSimHours(elapsedSecs);
    const sun = getSunVector(simHours);
    const sunFactor = Math.max(0, sun.y);

    this.scene.fogDensity = weather.fogDensity;
    this.scene.fogColor = this.computeFogColor(sun);
    this.scene.environmentIntensity = weather.envIntensity;

    this.sunLight.intensity = weather.sunIntensity * sunFactor;
    this.sunLight.direction = new Vector3(-sun.x, -sun.y, -sun.z);
    this.fillLight.intensity = CabConfig.FILL_LIGHT_INTENSITY * weather.envIntensity;
  }

  private computeFogColor(sun: { altitudeDeg: number }): Color3 {
    const day = CabConfig.FOG_COLOR;
    const night = { r: 0.05, g: 0.06, b: 0.12 };
    const dayness = Math.max(0, Math.min(1, (sun.altitudeDeg + 6) / 12));

    return new Color3(
      night.r + (day.r - night.r) * dayness,
      night.g + (day.g - night.g) * dayness,
      night.b + (day.b - night.b) * dayness,
    );
  }

  private applyParticles(
    weather: Readonly<CabWeatherState>,
    target: Readonly<CabWeatherState> | null,
    previous: Readonly<CabWeatherState>,
  ): void {
    if (!this.particleSystem) return;

    const count = Math.round(weather.particles);
    const precipType = this.resolvePrecipitationType(weather, target, previous);

    if (count > 0 && precipType) {
      this.configureParticlesForType(precipType);
      this.particleSystem.emitRate = count;
      if (!this.particlesStarted) {
        this.particleSystem.start();
        this.particlesStarted = true;
      }
    } else {
      this.particleSystem.emitRate = 0;
      if (this.particlesStarted) {
        this.particleSystem.stop();
        this.particlesStarted = false;
      }
    }
  }

  private resolvePrecipitationType(
    weather: Readonly<CabWeatherState>,
    target: Readonly<CabWeatherState> | null,
    previous: Readonly<CabWeatherState>,
  ): CabWeatherType | null {
    const precip: readonly CabWeatherType[] = ['rain', 'snow'];
    if (precip.indexOf(weather.state) !== -1) {
      return weather.state;
    }
    if (target && precip.indexOf(target.state) !== -1) {
      return target.state;
    }
    if (precip.indexOf(previous.state) !== -1) {
      return previous.state;
    }
    return null;
  }

  private configureParticlesForType(type: CabWeatherType): void {
    if (!this.particleSystem) return;

    if (type === 'rain') {
      this.particleSystem.gravity = new Vector3(0, -45, 0);
      this.particleSystem.direction1 = new Vector3(-0.5, -25, 0.5);
      this.particleSystem.direction2 = new Vector3(0.5, -35, -0.5);
      this.particleSystem.minSize = 0.015;
      this.particleSystem.maxSize = 0.03;
      this.particleSystem.color1 = new Color4(0.7, 0.75, 0.85, 0.7);
      this.particleSystem.color2 = new Color4(0.65, 0.7, 0.8, 0.85);
      this.particleSystem.colorDead = new Color4(0.6, 0.65, 0.75, 0);
    } else {
      this.particleSystem.gravity = new Vector3(0, -2, 0);
      this.particleSystem.direction1 = new Vector3(-2, -1, -2);
      this.particleSystem.direction2 = new Vector3(2, -2, 2);
      this.particleSystem.minSize = 0.04;
      this.particleSystem.maxSize = 0.08;
      this.particleSystem.color1 = new Color4(0.95, 0.95, 0.95, 0.7);
      this.particleSystem.color2 = new Color4(1, 1, 1, 0.9);
      this.particleSystem.colorDead = new Color4(0.9, 0.9, 0.9, 1);
    }
  }

  private applyDroplets(weather: Readonly<CabWeatherState>, elapsedSecs: number): void {
    const inWetWeather = weather.state === 'rain' || weather.state === 'snow';
    const alpha = inWetWeather ? this.computeDropletAlpha(elapsedSecs) : 0;

    if (this.dropletMaterialL) {
      this.dropletMaterialL.alpha = alpha;
    }
    if (this.dropletMaterialR) {
      this.dropletMaterialR.alpha = alpha;
    }
  }

  private computeDropletAlpha(elapsedSecs: number): number {
    const interval = CabConfig.WINDSCREEN_WIPER_INTERVAL_S;
    const ramp = CabConfig.WINDSCREEN_DROPLET_RAMP_S;
    if (interval <= 0 || ramp <= 0) return 0;

    const elapsedSinceWipe = elapsedSecs % interval;
    return Math.min(1, Math.max(0, elapsedSinceWipe / ramp));
  }
}
