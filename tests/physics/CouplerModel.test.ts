import {
  evaluateCoupler,
  type CouplerState,
} from '../../src/physics/CouplerModel';
import type { CouplerPhysicsConfig } from '../../src/physics/TrainPhysicsConfig';

const config: CouplerPhysicsConfig = {
  slackMetres: 0.1,
  stiffnessNPerMetre: 1_000,
  dampingNsPerMetre: 100,
  maxCompressionMetres: 0.3,
  maxTensionMetres: 0.4,
  breakForceN: 500,
};

function state(extension: number, relativeSpeed = 0): CouplerState {
  return {
    id: 'coupler-1',
    leadingVehicleId: 'leading',
    trailingVehicleId: 'trailing',
    extension,
    relativeSpeed,
    forceN: 0,
    broken: false,
  };
}

describe('evaluateCoupler', () => {
  it('applies no spring or damping force while movement remains inside slack', () => {
    const result = evaluateCoupler(state(0.05, 20), config);

    expect(result.state.forceN).toBe(0);
    expect(result.forceOnLeadingN).toBe(0);
    expect(result.forceOnTrailingN).toBe(0);
  });

  it.each([
    ['tension', 0.2, -100, 100],
    ['compression', -0.2, 100, -100],
  ])('applies equal and opposite %s force outside slack', (
    _label,
    extension,
    forceOnLeadingN,
    forceOnTrailingN,
  ) => {
    const result = evaluateCoupler(state(extension), config);

    expect(result.forceOnLeadingN).toBeCloseTo(forceOnLeadingN, 9);
    expect(result.forceOnTrailingN).toBeCloseTo(forceOnTrailingN, 9);
    expect(result.forceOnLeadingN).toBeCloseTo(-result.forceOnTrailingN, 9);
  });

  it('damps separation and closing speed with the correct sign', () => {
    expect(evaluateCoupler(state(0.2, 0.5), config).state.forceN).toBeCloseTo(150, 9);
    expect(evaluateCoupler(state(0.2, -0.5), config).state.forceN).toBeCloseTo(50, 9);
  });

  it('limits draft-gear travel before evaluating overload', () => {
    expect(evaluateCoupler(state(0.8), config).state.forceN).toBeCloseTo(300, 9);
    expect(evaluateCoupler(state(-0.8), config).state.forceN).toBeCloseTo(-200, 9);
  });

  it('breaks once deterministically and stops applying force thereafter', () => {
    const fragile = { ...config, breakForceN: 200 };
    const overload = evaluateCoupler(state(0.4), fragile);

    expect(overload.state.broken).toBe(true);
    expect(overload.brokeThisStep).toBe(true);
    expect(overload.forceOnLeadingN).toBe(0);
    expect(overload.forceOnTrailingN).toBe(0);

    const replay = evaluateCoupler(overload.state, fragile);
    expect(replay.state.broken).toBe(true);
    expect(replay.brokeThisStep).toBe(false);
    expect(replay.state.forceN).toBe(0);
  });
});
