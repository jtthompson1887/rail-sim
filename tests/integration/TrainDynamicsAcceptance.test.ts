import Train from '../../src/entities/Train';
import { GameConfig } from '../../src/config/GameConfig';
import { runTrainPhysicsScenario } from '../../src/physics/TrainPhysicsHarness';
import {
  FORTY_CAR_SCENARIO,
  MIXED_POWER_SCENARIO,
  SAFE_CURVE_SCENARIO,
  TRAIN_PHYSICS_STRESS_SCENARIO,
} from '../../src/physics/TrainPhysicsScenarios';

const { makeScene } = require('../../__mocks__/phaser');

describe('dual-mode train dynamics acceptance', () => {
  it('keeps vehicle entities passive while the bogie solver owns rail motion', () => {
    const train = new Train(makeScene(), 0, 0, 'passive-entity');
    train.enginePower = GameConfig.TRAIN.ENGINE_POWER;
    expect((train as any).update).toBeUndefined();
    expect((train.getMatterBody().body as any).force).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ['safe curve', SAFE_CURVE_SCENARIO],
    ['mixed powered and unpowered cars', MIXED_POWER_SCENARIO],
    ['40-car acceptance', FORTY_CAR_SCENARIO],
    ['100-car stress', TRAIN_PHYSICS_STRESS_SCENARIO],
  ])('meets exact bogie and finite-force gates for %s', (_label, scenario) => {
    const metrics = runTrainPhysicsScenario(scenario);

    expect(metrics.maxFrontBogieError).toBeLessThan(0.01);
    expect(metrics.maxRearBogieError).toBeLessThan(0.01);
    expect(metrics.maxWheelbaseError).toBeLessThan(0.01);
    expect(metrics.maxTransitionJump).toBeLessThan(0.1);
    expect(Number.isFinite(metrics.maxCouplerForceN)).toBe(true);
    expect(Number.isFinite(metrics.maxAccelerationMps2)).toBe(true);
  });
});
