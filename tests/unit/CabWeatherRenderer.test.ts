import {
  Vector3,
  ParticleSystem,
  PBRMaterial,
} from '@babylonjs/core';
import { CabWeatherRenderer } from '../../src/cab3d/renderer/CabWeatherRenderer';
import { WEATHER_STATE_TABLE } from '../../src/cab3d/atmosphere/CabWeatherModel';
import type { CabWeatherState, CabWeatherType } from '../../src/cab3d/atmosphere/CabWeatherModel';
import type { CabWorldSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';
import { CabConfig } from '../../src/cab3d/CabConfig';

function makeWeather(
  state: CabWeatherType,
  key: string = state,
): Readonly<CabWeatherState> {
  return Object.freeze({
    key,
    state,
    ...WEATHER_STATE_TABLE[state],
  });
}

function makeSnapshot(
  weather: Readonly<CabWeatherState>,
  elapsedSecs = 360,
): CabWorldSnapshot {
  return {
    valid: true,
    seed: 'test',
    biome: 'temperate',
    vehicle: null,
    path: [],
    elapsedSecs,
    weather,
  };
}

function makeInteriorBuilder(glassL: any, glassR: any) {
  return {
    getNode: jest.fn((id: string) => {
      if (id === 'glassL') return glassL;
      if (id === 'glassR') return glassR;
      return undefined;
    }),
  } as any;
}

describe('CabWeatherRenderer', () => {
  let scene: any;
  let sunLight: any;
  let fillLight: any;
  let eyeNode: any;
  let glassL: any;
  let glassR: any;
  let interiorBuilder: any;
  let renderer: CabWeatherRenderer;

  beforeEach(() => {
    scene = { fogMode: 0, fogDensity: 0, fogColor: null, environmentIntensity: 1 };
    sunLight = { direction: null, intensity: 1 };
    fillLight = { intensity: 1 };
    eyeNode = { position: new Vector3(0, 2.4, 0), rotation: new Vector3(0, 0, 0) };
    glassL = { id: 'glassL', parent: null, position: null };
    glassR = { id: 'glassR', parent: null, position: null };
    interiorBuilder = makeInteriorBuilder(glassL, glassR);
    renderer = new CabWeatherRenderer(scene, sunLight, fillLight, interiorBuilder);
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('can be constructed and disposed without error', () => {
    expect(renderer).toBeDefined();
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('parents the precipitation emitter to the eye node', () => {
    renderer.apply(makeSnapshot(makeWeather('clear')), eyeNode, 360);
    expect((renderer as any).emitterMesh.position).toBe(eyeNode.position);
    expect((renderer as any).emitterMesh.rotation).toBe(eyeNode.rotation);
  });

  it('applies clear weather fog, lights and environment', () => {
    const weather = makeWeather('clear');
    renderer.apply(makeSnapshot(weather), eyeNode, 360);

    expect(scene.fogDensity).toBe(weather.fogDensity);
    expect(scene.environmentIntensity).toBe(weather.envIntensity);
    expect(fillLight.intensity).toBe(CabConfig.FILL_LIGHT_INTENSITY * weather.envIntensity);
    expect(sunLight.intensity).toBe(weather.sunIntensity);
    expect(sunLight.direction).toBeDefined();
    expect(scene.fogColor).toBeDefined();

    const fog = scene.fogColor;
    expect(fog.r).toBeCloseTo(CabConfig.FOG_COLOR.r, 10);
    expect(fog.g).toBeCloseTo(CabConfig.FOG_COLOR.g, 10);
    expect(fog.b).toBeCloseTo(CabConfig.FOG_COLOR.b, 10);
  });

  it('dims the fog colour at night', () => {
    renderer.apply(makeSnapshot(makeWeather('clear'), 960), eyeNode, 960);
    const fog = scene.fogColor;
    expect(fog.r).toBeCloseTo(0.05, 10);
    expect(fog.g).toBeCloseTo(0.06, 10);
    expect(fog.b).toBeCloseTo(0.12, 10);
  });

  it('starts rain particles and configures them for falling rain', () => {
    const weather = makeWeather('rain');
    renderer.apply(makeSnapshot(weather), eyeNode, 360);

    const ps = (renderer as any).particleSystem as ParticleSystem;
    expect(ps.emitRate).toBe(weather.particles);
    expect(ps.start).toHaveBeenCalled();
    expect(ps.gravity.y).toBeLessThan(-30);
    expect(ps.direction1.y).toBeLessThan(-10);
  });

  it('stops the particle system when the weather is clear', () => {
    renderer.apply(makeSnapshot(makeWeather('rain')), eyeNode, 360);
    const ps = (renderer as any).particleSystem as ParticleSystem;
    expect(ps.start).toHaveBeenCalled();

    renderer.apply(makeSnapshot(makeWeather('clear')), eyeNode, 360);
    renderer.apply(makeSnapshot(makeWeather('clear')), eyeNode, 380);
    expect(ps.emitRate).toBe(0);
    expect(ps.stop).toHaveBeenCalled();
  });

  it('configures snow particles differently from rain', () => {
    const weather = makeWeather('snow');
    renderer.apply(makeSnapshot(weather), eyeNode, 360);

    const ps = (renderer as any).particleSystem as ParticleSystem;
    expect(ps.emitRate).toBe(weather.particles);
    expect(ps.gravity.y).toBeGreaterThan(-10);
    expect(ps.minSize).toBeGreaterThan(0.03);
  });

  it('creates droplet planes in front of the left and right glass', () => {
    renderer.apply(makeSnapshot(makeWeather('rain')), eyeNode, 360);

    const left = (renderer as any).dropletL;
    const right = (renderer as any).dropletR;

    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left.parent).toBe(glassL);
    expect(right.parent).toBe(glassR);
    expect(left.position.z).toBe(0.01);
    expect(right.position.z).toBe(0.01);
    expect(left.material).toBeInstanceOf(PBRMaterial);
  });

  it('ramps droplet alpha up during rain and resets after a wiper pass', () => {
    const weather = makeWeather('rain');

    renderer.apply(makeSnapshot(weather), eyeNode, 0.9);
    let alpha = (renderer as any).dropletMaterialL.alpha as number;
    expect(alpha).toBeGreaterThan(0.4);
    expect(alpha).toBeLessThan(0.6);

    renderer.apply(makeSnapshot(weather), eyeNode, 1.8);
    alpha = (renderer as any).dropletMaterialL.alpha as number;
    expect(alpha).toBe(1);

    renderer.apply(makeSnapshot(weather), eyeNode, 2.0);
    alpha = (renderer as any).dropletMaterialL.alpha as number;
    expect(alpha).toBe(0);
  });

  it('hides droplets when the weather is not wet', () => {
    renderer.apply(makeSnapshot(makeWeather('rain')), eyeNode, 1.8);
    expect((renderer as any).dropletMaterialL.alpha).toBe(1);

    renderer.apply(makeSnapshot(makeWeather('clear')), eyeNode, 1.8);
    renderer.apply(makeSnapshot(makeWeather('clear')), eyeNode, 21.8);
    expect((renderer as any).dropletMaterialL.alpha).toBe(0);
    expect((renderer as any).dropletMaterialR.alpha).toBe(0);
  });

  it('transitions weather values over the configured duration', () => {
    const clear = makeWeather('clear', 'clear-1');
    const rain = makeWeather('rain', 'rain-1');

    renderer.apply(makeSnapshot(clear), eyeNode, 0);
    expect(scene.fogDensity).toBe(clear.fogDensity);

    renderer.apply(makeSnapshot(rain), eyeNode, 0);
    renderer.apply(makeSnapshot(rain), eyeNode, 10);
    expect(scene.fogDensity).toBeGreaterThan(clear.fogDensity);
    expect(scene.fogDensity).toBeLessThan(rain.fogDensity);

    renderer.apply(makeSnapshot(rain), eyeNode, 20);
    expect(scene.fogDensity).toBeCloseTo(rain.fogDensity, 10);
  });

  it('disposes particles, droplets and materials', () => {
    renderer.apply(makeSnapshot(makeWeather('rain')), eyeNode, 360);
    const ps = (renderer as any).particleSystem as ParticleSystem;
    const left = (renderer as any).dropletL as any;
    const matL = (renderer as any).dropletMaterialL as PBRMaterial;

    renderer.dispose();

    expect(ps.stop).toHaveBeenCalled();
    expect(ps.dispose).toHaveBeenCalled();
    expect(left.dispose).toHaveBeenCalled();
    expect(matL.dispose).toHaveBeenCalled();
  });
});
