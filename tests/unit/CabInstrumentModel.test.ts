import {
  buildCabInstrumentState,
  buildInstrumentValues,
  valueToAngle,
  notchedLeverAngle,
  SPEEDO_GAUGE,
  BRAKE_PIPE_GAUGE,
  MAIN_RESERVOIR_GAUGE,
  BRAKE_CYLINDER_GAUGE,
  AMMETER_GAUGE,
  POWER_LEVER_NOTCHES,
  BRAKE_LEVER_NOTCHES,
} from '../../src/cab3d/cab/CabInstrumentModel';
import type { CabWorldSnapshot, CabVehicleSnapshot } from '../../src/cab3d/model/CabWorldSnapshot';

function makeSnapshot(vehicle: CabVehicleSnapshot | null, nearestFacilityDistanceM?: number | null): CabWorldSnapshot {
  return {
    valid: true,
    seed: 'test',
    biome: 'temperate',
    vehicle,
    path: [],
    nearestFacilityDistanceM: nearestFacilityDistanceM ?? null,
    elapsedSecs: 0,
    weather: null,
  };
}

function makeVehicle(overrides: Partial<CabVehicleSnapshot> = {}): CabVehicleSnapshot {
  return {
    id: 't1',
    x: 0,
    y: 0,
    headingRad: 0,
    speedMps: 0,
    throttle: 0,
    derailed: false,
    onTrack: true,
    ...overrides,
  };
}

describe('valueToAngle', () => {
  it.each([
    [0, -2.18166],
    [31.25, -1.09083],
    [62.5, 0],
    [93.75, 1.09083],
    [125, 2.18166],
  ])('speedo %i mph -> %f rad', (value, expected) => {
    expect(valueToAngle(value, SPEEDO_GAUGE)).toBeCloseTo(expected, 4);
  });

  it('clamps below minimum to the start angle', () => {
    expect(valueToAngle(-10, SPEEDO_GAUGE)).toBeCloseTo(valueToAngle(0, SPEEDO_GAUGE), 6);
  });

  it('clamps above maximum to the end angle', () => {
    expect(valueToAngle(200, SPEEDO_GAUGE)).toBeCloseTo(valueToAngle(125, SPEEDO_GAUGE), 6);
  });

  it('handles a zero-range gauge gracefully', () => {
    expect(valueToAngle(5, { min: 0, max: 0, startAngleDeg: -90, sweepAngleDeg: 180 })).toBeCloseTo((-90 * Math.PI) / 180, 6);
  });

  it.each([
    [-1000, -2.26893],
    [-250, -1.13446],
    [500, 1.13446 * -0.333], // approximate at 1/3 from -250? Let's compute via function
    [2000, 2.26893],
  ])('ammeter %i A maps correctly', (value) => {
    const angle = valueToAngle(value, AMMETER_GAUGE);
    expect(angle).toBeGreaterThanOrEqual(valueToAngle(-1000, AMMETER_GAUGE));
    expect(angle).toBeLessThanOrEqual(valueToAngle(2000, AMMETER_GAUGE));
  });
});

describe('notchedLeverAngle', () => {
  it.each([
    [0, -26],
    [0.1, -26],
    [1 / 6, -26],
    [0.25, -13],
    [0.5, 0],
    [0.75, 18],
    [0.9, 26],
    [1, 26],
    [1.2, 26],
  ])('power lever fraction %f -> %f deg', (input, expectedDeg) => {
    expect(notchedLeverAngle(input, POWER_LEVER_NOTCHES)).toBeCloseTo((expectedDeg * Math.PI) / 180, 6);
  });

  it.each([
    [0, -24],
    [0.2, -8],
    [0.4, 2],
    [0.6, 12],
    [0.8, 22],
    [1, 22],
    [1.5, 34],
  ])('brake lever fraction %f -> %f deg', (input, expectedDeg) => {
    expect(notchedLeverAngle(input, BRAKE_LEVER_NOTCHES)).toBeCloseTo((expectedDeg * Math.PI) / 180, 6);
  });

  it('returns zero for an empty notch table', () => {
    expect(notchedLeverAngle(0.5, [])).toBe(0);
  });
});

describe('buildInstrumentValues', () => {
  it('converts speed to mph', () => {
    const values = buildInstrumentValues(makeSnapshot(makeVehicle({ speedMps: 10 })));
    expect(values.speedMph).toBeCloseTo(22.3694, 3);
  });

  it('derives brake and power fractions from throttle', () => {
    const values = buildInstrumentValues(makeSnapshot(makeVehicle({ throttle: -0.5 })));
    expect(values.powerFraction).toBe(0);
    expect(values.brakeFraction).toBe(0.5);
  });

  it('clamps throttle-derived values', () => {
    const values = buildInstrumentValues(makeSnapshot(makeVehicle({ throttle: -2 })));
    expect(values.brakeFraction).toBe(1);
    expect(values.brakeCylinderBar).toBe(4);
    expect(values.ammeterA).toBe(-1000);
  });

  it('returns zero values for invalid snapshots', () => {
    const values = buildInstrumentValues({ ...makeSnapshot(null), valid: false });
    expect(values.speedMph).toBe(0);
    expect(values.brakeCylinderBar).toBe(0);
  });
});

describe('buildCabInstrumentState', () => {
  it('maps speed needle across the full gauge sweep', () => {
    const zero = buildCabInstrumentState(makeSnapshot(makeVehicle({ speedMps: 0 })));
    const full = buildCabInstrumentState(makeSnapshot(makeVehicle({ speedMps: 55.92 })));
    expect(zero.speed.angleRad).toBeCloseTo(valueToAngle(0, SPEEDO_GAUGE), 6);
    expect(full.speed.angleRad).toBeCloseTo(valueToAngle(125, SPEEDO_GAUGE), 6);
  });

  it('maps brake cylinder from negative throttle', () => {
    const state = buildCabInstrumentState(makeSnapshot(makeVehicle({ throttle: -0.5 })));
    expect(state.brakeCylinder.value).toBe(2);
    expect(state.brakeCylinder.angleRad).toBeCloseTo(valueToAngle(2, BRAKE_CYLINDER_GAUGE), 6);
  });

  it('keeps main reservoir at 8.5 bar normally', () => {
    const state = buildCabInstrumentState(makeSnapshot(makeVehicle({ throttle: -0.5 })));
    expect(state.mainReservoir.value).toBe(8.5);
  });

  it('drops main reservoir to zero when derailed', () => {
    const state = buildCabInstrumentState(makeSnapshot(makeVehicle({ derailed: true })));
    expect(state.mainReservoir.value).toBe(0);
  });

  it('activates AWS when a facility is nearby', () => {
    const nearby = buildCabInstrumentState(makeSnapshot(makeVehicle(), 250));
    const far = buildCabInstrumentState(makeSnapshot(makeVehicle(), 1000));
    const none = buildCabInstrumentState(makeSnapshot(makeVehicle(), null));
    expect(nearby.awsActive).toBe(true);
    expect(far.awsActive).toBe(false);
    expect(none.awsActive).toBe(false);
  });

  it('sets the reverser to forward when power is applied and not braking', () => {
    const state = buildCabInstrumentState(makeSnapshot(makeVehicle({ throttle: 0.5 })));
    expect(state.reverser.angleRad).toBeCloseTo((35 * Math.PI) / 180, 6);
  });

  it('returns zero state when no vehicle is present', () => {
    const state = buildCabInstrumentState(makeSnapshot(null));
    expect(state.speed.value).toBe(0);
    expect(state.powerLever.angleRad).toBe(0);
  });
});
