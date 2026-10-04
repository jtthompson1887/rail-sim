import { runTrainPhysicsScenario } from '../../src/physics/TrainPhysicsHarness';
import {
  TRAIN_PHYSICS_SCENARIOS,
  TRAIN_PHYSICS_STRESS_SCENARIO,
} from '../../src/physics/TrainPhysicsScenarios';

describe('train physics performance gates', () => {
  it('runs the standard corpus in under two seconds', () => {
    const started = performance.now();
    TRAIN_PHYSICS_SCENARIOS.forEach((scenario) => runTrainPhysicsScenario(scenario));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('runs the 100-car diagnostic stress case in under five seconds', () => {
    const started = performance.now();
    const metrics = runTrainPhysicsScenario(TRAIN_PHYSICS_STRESS_SCENARIO);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(metrics.maxFrontBogieError).toBeLessThan(0.01);
    expect(metrics.maxRearBogieError).toBeLessThan(0.01);
  });
});
