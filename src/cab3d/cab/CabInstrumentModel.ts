import { degToRad } from '../model/CabCoordinate';
import type { CabWorldSnapshot, CabVehicleSnapshot } from '../model/CabWorldSnapshot';

/** AWS sunflower activates when a facility is within this distance in metres. */
const AWS_APPROACH_DISTANCE_M = 400;

/** Emergency threshold on the normalised brake fraction. */
const EMERGENCY_BRAKE_THRESHOLD = 0.95;

/** Base main-reservoir pressure in bar. */
const MAIN_RESERVOIR_BAR = 8.5;

/** Base brake-pipe pressure in bar. */
const BRAKE_PIPE_BASE_BAR = 5;

/** Brake-pipe pressure drop at full brake in bar. */
const BRAKE_PIPE_DROP_BAR = 3.5;

export interface CabGaugeDef {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly startAngleDeg: number;
  readonly sweepAngleDeg: number;
  readonly unit: string;
  readonly majorTicks: number;
}

export const SPEEDO_GAUGE: CabGaugeDef = {
  id: 'speedo',
  min: 0,
  max: 125,
  startAngleDeg: -125,
  sweepAngleDeg: 250,
  unit: 'mph',
  majorTicks: 6,
};

export const BRAKE_PIPE_GAUGE: CabGaugeDef = {
  id: 'brakePipe',
  min: 0,
  max: 7,
  startAngleDeg: -135,
  sweepAngleDeg: 270,
  unit: 'bar',
  majorTicks: 8,
};

export const MAIN_RESERVOIR_GAUGE: CabGaugeDef = {
  id: 'mainReservoir',
  min: 0,
  max: 10,
  startAngleDeg: -135,
  sweepAngleDeg: 270,
  unit: 'bar',
  majorTicks: 6,
};

export const BRAKE_CYLINDER_GAUGE: CabGaugeDef = {
  id: 'brakeCylinder',
  min: 0,
  max: 4,
  startAngleDeg: -120,
  sweepAngleDeg: 240,
  unit: 'bar',
  majorTicks: 5,
};

export const AMMETER_GAUGE: CabGaugeDef = {
  id: 'ammeter',
  min: -1000,
  max: 2000,
  startAngleDeg: -130,
  sweepAngleDeg: 260,
  unit: 'A',
  majorTicks: 7,
};

export interface CabNeedleState {
  readonly value: number;
  readonly angleRad: number;
}

export interface CabLeverState {
  readonly angleRad: number;
}

export interface CabInstrumentState {
  readonly speed: CabNeedleState;
  readonly brakePipe: CabNeedleState;
  readonly mainReservoir: CabNeedleState;
  readonly brakeCylinder: CabNeedleState;
  readonly ammeter: CabNeedleState;
  readonly awsActive: boolean;
  readonly powerLever: CabLeverState;
  readonly brakeLever: CabLeverState;
  readonly reverser: CabLeverState;
}

export interface CabInstrumentValues {
  readonly speedMph: number;
  readonly brakePipeBar: number;
  readonly mainReservoirBar: number;
  readonly brakeCylinderBar: number;
  readonly ammeterA: number;
  readonly powerFraction: number;
  readonly brakeFraction: number;
}

/**
 * Convert a value to a needle angle in radians using a gauge definition.
 *
 * The angle is zero at the gauge start and increases linearly across the sweep.
 */
export function valueToAngle(
  value: number,
  gauge: Pick<CabGaugeDef, 'min' | 'max' | 'startAngleDeg' | 'sweepAngleDeg'>,
): number {
  const range = gauge.max - gauge.min;
  const t = range === 0 ? 0 : (value - gauge.min) / range;
  const clamped = Math.max(0, Math.min(1, t));
  return degToRad(gauge.startAngleDeg + clamped * gauge.sweepAngleDeg);
}

/**
 * Select a lever angle from a table of notches based on a normalised input.
 *
 * `notches` must be sorted by `input` ascending and end with an entry whose
 * `input` is `Infinity`.
 */
export function notchedLeverAngle(
  input: number,
  notches: ReadonlyArray<{ readonly input: number; readonly angleDeg: number }>,
): number {
  let selected = notches[notches.length - 1]?.angleDeg ?? 0;
  for (const notch of notches) {
    if (input <= notch.input) {
      selected = notch.angleDeg;
      break;
    }
  }
  return degToRad(selected);
}

/**
 * Power-controller notches: Off, N1, N2, N3, N4, N5.
 */
export const POWER_LEVER_NOTCHES = Object.freeze([
  { input: 1 / 6, angleDeg: -26 },
  { input: 2 / 6, angleDeg: -13 },
  { input: 3 / 6, angleDeg: 0 },
  { input: 4 / 6, angleDeg: 9 },
  { input: 5 / 6, angleDeg: 18 },
  { input: 1, angleDeg: 26 },
  { input: Infinity, angleDeg: 26 },
] as const);

/**
 * Brake-controller notches: Release, Initial, Step 2, Step 3, Full Service,
 * Emergency.
 */
export const BRAKE_LEVER_NOTCHES = Object.freeze([
  { input: 0, angleDeg: -24 },
  { input: 1 / 5, angleDeg: -8 },
  { input: 2 / 5, angleDeg: 2 },
  { input: 3 / 5, angleDeg: 12 },
  { input: 4 / 5, angleDeg: 22 },
  { input: 1, angleDeg: 22 },
  { input: Infinity, angleDeg: 34 },
] as const);

function computeBrakePipeBar(throttle: number): number {
  if (throttle >= 0) return BRAKE_PIPE_BASE_BAR;
  const brake = Math.min(1, -throttle);
  return Math.max(0, BRAKE_PIPE_BASE_BAR - brake * BRAKE_PIPE_DROP_BAR);
}

function computeMainReservoirBar(vehicle: CabVehicleSnapshot): number {
  if (vehicle.derailed) return 0;
  const brake = Math.max(0, -vehicle.throttle);
  if (brake >= EMERGENCY_BRAKE_THRESHOLD) return 0;
  return MAIN_RESERVOIR_BAR;
}

function computeBrakeCylinderBar(throttle: number): number {
  return Math.max(0, Math.min(4, -throttle * 4));
}

function computeAmmeterA(throttle: number): number {
  return Math.max(-1000, Math.min(2000, throttle * 1800));
}

function awsActive(snapshot: CabWorldSnapshot): boolean {
  const distance = snapshot.nearestFacilityDistanceM;
  return typeof distance === 'number' && distance < AWS_APPROACH_DISTANCE_M;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Extract the raw instrument values from a snapshot.
 *
 * This is exposed separately from {@link buildCabInstrumentState} so tests can
 * inspect the physical values before they are converted to angles.
 */
export function buildInstrumentValues(snapshot: CabWorldSnapshot): CabInstrumentValues {
  const vehicle = snapshot.vehicle;
  if (!snapshot.valid || !vehicle) {
    return {
      speedMph: 0,
      brakePipeBar: 0,
      mainReservoirBar: 0,
      brakeCylinderBar: 0,
      ammeterA: 0,
      powerFraction: 0,
      brakeFraction: 0,
    };
  }

  const throttle = vehicle.throttle;
  return {
    speedMph: vehicle.speedMps * 2.23694,
    brakePipeBar: computeBrakePipeBar(throttle),
    mainReservoirBar: computeMainReservoirBar(vehicle),
    brakeCylinderBar: computeBrakeCylinderBar(throttle),
    ammeterA: computeAmmeterA(throttle),
    powerFraction: clamp01(throttle),
    brakeFraction: clamp01(-throttle),
  };
}

const ZERO_INSTRUMENT_STATE: CabInstrumentState = Object.freeze({
  speed: { value: 0, angleRad: 0 },
  brakePipe: { value: 0, angleRad: 0 },
  mainReservoir: { value: 0, angleRad: 0 },
  brakeCylinder: { value: 0, angleRad: 0 },
  ammeter: { value: 0, angleRad: 0 },
  awsActive: false,
  powerLever: { angleRad: 0 },
  brakeLever: { angleRad: 0 },
  reverser: { angleRad: 0 },
});

/**
 * Map a snapshot to the full set of live instrument states.
 *
 * This function is pure: it does not import Babylon or the DOM.
 */
export function buildCabInstrumentState(snapshot: CabWorldSnapshot): CabInstrumentState {
  if (!snapshot.valid || !snapshot.vehicle) {
    return ZERO_INSTRUMENT_STATE;
  }

  const values = buildInstrumentValues(snapshot);

  return {
    speed: {
      value: values.speedMph,
      angleRad: valueToAngle(values.speedMph, SPEEDO_GAUGE),
    },
    brakePipe: {
      value: values.brakePipeBar,
      angleRad: valueToAngle(values.brakePipeBar, BRAKE_PIPE_GAUGE),
    },
    mainReservoir: {
      value: values.mainReservoirBar,
      angleRad: valueToAngle(values.mainReservoirBar, MAIN_RESERVOIR_GAUGE),
    },
    brakeCylinder: {
      value: values.brakeCylinderBar,
      angleRad: valueToAngle(values.brakeCylinderBar, BRAKE_CYLINDER_GAUGE),
    },
    ammeter: {
      value: values.ammeterA,
      angleRad: valueToAngle(values.ammeterA, AMMETER_GAUGE),
    },
    awsActive: awsActive(snapshot),
    powerLever: {
      angleRad: notchedLeverAngle(values.powerFraction, POWER_LEVER_NOTCHES),
    },
    brakeLever: {
      angleRad: notchedLeverAngle(values.brakeFraction, BRAKE_LEVER_NOTCHES),
    },
    reverser: {
      angleRad: computeReverserAngleRad(values.powerFraction, values.brakeFraction),
    },
  };
}

function computeReverserAngleRad(power: number, brake: number): number {
  if (brake > 1 / 5) return degToRad(-35);
  if (power > 1 / 5) return degToRad(35);
  return 0;
}

/**
 * Gauge face definitions, ordered so a builder can create textures by material id.
 */
export const CAB_GAUGE_FACE_DEFS: ReadonlyArray<{
  materialId: string;
  gauge: CabGaugeDef;
  label?: string;
}> = Object.freeze([
  { materialId: 'dynSpeedo', gauge: SPEEDO_GAUGE, label: 'SPEED' },
  { materialId: 'dynBrakeDuplex', gauge: MAIN_RESERVOIR_GAUGE, label: 'BRAKE' },
  { materialId: 'dynBrakeCyl', gauge: BRAKE_CYLINDER_GAUGE, label: 'B.CYL' },
  { materialId: 'dynAmmeter', gauge: AMMETER_GAUGE, label: 'AMPS' },
]);
